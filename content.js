// content.js
let addWordModal = null;
const MAX_EXAMPLES_PER_WORD = 20;
let contentUiLang = "en";
let contentTourAttempted = false;
let contentTourPending = false;
let contentSelectionTourAttempted = false;
let activeSelectionTranslationRequestId = 0;
const contextualWordTranslationCache = new Map();
const contextualWordTranslationInflight = new Map();
const MAX_CONTEXTUAL_WORD_CACHE_ENTRIES = 120;
let lastResolvedContextualWordQuery = null;
const recentResolvedContextualWordQueries = new Map();
const MAX_RECENT_CONTEXTUAL_WORD_ENTRIES = 40;
let contentLanguageHint = "";
let contentLanguageHintHref = "";
let contentLanguageHintPromise = null;
let contentLanguageHintSample = "";
let wordfreqPageEnabled = false;
function requireContentDependency(name) {
	const dependency = globalThis[name];
	if (!dependency) {
		throw new Error(`${name} must be loaded before content.js`);
	}
	return dependency;
}

const DictionaryUtilsRef = requireContentDependency("DictionaryUtils");
const LemmaUtilsRef = requireContentDependency("LemmaUtils");
const ExampleUtilsRef = requireContentDependency("ExampleUtils");
const ContentAddWordRef = requireContentDependency("ContentAddWord");
const ContentUiRef = requireContentDependency("ContentUi");
const ContentLookupUiRef = requireContentDependency("ContentLookupUi");
const ContentPageProcessingRef = requireContentDependency("ContentPageProcessing");
const TranslationUtilsRef = requireContentDependency("TranslationUtils");
const WordfreqUtils = globalThis.WordfreqUtils || null;
const SKIP_TEXT_TAGS = new Set([
	"SCRIPT",
	"STYLE",
	"NOSCRIPT",
	"TEXTAREA",
	"INPUT",
	"SELECT",
	"OPTION",
	"CODE",
	"PRE",
]);

WordStorage.getUiLanguage()
	.then((lang) => {
		contentUiLang = lang || "en";
	})
	.catch(() => {
		contentUiLang = "en";
	});


function contentT(key) {
	if (globalThis.UiI18n && typeof globalThis.UiI18n.t === "function") {
		return globalThis.UiI18n.t(contentUiLang, key);
	}
	const fallback = {
		add_word_title: "Add Word",
		add_word_hint: "Please enter the meaning of this word",
		dict_selected_form: "Selected form",
		lemma_label: "Base form",
		dict_via_lemma: "Dictionary result came from the base form",
		lemma_available: "Base-form version available",
		use_lemma: "Use base form",
		use_original: "Use original",
		using_lemma: "Using base form",
		loading_translation: "Fetching translation...",
		cancel: "Cancel",
		save: "Save",
		apply: "Apply",
		confirm_action: "Confirm Action",
		confirm: "Confirm",
		meaning_placeholder: "For example: the meaning of this word in this context...",
		mark_confirm_prefix: "Mark \"",
		mark_confirm_suffix: "\" as learned?",
	};
	return fallback[key] || key;
}

function showContentBrowserTranslationFallback(reason) {
	if (!globalThis.UiToast || typeof globalThis.UiToast.show !== "function") return;
	const messageKey = TranslationUtilsRef.getBrowserTranslationFallbackKey(reason);
	UiToast.show(contentT(messageKey), "error");
}

function startContentTour(force) {
	if (!globalThis.UiTour) return;
	const run = force ? UiTour.start : UiTour.maybeStartOnce;
	return run({
		storageKey: "content_v1",
		lang: contentUiLang,
		steps: UiTour.getSteps(contentUiLang, "content"),
	});
}

function startContentSelectionTour(force) {
	if (!globalThis.UiTour) return;
	const run = force ? UiTour.start : UiTour.maybeStartOnce;
	return run({
		storageKey: "content_selection_v1",
		lang: contentUiLang,
		steps: UiTour.getSteps(contentUiLang, "contentSelection"),
	});
}

function isContextInvalidatedError(error) {
	if (!error || typeof error.message !== "string") return false;
	const msg = error.message;
	if (msg.includes("Extension context invalidated")) return true;
	if (error instanceof TypeError && (
		msg.includes("(reading 'local')") ||
		msg.includes("(reading 'sync')") ||
		msg.includes("(reading 'storage')")
	)) return true;
	return false;
}

function getExampleText(entry) {
	if (typeof entry === "string") return (entry || "").replace(/\s+/g, " ").trim();
	if (entry && typeof entry === "object") return (entry.text || "").replace(/\s+/g, " ").trim();
	return "";
}

function isExtensionUiElement(element) {
	if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
	if (element.id === "translationBox") return true;
	if (element.classList.contains("plugin-highlight-word")) return true;

	for (let i = 0; i < element.classList.length; i += 1) {
		if (element.classList[i].startsWith("la-")) return true;
	}
	return false;
}

function hostMatchesExcludedDomain(hostname, excludedDomain) {
	const host = (hostname || "").toLowerCase();
	const domain = (excludedDomain || "").toLowerCase();
	if (!host || !domain) return false;
	return host === domain || host.endsWith(`.${domain}`);
}

async function isCurrentDomainExcluded() {
	try {
		const excludedDomains = await WordStorage.getExcludedDomains();
		if (!Array.isArray(excludedDomains) || excludedDomains.length === 0) return false;
		const host = (location.hostname || "").toLowerCase();
		for (let i = 0; i < excludedDomains.length; i += 1) {
			if (hostMatchesExcludedDomain(host, excludedDomains[i])) return true;
		}
		return false;
	} catch (error) {
		return false;
	}
}

// 标记单词为已学会
function markLearned(word) {
	const lowerCaseWord = word.toLowerCase();
	ContentUiRef.showConfirmModal({
		document,
		t: contentT,
		message: `${contentT("mark_confirm_prefix")}${lowerCaseWord}${contentT("mark_confirm_suffix")}`,
	}).then((confirmed) => {
		if (!confirmed) return;
		WordStorage.getWords().then((words) => {
			if (words[lowerCaseWord]) {
				words[lowerCaseWord].learned = true;
				WordStorage.saveWords(words, { syncMode: "immediate" }).then(() => {
					// 可能需要刷新页面或以其他方式更新显示
					console.log(`Word: ${lowerCaseWord} marked as learned.`);
					// make all highlighted words with the same word has no style
					document
						.querySelectorAll(".plugin-highlight-word")
						.forEach((span) => {
							if (span.textContent.toLowerCase() === lowerCaseWord) {
								span.style.backgroundColor = "";
								span.style.cursor = "";
								span.style.color = "";
								span.title = "";
							}
						});
				}).catch((error) => {
					console.error("Failed to mark word as learned:", error);
				});
			}
		}).catch((error) => {
			console.error("Failed to load words:", error);
		});
	});
}

