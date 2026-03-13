(function (global) {
	const ExampleUtilsRef = global.ExampleUtils;
	let lastUrl = "";
	let highlightDebounceTimer = null;
	let ignoreMutationsUntil = 0;

	function isCjkText(text) {
		return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text || "");
	}

	function isWordChar(char) {
		return !!char && /[\p{L}\p{N}]/u.test(char);
	}

	function isBoundaryMatch(text, start, end, cjkWord) {
		if (cjkWord) return true;
		const prev = start > 0 ? text[start - 1] : "";
		const next = end < text.length ? text[end] : "";
		return !isWordChar(prev) && !isWordChar(next);
	}

	function findNextWholeWordIndex(text, lowerText, word, fromIndex, languageHint) {
		if (ExampleUtilsRef && typeof ExampleUtilsRef.findWholeWordMatch === "function") {
			const match = ExampleUtilsRef.findWholeWordMatch(text, word, languageHint, fromIndex);
			return match ? match.index : -1;
		}
		const lowerWord = (word || "").toLowerCase();
		const cjkWord = isCjkText(word);
		let searchFrom = fromIndex;

		while (searchFrom < text.length) {
			const idx = lowerText.indexOf(lowerWord, searchFrom);
			if (idx === -1) return -1;
			const end = idx + word.length;
			if (isBoundaryMatch(text, idx, end, cjkWord)) return idx;
			searchFrom = idx + 1;
		}
		return -1;
	}

	function containsWord(text, word, languageHint) {
		const trimmed = (word || "").trim();
		if (!trimmed) return false;
		const rawText = text || "";
		const lowerText = rawText.toLowerCase();
		return findNextWholeWordIndex(rawText, lowerText, trimmed.toLowerCase(), 0, languageHint) !== -1;
	}

	function normalizePageKey(url, normalizeText) {
		if (!url) return "";
		try {
			const u = new URL(url);
			return `${u.origin}${u.pathname}`;
		} catch (error) {
			return normalizeText(url);
		}
	}

	function getDerivedPageCountFromExamples(wordData, normalizeText) {
		const examples = Array.isArray(wordData && wordData.examples) ? wordData.examples : [];
		const keys = new Set();
		for (let i = 0; i < examples.length; i += 1) {
			const entry = examples[i] || {};
			const key = normalizePageKey(entry.sourceUrl || entry.url || "", normalizeText);
			if (key) keys.add(key);
		}
		return keys.size;
	}

	function getContextContainerForNode(node) {
		const parentElement = node && node.parentElement;
		if (!parentElement) return null;
		return parentElement.closest("p, li, article, section, blockquote, td");
	}

	function getContextTextForNode(node, normalizeText) {
		const parentElement = node.parentElement;
		if (!parentElement) return normalizeText(node.nodeValue || "");
		const container = getContextContainerForNode(node);
		const text = container ? container.textContent : (parentElement.textContent || node.nodeValue);
		const normalized = normalizeText(text || "");
		if (normalized.length > 2500) return "";
		return normalized;
	}

	function collectExampleCandidates(bodyTextNodes, storedWordsArray, storedWords, deps) {
		const candidates = {};
		const splitIntoSentences = deps.splitIntoSentences;
		const isLowInformationExample = deps.isLowInformationExample;
		const normalizeText = deps.normalizeText;
		const currentHref = deps.currentHref;
		const seenContexts = new Set();
		for (let i = 0; i < bodyTextNodes.length; i += 1) {
			const node = bodyTextNodes[i];
			const container = getContextContainerForNode(node);
			if (container) {
				if (seenContexts.has(container)) continue;
				seenContexts.add(container);
			}
			const contextText = getContextTextForNode(node, normalizeText);
			if (!contextText || contextText.length < 8) continue;
			const sentences = splitIntoSentences(contextText);
			if (sentences.length === 0) continue;

			for (let w = 0; w < storedWordsArray.length; w += 1) {
				const word = storedWordsArray[w];
				if (!storedWords[word] || storedWords[word].learned) continue;
				if (!containsWord(contextText, word, deps.languageHint)) continue;

				for (let s = 0; s < sentences.length; s += 1) {
					const sentence = sentences[s];
					if (!containsWord(sentence, word, deps.languageHint)) continue;
					if (isLowInformationExample(sentence, word)) continue;
					if (!candidates[word]) candidates[word] = [];
					candidates[word].push({
						text: sentence,
						sourceUrl: currentHref,
						capturedAt: Date.now(),
					});
				}
			}
		}
		return candidates;
	}

	function enqueueExampleCandidates(candidates, state, deps) {
		const words = Object.keys(candidates);
		if (words.length === 0) return;

		words.forEach((word) => {
			if (!state.pendingExampleMap[word]) state.pendingExampleMap[word] = [];
			state.pendingExampleMap[word] = state.pendingExampleMap[word].concat(candidates[word]);
		});

		if (state.exampleMergeTimer) clearTimeout(state.exampleMergeTimer);
		state.exampleMergeTimer = setTimeout(async () => {
			const batch = state.pendingExampleMap;
			state.pendingExampleMap = {};
			state.exampleMergeTimer = null;
			try {
				const wordsData = await deps.WordStorage.getWords();
				let changed = false;

				Object.keys(batch).forEach((word) => {
					if (!wordsData[word]) return;
					if (wordsData[word].learned) return;
					const existing = deps.normalizeExampleList(wordsData[word].examples);
					const existingSet = new Set(existing.map((item) => item.text.toLowerCase()));
					const incoming = batch[word]
						.map((item) => {
							const text = deps.normalizeText(item && item.text ? item.text : "");
							if (!text) return null;
							return {
								text,
								sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : "",
								capturedAt: typeof item.capturedAt === "number" ? item.capturedAt : Date.now(),
							};
						})
						.filter(Boolean);
					const newOnes = [];
					const comparisonPool = existing.map((item) => item.text);

					for (let i = incoming.length - 1; i >= 0; i -= 1) {
						const sample = incoming[i];
						if (deps.isLowInformationExample(sample.text, word)) continue;
						const key = sample.text.toLowerCase();
						if (existingSet.has(key)) {
							for (let e = 0; e < existing.length; e += 1) {
								const existingItem = existing[e];
								if (existingItem.text.toLowerCase() !== key) continue;
								let touched = false;
								if (!existingItem.sourceUrl && sample.sourceUrl) {
									existingItem.sourceUrl = sample.sourceUrl;
									touched = true;
								}
								if (!existingItem.capturedAt && sample.capturedAt) {
									existingItem.capturedAt = sample.capturedAt;
									if (!existingItem.createdAt) existingItem.createdAt = sample.capturedAt;
									touched = true;
								}
								if (touched) changed = true;
								break;
							}
							continue;
						}
						if (newOnes.find((x) => x.text.toLowerCase() === key)) continue;
					if (deps.hasContainmentRelation(sample.text, comparisonPool, deps.languageHint)) continue;
					if (deps.isTooSimilarToAny(sample.text, comparisonPool, deps.languageHint)) continue;
						newOnes.push(sample);
						comparisonPool.push(sample.text);
					}

					if (newOnes.length === 0) return;
					const merged = newOnes.map((item, index) => ({
						text: item.text,
						pinned: false,
						createdAt: item.capturedAt || (Date.now() + index),
						sourceUrl: item.sourceUrl || "",
						capturedAt: item.capturedAt || 0,
					})).concat(existing);
					wordsData[word].examples = deps.enforceExampleLimit(
						deps.sortExamples(merged),
						deps.maxExamplesPerWord
					);
					const prevCount = typeof wordsData[word].encounterCount === "number" ? wordsData[word].encounterCount : 0;
					const nextCount = prevCount + newOnes.length;
					const currentExampleCount = Array.isArray(wordsData[word].examples) ? wordsData[word].examples.length : 0;
					wordsData[word].encounterCount = Math.max(nextCount, currentExampleCount);

					const existingPageKeys = Array.isArray(wordsData[word].encounterPageKeys)
						? wordsData[word].encounterPageKeys.filter((x) => typeof x === "string" && x)
						: [];
					const pageKeySet = new Set(existingPageKeys);
					const currentPageKey = normalizePageKey(deps.currentHref, deps.normalizeText);
					if (newOnes.length > 0 && currentPageKey) {
						pageKeySet.add(currentPageKey);
					}
					wordsData[word].encounterPageKeys = Array.from(pageKeySet).slice(-300);
					const derivedPageCount = getDerivedPageCountFromExamples(wordsData[word], deps.normalizeText);
					wordsData[word].pageCount = Math.max(pageKeySet.size, derivedPageCount);
					changed = true;
				});

				if (changed) {
					await deps.WordStorage.saveWords(wordsData, { syncMode: "deferred" });
				}
			} catch (error) {
				deps.onError(error);
			}
		}, 1200);
	}

	function createHighlightSpan(word, meaning, examples, deps) {
		const doc = deps.document || document;
		const span = doc.createElement("span");
		span.className = "plugin-highlight-word";
		span.dataset.highlightKind = "root";
		span.textContent = word;
		span.style.backgroundColor = "#ead480";
		span.style.cursor = "pointer";
		span.style.color = "#3f2f22";
		span.style.padding = "0 4px";
		span.style.borderRadius = "6px 5px 7px 5px";
		span.style.boxShadow = "inset 0 -1px 0 rgba(120, 98, 67, 0.16)";
		span.style.border = "1px solid rgba(154, 120, 56, 0.22)";
		span.title = "";
		span.addEventListener("mouseenter", () => {
			span.style.backgroundColor = "#e1c76a";
			deps.showWordPreview(span, meaning, examples);
		});
		span.addEventListener("mouseleave", () => {
			span.style.backgroundColor = "#ead480";
			deps.hideWordPreview(140);
		});
		return span;
	}

	function createFamilyHighlightSpan(word, meaning, examples, deps, familyMeta) {
		const doc = deps.document || document;
		const span = doc.createElement("span");
		span.className = "plugin-highlight-word plugin-highlight-family-word";
		span.dataset.highlightKind = "family";
		span.textContent = word;
		span.style.backgroundColor = "#fbf6e8";
		span.style.cursor = "pointer";
		span.style.color = "#7a6549";
		span.style.padding = "0 3px";
		span.style.borderRadius = "6px 5px 7px 5px";
		span.style.boxShadow = "inset 0 -1px 0 rgba(120, 98, 67, 0.03)";
		span.style.border = "1px dashed rgba(184, 151, 94, 0.48)";
		span.style.borderBottom = "2px solid rgba(184, 151, 94, 0.78)";
		span.title = "";
		span.addEventListener("mouseenter", () => {
			span.style.backgroundColor = "#f4ebcf";
			span.style.borderColor = "rgba(169, 132, 74, 0.62)";
			span.style.borderBottomColor = "rgba(160, 120, 58, 0.92)";
			deps.showWordPreview(span, {
				mode: "family",
				currentForm: word,
				rootWord: familyMeta && familyMeta.rootWord ? familyMeta.rootWord : word,
				rootMeaning: familyMeta && familyMeta.rootMeaning ? familyMeta.rootMeaning : meaning,
				examples: Array.isArray(examples) ? examples : [],
			});
		});
		span.addEventListener("mouseleave", () => {
			span.style.backgroundColor = "#fbf6e8";
			span.style.borderColor = "rgba(184, 151, 94, 0.48)";
			span.style.borderBottomColor = "rgba(184, 151, 94, 0.78)";
			deps.hideWordPreview(140);
		});
		return span;
	}

	function buildHighlightTargets(storedWordsArray, storedWords) {
		const targets = [];
		const seen = new Set();
		for (let i = 0; i < storedWordsArray.length; i += 1) {
			const word = storedWordsArray[i];
			const data = storedWords[word];
			if (!data || data.learned) continue;
			const pushTarget = (form, isFamily) => {
				const value = typeof form === "string" ? form.trim() : "";
				if (!value) return;
				const key = value.toLowerCase();
				if (seen.has(key)) return;
				seen.add(key);
				targets.push({ form: value, rootWord: word, isFamily: !!isFamily });
			};
			pushTarget(word, false);
			const familyForms = Array.isArray(data.familyForms) ? data.familyForms : [];
			for (let f = 0; f < familyForms.length; f += 1) {
				const familyForm = familyForms[f];
				if (typeof familyForm !== "string") continue;
				if (familyForm.trim().toLowerCase() === word.toLowerCase()) continue;
				pushTarget(familyForm, true);
			}
		}
		targets.sort((a, b) => b.form.length - a.form.length);
		return targets;
	}

	function buildHighlightedFragment(text, highlightTargets, storedWords, deps) {
		const lowerText = text.toLowerCase();
		let cursor = 0;
		let hasMatch = false;
		const fragment = deps.document.createDocumentFragment();

		while (cursor < text.length) {
			let bestTarget = null;
			let bestIndex = -1;

			for (let i = 0; i < highlightTargets.length; i += 1) {
				const target = highlightTargets[i];
				const rootData = storedWords[target.rootWord];
				if (!rootData || rootData.learned) continue;
					const idx = findNextWholeWordIndex(text, lowerText, target.form, cursor, deps.languageHint);
				if (idx === -1) continue;
				if (bestIndex === -1 || idx < bestIndex || (idx === bestIndex && target.form.length > bestTarget.form.length)) {
					bestIndex = idx;
					bestTarget = target;
				}
			}

			if (bestIndex === -1 || !bestTarget) break;
			if (bestIndex > cursor) {
				fragment.appendChild(deps.document.createTextNode(text.slice(cursor, bestIndex)));
			}
			const matchedText = text.slice(bestIndex, bestIndex + bestTarget.form.length);
			const rootData = storedWords[bestTarget.rootWord];
			fragment.appendChild(
				bestTarget.isFamily
					? createFamilyHighlightSpan(
						matchedText,
						rootData.meaning,
						Array.isArray(rootData.examples) ? rootData.examples : [],
						deps,
						{
							rootWord: bestTarget.rootWord,
							rootMeaning: rootData.meaning,
						}
					)
					: createHighlightSpan(
						matchedText,
						rootData.meaning,
						Array.isArray(rootData.examples) ? rootData.examples : [],
						deps
					)
			);
			hasMatch = true;
			cursor = bestIndex + bestTarget.form.length;
		}

		if (!hasMatch) return null;
		if (cursor < text.length) {
			fragment.appendChild(deps.document.createTextNode(text.slice(cursor)));
		}
		return fragment;
	}

	function findTextNodes(element, deps) {
		let textNodes = [];
		if (element) {
			if (
				element.nodeType === deps.Node.ELEMENT_NODE &&
				(deps.skipTags.has(element.tagName) || deps.isExtensionUiElement(element))
			) {
				return textNodes;
			}
			element.childNodes.forEach((node) => {
				if (
					node.nodeType === deps.Node.TEXT_NODE &&
					node.nodeValue.trim().length >= 2 &&
					!(node.parentElement && deps.isExtensionUiElement(node.parentElement))
				) {
					textNodes.push(node);
				} else {
					textNodes = textNodes.concat(findTextNodes(node, deps));
				}
			});
		}
		return textNodes;
	}

	function addClickEventToHighlightedWords(doc, handlers) {
		doc.querySelectorAll(".plugin-highlight-word").forEach((span) => {
			span.addEventListener("click", () => {
				const kind = span.dataset.highlightKind || "root";
				const text = span.textContent;
				if (kind === "family" && handlers && typeof handlers.onFamilyClick === "function") {
					handlers.onFamilyClick(text);
					return;
				}
				if (handlers && typeof handlers.onRootClick === "function") {
					handlers.onRootClick(text);
				}
			});
		});
	}

	function highlightWords(deps) {
		deps.isCurrentDomainExcluded().then((excluded) => {
			if (excluded) return;
			deps.WordStorage.getWords().then((storedWords) => {
				const storedWordsArray = Object.keys(storedWords);
				storedWordsArray.sort((a, b) => b.length - a.length);
				const highlightTargets = buildHighlightTargets(storedWordsArray, storedWords);
				const bodyTextNodes = findTextNodes(deps.document.body, deps);
				const replacements = [];
				const exampleCandidates = collectExampleCandidates(bodyTextNodes, storedWordsArray, storedWords, {
					splitIntoSentences: deps.splitIntoSentences,
					isLowInformationExample: deps.isLowInformationExample,
					normalizeText: deps.normalizeText,
					currentHref: deps.currentHref(),
				});
				bodyTextNodes.forEach((node) => {
					const fragment = buildHighlightedFragment(node.nodeValue, highlightTargets, storedWords, deps);
					if (fragment) replacements.push({ node, fragment });
				});
				replacements.forEach(({ node, fragment }) => {
					const parent = node.parentNode;
					if (!parent) return;
					parent.insertBefore(fragment, node);
					parent.removeChild(node);
				});
				enqueueExampleCandidates(exampleCandidates, deps.state, {
					WordStorage: deps.WordStorage,
					normalizeExampleList: deps.normalizeExampleList,
					normalizeText: deps.normalizeText,
					isLowInformationExample: deps.isLowInformationExample,
					hasContainmentRelation: deps.hasContainmentRelation,
					isTooSimilarToAny: deps.isTooSimilarToAny,
					enforceExampleLimit: deps.enforceExampleLimit,
					sortExamples: deps.sortExamples,
					maxExamplesPerWord: deps.maxExamplesPerWord,
					currentHref: deps.currentHref(),
					onError: deps.onMergeError,
				});
				addClickEventToHighlightedWords(deps.document, {
					onRootClick: deps.markLearned,
					onFamilyClick: deps.openAddWordModal,
				});
				if (!deps.state.contentTourAttempted && !deps.state.contentTourPending) {
					const firstHighlight = deps.document.querySelector(".plugin-highlight-word");
					if (firstHighlight) {
						deps.state.contentTourPending = true;
						requestAnimationFrame(() => {
							requestAnimationFrame(() => {
								if (!firstHighlight.isConnected || firstHighlight.getClientRects().length === 0) {
									deps.state.contentTourPending = false;
									return;
								}
								Promise.resolve(deps.startContentTour(false))
									.then((started) => {
										if (started || !firstHighlight.isConnected) {
											deps.state.contentTourAttempted = true;
										}
									})
									.finally(() => {
										deps.state.contentTourPending = false;
									});
							});
						});
					}
				}
			}).catch((error) => {
				deps.onHighlightError(error);
			});
		});
	}

	function scheduleHighlight(delay, deps) {
		if (highlightDebounceTimer) clearTimeout(highlightDebounceTimer);
		highlightDebounceTimer = setTimeout(() => {
			ignoreMutationsUntil = Date.now() + 500;
			deps.highlightWords();
		}, delay || 120);
	}

	function checkUrlAndHighlight(deps) {
		const currentUrl = deps.getLocationHref();
		if (lastUrl !== currentUrl) {
			lastUrl = currentUrl;
			scheduleHighlight(80, deps);
		}
	}

	function setupNavigationWatchers(deps) {
		lastUrl = deps.getLocationHref();
		const originalPushState = deps.history.pushState;
		const originalReplaceState = deps.history.replaceState;

		deps.history.pushState = function () {
			originalPushState.apply(this, arguments);
			checkUrlAndHighlight(deps);
		};

		deps.history.replaceState = function () {
			originalReplaceState.apply(this, arguments);
			checkUrlAndHighlight(deps);
		};

		deps.window.addEventListener("popstate", () => checkUrlAndHighlight(deps));
		deps.window.addEventListener("hashchange", () => checkUrlAndHighlight(deps));

		const observer = new deps.MutationObserver(() => {
			if (Date.now() < ignoreMutationsUntil) return;
			scheduleHighlight(180, deps);
			checkUrlAndHighlight(deps);
		});
		observer.observe(deps.document.documentElement, {
			childList: true,
			subtree: true,
		});
		return observer;
	}

	global.ContentPageProcessing = {
		createHighlightSpan,
		createFamilyHighlightSpan,
		buildHighlightTargets,
		isCjkText,
		isWordChar,
		isBoundaryMatch,
		findNextWholeWordIndex,
		containsWord,
		normalizePageKey,
		getDerivedPageCountFromExamples,
		getContextContainerForNode,
		findTextNodes,
		buildHighlightedFragment,
		addClickEventToHighlightedWords,
		collectExampleCandidates,
		enqueueExampleCandidates,
		highlightWords,
		scheduleHighlight,
		checkUrlAndHighlight,
		setupNavigationWatchers,
	};
})(globalThis);
