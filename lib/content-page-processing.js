(function (global) {
	const ExampleUtilsRef = global.ExampleUtils;
	let lastUrl = "";
	let highlightDebounceTimer = null;
	let ignoreMutationsUntil = 0;
	let pendingHighlightRoots = null; // null = full body scan; Set = incremental scan of added nodes
	const MAX_INCREMENTAL_ROOTS = 20;
	const highlightContextMap = new WeakMap();

	// zh/ja/ko: unspaced scripts — each character is its own word unit
	function isCharLevelLang(lang) {
		return lang === "zh" || lang === "ja" || lang === "ko";
	}

	// th and other scripts with very short words need minLen=1 but are space-separated
	function isShortWordLang(lang) {
		return lang === "th";
	}

	function computeContextScore(sentence, targetWord, WordfreqUtils, lang) {
		const lw = (targetWord || "").toLowerCase();
		let sum = 0, count = 0;
		if (isCharLevelLang(lang)) {
			// Unspaced CJK: each Unicode letter codepoint is its own word unit
			for (const ch of (sentence || "")) {
				const t = ch.toLowerCase();
				if (!/\p{L}/u.test(ch) || t === lw) continue;
				const z = WordfreqUtils.getZipf(t, lang);
				if (z !== null) { sum += z; count += 1; }
			}
		} else {
			const minLen = isShortWordLang(lang) ? 1 : 3;
			const regex = /\p{L}+/gu;
			let match;
			while ((match = regex.exec(sentence)) !== null) {
				const t = match[0].toLowerCase();
				if (t.length < minLen || t === lw) continue;
				const z = WordfreqUtils.getZipf(t, lang);
				if (z !== null) { sum += z; count += 1; }
			}
		}
		return count === 0 ? 0 : sum / count;
	}

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

	function findNearestContextContainerForNode(node, deps) {
		const container = getContextContainerForNode(node);
		if (container) return container;
		const parentElement = node && node.parentElement;
		if (parentElement) return parentElement;
		const doc = (deps && deps.document) || (node && node.ownerDocument) || document;
		return doc && doc.body ? doc.body : null;
	}

	function collectContainerTextNodes(container, deps) {
		const result = [];
		if (!container) return result;
		const skipTags = deps && deps.skipTags ? deps.skipTags : new Set();
		const isExtensionUiElement = deps && typeof deps.isExtensionUiElement === "function"
			? deps.isExtensionUiElement
			: (() => false);

		function walk(node) {
			if (!node) return;
			if (node.nodeType === Node.TEXT_NODE) {
				result.push(node);
				return;
			}
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			if (skipTags.has(node.tagName) || isExtensionUiElement(node)) return;
			const children = node.childNodes || [];
			for (let i = 0; i < children.length; i += 1) {
				walk(children[i]);
			}
		}

		walk(container);
		return result;
	}

	function computeNodeOffsetWithinContainer(node, container, deps) {
		if (!node || !container) return -1;
		const textNodes = collectContainerTextNodes(container, deps);
		let offset = 0;
		for (let i = 0; i < textNodes.length; i += 1) {
			const currentNode = textNodes[i];
			if (currentNode === node) return offset;
			offset += (currentNode.nodeValue || "").length;
		}
		return -1;
	}

	function normalizeContextTextWithMap(text) {
		const rawText = typeof text === "string" ? text : "";
		const rawToNormalized = new Array(rawText.length + 1).fill(0);
		let normalized = "";
		let pendingSpace = false;
		let pendingSpaceStart = -1;

		for (let i = 0; i < rawText.length; i += 1) {
			const char = rawText[i];
			if (/\s/u.test(char)) {
				rawToNormalized[i] = normalized.length;
				if (normalized.length > 0 && !pendingSpace) {
					pendingSpace = true;
					pendingSpaceStart = i;
				}
				continue;
			}
			if (pendingSpace && normalized.length > 0) {
				const spaceIndex = normalized.length;
				normalized += " ";
				for (let j = pendingSpaceStart; j < i; j += 1) {
					rawToNormalized[j] = spaceIndex;
				}
				pendingSpace = false;
				pendingSpaceStart = -1;
			}
			rawToNormalized[i] = normalized.length;
			normalized += char;
		}

		if (pendingSpace && pendingSpaceStart >= 0) {
			for (let i = pendingSpaceStart; i < rawText.length; i += 1) {
				rawToNormalized[i] = normalized.length;
			}
		}
		rawToNormalized[rawText.length] = normalized.length;
		return {
			text: normalized.trim(),
			rawToNormalized,
		};
	}

	function getWholeWordMatches(text, word, languageHint) {
		const matches = [];
		if (!ExampleUtilsRef || typeof ExampleUtilsRef.findWholeWordMatch !== "function") {
			return matches;
		}
		const rawText = typeof text === "string" ? text : "";
		const rawWord = typeof word === "string" ? word : "";
		if (!rawText || !rawWord) return matches;
		let cursor = 0;
		while (cursor <= rawText.length) {
			const match = ExampleUtilsRef.findWholeWordMatch(rawText, rawWord, languageHint, cursor);
			if (!match) break;
			matches.push(match);
			const step = Math.max(match.length || rawWord.length || 1, 1);
			cursor = match.index + step;
		}
		return matches;
	}

	function findSentenceByOffset(containerText, absoluteOffset, languageHint, splitIntoSentences) {
		const splitter = typeof splitIntoSentences === "function"
			? splitIntoSentences
			: ((text) => [text]);
		const normalizedBundle = normalizeContextTextWithMap(containerText);
		const normalizedText = normalizedBundle.text;
		if (!normalizedText) {
			return {
				found: false,
				sentence: "",
				wordPos: null,
				containerText: normalizedText,
				containerOffset: null,
				languageHint: languageHint || "",
			};
		}
		const rawIndex = typeof absoluteOffset === "number" && Number.isFinite(absoluteOffset)
			? Math.max(0, Math.min(Math.floor(absoluteOffset), normalizedBundle.rawToNormalized.length - 1))
			: 0;
		const normalizedOffset = Math.max(
			0,
			Math.min(normalizedBundle.rawToNormalized[rawIndex] || 0, normalizedText.length)
		);
		const sentences = splitter(normalizedText, languageHint || "en");
		if (!Array.isArray(sentences) || sentences.length === 0) {
			return {
				found: false,
				sentence: "",
				wordPos: null,
				containerText: normalizedText,
				containerOffset: normalizedOffset,
				languageHint: languageHint || "",
			};
		}
		let cursor = 0;
		for (let i = 0; i < sentences.length; i += 1) {
			const sentence = sentences[i];
			if (!sentence) continue;
			const start = normalizedText.indexOf(sentence, cursor);
			if (start === -1) continue;
			const end = start + sentence.length;
			const isLast = i === sentences.length - 1;
			if ((normalizedOffset >= start && normalizedOffset < end) || (isLast && normalizedOffset === end)) {
				return {
					found: true,
					sentence,
					sentenceStart: start,
					sentenceEnd: end,
					wordPos: normalizedOffset - start,
					containerText: normalizedText,
					containerOffset: normalizedOffset,
					languageHint: languageHint || "",
				};
			}
			cursor = end;
		}
		const lastSentence = sentences[sentences.length - 1] || "";
		const lastStart = normalizedText.lastIndexOf(lastSentence);
		if (lastSentence && lastStart !== -1) {
			return {
				found: true,
				sentence: lastSentence,
				sentenceStart: lastStart,
				sentenceEnd: lastStart + lastSentence.length,
				wordPos: Math.max(0, normalizedOffset - lastStart),
				containerText: normalizedText,
				containerOffset: normalizedOffset,
				languageHint: languageHint || "",
			};
		}
		return {
			found: false,
			sentence: "",
			wordPos: null,
			containerText: normalizedText,
			containerOffset: normalizedOffset,
			languageHint: languageHint || "",
		};
	}

	function buildContextPayloadFromContainer(containerText, word, absoluteOffset, languageHint, splitIntoSentences) {
		const sentenceInfo = findSentenceByOffset(containerText, absoluteOffset, languageHint, splitIntoSentences);
		if (!sentenceInfo.found || !sentenceInfo.sentence) {
			return Object.assign({ word: typeof word === "string" ? word : "" }, sentenceInfo);
		}
		const matches = getWholeWordMatches(sentenceInfo.sentence, word, languageHint);
		const exactMatch = matches.find((match) => match.index === sentenceInfo.wordPos);
		if (matches.length > 1 && !exactMatch) {
			return {
				found: false,
				sentence: "",
				word: typeof word === "string" ? word : "",
				wordPos: null,
				containerText: sentenceInfo.containerText,
				containerOffset: sentenceInfo.containerOffset,
				languageHint: languageHint || "",
			};
		}
		if (matches.length === 0) {
			return {
				found: false,
				sentence: "",
				word: typeof word === "string" ? word : "",
				wordPos: null,
				containerText: sentenceInfo.containerText,
				containerOffset: sentenceInfo.containerOffset,
				languageHint: languageHint || "",
			};
		}
		const resolvedMatch = exactMatch || matches[0];
		return {
			found: true,
			sentence: sentenceInfo.sentence,
			word: typeof word === "string" ? word : "",
			wordPos: resolvedMatch.index,
			containerText: sentenceInfo.containerText,
			containerOffset: sentenceInfo.containerOffset,
			languageHint: languageHint || "",
		};
	}

	function resolveMatchSentenceContext(node, matchStart, word, deps) {
		const container = findNearestContextContainerForNode(node, deps);
		if (!container) {
			return {
				found: false,
				sentence: "",
				word: typeof word === "string" ? word : "",
				wordPos: null,
				containerText: "",
				containerOffset: null,
				languageHint: deps && deps.languageHint ? deps.languageHint : "",
			};
		}
		const nodeOffset = computeNodeOffsetWithinContainer(node, container, deps);
		if (nodeOffset < 0) {
			return {
				found: false,
				sentence: "",
				word: typeof word === "string" ? word : "",
				wordPos: null,
				containerText: "",
				containerOffset: null,
				languageHint: deps && deps.languageHint ? deps.languageHint : "",
			};
		}
		return buildContextPayloadFromContainer(
			container.textContent || "",
			word,
			nodeOffset + (typeof matchStart === "number" ? matchStart : 0),
			deps && deps.languageHint ? deps.languageHint : "",
			deps && deps.splitIntoSentences
		);
	}

	function setHighlightContext(span, context) {
		if (span && typeof span === "object") {
			highlightContextMap.set(span, context || null);
		}
	}

	function getHighlightContext(span) {
		return highlightContextMap.get(span) || null;
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
				const [wordsData, sourceLang] = await Promise.all([
					deps.WordStorage.getWords(),
					deps.sourceLang !== undefined
						? Promise.resolve(deps.sourceLang)
						: typeof deps.WordStorage.getSourceLang === "function"
							? deps.WordStorage.getSourceLang().catch(() => "")
							: Promise.resolve(""),
				]);
				const WordfreqUtils = deps.WordfreqUtils !== undefined ? deps.WordfreqUtils : global.WordfreqUtils;
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
								if (existingItem.contextScore == null && WordfreqUtils && WordfreqUtils.isReady(sourceLang)) {
									existingItem.contextScore = computeContextScore(existingItem.text, word, WordfreqUtils, sourceLang);
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

					const wfReady = !!(WordfreqUtils && WordfreqUtils.isReady(sourceLang));
					if (newOnes.length > 0) {
						const merged = newOnes.map((item) => ({
							text: item.text,
							pinned: false,
							createdAt: item.capturedAt || Date.now(),
							contextScore: wfReady ? computeContextScore(item.text, word, WordfreqUtils, sourceLang) : null,
							sourceUrl: item.sourceUrl || "",
							capturedAt: item.capturedAt || 0,
						})).concat(existing);
						wordsData[word].examples = deps.enforceExampleLimit(
							deps.sortExamples(merged),
							deps.maxExamplesPerWord
						);
					} else if (changed) {
						wordsData[word].examples = deps.enforceExampleLimit(
							deps.sortExamples(existing),
							deps.maxExamplesPerWord
						);
					} else {
						return;
					}
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

	function createHighlightSpan(word, meaning, examples, deps, contextData) {
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
		setHighlightContext(span, contextData || null);
		return span;
	}

	function createFamilyHighlightSpan(word, meaning, examples, deps, familyMeta, contextData) {
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
				contextSentence: contextData && contextData.found ? contextData.sentence : "",
				contextWordPos: contextData && typeof contextData.wordPos === "number" ? contextData.wordPos : null,
				examples: Array.isArray(examples) ? examples : [],
			});
		});
		span.addEventListener("mouseleave", () => {
			span.style.backgroundColor = "#fbf6e8";
			span.style.borderColor = "rgba(184, 151, 94, 0.48)";
			span.style.borderBottomColor = "rgba(184, 151, 94, 0.78)";
			deps.hideWordPreview(140);
		});
		setHighlightContext(span, contextData || null);
		return span;
	}

	function buildHighlightTargets(storedWordsArray, storedWords) {
		const targets = [];
		const seen = new Set();
		const explicitRoots = new Set();
		const normalizeTarget = (form) => {
			const value = typeof form === "string" ? form.trim() : "";
			if (!value) return null;
			return {
				value,
				key: value.toLowerCase(),
			};
		};
		const pushTarget = (word, form, isFamily) => {
			const normalized = normalizeTarget(form);
			if (!normalized) return;
			if (seen.has(normalized.key)) return;
			seen.add(normalized.key);
			targets.push({ form: normalized.value, rootWord: word, isFamily: !!isFamily });
		};

		for (let i = 0; i < storedWordsArray.length; i += 1) {
			const word = storedWordsArray[i];
			const data = storedWords[word];
			if (!data || data.learned) continue;
			const normalizedRoot = normalizeTarget(word);
			if (!normalizedRoot) continue;
			explicitRoots.add(normalizedRoot.key);
			pushTarget(word, normalizedRoot.value, false);
		}

		for (let i = 0; i < storedWordsArray.length; i += 1) {
			const word = storedWordsArray[i];
			const data = storedWords[word];
			if (!data || data.learned) continue;
			const familyForms = Array.isArray(data.familyForms) ? data.familyForms : [];
			for (let f = 0; f < familyForms.length; f += 1) {
				const familyForm = familyForms[f];
				const normalizedFamily = normalizeTarget(familyForm);
				if (!normalizedFamily) continue;
				if (normalizedFamily.key === word.toLowerCase()) continue;
				if (explicitRoots.has(normalizedFamily.key)) continue;
				pushTarget(word, normalizedFamily.value, true);
			}
		}
		targets.sort((a, b) => b.form.length - a.form.length);
		return targets;
	}

	function buildHighlightedFragment(text, highlightTargets, storedWords, deps, sourceNode) {
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
			const contextData = sourceNode
				? resolveMatchSentenceContext(sourceNode, bestIndex, matchedText, deps)
				: null;
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
						},
						contextData
					)
					: createHighlightSpan(
						matchedText,
						rootData.meaning,
						Array.isArray(rootData.examples) ? rootData.examples : [],
						deps,
						contextData
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
		const textNodes = [];
		if (!element) return textNodes;
		if (
			element.nodeType === deps.Node.ELEMENT_NODE &&
			(deps.skipTags.has(element.tagName) || deps.isExtensionUiElement(element))
		) {
			return textNodes;
		}
		const stack = [];
		const children = element.childNodes;
		for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
		while (stack.length > 0) {
			const node = stack.pop();
			if (node.nodeType === deps.Node.TEXT_NODE) {
				if (
					node.nodeValue.trim().length >= 2 &&
					!(node.parentElement && deps.isExtensionUiElement(node.parentElement))
				) {
					textNodes.push(node);
				}
			} else if (node.nodeType === deps.Node.ELEMENT_NODE) {
				if (deps.skipTags.has(node.tagName) || deps.isExtensionUiElement(node)) continue;
				const ch = node.childNodes;
				for (let i = ch.length - 1; i >= 0; i -= 1) stack.push(ch[i]);
			}
		}
		return textNodes;
	}

	function addClickEventToHighlightedWords(doc, handlers) {
		doc.querySelectorAll(".plugin-highlight-word").forEach((span) => {
			span.addEventListener("click", () => {
				const kind = span.dataset.highlightKind || "root";
				const text = span.textContent;
				const context = getHighlightContext(span);
				if (kind === "family" && handlers && typeof handlers.onFamilyClick === "function") {
					handlers.onFamilyClick({
						word: text,
						contextSentence: context && context.found ? context.sentence : "",
						contextWordPos: context && typeof context.wordPos === "number" ? context.wordPos : null,
					});
					return;
				}
				if (handlers && typeof handlers.onRootClick === "function") {
					handlers.onRootClick(text);
				}
			});
		});
	}

	function highlightWords(deps, roots) {
		deps.isCurrentDomainExcluded().then((excluded) => {
			if (excluded) return;
			deps.WordStorage.getWords().then((storedWords) => {
				const storedWordsArray = Object.keys(storedWords);
				storedWordsArray.sort((a, b) => b.length - a.length);
				const highlightTargets = buildHighlightTargets(storedWordsArray, storedWords);
				let bodyTextNodes;
				if (Array.isArray(roots) && roots.length > 0) {
					bodyTextNodes = [];
					for (let r = 0; r < roots.length; r += 1) {
						const root = roots[r];
						if (!root || !root.isConnected) continue;
						const nodes = root.nodeType === deps.Node.TEXT_NODE
							? (root.nodeValue.trim().length >= 2 ? [root] : [])
							: findTextNodes(root, deps);
						for (let n = 0; n < nodes.length; n += 1) bodyTextNodes.push(nodes[n]);
					}
				} else {
					bodyTextNodes = findTextNodes(deps.document.body, deps);
				}
				const replacements = [];
				const exampleCandidates = collectExampleCandidates(bodyTextNodes, storedWordsArray, storedWords, {
					splitIntoSentences: deps.splitIntoSentences,
					isLowInformationExample: deps.isLowInformationExample,
					normalizeText: deps.normalizeText,
					currentHref: deps.currentHref(),
				});
				bodyTextNodes.forEach((node) => {
					const fragment = buildHighlightedFragment(node.nodeValue, highlightTargets, storedWords, deps, node);
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
			ignoreMutationsUntil = Date.now() + 1000;
			const roots = pendingHighlightRoots;
			pendingHighlightRoots = new Set();
			deps.highlightWords(roots !== null ? Array.from(roots) : null);
		}, delay || 120);
	}

	function checkUrlAndHighlight(deps) {
		const currentUrl = deps.getLocationHref();
		if (lastUrl !== currentUrl) {
			lastUrl = currentUrl;
			pendingHighlightRoots = null; // URL changed: need full body scan
			scheduleHighlight(80, deps);
			if (typeof deps.onUrlChange === "function") {
				deps.onUrlChange(currentUrl);
			}
		}
	}

	function setupNavigationWatchers(deps) {
		lastUrl = deps.getLocationHref();
		pendingHighlightRoots = new Set(); // initial full scan already done; go incremental
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

		const observer = new deps.MutationObserver((mutations) => {
			if (Date.now() < ignoreMutationsUntil) return;
			let hasSignificantMutation = false;
			for (let m = 0; m < mutations.length; m += 1) {
				const added = mutations[m].addedNodes;
				for (let i = 0; i < added.length; i += 1) {
					const node = added[i];
					// Skip our own highlight spans — they must not trigger a rescan
					if (
						node.nodeType === Node.ELEMENT_NODE &&
						(node.classList.contains("plugin-highlight-word") ||
							node.classList.contains("plugin-highlight-family-word"))
					) continue;
					hasSignificantMutation = true;
					if (pendingHighlightRoots !== null) {
						pendingHighlightRoots.add(node);
						if (pendingHighlightRoots.size > MAX_INCREMENTAL_ROOTS) {
							pendingHighlightRoots = null; // too many roots: fall back to full scan
						}
					}
				}
			}
			if (!hasSignificantMutation) return;
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
		findNearestContextContainerForNode,
		collectContainerTextNodes,
		computeNodeOffsetWithinContainer,
		normalizeContextTextWithMap,
		findSentenceByOffset,
		buildContextPayloadFromContainer,
		resolveMatchSentenceContext,
		getHighlightContext,
		findTextNodes,
		buildHighlightedFragment,
		addClickEventToHighlightedWords,
		collectExampleCandidates,
		enqueueExampleCandidates,
		highlightWords,
		scheduleHighlight,
		checkUrlAndHighlight,
		setupNavigationWatchers,
		computeContextScore,
	};
})(globalThis);