function hideWordPreview(delay) {
	ContentLookupUiRef.hideWordPreview(delay);
}

	function showWordPreview(anchor, previewData, examples) {
		const payload = (previewData && typeof previewData === "object" && !Array.isArray(previewData))
			? Object.assign({}, previewData)
			: previewData;
		if (payload && typeof payload === "object" && !Array.isArray(payload) && !Array.isArray(payload.examples)) {
			payload.examples = Array.isArray(examples) ? examples : [];
		}
	ContentLookupUiRef.showWordPreview(anchor, payload, Array.isArray(examples) ? examples : [], {
		document,
		WordStorage,
		chromeRuntime: chrome.runtime,
		TranslationUtilsRef,
		DictionaryUtilsRef,
		contentT,
		normalizeDictionaryQuery,
		shouldLookupDictionaryQuery,
		supportsDictionaryBySourceLang,
		getExampleText,
		isCjkText,
		isBoundaryMatch,
		findWholeWordMatch: ExampleUtilsRef.findWholeWordMatch,
		languageHint: contentLanguageHint || document.documentElement.lang || (typeof navigator !== "undefined" ? navigator.language : "en"),
		detectLanguage(text) {
			return detectTextLanguageWithBrowserApi(text);
		},
		translateWordInContext({ word, contextSentence, contextWordPos, sourceLang }) {
			return requestWordTranslationInContext({
				word,
				sourceLang: sourceLang || "auto",
				contextSentence,
				contextWordPos,
			});
		},
		WordfreqUtils: wordfreqPageEnabled ? WordfreqUtils : null,
	});
}

function isCjkText(text) {
	return ContentPageProcessingRef.isCjkText(text);
}

function isBoundaryMatch(text, start, end, cjkWord) {
	return ContentPageProcessingRef.isBoundaryMatch(text, start, end, cjkWord);
}

function normalizeText(text) {
	return (text || "").replace(/\s+/g, " ").trim();
}

const normalizeDictionaryQuery = DictionaryUtilsRef.normalizeDictionaryQuery;
const shouldLookupDictionaryQuery = DictionaryUtilsRef.shouldLookupDictionaryQuery;
const supportsDictionaryBySourceLang = DictionaryUtilsRef.supportsDictionaryBySourceLang;
const normalizeLemmaSourceLang = LemmaUtilsRef.normalizeLemmaSourceLang;
const supportsLemmaBySourceLang = LemmaUtilsRef.supportsLemmaBySourceLang;
const resolveLemma = LemmaUtilsRef.createRuntimeLemmaResolver({
	normalizeQuery: normalizeDictionaryQuery,
	sendMessage: chrome.runtime.sendMessage.bind(chrome.runtime),
	cache: new Map(),
});
const resolveLemmaVariations = LemmaUtilsRef.createRuntimeLemmaVariationsResolver({
	normalizeQuery: normalizeDictionaryQuery,
	sendMessage: chrome.runtime.sendMessage.bind(chrome.runtime),
	cache: new Map(),
});

