(function (global) {
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

	function findNextWholeWordIndex(text, lowerText, word, fromIndex) {
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

	function containsWord(text, word) {
		const trimmed = (word || "").trim();
		if (!trimmed) return false;
		const rawText = text || "";
		const lowerText = rawText.toLowerCase();
		return findNextWholeWordIndex(rawText, lowerText, trimmed.toLowerCase(), 0) !== -1;
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

	function getContextTextForNode(node, normalizeText) {
		const parentElement = node.parentElement;
		if (!parentElement) return normalizeText(node.nodeValue || "");
		const container = parentElement.closest("p, li, article, section, blockquote, td");
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
		for (let i = 0; i < bodyTextNodes.length; i += 1) {
			const node = bodyTextNodes[i];
			const contextText = getContextTextForNode(node, normalizeText);
			if (!contextText || contextText.length < 8) continue;
			const sentences = splitIntoSentences(contextText);
			if (sentences.length === 0) continue;

			for (let w = 0; w < storedWordsArray.length; w += 1) {
				const word = storedWordsArray[w];
				if (!storedWords[word] || storedWords[word].learned) continue;
				if (!containsWord(contextText, word)) continue;

				for (let s = 0; s < sentences.length; s += 1) {
					const sentence = sentences[s];
					if (!containsWord(sentence, word)) continue;
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
						if (deps.hasContainmentRelation(sample.text, comparisonPool)) continue;
						if (deps.isTooSimilarToAny(sample.text, comparisonPool)) continue;
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
					let newPageHits = 0;
					if (newOnes.length > 0 && currentPageKey && !pageKeySet.has(currentPageKey)) {
						pageKeySet.add(currentPageKey);
						newPageHits = 1;
					}
					wordsData[word].encounterPageKeys = Array.from(pageKeySet).slice(-300);
					const prevPageCount = typeof wordsData[word].pageCount === "number"
						? wordsData[word].pageCount
						: getDerivedPageCountFromExamples(wordsData[word], deps.normalizeText);
					const derivedPageCount = getDerivedPageCountFromExamples(wordsData[word], deps.normalizeText);
					wordsData[word].pageCount = Math.max(prevPageCount + newPageHits, derivedPageCount);
					changed = true;
				});

				if (changed) {
					await deps.WordStorage.saveWords(wordsData);
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
		span.textContent = word;
		span.style.backgroundColor = "#efe0a8";
		span.style.cursor = "pointer";
		span.style.color = "#4b392c";
		span.style.padding = "0 3px";
		span.style.borderRadius = "6px 5px 7px 5px";
		span.style.boxShadow = "inset 0 -1px 0 rgba(120, 98, 67, 0.12)";
		span.title = "";
		span.addEventListener("mouseenter", () => {
			span.style.backgroundColor = "#e4d295";
			deps.showWordPreview(span, meaning, examples);
		});
		span.addEventListener("mouseleave", () => {
			span.style.backgroundColor = "#efe0a8";
			deps.hideWordPreview(70);
		});
		return span;
	}

	function buildHighlightedFragment(text, storedWordsArray, storedWords, deps) {
		const lowerText = text.toLowerCase();
		let cursor = 0;
		let hasMatch = false;
		const fragment = deps.document.createDocumentFragment();

		while (cursor < text.length) {
			let bestWord = null;
			let bestIndex = -1;

			for (let i = 0; i < storedWordsArray.length; i += 1) {
				const word = storedWordsArray[i];
				if (!storedWords[word] || storedWords[word].learned) continue;
				const idx = findNextWholeWordIndex(text, lowerText, word, cursor);
				if (idx === -1) continue;
				if (bestIndex === -1 || idx < bestIndex || (idx === bestIndex && word.length > bestWord.length)) {
					bestIndex = idx;
					bestWord = word;
				}
			}

			if (bestIndex === -1 || !bestWord) break;
			if (bestIndex > cursor) {
				fragment.appendChild(deps.document.createTextNode(text.slice(cursor, bestIndex)));
			}
			const matchedText = text.slice(bestIndex, bestIndex + bestWord.length);
			fragment.appendChild(
				createHighlightSpan(
					matchedText,
					storedWords[bestWord].meaning,
					Array.isArray(storedWords[bestWord].examples) ? storedWords[bestWord].examples : [],
					deps
				)
			);
			hasMatch = true;
			cursor = bestIndex + bestWord.length;
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

	function addClickEventToHighlightedWords(doc, onClick) {
		doc.querySelectorAll(".plugin-highlight-word").forEach((span) => {
			span.addEventListener("click", () => onClick(span.textContent));
		});
	}

	function highlightWords(deps) {
		deps.isCurrentDomainExcluded().then((excluded) => {
			if (excluded) return;
			deps.WordStorage.getWords().then((storedWords) => {
				const storedWordsArray = Object.keys(storedWords);
				storedWordsArray.sort((a, b) => b.length - a.length);
				const bodyTextNodes = findTextNodes(deps.document.body, deps);
				const replacements = [];
				const exampleCandidates = collectExampleCandidates(bodyTextNodes, storedWordsArray, storedWords, {
					splitIntoSentences: deps.splitIntoSentences,
					isLowInformationExample: deps.isLowInformationExample,
					normalizeText: deps.normalizeText,
					currentHref: deps.currentHref(),
				});
				bodyTextNodes.forEach((node) => {
					const fragment = buildHighlightedFragment(node.nodeValue, storedWordsArray, storedWords, deps);
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
				addClickEventToHighlightedWords(deps.document, deps.markLearned);
				if (!deps.state.contentTourAttempted && deps.document.querySelector(".plugin-highlight-word")) {
					deps.state.contentTourAttempted = true;
					window.setTimeout(() => deps.startContentTour(false), 260);
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
		isCjkText,
		isWordChar,
		isBoundaryMatch,
		findNextWholeWordIndex,
		containsWord,
		normalizePageKey,
		getDerivedPageCountFromExamples,
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