function getBrowserBaseLang() {
	const lang = (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en").toLowerCase();
	const base = (lang.split("-")[0] || "en");
	// Normalize Chinese variants (zh-TW / zh-CN / zh-HK ...) into one bucket.
	if (base === "zh") return "zh";
	return base;
}

function detectTextLanguageWithBrowserApi(text) {
	return new Promise((resolve) => {
		try {
			if (!chrome || !chrome.i18n || typeof chrome.i18n.detectLanguage !== "function") {
				resolve("");
				return;
			}
			chrome.i18n.detectLanguage(text || "", (result) => {
				if (chrome.runtime.lastError || !result || !Array.isArray(result.languages)) {
					resolve("");
					return;
				}
				if (result.languages.length === 0) {
					resolve("");
					return;
				}
				const top = result.languages[0];
				const lang = (top && top.language ? top.language : "").toLowerCase();
				resolve((lang.split("-")[0] || ""));
			});
		} catch (_) {
			resolve("");
		}
	});
}

async function resolveContentLanguageHint() {
	const currentHref = location.href || "";
	const bodyText = normalizeText(
		document.body && typeof document.body.innerText === "string"
			? document.body.innerText
			: (document.body && document.body.textContent) || ""
	).slice(0, 4000);
	if (contentLanguageHintPromise && contentLanguageHintHref === currentHref) {
		if (contentLanguageHintSample === bodyText) {
			return contentLanguageHintPromise;
		}
	}
	contentLanguageHintHref = currentHref;
	contentLanguageHintSample = bodyText;
	contentLanguageHintPromise = (async () => {
		const detected = await detectTextLanguageWithBrowserApi(bodyText);
		const fallback = (
			document.documentElement.lang ||
			await WordStorage.getSourceLang().catch(() => "") ||
			(typeof navigator !== "undefined" ? navigator.language : "en")
		);
		contentLanguageHint = detected || fallback || "en";
		return contentLanguageHint;
	})();
	return contentLanguageHintPromise;
}

async function shouldSkipTranslateAndDictionary(text) {
	const detected = await detectTextLanguageWithBrowserApi(text);
	if (!detected) return false;
	const browserLang = getBrowserBaseLang();
	const normalizedDetected = detected === "fil" ? "tl" : detected;
	const normalizedBrowser = browserLang === "fil" ? "tl" : browserLang;
	if (normalizedDetected === "zh" && normalizedBrowser === "zh") return true;
	return normalizedDetected === normalizedBrowser;
}

const getAddWordTargetWord = ContentAddWordRef.getTargetWord;
const updateAddWordLineState = ContentAddWordRef.updateWordLine;
const setAddWordLemmaMode = ContentAddWordRef.setLemmaMode;
const applyAddWordDictionarySelection = ContentAddWordRef.applyDictionarySelection;

function mapDictionarySections(dictResponse, sourceLang) {
	return DictionaryUtilsRef.mapDictionarySections(dictResponse, sourceLang, {
		maxEntries: 3,
		translateEntry(definition, lang) {
			return TranslationUtilsRef.requestPreferredTranslation({
				chromeRuntime: chrome.runtime,
				chromeI18n: chrome.i18n,
				wordStorage: WordStorage,
				text: definition,
				sourceLang: lang || "auto",
			});
		},
	});
}

const isLowInformationExample = ExampleUtilsRef.isLowInformationExample;
const normalizeExampleList = ExampleUtilsRef.normalizeExampleList;
const sortExamples = ExampleUtilsRef.sortExamples;
const enforceExampleLimit = ExampleUtilsRef.enforceExampleLimit;
const isTooSimilarToAny = (candidate, pool, languageHint) => ExampleUtilsRef.isTooSimilarToAny(candidate, pool, 0.88, languageHint);
const hasContainmentRelation = (candidate, pool, languageHint) => ExampleUtilsRef.hasContainmentRelation(candidate, pool, languageHint);

function splitIntoSentences(text) {
	const lang =
		contentLanguageHint ||
		document.documentElement.lang ||
		(typeof navigator !== "undefined" ? navigator.language : "en");
	return ExampleUtilsRef.splitIntoSentences(text, lang || "en");
}

function findNearestContextContainer(node) {
	return ContentPageProcessingRef.findNearestContextContainerForNode(node, { document }) || document.body;
}

function collectTextNodesWithOffsets(container) {
	const nodes = ContentPageProcessingRef.collectContainerTextNodes(container, {
		document,
		skipTags: SKIP_TEXT_TAGS,
		isExtensionUiElement,
	});
	const results = [];
	let offset = 0;
	for (let i = 0; i < nodes.length; i += 1) {
		const node = nodes[i];
		results.push({
			node,
			start: offset,
			end: offset + ((node && node.nodeValue) || "").length,
		});
		offset += ((node && node.nodeValue) || "").length;
	}
	return results;
}

function getAbsoluteOffsetInContainer(range, container) {
	if (!range || !container) return null;
	const startContainer = range.startContainer;
	if (startContainer && startContainer.nodeType === Node.TEXT_NODE) {
		const baseOffset = ContentPageProcessingRef.computeNodeOffsetWithinContainer(startContainer, container, {
			document,
			skipTags: SKIP_TEXT_TAGS,
			isExtensionUiElement,
		});
		if (baseOffset >= 0) {
			return baseOffset + Math.max(0, range.startOffset || 0);
		}
	}
	try {
		const probeRange = document.createRange();
		probeRange.selectNodeContents(container);
		probeRange.setEnd(range.startContainer, range.startOffset);
		return probeRange.toString().length;
	} catch (_) {
		return null;
	}
}

function findSentenceByOffset(containerText, absoluteOffset, languageHint) {
	return ContentPageProcessingRef.findSentenceByOffset(
		containerText,
		absoluteOffset,
		languageHint,
		(text, lang) => ExampleUtilsRef.splitIntoSentences(text, lang || languageHint || "en")
	);
}

function buildContextPayloadFromContainer(containerText, word, absoluteOffset, languageHint) {
	return ContentPageProcessingRef.buildContextPayloadFromContainer(
		containerText,
		word,
		absoluteOffset,
		languageHint,
		(text, lang) => ExampleUtilsRef.splitIntoSentences(text, lang || languageHint || "en")
	);
}

function getRangeContextForWord(range, selectedWord, languageHint) {
	const trimmedWord = typeof selectedWord === "string" ? selectedWord.trim() : "";
	if (!range || !trimmedWord) {
		return {
			found: false,
			sentence: "",
			word: trimmedWord,
			wordPos: null,
			containerText: "",
			containerOffset: null,
			languageHint: languageHint || "",
		};
	}
	const container = findNearestContextContainer(range.startContainer);
	if (!container) {
		return {
			found: false,
			sentence: "",
			word: trimmedWord,
			wordPos: null,
			containerText: "",
			containerOffset: null,
			languageHint: languageHint || "",
		};
	}
	const absoluteOffset = getAbsoluteOffsetInContainer(range, container);
	if (absoluteOffset == null) {
		return {
			found: false,
			sentence: "",
			word: trimmedWord,
			wordPos: null,
			containerText: "",
			containerOffset: null,
			languageHint: languageHint || "",
		};
	}
	return buildContextPayloadFromContainer(
		container.textContent || "",
		trimmedWord,
		absoluteOffset,
		languageHint || contentLanguageHint || document.documentElement.lang || navigator.language
	);
}

function getSelectionContextForWord(selectedWord, languageHint, explicitSelection) {
	const selection = explicitSelection || window.getSelection();
	const trimmedWord = typeof selectedWord === "string" ? selectedWord.trim() : "";
	if (!selection || !selection.rangeCount || !trimmedWord) {
		return {
			found: false,
			sentence: "",
			word: trimmedWord,
			wordPos: null,
			containerText: "",
			containerOffset: null,
			languageHint: languageHint || "",
		};
	}
	return getRangeContextForWord(
		selection.getRangeAt(0),
		trimmedWord,
		languageHint || contentLanguageHint || document.documentElement.lang || navigator.language
	);
}

function buildEmptyContextPayload(word, languageHint) {
	return {
		found: false,
		sentence: "",
		word: typeof word === "string" ? word.trim() : "",
		wordPos: null,
		containerText: "",
		containerOffset: null,
		languageHint: languageHint || "",
	};
}

function buildVerifiedDirectContext(sentence, word, wordPos, languageHint) {
	const trimmedSentence = typeof sentence === "string" ? sentence.trim() : "";
	const trimmedWord = typeof word === "string" ? word.trim() : "";
	if (!trimmedSentence || !trimmedWord) {
		return buildEmptyContextPayload(trimmedWord, languageHint);
	}
	if (typeof wordPos !== "number" || !Number.isFinite(wordPos) || wordPos < 0) {
		return buildEmptyContextPayload(trimmedWord, languageHint);
	}
	const verifiedContext = buildContextPayloadFromContainer(
		trimmedSentence,
		trimmedWord,
		wordPos,
		languageHint
	);
	if (!verifiedContext.found || verifiedContext.sentence !== trimmedSentence || verifiedContext.wordPos !== wordPos) {
		return buildEmptyContextPayload(trimmedWord, languageHint);
	}
	return verifiedContext;
}

function getContextForWord(word, options) {
	const params = options || {};
	const trimmedWord = typeof word === "string" ? word.trim() : "";
	const languageHint =
		params.languageHint ||
		contentLanguageHint ||
		document.documentElement.lang ||
		(typeof navigator !== "undefined" ? navigator.language : "en");
	const directContextSentence = typeof params.contextSentence === "string" && params.contextSentence.trim()
		? params.contextSentence
		: (typeof params.sentence === "string" && params.sentence.trim() ? params.sentence : "");
	const directContextWordPos = typeof params.contextWordPos === "number"
		? params.contextWordPos
		: (typeof params.wordPos === "number" ? params.wordPos : null);
	if (directContextSentence) {
		return buildVerifiedDirectContext(
			directContextSentence,
			trimmedWord,
			directContextWordPos,
			languageHint
		);
	}
	const selectionContext = getSelectionContextForWord(trimmedWord, languageHint, params.selection);
	if (!selectionContext.found) return selectionContext;
	if (
		params.expectedWord &&
		selectionContext.word &&
		selectionContext.word.toLowerCase() !== String(params.expectedWord).trim().toLowerCase()
	) {
		return {
			found: false,
			sentence: "",
			word: trimmedWord,
			wordPos: null,
			containerText: "",
			containerOffset: null,
			languageHint,
		};
	}
	return selectionContext;
}

function buildContextualWordCacheKey(context, sourceLang, targetLang) {
	if (!context || !context.found || !context.sentence || !context.word) return "";
	const normalizedSentence = String(context.sentence).trim().replace(/\s+/g, " ");
	const normalizedWord = String(context.word).trim().toLowerCase();
	const normalizedSourceLang = TranslationUtilsRef.normalizeTranslationLang(sourceLang) || "auto";
	const normalizedTargetLang =
		TranslationUtilsRef.normalizeTranslationLang(targetLang) ||
		TranslationUtilsRef.getBrowserTargetLang(window.navigator) ||
		"en";
	const normalizedWordPos =
		typeof context.wordPos === "number" && Number.isFinite(context.wordPos) && context.wordPos >= 0
			? String(context.wordPos)
			: "";
	return `${normalizedSourceLang}__${normalizedTargetLang}__${normalizedWordPos}__${normalizedWord}__${normalizedSentence}`;
}

function rememberContextualWordTranslation(cacheKey, translation) {
	if (!cacheKey) return translation;
	if (contextualWordTranslationCache.has(cacheKey)) {
		contextualWordTranslationCache.delete(cacheKey);
	}
	contextualWordTranslationCache.set(cacheKey, translation);
	while (contextualWordTranslationCache.size > MAX_CONTEXTUAL_WORD_CACHE_ENTRIES) {
		const oldestKey = contextualWordTranslationCache.keys().next().value;
		if (oldestKey === undefined) break;
		contextualWordTranslationCache.delete(oldestKey);
	}
	return translation;
}

function rememberLastResolvedContext(context, sourceLang, targetLang, cacheKey, translation) {
	if (!context || !context.found || !context.sentence || !context.word) return;
	const normalizedSentence = String(context.sentence).trim().replace(/\s+/g, " ");
	const entry = {
		word: String(context.word).trim().toLowerCase(),
		sentence: normalizedSentence,
		wordPos: typeof context.wordPos === "number" ? context.wordPos : null,
		sourceLang: TranslationUtilsRef.normalizeTranslationLang(sourceLang) || "auto",
		targetLang:
			TranslationUtilsRef.normalizeTranslationLang(targetLang) ||
			TranslationUtilsRef.getBrowserTargetLang(window.navigator) ||
			"en",
		cacheKey: cacheKey || "",
		translation: typeof translation === "string" ? translation : "",
			updatedAt: Date.now(),
	};
	lastResolvedContextualWordQuery = entry;
	const recentKey = `${entry.targetLang}__${entry.word}__${normalizedSentence}`;
	if (recentResolvedContextualWordQueries.has(recentKey)) {
		recentResolvedContextualWordQueries.delete(recentKey);
	}
	recentResolvedContextualWordQueries.set(recentKey, entry);
	while (recentResolvedContextualWordQueries.size > MAX_RECENT_CONTEXTUAL_WORD_ENTRIES) {
		const oldestKey = recentResolvedContextualWordQueries.keys().next().value;
		if (oldestKey === undefined) break;
		recentResolvedContextualWordQueries.delete(oldestKey);
	}
}

function getRecentResolvedContextualEntry(word, sourceLang, targetLang, sentence) {
	const normalizedWord = String(word || "").trim().toLowerCase();
	const normalizedTargetLang =
		TranslationUtilsRef.normalizeTranslationLang(targetLang) ||
		TranslationUtilsRef.getBrowserTargetLang(window.navigator) ||
		"en";
	const normalizedSentence = typeof sentence === "string"
		? String(sentence).trim().replace(/\s+/g, " ")
		: "";
	if (!normalizedSentence) return null;
	const recentKey = `${normalizedTargetLang}__${normalizedWord}__${normalizedSentence}`;
	const mappedEntry = recentResolvedContextualWordQueries.get(recentKey) || null;
	const entry = mappedEntry || (
		lastResolvedContextualWordQuery &&
		lastResolvedContextualWordQuery.word === normalizedWord &&
		lastResolvedContextualWordQuery.targetLang === normalizedTargetLang &&
		lastResolvedContextualWordQuery.sentence === normalizedSentence
			? lastResolvedContextualWordQuery
			: null
	);
	if (!entry) return null;
	if (Date.now() - entry.updatedAt > 30000) return null;
	if (entry.word !== normalizedWord) return null;
	if (entry.targetLang !== normalizedTargetLang) return null;
	if (entry.sentence !== normalizedSentence) return null;
	return entry;
}

function getRecentContextForWord(word, sourceLang, targetLang, sentence) {
	const entry = getRecentResolvedContextualEntry(word, sourceLang, targetLang, sentence);
	if (!entry) return null;
	const normalizedWord = String(word || "").trim().toLowerCase();
	const verifiedContext = buildVerifiedDirectContext(
		entry.sentence,
		normalizedWord,
		entry.wordPos,
		contentLanguageHint || document.documentElement.lang || navigator.language
	);
	return verifiedContext.found ? verifiedContext : null;
}

function resolveContextualSourceLang(context, fallbackSourceLang) {
	if (!context || !context.found || !context.sentence) {
		return Promise.resolve(fallbackSourceLang || "auto");
	}
	return detectTextLanguageWithBrowserApi(context.sentence)
		.then((detectedLang) => detectedLang || fallbackSourceLang || "auto")
		.catch(() => fallbackSourceLang || "auto");
}

function shouldSkipContextualTranslationForWord(word, sourceLang) {
	if (!WordfreqUtils || !word) return Promise.resolve(false);
	const normalizedSourceLang = String(sourceLang || "").split("-")[0].toLowerCase();
	if (!normalizedSourceLang || normalizedSourceLang === "auto") return Promise.resolve(false);
	if (!WordfreqUtils.isSupported(normalizedSourceLang)) return Promise.resolve(false);
	return Promise.resolve(WordfreqUtils.initForLang(normalizedSourceLang))
		.then((ready) => {
			if (!ready) return false;
			const zipf = WordfreqUtils.getZipf(String(word).trim().toLowerCase(), normalizedSourceLang);
			const tier = WordfreqUtils.getDifficultyTier(zipf, normalizedSourceLang);
			return tier === "A1";
		})
			.catch(() => false);
}

function requestWordTranslationInContext(options) {
	const params = options || {};
	const trimmedWord = typeof params.word === "string" ? params.word.trim() : "";
	if (!trimmedWord) return Promise.resolve("");
	const requestedSourceLang = params.sourceLang || "auto";
	const requestedTargetLang =
		params.targetLang || TranslationUtilsRef.getBrowserTargetLang(window.navigator) || "en";
	let context = getContextForWord(trimmedWord, params);
	const recentResolvedEntry = params.allowRecentContextCache && context && context.found && context.sentence
		? getRecentResolvedContextualEntry(trimmedWord, requestedSourceLang, requestedTargetLang, context.sentence)
		: null;
	if ((!context || !context.found) && params.allowRecentContextCache) {
		context = getRecentContextForWord(
			trimmedWord,
			requestedSourceLang,
			requestedTargetLang,
			typeof params.contextSentence === "string" ? params.contextSentence : ""
		) || context;
	}
	if (!context.found || !context.sentence) {
		if (params.cacheOnly && recentResolvedEntry && recentResolvedEntry.translation) {
			return Promise.resolve(recentResolvedEntry.translation);
		}
		return Promise.resolve("");
	}
	return resolveContextualSourceLang(context, requestedSourceLang).then((effectiveSourceLang) => {
		return shouldSkipContextualTranslationForWord(trimmedWord, effectiveSourceLang).then((shouldSkip) => {
			if (shouldSkip) return "";
			const cacheKey = buildContextualWordCacheKey(
				context,
				effectiveSourceLang,
				requestedTargetLang
			);
			if (cacheKey && contextualWordTranslationCache.has(cacheKey)) {
				return contextualWordTranslationCache.get(cacheKey) || "";
			}
			if (params.cacheOnly) {
				if (recentResolvedEntry && recentResolvedEntry.translation) {
					return recentResolvedEntry.translation;
				}
				return "";
			}
				if (cacheKey && contextualWordTranslationInflight.has(cacheKey)) {
					return contextualWordTranslationInflight.get(cacheKey);
				}
				const translationPromise = TranslationUtilsRef.requestContextualWordTranslation({
					chromeRuntime: chrome.runtime,
				sentence: context.sentence,
				word: trimmedWord,
					wordPos: typeof context.wordPos === "number" ? context.wordPos : null,
						sourceLang: effectiveSourceLang,
						targetLang: requestedTargetLang,
					}).then((result) => {
						const translation = result && typeof result.translation === "string" ? result.translation : "";
						const isTrueContextualHit = !!(result && result.usedContext && !result.fallback && translation);
						if (!isTrueContextualHit) {
							return "";
						}
						const rememberedTranslation = rememberContextualWordTranslation(cacheKey, translation);
						if (rememberedTranslation) {
						rememberLastResolvedContext(
							context,
							effectiveSourceLang,
							requestedTargetLang,
							cacheKey,
						rememberedTranslation
					);
				}
				return rememberedTranslation;
			}).catch(() => "").finally(() => {
				if (cacheKey) {
					contextualWordTranslationInflight.delete(cacheKey);
				}
			});
			if (cacheKey) {
				contextualWordTranslationInflight.set(cacheKey, translationPromise);
			}
			return translationPromise;
		});
	});
}

const contentPageProcessingState = {
	exampleMergeTimer: null,
	pendingExampleMap: {},
};

function getContentPageProcessingDeps(languageHint) {
	return {
		document,
		Node,
		skipTags: SKIP_TEXT_TAGS,
		isExtensionUiElement,
		isCurrentDomainExcluded,
		showWordPreview,
		hideWordPreview,
		WordStorage,
		splitIntoSentences,
		isLowInformationExample,
		normalizeText,
		normalizeExampleList,
		hasContainmentRelation,
		isTooSimilarToAny,
		enforceExampleLimit,
		sortExamples,
		maxExamplesPerWord: MAX_EXAMPLES_PER_WORD,
		languageHint: languageHint || contentLanguageHint || document.documentElement.lang || "en",
		currentHref: () => location.href,
		markLearned,
		openAddWordModal: showAddWordModal,
		startContentTour,
		state: {
			get pendingExampleMap() { return contentPageProcessingState.pendingExampleMap; },
			set pendingExampleMap(value) { contentPageProcessingState.pendingExampleMap = value; },
			get exampleMergeTimer() { return contentPageProcessingState.exampleMergeTimer; },
			set exampleMergeTimer(value) { contentPageProcessingState.exampleMergeTimer = value; },
			get contentTourAttempted() { return contentTourAttempted; },
			set contentTourAttempted(value) { contentTourAttempted = value; },
			get contentTourPending() { return contentTourPending; },
			set contentTourPending(value) { contentTourPending = value; },
		},
		onMergeError(error) {
			if (!isContextInvalidatedError(error)) {
				console.error("Failed to merge examples:", error);
			}
		},
		onHighlightError(error) {
			if (!isContextInvalidatedError(error)) {
				console.error("Failed to highlight words:", error);
			}
		},
	};
}

function highlightWords() {
	return resolveContentLanguageHint().then((languageHint) => (
		ContentPageProcessingRef.highlightWords(getContentPageProcessingDeps(languageHint))
	));
}
if (typeof window !== "undefined") {
	window.__resetContentLanguageHintForTests = function __resetContentLanguageHintForTests() {
		contentLanguageHint = "";
		contentLanguageHintHref = "";
		contentLanguageHintSample = "";
		contentLanguageHintPromise = null;
	};
	window.__resolveContentLanguageHintForTests = resolveContentLanguageHint;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === "openAddWordModal" && request.word) {
		showAddWordModal(request.word);
		sendResponse({ ok: true });
	}
});

function showAddWordModal(word) {
	ContentUiRef.ensureAddWordModalStyle(document);
	if (addWordModal) addWordModal.remove();

	const modalOptions = (word && typeof word === "object" && !Array.isArray(word))
		? word
		: { word };
	const normalizedWord = String(modalOptions.word || "").trim().toLowerCase();
	const capturedSelectionContext = (!modalOptions.contextSentence && normalizedWord)
		? getContextForWord(normalizedWord, { expectedWord: normalizedWord })
		: null;
	const modalContextSentence = modalOptions.contextSentence ||
		(capturedSelectionContext && capturedSelectionContext.found ? capturedSelectionContext.sentence : "");
	const modalContextWordPos =
		typeof modalOptions.contextWordPos === "number"
			? modalOptions.contextWordPos
			: (capturedSelectionContext && typeof capturedSelectionContext.wordPos === "number"
				? capturedSelectionContext.wordPos
				: null);
	const modalUi = ContentAddWordRef.createAddWordModal({
		document,
		normalizedWord,
		t: contentT,
		applyButtonStyle: ContentUiRef.applyModalButtonStyle,
		applyTextareaStyle: ContentUiRef.applyModalTextareaStyle,
	});
	const overlay = modalUi.overlay;
	const wordLine = modalUi.wordLine;
	const hint = modalUi.hint;
	const lemmaNotice = modalUi.lemmaNotice;
	const lemmaText = modalUi.lemmaText;
	const lemmaBtn = modalUi.lemmaBtn;
	const input = modalUi.input;
	let userEdited = false;
	const dictPreview = modalUi.dictPreview;
	const dictTitle = modalUi.dictTitle;
	const dictList = modalUi.dictList;
	const cancelBtn = modalUi.cancelBtn;
	const saveBtn = modalUi.saveBtn;
	document.body.appendChild(overlay);
	addWordModal = overlay;
	input.focus();
	input.addEventListener("input", () => {
		userEdited = true;
	});

	function getTargetWord() {
		return getAddWordTargetWord(overlay, normalizedWord);
	}

	function updateWordLine() {
		return updateAddWordLineState({
			overlay,
			normalizedWord,
			wordLine,
			hint,
			t: contentT,
		});
	}

	function setLemmaMode(useLemma, lemmaValue) {
		return setAddWordLemmaMode({
			overlay,
			normalizedWord,
			lemmaValue,
			useLemma,
			wordLine,
			hint,
			lemmaBtn,
			t: contentT,
		});
	}

	function closeModal() {
		overlay.remove();
		if (addWordModal === overlay) addWordModal = null;
		document.removeEventListener("keydown", onKeyDown, true);
	}

	function onKeyDown(event) {
		if (event.key === "Escape") closeModal();
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "enter") saveWord();
	}

async function saveWord() {
		const meaning = input.value.trim();
		if (!meaning) return;
		try {
			const words = await WordStorage.getWords();
			const targetWord = getTargetWord();
			const existing = words[targetWord] || words[normalizedWord];
			let dictEntries = [];
			try {
				dictEntries = JSON.parse(overlay.dataset.dictEntries || "[]");
				if (!Array.isArray(dictEntries)) dictEntries = [];
			} catch (error) {
				dictEntries = [];
			}
			const selectedIndexRaw = Number(overlay.dataset.dictSelectedIndex || "0");
			const selectedIndex =
				Number.isInteger(selectedIndexRaw) && selectedIndexRaw >= 0
					? selectedIndexRaw
					: 0;
			const dictPosValue = (overlay.dataset.dictPos || "").trim();
			const dictDefinitionOriginal = (overlay.dataset.dictDefinitionOriginal || "").trim();
			const dictDefinitionTranslated = (overlay.dataset.dictDefinitionTranslated || "").trim();
			const dictSource = (overlay.dataset.dictSource || "").trim();
			const dictionary =
				dictPosValue || dictDefinitionOriginal || dictDefinitionTranslated || dictEntries.length > 0
					? {
						pos: dictPosValue,
						definitionOriginal: dictDefinitionOriginal,
						definitionTranslated: dictDefinitionTranslated,
						source: dictSource || "dictionary",
						usedLemma: overlay.dataset.dictUsedLemma === "1",
						lookupLemma: (overlay.dataset.dictLookupLemma || "").trim(),
						queryText: (overlay.dataset.dictQueryText || "").trim(),
						entries: dictEntries,
						selectedIndex: Math.min(selectedIndex, Math.max(dictEntries.length - 1, 0)),
						updatedAt: Date.now(),
					}
					: (existing && existing.dictionary ? existing.dictionary : null);
			const sourceLang = await WordStorage.getSourceLang();
			const lemmaValue = (overlay.dataset.lemma || "").trim() || (existing && typeof existing.lemma === "string" ? existing.lemma : "");
			const familyResult = supportsLemmaBySourceLang(sourceLang)
				? await resolveLemmaVariations(targetWord, lemmaValue, sourceLang)
				: { familyForms: LemmaUtilsRef.normalizeFamilyForms([], lemmaValue, targetWord) };
			words[targetWord] = {
				meaning: meaning,
				learned: false,
				createdAt: existing && existing.createdAt ? existing.createdAt : Date.now(),
				lemma: lemmaValue,
				familyForms: Array.isArray(familyResult.familyForms) ? familyResult.familyForms : [],
				dictionary: dictionary,
			};
			await WordStorage.saveWords(words, { syncMode: "immediate" });
			closeModal();
		} catch (error) {
			console.error("Failed to save word:", error);
		}
	}

	cancelBtn.addEventListener("click", closeModal);
	saveBtn.addEventListener("click", saveWord);
	overlay.addEventListener("click", (event) => {
		if (event.target === overlay) closeModal();
	});
	document.addEventListener("keydown", onKeyDown, true);
	prefillMeaningFromTranslation(
		normalizedWord,
		wordLine,
		input,
		() => userEdited,
			overlay,
			{
				getTargetWord,
				contextSentence: modalContextSentence,
				contextWordPos: modalContextWordPos,
			},
			(dictPayload) => {
			const sections = dictPayload && Array.isArray(dictPayload.sections)
				? dictPayload.sections
				: [];
			const hasAnyEntries = sections.some((section) => Array.isArray(section.entries) && section.entries.length > 0);
			if (!hasAnyEntries) {
				dictPreview.style.display = "none";
				return;
			}
			dictPreview.style.display = "block";
			dictTitle.textContent = contentT("dictionary");
			const availableLemma = String((dictPayload && dictPayload.lemma) || overlay.dataset.lemma || "").trim().toLowerCase();
			if (availableLemma && availableLemma !== normalizedWord) {
				lemmaNotice.style.display = "";
				lemmaText.textContent = `${contentT("lemma_available")}: ${availableLemma}`;
				lemmaBtn.textContent = contentT("use_lemma");
				lemmaBtn.onclick = () => {
					const usingLemma = getTargetWord() === availableLemma;
					setLemmaMode(!usingLemma, availableLemma);
				};
			} else {
				lemmaNotice.style.display = "none";
				lemmaBtn.onclick = null;
				setLemmaMode(false, "");
			}
			DictionaryUtilsRef.renderInteractiveDictionarySections(dictList, sections, {
				document,
				emptyText: contentT("no_dict_entries"),
				getSectionTitle: (section) => `${DictionaryUtilsRef.getDictionarySectionLabel(contentT, section.mode, section.query)} · ${DictionaryUtilsRef.getDictionarySourceLabel(section.source)}`,
				decorateSection(sectionWrap, section, sectionIndex) {
					sectionWrap.className = "la-addword-dict-section";
					if (sectionIndex > 0) sectionWrap.classList.add("is-secondary");
				},
				decorateSectionTitle(sectionTitle) {
					sectionTitle.className = "la-addword-dict-section-title";
				},
				createApplyButton() {
					const applyBtn = document.createElement("button");
					applyBtn.type = "button";
					applyBtn.className = "la-addword-dict-apply";
					applyBtn.textContent = contentT("apply");
					ContentUiRef.applyModalButtonStyle(applyBtn, "apply");
					return applyBtn;
				},
				onApply({ item, section, index, row }) {
					applyAddWordDictionarySelection({
						overlay,
						item,
						section,
						index,
						input,
						dictList,
						row,
						onUserEdit() {
							userEdited = true;
						},
					});
				},
			});
			const firstRow = dictList.querySelector(".la-addword-dict-item");
			if (firstRow) firstRow.classList.add("is-selected");
		}
	);
	updateWordLine();
}

function prefillMeaningFromTranslation(word, wordLineEl, inputEl, isUserEdited, modalOverlay, contextOptions, onDictionaryReady) {
	const options = contextOptions && typeof contextOptions === "object" ? contextOptions : {};
	const getTargetWord = typeof options.getTargetWord === "function" ? options.getTargetWord : (() => word);
	const contextSentence = typeof options.contextSentence === "string" ? options.contextSentence : "";
	const contextWordPos = typeof options.contextWordPos === "number" ? options.contextWordPos : null;
	return ContentAddWordRef.prefillMeaningFromTranslation({
		word,
		wordLineEl,
		inputEl,
		isUserEdited,
		modalOverlay,
		onDictionaryReady,
		deps: {
			WordStorage,
			resolveLemma,
			normalizeDictionaryQuery,
			contentT,
			supportsDictionaryBySourceLang,
					shouldLookupDictionaryQuery,
					mapDictionarySections,
					TranslationUtilsRef,
					chromeRuntime: chrome.runtime,
					translateWordInContext({ word: translateWord, sourceLang }) {
						return requestWordTranslationInContext({
							word: translateWord,
							sourceLang: sourceLang || "auto",
							expectedWord: getTargetWord(),
							contextSentence,
							contextWordPos,
							cacheOnly: true,
							allowRecentContextCache: true,
						}).then((translated) => {
							if (translated) return translated;
							return TranslationUtilsRef.requestPreferredTranslation({
								chromeRuntime: chrome.runtime,
								chromeI18n: chrome.i18n,
								wordStorage: WordStorage,
								text: translateWord,
								sourceLang: sourceLang || "auto",
							});
						});
					},
				},
			});
}

// 勾选后自动翻译
document.addEventListener("mouseup", function () {
	const selectedText = window.getSelection().toString().trim();
	if (!(selectedText.length > 0 && selectedText.length <= 800)) return;
	WordStorage.getAutoTranslateOnSelect().then((enabled) => {
		if (enabled) translateText(selectedText);
	}).catch((error) => {
		if (!isContextInvalidatedError(error)) {
			console.error("Failed to read auto-translate setting:", error);
		}
		translateText(selectedText);
	});
});

function translateText(text) {
	shouldSkipTranslateAndDictionary(text).then((shouldSkip) => {
		if (shouldSkip) return;
		return Promise.all([
		WordStorage.getSourceLang(),
		typeof WordStorage.getTranslationEngine === "function"
			? WordStorage.getTranslationEngine().catch(() => "online")
			: Promise.resolve("online"),
		WordStorage.getDictionaryLookupEnabled().catch(() => true),
	]).then(async ([sourceLang, translationEngine, dictionaryEnabled]) => {
		const detectedLang = await detectTextLanguageWithBrowserApi(text);
		if (detectedLang && TranslationUtilsRef.isSameLanguageFamily(detectedLang, TranslationUtilsRef.getBrowserTargetLang(window.navigator))) {
			return;
		}
			const isSingleWord = TranslationUtilsRef.isSingleWordLikeText(
				text,
				detectedLang || sourceLang || document.documentElement.lang || navigator.language
			);
		// If the selected text's language doesn't match the configured source language,
		// use "auto" so the translation API detects the actual language instead of
		// forcing an incorrect source language (e.g. translating Chinese text when
		// sourceLang is set to Indonesian).
		const detectedMatchesSource = detectedLang
			? TranslationUtilsRef.isSameLanguageFamily(detectedLang, sourceLang)
			: true;
		const effectiveSourceLang = (sourceLang && !detectedMatchesSource) ? "auto" : (sourceLang || "auto");
		const targetLang = TranslationUtilsRef.getBrowserTargetLang(window.navigator) || "en";
		const translationRequestId = activeSelectionTranslationRequestId + 1;
		activeSelectionTranslationRequestId = translationRequestId;
		const contextualPromise = isSingleWord
			? requestWordTranslationInContext({
				word: text,
				sourceLang: effectiveSourceLang,
				targetLang,
				languageHint: detectedLang || sourceLang || document.documentElement.lang || navigator.language,
			})
			: Promise.resolve("");
		const preferredPromise = TranslationUtilsRef.requestPreferredTranslation({
			chromeRuntime: chrome.runtime,
			chromeI18n: chrome.i18n,
			wordStorage: WordStorage,
			text,
			sourceLang: effectiveSourceLang,
			translationEngine,
			detectedLanguage: detectedLang,
			targetLang,
			onBrowserFallback(result) {
				showContentBrowserTranslationFallback(result && result.reason);
			},
		});
		const firstTranslationPromise = isSingleWord
			? new Promise((resolve) => {
				let settledCount = 0;
				let resolved = false;
				function handleResult(source, translation) {
					if (resolved) return;
					if (translation) {
						resolved = true;
						resolve({ source, translation });
						return;
					}
					settledCount += 1;
					if (settledCount >= 2) {
						resolve({ source, translation: "" });
					}
				}
				contextualPromise.then((translation) => handleResult("contextual", translation)).catch(() => handleResult("contextual", ""));
				preferredPromise.then((translation) => handleResult("preferred", translation)).catch(() => handleResult("preferred", ""));
			})
			: preferredPromise.then((translation) => ({ source: "preferred", translation }));
		return firstTranslationPromise.then((result) => {
			const translation = result && typeof result.translation === "string" ? result.translation : "";
			if (!translation) return;
			showTranslation(translation, isSingleWord ? {
				sourceWord: text.trim(),
				sourceLang,
				isContextual: !!(result && result.source === "contextual"),
			} : null);
			if (isSingleWord && result && result.source === "preferred") {
				contextualPromise.then((contextualTranslation) => {
					if (!contextualTranslation) return;
					if (activeSelectionTranslationRequestId !== translationRequestId) return;
					updateTranslationBox(contextualTranslation, { isContextual: true });
				}).catch(() => {});
			}
			const dictQuery = normalizeDictionaryQuery(text);
			if (!(dictionaryEnabled && isSingleWord && supportsDictionaryBySourceLang(sourceLang) && shouldLookupDictionaryQuery(dictQuery) && detectedMatchesSource)) return;
			chrome.runtime.sendMessage(
				{ action: "lookupDictionary", text: dictQuery, sourceLang: sourceLang || "auto" },
				(dictResponse) => {
					if (chrome.runtime.lastError || !dictResponse || !dictResponse.found) return;
					appendDictionaryToTranslationBox(dictResponse, sourceLang || "auto");
				}
			);
		});
		});
	}).catch((error) => {
		if (!isContextInvalidatedError(error)) {
			console.error("Failed to get source language:", error);
		}
	});
}

function showTranslation(translation, wordfreqOpts) {
	return ContentLookupUiRef.showTranslation(translation, {
		document,
		startContentSelectionTour,
		chromeRuntime: chrome.runtime,
		WordfreqUtils: (wordfreqOpts && wordfreqPageEnabled && WordfreqUtils) || null,
		sourceWord: wordfreqOpts && wordfreqOpts.sourceWord,
		sourceLang: wordfreqOpts && wordfreqOpts.sourceLang,
		isContextual: !!(wordfreqOpts && wordfreqOpts.isContextual),
		state: {
			get contentSelectionTourAttempted() {
				return contentSelectionTourAttempted;
			},
			set contentSelectionTourAttempted(value) {
				contentSelectionTourAttempted = value;
			},
		},
	});
}

function updateTranslationBox(translation, options) {
	return ContentLookupUiRef.updateTranslationBox(translation, {
		document,
		isContextual: !!(options && options.isContextual),
	});
}

function appendDictionaryToTranslationBox(dictResponse, sourceLang) {
	return ContentLookupUiRef.appendDictionaryToTranslationBox(dictResponse, sourceLang, {
		document,
		DictionaryUtilsRef,
		TranslationUtilsRef,
		WordStorage,
		contentT,
		chromeRuntime: chrome.runtime,
		startContentSelectionTour,
		state: {
			get contentSelectionTourAttempted() {
				return contentSelectionTourAttempted;
			},
			set contentSelectionTourAttempted(value) {
				contentSelectionTourAttempted = value;
			},
		},
	});
}

// 以下为事件监听和初始化代码

function scheduleHighlight(delay) {
	return ContentPageProcessingRef.scheduleHighlight(delay, {
		highlightWords,
	});
}

function checkUrlAndHighlight() {
	return ContentPageProcessingRef.checkUrlAndHighlight({
		getLocationHref: () => location.href,
		highlightWords,
	});
}

function pageMatchesSrcLang(srcLang) {
	// Use detectLanguage with all candidates.
	// Check if srcLang appears in any candidate with percentage >= 20%.
	// This handles near-identical language pairs (e.g. id/ms) without false negatives.
	// We intentionally skip the HTML lang attribute — page authors often set it incorrectly.
	return new Promise((resolve) => {
		try {
			if (!chrome || !chrome.i18n || typeof chrome.i18n.detectLanguage !== "function") {
				resolve(true); return;
			}
			const rawSample = globalThis.ContentDifficulty
				? globalThis.ContentDifficulty.extractArticleText(document)
				: (document.body && document.body.innerText || "");
			// If article extraction yields too little text (dynamic page not yet rendered,
			// or unusual structure), fall back to body text for a better sample.
			const fullSample = rawSample.length >= 200 ? rawSample : (document.body && document.body.innerText || "");
			const sample = fullSample.slice(0, 4000);
			// Not enough text to make a reliable judgement — allow through.
			if (sample.length < 100) { resolve(true); return; }
			chrome.i18n.detectLanguage(sample, (result) => {
				if (chrome.runtime.lastError || !result || !Array.isArray(result.languages) || result.languages.length === 0) {
					resolve(true); return;
				}
				// Always check the top detected language — don't blindly allow through when
				// isReliable is false, because that's exactly when mixed-language pages slip in.
				const top = result.languages[0];
				if (!top) { resolve(true); return; }
				const topLang = (top.language || "").split("-")[0].toLowerCase();
				// id and ms (Indonesian / Malay) are nearly identical — treat as equivalent.
				const LANG_ALIASES = { "id": "ms", "ms": "id" };
				const topMatches = topLang === srcLang || LANG_ALIASES[srcLang] === topLang;
				resolve(topMatches && top.percentage >= 40);
			});
		} catch (_) {
			resolve(true);
		}
	});
}

function checkAndActivateWordfreq(lang) {
	if (!WordfreqUtils) return;
	if (!lang || lang === "auto" || !WordfreqUtils.isSupported(lang)) return;
	const srcLang = (lang || "").split("-")[0].toLowerCase();
	Promise.resolve(pageMatchesSrcLang(srcLang)).then((match) => {
		if (!match) return;
		wordfreqPageEnabled = true;
		WordfreqUtils.initForLang(srcLang);
		if (globalThis.ContentDifficulty) {
			globalThis.ContentDifficulty.analyzeAndShow({
				sourceLang: lang,
				document,
				translate: (word) => WordStorage.getTranslationEngine().catch(() => "online").then((engine) =>
					TranslationUtilsRef.requestPreferredTranslation({
						chromeRuntime: chrome.runtime,
						chromeI18n: chrome.i18n,
						wordStorage: WordStorage,
						text: word,
						sourceLang: lang,
						translationEngine: engine,
						targetLang: TranslationUtilsRef.getBrowserTargetLang(window.navigator),
					})
				).catch(() => null),
					translateWordInContext: ({ word, sentence, wordPos }) => (
						requestWordTranslationInContext({
							word,
							sourceLang: lang,
							targetLang: TranslationUtilsRef.getBrowserTargetLang(window.navigator),
							contextSentence: sentence,
							contextWordPos: wordPos,
						}).then((translated) => translated || null)
					).catch(() => null),
				getLemma: (word) => resolveLemma(word, lang)
					.then((r) => (r && r.lemma) || null)
					.catch(() => null),
			});
		}
	}).catch(() => {});
}

function setupNavigationWatchers(sourceLang) {
	return ContentPageProcessingRef.setupNavigationWatchers({
		history,
		window,
		document,
		MutationObserver,
		getLocationHref: () => location.href,
		highlightWords,
		onUrlChange: () => {
			wordfreqPageEnabled = false;
			setTimeout(() => checkAndActivateWordfreq(sourceLang), 300);
		},
	});
}

window.addEventListener("load", () => {
	highlightWords();
	if (WordfreqUtils) {
		WordStorage.getSourceLang().then((lang) => {
			setupNavigationWatchers(lang);
			setTimeout(() => checkAndActivateWordfreq(lang), 300);
		}).catch(() => { setupNavigationWatchers(""); });
	} else {
		setupNavigationWatchers("");
	}
});
