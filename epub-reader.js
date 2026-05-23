"use strict";

// — Module-level refs —
const ContentPageProcessingRef = globalThis.ContentPageProcessing;
const ContentLookupUiRef = globalThis.ContentLookupUi;
const ContentAddWordRef = globalThis.ContentAddWord;
const ContentSelectionRef = globalThis.ContentSelection;
const ContentUiRef = globalThis.ContentUi;
const DictionaryUtilsRef = globalThis.DictionaryUtils;
const LemmaUtilsRef = globalThis.LemmaUtils;
const TranslationUtilsRef = globalThis.TranslationUtils;
const ExampleUtilsRef = globalThis.ExampleUtils;

const SKIP_TEXT_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE"]);
const MAX_EXAMPLES_PER_WORD = 20;
const MAX_CONTEXTUAL_WORD_CACHE_ENTRIES = 120;
const MAX_RECENT_CONTEXTUAL_WORD_ENTRIES = 40;
const FONT_SIZE_STEP = 1;
const FONT_SIZE_MIN = 13;
const FONT_SIZE_MAX = 40;
const FONT_SIZE_DEFAULT = 17;
const FONT_DEFAULT_ID = "lora";

// Font presets — { id, label, stack, googleFont? }
// googleFont: Google Fonts CSS2 family param string (injected lazily on first use).
// stack: always has system fallbacks so the font still works when offline.
const FONT_PRESETS = [
	// ── Western serif ────────────────────────────────────────────────────────
	{ id: "lora",         label: "Lora",
	  googleFont: "Lora:ital,wght@0,400;0,600;1,400",
	  stack: '"Lora","Georgia",serif' },
	{ id: "crimson",      label: "Crimson Pro",
	  googleFont: "Crimson+Pro:ital,wght@0,400;0,600;1,400",
	  stack: '"Crimson Pro","Georgia",serif' },
	{ id: "garamond",     label: "EB Garamond",
	  googleFont: "EB+Garamond:ital,wght@0,400;0,600;1,400",
	  stack: '"EB Garamond","Garamond","Georgia",serif' },
	{ id: "merriweather", label: "Merriweather",
	  googleFont: "Merriweather:ital,wght@0,300;0,400;1,300",
	  stack: '"Merriweather","Georgia",serif' },
	{ id: "noto-serif",   label: "Noto Serif",
	  googleFont: "Noto+Serif:ital,wght@0,400;0,600;1,400",
	  stack: '"Noto Serif","Georgia",serif' },
	// ── Western sans ─────────────────────────────────────────────────────────
	{ id: "noto-sans",    label: "Noto Sans",
	  googleFont: "Noto+Sans:wght@300;400;500",
	  stack: '"Noto Sans",system-ui,sans-serif' },
	{ id: "source-sans",  label: "Source Sans 3",
	  googleFont: "Source+Sans+3:ital,wght@0,300;0,400;1,300",
	  stack: '"Source Sans 3",system-ui,sans-serif' },
	{ id: "system-sans",  label: "System Sans",
	  stack: 'system-ui,-apple-system,"Segoe UI","Helvetica Neue",sans-serif' },
	// ── CJK (TC/SC/JP/KR all share the same Noto glyphs) ────────────────────
	{ id: "cjk-ming",     label: "明體 CJK",
	  googleFont: "Noto+Serif+TC:wght@300;400;500",
	  stack: '"Noto Serif TC","Noto Serif SC","Noto Serif JP","Noto Serif KR","Source Han Serif","Songti TC","STSong","SimSun","MS Mincho",serif' },
	{ id: "cjk-gothic",   label: "黑體 CJK",
	  googleFont: "Noto+Sans+TC:wght@300;400;500",
	  stack: '"Noto Sans TC","Noto Sans SC","Noto Sans JP","Noto Sans KR","Source Han Sans","PingFang TC","Microsoft JhengHei","Meiryo",sans-serif' },
	{ id: "lxgw",         label: "霞鶩文楷",
	  googleFont: "LXGW+WenKai+TC",
	  stack: '"LXGW WenKai TC","LXGW WenKai","Kaiti TC","DFKai-SB","KaiTi",cursive' },
	{ id: "zcool-xiaowei",label: "小薇宋體",
	  googleFont: "ZCOOL+XiaoWei",
	  stack: '"ZCOOL XiaoWei","Noto Serif TC","Noto Serif SC","Songti TC","STSong","SimSun",serif' },
	// ── Arabic ───────────────────────────────────────────────────────────────
	{ id: "arabic",       label: "عربي",
	  googleFont: "Noto+Naskh+Arabic:wght@400;500",
	  stack: '"Noto Naskh Arabic","Traditional Arabic","Scheherazade New",serif' },
	// ── Devanagari ───────────────────────────────────────────────────────────
	{ id: "devanagari",   label: "देवनागरी",
	  googleFont: "Noto+Serif+Devanagari:wght@400;500",
	  stack: '"Noto Serif Devanagari","Noto Sans Devanagari","Mangal",serif' },
	// ── Monospace ────────────────────────────────────────────────────────────
	{ id: "mono",         label: "Monospace",
	  stack: '"Courier New","Courier",monospace' },
];
let currentFontId = FONT_DEFAULT_ID;

// Created once; shared by buildAnnotationDeps, showReaderAddWordModal, translateSelected
const resolveLemma = LemmaUtilsRef ? LemmaUtilsRef.createRuntimeLemmaResolver({
	normalizeQuery: DictionaryUtilsRef.normalizeDictionaryQuery,
	sendMessage: chrome.runtime.sendMessage.bind(chrome.runtime),
	cache: new Map(),
}) : null;
const resolveLemmaVariations = LemmaUtilsRef ? LemmaUtilsRef.createRuntimeLemmaVariationsResolver({
	normalizeQuery: DictionaryUtilsRef.normalizeDictionaryQuery,
	sendMessage: chrome.runtime.sendMessage.bind(chrome.runtime),
	cache: new Map(),
}) : null;

let uiLang = "zh-TW";
let currentBook = null;
const contextualWordTranslationCache = new Map();
const contextualWordTranslationInflight = new Map();
let lastResolvedContextualWordQuery = null;
const recentResolvedContextualWordQueries = new Map();
let currentChapterIndex = 0;
let activeBlobUrls = [];
let currentBookHash = null;
let currentBookTitle = "";
let currentMouseupHandler = null;
let readerPageProcessingState = { pendingExampleMap: {}, exampleMergeTimer: null };
let currentFontSize = FONT_SIZE_DEFAULT;
let sidebarOpen = false;
let readerAddWordModal = null;
const activeSelectionRequestIdRef = { value: 0 };

function t(key) {
	return (globalThis.UiI18n && globalThis.UiI18n.t) ? globalThis.UiI18n.t(uiLang, key) : key;
}

// — Shared runtime helpers (module-level, no duplication) —

// Contextual translation cache helpers (mirrors content.js)

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
	if (Date.now() - entry.updatedAt > 30000) {
		recentResolvedContextualWordQueries.delete(recentKey);
		return null;
	}
	if (entry.word !== normalizedWord) return null;
	if (entry.targetLang !== normalizedTargetLang) return null;
	if (entry.sentence !== normalizedSentence) return null;
	return entry;
}

function resolveContextualSourceLang(context, fallbackSourceLang, detectedLangHint) {
	if (detectedLangHint) return Promise.resolve(detectedLangHint);
	if (!context || !context.found || !context.sentence) {
		return Promise.resolve(fallbackSourceLang || "auto");
	}
	return detectLangText(context.sentence)
		.then(function (detectedLang) { return detectedLang || fallbackSourceLang || "auto"; })
		.catch(function () { return fallbackSourceLang || "auto"; });
}

function shouldSkipContextualTranslationForWord(word, sourceLang) {
	const WordfreqUtils = globalThis.WordfreqUtils || null;
	if (!WordfreqUtils || !word) return Promise.resolve(false);
	const normalizedSourceLang = String(sourceLang || "").split("-")[0].toLowerCase();
	if (!normalizedSourceLang || normalizedSourceLang === "auto") return Promise.resolve(false);
	if (!WordfreqUtils.isSupported(normalizedSourceLang)) return Promise.resolve(false);
	return Promise.resolve(WordfreqUtils.initForLang(normalizedSourceLang))
		.then(function (ready) {
			if (!ready) return false;
			const zipf = WordfreqUtils.getZipf(String(word).trim().toLowerCase(), normalizedSourceLang);
			const tier = WordfreqUtils.getDifficultyTier(zipf, normalizedSourceLang);
			return tier === "A1";
		})
		.catch(function () { return false; });
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
	const verifiedContext = ContentPageProcessingRef.buildContextPayloadFromContainer(
		trimmedSentence,
		trimmedWord,
		wordPos,
		languageHint,
		function (text, lang) { return ExampleUtilsRef.splitIntoSentences(text, lang || languageHint || "en"); }
	);
	if (!verifiedContext.found || verifiedContext.sentence !== trimmedSentence || verifiedContext.wordPos !== wordPos) {
		return buildEmptyContextPayload(trimmedWord, languageHint);
	}
	return verifiedContext;
}

function getRecentContextForWord(word, sourceLang, targetLang, sentence) {
	const entry = getRecentResolvedContextualEntry(word, sourceLang, targetLang, sentence);
	if (!entry) return null;
	const normalizedWord = String(word || "").trim().toLowerCase();
	const langHint = (currentBook && currentBook.language) || document.documentElement.lang || navigator.language;
	const verifiedContext = buildVerifiedDirectContext(
		entry.sentence,
		normalizedWord,
		entry.wordPos,
		langHint
	);
	return verifiedContext.found ? verifiedContext : null;
}

function getContextForWord(word, options) {
	const params = options || {};
	const trimmedWord = typeof word === "string" ? word.trim() : "";
	const languageHint =
		params.languageHint ||
		(currentBook && currentBook.language) ||
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
	const selectionContext = getSelectionContext(trimmedWord, languageHint);
	if (!selectionContext || !selectionContext.found) {
		return selectionContext || buildEmptyContextPayload(trimmedWord, languageHint);
	}
	if (
		params.expectedWord &&
		selectionContext.word &&
		selectionContext.word.toLowerCase() !== String(params.expectedWord).trim().toLowerCase()
	) {
		return buildEmptyContextPayload(trimmedWord, languageHint);
	}
	return selectionContext;
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
	if (!context || !context.found || !context.sentence) {
		if (params.cacheOnly && recentResolvedEntry && recentResolvedEntry.translation) {
			return Promise.resolve(recentResolvedEntry.translation);
		}
		return Promise.resolve("");
	}
	return resolveContextualSourceLang(context, requestedSourceLang, params.detectedLang || "").then(function (effectiveSourceLang) {
		const cacheKey = buildContextualWordCacheKey(context, effectiveSourceLang, requestedTargetLang);
		if (cacheKey && contextualWordTranslationCache.has(cacheKey)) {
			return contextualWordTranslationCache.get(cacheKey) || "";
		}
		if (params.cacheOnly) {
			if (recentResolvedEntry && recentResolvedEntry.translation) {
				return recentResolvedEntry.translation;
			}
			return "";
		}
		return shouldSkipContextualTranslationForWord(trimmedWord, effectiveSourceLang).then(function (shouldSkip) {
			if (shouldSkip) return "";
			if (cacheKey && contextualWordTranslationCache.has(cacheKey)) {
				return contextualWordTranslationCache.get(cacheKey) || "";
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
			}).then(function (result) {
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
			}).catch(function () { return ""; }).finally(function () {
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

// Thin wrapper used by buildAnnotationDeps / ContentDifficulty — no caching options.
function translateWordInContext(opts) {
	return requestWordTranslationInContext({
		word: opts.word,
		sourceLang: opts.sourceLang || "auto",
		contextSentence: opts.contextSentence,
		contextWordPos: opts.contextWordPos,
	});
}

// Low-level: uses chrome.i18n directly, returns base lang string (mirrors content.js detectTextLanguageWithBrowserApi).
function detectLangText(text) {
	return new Promise(function (resolve) {
		try {
			if (!chrome || !chrome.i18n || typeof chrome.i18n.detectLanguage !== "function") {
				resolve(""); return;
			}
			chrome.i18n.detectLanguage(text || "", function (result) {
				if (chrome.runtime.lastError || !result || !Array.isArray(result.languages)) {
					resolve(""); return;
				}
				if (result.languages.length === 0) { resolve(""); return; }
				const top = result.languages[0];
				const lang = (top && top.language ? top.language : "").toLowerCase();
				resolve((lang.split("-")[0] || ""));
			});
		} catch (_) {
			resolve("");
		}
	});
}

// Higher-level detectLang used by ContentSelection / showWordPreview.
function detectLang(text) {
	return ContentSelectionRef
		? ContentSelectionRef.detectLang(text, chrome.runtime, chrome.i18n)
		: detectLangText(text);
}

function shouldSkipTranslateAndDictionaryForLang(detected) {
	if (!detected) return false;
	const browserBase = (navigator.language || "en").split("-")[0].toLowerCase();
	const norm = function (l) { return l === "fil" ? "tl" : l; };
	if (norm(detected) === "zh" && norm(browserBase) === "zh") return true;
	return norm(detected) === norm(browserBase);
}

function isExtensionUiElement(el) {
	if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
	if (el.id === "translationBox") return true;
	if (el.classList.contains("plugin-highlight-word")) return true;
	for (let i = 0; i < el.classList.length; i++) {
		if (el.classList[i].startsWith("la-")) return true;
	}
	return false;
}

const _selectionTourState = { contentSelectionTourAttempted: true };

function showTranslation(translation, opts) {
	const WordfreqUtils = globalThis.WordfreqUtils || null;
	ContentLookupUiRef.showTranslation(translation, {
		document,
		startContentSelectionTour: function () {},
		chromeRuntime: chrome.runtime,
		WordfreqUtils: WordfreqUtils,
		sourceWord: opts && opts.sourceWord,
		sourceLang: opts && opts.sourceLang,
		isContextual: !!(opts && opts.isContextual),
		state: _selectionTourState,
	});
}

function updateTranslationBox(translation, opts) {
	ContentLookupUiRef.updateTranslationBox(translation, { document, isContextual: !!(opts && opts.isContextual) });
}

function appendDictionaryToTranslationBox(dictResponse, sourceLang) {
	ContentLookupUiRef.appendDictionaryToTranslationBox(dictResponse, sourceLang, {
		document,
		contentT: t,
		DictionaryUtilsRef,
		TranslationUtilsRef,
		chromeRuntime: chrome.runtime,
		WordStorage,
		startContentSelectionTour: function () {},
		state: _selectionTourState,
	});
}

function showWordPreview(anchor, previewData, examples, languageHint) {
	const word = anchor && anchor.textContent && anchor.textContent.trim().toLowerCase();
	WordStorage.getWords(word ? [word] : []).then(function (data) {
		const freshExamples = (word && data && data[word] && Array.isArray(data[word].examples))
			? data[word].examples
			: (Array.isArray(examples) ? examples : []);
		const payload = (previewData && typeof previewData === "object" && !Array.isArray(previewData))
			? Object.assign({}, previewData) : previewData;
		if (payload && typeof payload === "object" && !Array.isArray(payload) && !Array.isArray(payload.examples)) {
			payload.examples = freshExamples;
		}
		const wfUtils = globalThis.WordfreqUtils || null;
		ContentLookupUiRef.showWordPreview(anchor, payload, freshExamples, {
			document, WordStorage, chromeRuntime: chrome.runtime,
			TranslationUtilsRef, DictionaryUtilsRef, contentT: t,
			normalizeDictionaryQuery: DictionaryUtilsRef.normalizeDictionaryQuery,
			shouldLookupDictionaryQuery: DictionaryUtilsRef.shouldLookupDictionaryQuery,
			supportsDictionaryBySourceLang: DictionaryUtilsRef.supportsDictionaryBySourceLang,
			getExampleText: function (ex) { return ex && typeof ex.text === "string" ? ex.text : (typeof ex === "string" ? ex : ""); },
			isCjkText: ContentPageProcessingRef.isCjkText,
			isBoundaryMatch: ContentPageProcessingRef.isBoundaryMatch,
			findWholeWordMatch: ExampleUtilsRef.findWholeWordMatch,
			languageHint: languageHint || "en",
			detectLanguage: detectLang,
			translateWordInContext: function (o) { return requestWordTranslationInContext(o); },
			WordfreqUtils: wfUtils,
		});
	}).catch(function () {});
}

// — DOM elements —
const shelfView = document.getElementById("shelfView");
const fileInput = document.getElementById("fileInput");
const readerShell = document.getElementById("readerShell");
const bookTitleEl = document.getElementById("bookTitle");
const chapterSelect = document.getElementById("chapterSelect");
const prevChapterBtn = document.getElementById("prevChapter");
const nextChapterBtn = document.getElementById("nextChapter");
const readingPane = document.getElementById("readingPane");
const chapterProgress = document.getElementById("chapterProgress");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const tocList = document.getElementById("tocList");
const loadingOverlay = document.getElementById("loadingOverlay");
const progressFill = document.getElementById("progressFill");
const fontSizeDown = document.getElementById("fontSizeDown");
const fontSizeUp = document.getElementById("fontSizeUp");
const widthSlider = document.getElementById("widthSlider");
const shelfGrid = document.getElementById("shelfGrid");
const shelfEmpty = document.getElementById("shelfEmpty");

// — Init —
document.addEventListener("DOMContentLoaded", function () {
	WordStorage.getUiLanguage().then(function (lang) {
		uiLang = lang || "zh-TW";
		applyUiText();
	}).catch(function () {
		uiLang = "zh-TW";
		applyUiText();
	});

	setupFileInput();
	setupShelf();
	setupNav();
	setupThemeToggle();
	setupFontSize();
	setupFontWeight();
	setupFontSelect();
	setupReadingWidth();
	restorePreferences();
	setupTourBtn();
	renderShelf().then(function () { tryRestoreFromHash(); });
	setupMessageListener();
});

function setupMessageListener() {
	chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
		if (msg && msg.action === "openAddWordModal") {
			showReaderAddWordModal(msg.word || "");
			sendResponse({ ok: true });
		}
		return false;
	});
}

function applyUiText() {
	document.documentElement.lang = (globalThis.UiI18n && globalThis.UiI18n.langAttr) ? UiI18n.langAttr(uiLang) : uiLang;
	document.title = t("epub_reader_title") || "電子書閱讀器";
	const emptyHint = document.getElementById("shelfEmptyHint");
	if (emptyHint) emptyHint.textContent = t("epub_shelf_empty") || emptyHint.textContent;
	const shelfHeading = document.getElementById("shelfHeading");
	if (shelfHeading) shelfHeading.textContent = "📚 " + (t("epub_shelf") || "書架");
	const shelfAddLabel = document.getElementById("shelfAddLabel");
	if (shelfAddLabel) shelfAddLabel.textContent = t("epub_add_book") || "加入書籍";
	const shelfBtn = document.getElementById("shelfBtn");
	if (shelfBtn) shelfBtn.title = t("epub_back_to_shelf") || "書架";
	const sidebarToggle = document.getElementById("sidebarToggle");
	if (sidebarToggle) sidebarToggle.title = t("epub_toc") || "目錄";
	const fontSizeDown = document.getElementById("fontSizeDown");
	if (fontSizeDown) fontSizeDown.title = t("epub_font_smaller") || "縮小字體";
	const fontSizeUp = document.getElementById("fontSizeUp");
	if (fontSizeUp) fontSizeUp.title = t("epub_font_larger") || "放大字體";
	const fontSelectEl = document.getElementById("fontSelect");
	if (fontSelectEl) fontSelectEl.title = t("epub_font") || "字體";
	const fwTitles = { "300": t("epub_fw_light") || "細體", "400": t("epub_fw_regular") || "常規", "600": t("epub_fw_bold") || "粗體" };
	document.querySelectorAll(".fw-btn").forEach(function (btn) {
		if (fwTitles[btn.dataset.fw]) btn.title = fwTitles[btn.dataset.fw];
	});
	prevChapterBtn.title = t("epub_prev_chapter");
	nextChapterBtn.title = t("epub_next_chapter");
	const epubHelpBtn = document.getElementById("epubHelpBtn");
	if (epubHelpBtn && globalThis.UiTour) epubHelpBtn.title = UiTour.getLabel(uiLang, "replay") || "教學導覽";
}

// — Tour —
function setupTourBtn() {
	const btn = document.getElementById("epubHelpBtn");
	if (!btn || !globalThis.UiTour) return;
	btn.addEventListener("click", function () {
		UiTour.start({ lang: uiLang, steps: UiTour.getSteps(uiLang, "epub"), document });
	});
}

function maybeStartEpubTour() {
	if (!globalThis.UiTour) return;
	UiTour.maybeStartOnce({ storageKey: "epub_v1", lang: uiLang, steps: UiTour.getSteps(uiLang, "epub"), document });
}

// — File input —
function setupFileInput() {
	fileInput.addEventListener("change", function (e) {
		const file = e.target.files && e.target.files[0];
		if (file) openEpub(file);
		fileInput.value = "";
	});
}

// — Bookshelf —
function showShelf() {
	if (currentBook && typeof currentBook.destroy === "function") {
		currentBook.destroy();
		currentBook = null;
	}
	readerShell.classList.remove("visible");
	shelfView.style.display = "";
	renderShelf();
}

function setupShelf() {
	const shelfBtn = document.getElementById("shelfBtn");
	const shelfAddBtn = document.getElementById("shelfAddBtn");

	if (shelfBtn) shelfBtn.addEventListener("click", showShelf);
	if (shelfAddBtn) shelfAddBtn.addEventListener("click", function () { fileInput.click(); });
}

async function renderShelf() {
	const EpubShelf = globalThis.EpubShelf;
	shelfGrid.innerHTML = "";
	if (!EpubShelf) {
		shelfEmpty.style.display = "";
		shelfGrid.style.display = "none";
		return;
	}
	const books = await EpubShelf.listBooks().catch(function () { return []; });
	if (books.length === 0) {
		shelfEmpty.style.display = "";
		shelfGrid.style.display = "none";
		return;
	}
	shelfEmpty.style.display = "none";
	shelfGrid.style.display = "";
	books.forEach(function (book) {
		const card = createShelfCard(book);
		shelfGrid.appendChild(card);
	});
}

function createShelfCard(book) {
	const div = document.createElement("div");
	div.className = "shelf-book";
	div.setAttribute("role", "button");
	div.setAttribute("tabindex", "0");

	const coverDiv = document.createElement("div");
	coverDiv.className = "shelf-book-cover";

	if (book.coverDataUrl) {
		const img = document.createElement("img");
		img.src = book.coverDataUrl;
		img.alt = book.title || "";
		coverDiv.appendChild(img);
	} else {
		const ph = document.createElement("span");
		ph.className = "cover-placeholder";
		ph.textContent = "📖";
		coverDiv.appendChild(ph);
	}

	// Reading progress bar
	if (book.chapterCount > 1 && typeof book.lastChapter === "number") {
		const pct = Math.round((book.lastChapter / (book.chapterCount - 1)) * 100);
		const progDiv = document.createElement("div");
		progDiv.className = "shelf-book-progress";
		const fill = document.createElement("div");
		fill.className = "shelf-book-progress-fill";
		fill.style.width = pct + "%";
		progDiv.appendChild(fill);
		coverDiv.appendChild(progDiv);
	}

	const delBtn = document.createElement("button");
	delBtn.className = "shelf-book-delete";
	delBtn.type = "button";
	delBtn.title = "從書架移除";
	delBtn.textContent = "✕";
	delBtn.addEventListener("click", function (e) {
		e.stopPropagation();
		const EpubShelf = globalThis.EpubShelf;
		if (EpubShelf) EpubShelf.removeBook(book.bookHash).then(renderShelf).catch(function () {});
	});

	const titleDiv = document.createElement("div");
	titleDiv.className = "shelf-book-title";
	titleDiv.textContent = book.title || "未知書名";

	div.appendChild(coverDiv);
	div.appendChild(delBtn);
	div.appendChild(titleDiv);

	async function openBook() {
		const EpubShelf = globalThis.EpubShelf;
		if (!EpubShelf) return;
		shelfView.style.display = "none";
		showLoading();
		try {
			const buffer = await EpubShelf.getBookBuffer(book.bookHash);
			if (!buffer) throw new Error("buffer not found");
			if (currentBook && typeof currentBook.destroy === "function") currentBook.destroy();
			let parsedBook;
			if (book.format === "mobi") {
				const MP = globalThis.MobiParser;
				if (!MP) throw new Error("MobiParser not loaded");
				parsedBook = await MP.parse(buffer);
			} else if (book.format === "pdf") {
				const PP = globalThis.PdfParser;
				if (!PP) throw new Error("PdfParser not loaded");
				parsedBook = await PP.parse(buffer);
			} else {
				const zip = await JSZip.loadAsync(buffer);
				parsedBook = await EpubParser.parse(zip);
			}
			currentBook = parsedBook;
			currentBookHash = book.bookHash;
			currentBookTitle = parsedBook.title || book.title || "";
			bookTitleEl.textContent = currentBookTitle;
			document.title = currentBookTitle + " — " + (t("epub_reader_title") || "電子書閱讀器");
			populateChapterSelect(parsedBook.chapters);
			populateTocList(parsedBook.chapters);
			const startChapter = (typeof book.lastChapter === "number" && book.lastChapter < parsedBook.chapters.length) ? book.lastChapter : 0;
			const startScroll = book.lastScrollTop || 0;
			await renderChapter(startChapter);
			readingPane.scrollTop = startScroll;
			readerShell.classList.add("visible");
			const debouncedSave = debounce(function () {
				EpubShelf.updateReadState(currentBookHash, currentChapterIndex, readingPane.scrollTop).catch(function () {});
			}, 600);
			readingPane.addEventListener("scroll", debouncedSave);
		} catch (e) {
			console.error("epub-shelf: open failed", e);
			showError(t("epub_load_error"));
		}
	}

	div.addEventListener("click", openBook);
	div.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") openBook(); });
	return div;
}

function setupNav() {
	prevChapterBtn.addEventListener("click", function () {
		if (currentBook && currentChapterIndex > 0) goToChapter(currentChapterIndex - 1);
	});
	nextChapterBtn.addEventListener("click", function () {
		if (currentBook && currentChapterIndex < currentBook.chapters.length - 1) goToChapter(currentChapterIndex + 1);
	});
	chapterSelect.addEventListener("change", function () {
		const idx = parseInt(chapterSelect.value, 10);
		if (!isNaN(idx)) goToChapter(idx);
	});
	if (sidebarToggle) {
		sidebarToggle.addEventListener("click", function () {
			sidebarOpen = !sidebarOpen;
			toggleSidebar(sidebarOpen);
		});
	}
	// Keyboard navigation
	document.addEventListener("keydown", function (e) {
		if (!currentBook) return;
		if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) return;
		if (e.key === "ArrowRight" || e.key === "ArrowDown") {
			if (currentChapterIndex < currentBook.chapters.length - 1) goToChapter(currentChapterIndex + 1);
		} else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
			if (currentChapterIndex > 0) goToChapter(currentChapterIndex - 1);
		}
	});
}

function toggleSidebar(open) {
	sidebarOpen = open;
	if (sidebar) {
		sidebar.classList.toggle("collapsed", !open);
	}
}

function applyTheme(val) {
	document.documentElement.setAttribute("data-theme", val);
	document.querySelectorAll(".theme-btn").forEach(function (b) {
		b.classList.toggle("active", b.dataset.themeVal === val);
	});
	try { localStorage.setItem("epubReaderTheme", val); } catch (_) {}
}

function setupThemeToggle() {
	document.addEventListener("click", function (e) {
		const btn = e.target.closest(".theme-btn");
		if (!btn) return;
		const val = btn.dataset.themeVal;
		if (!val) return;
		applyTheme(val);
	});
}

function applyReadingWidth(w) {
	document.documentElement.style.setProperty("--reading-max-width", w + "px");
	if (widthSlider) widthSlider.value = String(w);
	try { localStorage.setItem("epubReaderWidth", String(w)); } catch (_) {}
}

function setupReadingWidth() {
	if (!widthSlider) return;
	widthSlider.addEventListener("input", function () {
		applyReadingWidth(parseInt(widthSlider.value, 10));
	});
}

// ── Font controls ────────────────────────────────────────────────────────────
// Three independent axes: size (numeric), family (preset id), weight (300/400/600).
// All three persist via localStorage and are restored in restorePreferences().

function ensureGoogleFontLoaded(preset) {
	if (!preset.googleFont) return;
	const linkId = "gf-" + preset.id;
	if (document.getElementById(linkId)) return;
	const link = document.createElement("link");
	link.id = linkId;
	link.rel = "stylesheet";
	link.href = "https://fonts.googleapis.com/css2?family=" + preset.googleFont + "&display=swap";
	// Failure (offline/CSP) is silently ignored; the font stack fallbacks take over.
	document.head.appendChild(link);
}

function applyFontSize(size) {
	currentFontSize = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, size));
	document.documentElement.style.setProperty("--reader-font-size", currentFontSize + "px");
	try { localStorage.setItem("epubReaderFontSize", String(currentFontSize)); } catch (_) {}
}

function applyFont(id) {
	const preset = FONT_PRESETS.find(function (p) { return p.id === id; }) || FONT_PRESETS[0];
	currentFontId = preset.id;
	ensureGoogleFontLoaded(preset);
	document.documentElement.style.setProperty("--reader-font-family", preset.stack);
	const sel = document.getElementById("fontSelect");
	if (sel && sel.value !== preset.id) sel.value = preset.id;
	try { localStorage.setItem("epubReaderFont", preset.id); } catch (_) {}
}

function applyFontWeight(w) {
	document.documentElement.style.setProperty("--reader-font-weight", String(w));
	document.querySelectorAll(".fw-btn").forEach(function (btn) {
		btn.classList.toggle("active", Number(btn.dataset.fw) === w);
	});
	try { localStorage.setItem("epubReaderFontWeight", String(w)); } catch (_) {}
}

function setupFontSize() {
	if (fontSizeDown) {
		fontSizeDown.addEventListener("click", function () { applyFontSize(currentFontSize - FONT_SIZE_STEP); });
	}
	if (fontSizeUp) {
		fontSizeUp.addEventListener("click", function () { applyFontSize(currentFontSize + FONT_SIZE_STEP); });
	}
}

function setupFontSelect() {
	const sel = document.getElementById("fontSelect");
	if (!sel) return;
	FONT_PRESETS.forEach(function (p) {
		const opt = document.createElement("option");
		opt.value = p.id;
		opt.textContent = p.label;
		sel.appendChild(opt);
	});
	sel.value = currentFontId;
	sel.addEventListener("change", function () { applyFont(sel.value); });
}

function setupFontWeight() {
	document.querySelectorAll(".fw-btn").forEach(function (btn) {
		btn.addEventListener("click", function () {
			applyFontWeight(Number(btn.dataset.fw));
		});
	});
}

function restorePreferences() {
	try {
		const savedTheme = localStorage.getItem("epubReaderTheme");
		if (savedTheme) applyTheme(savedTheme);
		const savedFs = localStorage.getItem("epubReaderFontSize");
		if (savedFs) {
			const fs = parseInt(savedFs, 10);
			if (!isNaN(fs)) applyFontSize(fs);
		}
		const savedWidth = localStorage.getItem("epubReaderWidth");
		if (savedWidth) {
			const w = parseInt(savedWidth, 10);
			if (!isNaN(w)) applyReadingWidth(w);
		}
		const savedFont = localStorage.getItem("epubReaderFont");
		if (savedFont) applyFont(savedFont);
		const savedFw = localStorage.getItem("epubReaderFontWeight");
		if (savedFw) {
			const fw = parseInt(savedFw, 10);
			if (fw === 300 || fw === 400 || fw === 600) applyFontWeight(fw);
		}
	} catch (_) {}
}

// — Open ePub / MOBI —
function isMobiFile(name) {
	return /\.(mobi|azw|azw3)$/i.test(name || "");
}

function isPdfFile(name) {
	return /\.pdf$/i.test(name || "");
}

async function parseBook(file, buffer) {
	if (isMobiFile(file.name)) {
		const MP = globalThis.MobiParser;
		if (!MP) throw new Error("MobiParser not loaded");
		return { book: await MP.parse(buffer), format: "mobi" };
	}
	if (isPdfFile(file.name)) {
		const PP = globalThis.PdfParser;
		if (!PP) throw new Error("PdfParser not loaded");
		return { book: await PP.parse(buffer), format: "pdf" };
	}
	const zip = await JSZip.loadAsync(buffer);
	return { book: await EpubParser.parse(zip), format: "epub" };
}

async function openEpub(file) {
	const ext = (file.name || "").toLowerCase();
	if (!ext.endsWith(".epub") && !isMobiFile(file.name) && !isPdfFile(file.name)) {
		if (globalThis.UiToast) UiToast.show(t("epub_load_error"), "error");
		return;
	}

	// Destroy previous book's cached resources
	if (currentBook && typeof currentBook.destroy === "function") currentBook.destroy();

	showLoading();
	let buffer;
	try {
		buffer = await file.arrayBuffer();
	} catch (e) {
		showError(t("epub_load_error"));
		return;
	}

	const bookHash = computeBookHash(buffer);

	let book, format;
	try {
		({ book, format } = await parseBook(file, buffer));
	} catch (e) {
		console.error("epub-reader: parse failed", e);
		showError(t("epub_load_error"));
		return;
	}

	currentBook = book;
	currentBookHash = bookHash;
	const displayTitle = format === "pdf" ? file.name.replace(/\.pdf$/i, "") || file.name : (book.title || file.name);
	currentBookTitle = displayTitle;
	bookTitleEl.textContent = displayTitle;
	document.title = displayTitle + " — " + (t("epub_reader_title") || "電子書閱讀器");

	populateChapterSelect(book.chapters);
	populateTocList(book.chapters);

	// Restore reading position from shelf
	const EpubShelf = globalThis.EpubShelf;
	const shelfMeta = EpubShelf ? await EpubShelf.getBookMeta(bookHash).catch(function () { return null; }) : null;
	const startChapter = (shelfMeta && shelfMeta.lastChapter < book.chapters.length) ? shelfMeta.lastChapter : 0;
	const startScroll = shelfMeta ? (shelfMeta.lastScrollTop || 0) : 0;

	await renderChapter(startChapter);
	readingPane.scrollTop = startScroll;

	shelfView.style.display = "none";
	readerShell.classList.add("visible");
	maybeStartEpubTour();

	// Save to shelf (async — don't block render)
	if (EpubShelf) {
		book.getCoverDataUrl().then(function (coverDataUrl) {
			return EpubShelf.saveBook(bookHash, {
				title: format === "pdf" ? file.name.replace(/\.pdf$/i, "") || file.name : (book.title || file.name),
				language: book.language || "en",
				chapterCount: book.chapters.length,
				coverDataUrl: coverDataUrl || null,
				lastChapter: startChapter,
				lastScrollTop: startScroll,
				format: format,
			}, buffer);
		}).catch(function (e) { console.warn("epub-shelf: save failed", e); });
	}

	const debouncedSave = debounce(function () {
		if (EpubShelf) EpubShelf.updateReadState(currentBookHash, currentChapterIndex, readingPane.scrollTop).catch(function () {});
	}, 600);
	readingPane.addEventListener("scroll", debouncedSave);
}

function showLoading(msg) {
	if (loadingOverlay) {
		const txt = loadingOverlay.querySelector("#loadingText");
		if (txt) txt.textContent = msg || t("epub_loading") || "載入中…";
		loadingOverlay.classList.add("visible");
	} else {
		readingPane.innerHTML = "<p style='padding:32px;color:#7b655b;'>" + (t("epub_loading") || "載入中…") + "</p>";
	}
	readerShell.classList.add("visible");
	shelfView.style.display = "none";
}

function hideLoading() {
	if (loadingOverlay) loadingOverlay.classList.remove("visible");
}

function showError(msg) {
	hideLoading();
	readerShell.classList.remove("visible");
	shelfView.style.display = "";
	if (globalThis.UiToast) UiToast.show(msg, "error");
}

function populateChapterSelect(chapters) {
	chapterSelect.innerHTML = "";
	chapters.forEach(function (ch, i) {
		const opt = document.createElement("option");
		opt.value = String(i);
		opt.textContent = ch.title || ((t("epub_chapter") || "章節") + " " + (i + 1));
		chapterSelect.appendChild(opt);
	});
}

function populateTocList(chapters) {
	if (!tocList) return;
	tocList.innerHTML = "";
	chapters.forEach(function (ch, i) {
		const btn = document.createElement("button");
		btn.className = "toc-item";
		btn.type = "button";
		btn.dataset.chapterIndex = String(i);
		btn.textContent = ch.title || ((t("epub_chapter") || "章節") + " " + (i + 1));
		btn.addEventListener("click", function () {
			goToChapter(i);
		});
		tocList.appendChild(btn);
	});
}

function goToChapter(index) {
	renderChapter(index).then(function () {
		readingPane.scrollTop = 0;
		const EpubShelf = globalThis.EpubShelf;
		if (EpubShelf && currentBookHash) EpubShelf.updateReadState(currentBookHash, index, 0).catch(function () {});
	});
}

// ── URL hash navigation ───────────────────────────────────────────────────────
// Format: #HASH/CHAPTER_INDEX/title-slug
// HASH    = bookHash (8 hex chars, enough for uniqueness in a personal library)
// CHAPTER = 0-based chapter index
// slug    = cosmetic only — ignored on parse, helps human readability

function titleToSlug(title) {
	return (title || "")
		.toLowerCase()
		.replace(/[^a-z0-9一-鿿぀-ヿ]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

function updateUrlHash(chapterIndex) {
	if (!currentBookHash) return;
	const slug = titleToSlug(currentBookTitle);
	const short = currentBookHash.slice(0, 8);
	const hash = "#" + short + "/" + chapterIndex + (slug ? "/" + slug : "");
	history.replaceState(null, "", hash);
}

function parseUrlHash() {
	const raw = location.hash.slice(1); // strip leading #
	if (!raw) return null;
	const parts = raw.split("/");
	if (parts.length < 2) return null;
	const hashPrefix = parts[0];
	const chapterIndex = parseInt(parts[1], 10);
	if (!hashPrefix || isNaN(chapterIndex)) return null;
	return { hashPrefix, chapterIndex };
}

// Called after shelf is loaded. If the URL hash matches a shelf book, open it.
async function tryRestoreFromHash() {
	const parsed = parseUrlHash();
	if (!parsed) return;
	const EpubShelf = globalThis.EpubShelf;
	if (!EpubShelf) return;
	const books = await EpubShelf.listBooks().catch(function () { return []; });
	const match = books.find(function (b) {
		return b.bookHash && b.bookHash.slice(0, 8) === parsed.hashPrefix;
	});
	if (!match) return;
	showLoading();
	try {
		const buffer = await EpubShelf.getBookBuffer(match.bookHash);
		if (!buffer) { hideLoading(); return; }
		// Build a fake file with the correct extension so parseBook detects format
		const ext = match.format === "mobi" ? ".mobi" : match.format === "pdf" ? ".pdf" : ".epub";
		const fakeFile = { name: (match.title || "book") + ext };
		const { book, format } = await parseBook(fakeFile, buffer);
		currentBook = book;
		currentBookHash = match.bookHash;
		currentBookTitle = match.title || book.title || "";
		bookTitleEl.textContent = currentBookTitle;
		document.title = currentBookTitle + " — " + (t("epub_reader_title") || "電子書閱讀器");
		populateChapterSelect(book.chapters);
		populateTocList(book.chapters);
		const chIdx = (typeof parsed.chapterIndex === "number" && parsed.chapterIndex < book.chapters.length)
			? parsed.chapterIndex : 0;
		await renderChapter(chIdx);
		shelfView.style.display = "none";
		readerShell.classList.add("visible");
		const debouncedSave = debounce(function () {
			EpubShelf.updateReadState(currentBookHash, currentChapterIndex, readingPane.scrollTop).catch(function () {});
		}, 600);
		readingPane.addEventListener("scroll", debouncedSave);
	} catch (e) {
		console.warn("epub-reader: hash restore failed", e);
		hideLoading();
	}
}

// ── PDF rendering ────────────────────────────────────────────────────────────
// Convert pdf.js TextContent items to flowing HTML paragraphs.
// Three rendering paths share the same dehyphenation + escaping helpers below:
//   • Path A: pdfTaggedToHtml          — uses pdf.js marked-content structure
//   • Path B: pdfHeuristicFromLines    — coordinate-based segmentation
//   • Path C: tocLinesToHtml           — detects + renders table of contents pages
// Entry point: pdfTextContentToHtml picks a path based on item structure.

function dehyphenate(text) {
	return text
		.replace(/([a-zA-Zà-žÀ-ŽÀ-ɏ])-\s+([a-zA-Zà-žÀ-ŽÀ-ɏ])/g, "$1$2")
		.replace(/([a-zA-Zà-žÀ-ŽÀ-ɏ])\s+-\s+([a-zA-Zà-žÀ-ŽÀ-ɏ])/g, "$1$2");
}

function escapeHtml(s) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Path A: tagged PDF — use pdf.js marked-content structure ─────────────────
// pdf.js exposes `{ includeMarkedContent: true }` which emits synthetic items:
//   { type: 'beginMarkedContent',     tag: 'Artifact' }  ← page numbers, headers
//   { type: 'beginMarkedContentProps', tag: 'P', id: … } ← paragraph start
//   { type: 'endMarkedContent' }                          ← paragraph/artifact end
// Real text items have no `type` field.
function pdfTaggedToHtml(items) {
	const paragraphs = [];
	let currentPara = [];
	let depth = 0;           // nesting level of open marked-content blocks
	let inArtifact = 0;      // >0 → skip (headers, footers, page numbers)

	function flushPara() {
		const text = dehyphenate(currentPara.join("")).trim();
		if (text) paragraphs.push(text);
		currentPara = [];
	}

	for (const item of items) {
		if (item.type === "beginMarkedContent" || item.type === "beginMarkedContentProps") {
			depth++;
			if (item.tag === "Artifact") inArtifact++;
			else if (item.tag === "P" && depth > 0) {
				// Starting a new tagged paragraph — flush any preceding loose text
				if (currentPara.length) flushPara();
			}
		} else if (item.type === "endMarkedContent") {
			if (inArtifact > 0) inArtifact--;
			depth = Math.max(0, depth - 1);
		} else if (item.str !== undefined) {
			// Real text item
			if (inArtifact > 0) continue;
			// Use the string as-is (pdf.js includes explicit space tokens with str=" ")
			currentPara.push(item.str);
		}
	}
	flushPara();

	if (!paragraphs.length) return null; // signal to fall back to heuristic path
	// Dehyphenate each paragraph (handles PDF line-wrap artefacts in tagged PDFs too)
	return paragraphs.map(function (p) { return "<p>" + escapeHtml(dehyphenate(p)) + "</p>"; }).join("\n");
}

// ── Path B: untagged PDF — coordinate-based paragraph detection ───────────────
// Key design decisions to handle DTP-generated PDFs (QuarkXPress, InDesign, etc.):
//
// 1. SPACE TOKENS: pdf.js emits explicit whitespace items (str=" ", hasEOL?).
//    These are authoritative word-boundary markers — no gap math needed there.
//    We accumulate them in a `pendingSpace` flag rather than skipping them.
//
// 2. GAP THRESHOLD: For non-space-delimited tokens, a gap > fontSize*0.18 adds
//    a space. 0.18 em is well below a word space (~0.3 em) but above kerning
//    adjustments, so adjacent glyphs of the same word are not split.
//
// 3. hasEOL: pdf.js sets item.hasEOL:true on the last item before a PDF newline
//    operator (Td/TD/T*/etc.). We use this as a secondary grouping signal.
//
// 4. PARAGRAPH MERGE: After gap-based segmentation, we merge adjacent segments
//    that look like mid-sentence breaks:
//      • previous segment ends without sentence-terminal punctuation
//      • next segment starts with a lowercase letter
//    This handles justified text where a short final line causes a false break.

function pdfHeuristicFromLines(lines, baseFontSize) {
	if (!lines.length) return "<p>（" + (t("epub_empty_page") || "此頁無文字內容") + "）</p>";

	// ── Separate footnote area from body ──────────────────────────────────────
	// Footnote lines: significantly smaller font AND in the lower portion of the page.
	// Strategy: find the y-range of the page, then flag lines in the bottom 30% of that
	// range whose avgFs < 85% of the body font size.
	// A footnote block typically starts with a digit (the footnote number reference).
	const yValues = lines.map(function (l) { return l.y; });
	const yMax = Math.max.apply(null, yValues);
	const yMin = Math.min.apply(null, yValues);
	const pageHeight = yMax - yMin || 1;
	const bottomThresholdY = yMin + pageHeight * 0.32; // lower 32% of page
	const footnoteFsThresh = baseFontSize * 0.86;

	const bodyLines = [];
	const footnoteLines = [];
	let inFootnoteArea = false;

	for (const ln of lines) {
		const isSmallFont = (ln.avgFs || baseFontSize) < footnoteFsThresh;
		const isNearBottom = ln.y < bottomThresholdY;
		// Once we enter the footnote area, all subsequent lines (lower y) are footnotes
		if (!inFootnoteArea && isSmallFont && isNearBottom) inFootnoteArea = true;
		if (inFootnoteArea) footnoteLines.push(ln);
		else bodyLines.push(ln);
	}

	// ── 5. Layout metrics (body lines only) ──────────────────────────────────
	const workLines = bodyLines.length ? bodyLines : lines; // fallback: all lines

	// Dominant left margin = mode of x0 bucketed to 2px
	const x0Freq = {};
	for (const ln of workLines) {
		const b = Math.round(ln.x0 / 2) * 2;
		x0Freq[b] = (x0Freq[b] || 0) + 1;
	}
	const leftMargin = parseFloat(Object.keys(x0Freq).sort(function (a, b) {
		return x0Freq[b] - x0Freq[a];
	})[0] || 0);

	// 40th-percentile inter-line gap → "normal" single line spacing
	const gaps = [];
	for (let i = 1; i < workLines.length; i++) gaps.push(workLines[i - 1].y - workLines[i].y);
	gaps.sort(function (a, b) { return a - b; });
	const normalLineGap = gaps[Math.floor(gaps.length * 0.4)] || baseFontSize * 1.2;

	// Page text width = widest real line
	let pageTextWidth = 0;
	for (const ln of workLines) {
		const last = ln.tokens.filter(function (t) { return !t.isSpace; }).pop();
		if (last) pageTextWidth = Math.max(pageTextWidth, last.x + last.w - leftMargin);
	}
	if (pageTextWidth < 1) pageTextWidth = 400;

	// ── 6. Paragraph segmentation ─────────────────────────────────────────────
	const segments = [];
	let current = [];

	function flushSegment() {
		const joined = dehyphenate(current.join(" ")).trim();
		if (joined) segments.push(joined);
		current = [];
	}

	for (let i = 0; i < workLines.length; i++) {
		const ln = workLines[i];
		const text = ln.text;

		if (i > 0 && current.length) {
			const gap = workLines[i - 1].y - ln.y;
			const indented = ln.x0 - leftMargin > baseFontSize * 1.5;

			const prevLn = workLines[i - 1];
			const prevLast = prevLn.tokens.filter(function (t) { return !t.isSpace; }).pop();
			const prevRight = prevLast ? prevLast.x + prevLast.w - leftMargin : 0;
			const prevLineShort = prevRight < pageTextWidth * 0.60;

			const isParaBreak =
				gap > normalLineGap * 1.6 ||
				(gap > normalLineGap * 1.15 && indented) ||
				(gap > normalLineGap * 1.1  && prevLineShort);

			if (isParaBreak) flushSegment();
		}

		if (current.length && /[\p{L}]-$/u.test(current[current.length - 1])) {
			current[current.length - 1] = current[current.length - 1].slice(0, -1) + text;
		} else {
			current.push(text);
		}
	}
	flushSegment();

	// ── 7. Post-process: merge false paragraph breaks ─────────────────────────
	const TERMINAL = /[.!?。！？…]["»›'"'"]?$/;
	const paragraphs = [];
	let acc = segments[0] || "";
	for (let i = 1; i < segments.length; i++) {
		const next = segments[i];
		if (!TERMINAL.test(acc.trimEnd()) && /^\p{Ll}/u.test(next.trimStart())) {
			acc = dehyphenate(acc + " " + next);
		} else {
			if (acc) paragraphs.push(acc);
			acc = next;
		}
	}
	if (acc) paragraphs.push(acc);

	let html = paragraphs.map(function (p) { return "<p>" + escapeHtml(p.trim()) + "</p>"; }).join("\n");
	if (!html) html = "<p>（" + (t("epub_empty_page") || "此頁無文字內容") + "）</p>";

	// ── 8. Footnote block ─────────────────────────────────────────────────────
	// Join footnote lines into a single block (they flow as one continuous text
	// at the bottom of the page). Dehyphenate across lines too.
	if (footnoteLines.length) {
		const fnText = dehyphenate(footnoteLines.map(function (l) { return l.text; }).join(" ")).trim();
		if (fnText) {
			html += '\n<p class="pdf-footnotes">' + escapeHtml(fnText) + "</p>";
		}
	}

	return html;
}

// ── Path C: TOC page rendering ────────────────────────────────────────────────
// TOC entries follow the pattern:  Title ......... N
// We detect this, split title from page-number, and render as a styled list.

// Returns true if the line looks like a TOC entry (title + leader + page number)
// Text-based: line ends with dots/spaces + page number
function isTocLineText(text) {
	return /^.{2,}\s*[.·•‥…]{2,}\s*\d{1,5}\s*$/.test(text) ||  // dot leader
	       /^.{2,}\s{3,}\d{1,5}\s*$/.test(text);                 // whitespace leader
}

// Coordinate-based: last token is a number AND its left edge is far right
// (gap between title text and page number > 15% of page width → right-aligned)
function isTocLineCoord(ln, rightMargin) {
	if (!ln.tokens || !ln.tokens.length) return false;
	const realToks = ln.tokens.filter(function (t) { return !t.isSpace && t.str.trim(); });
	if (realToks.length < 2) return false;  // need at least title + page-number token
	const lastTok = realToks[realToks.length - 1];
	const prevTok = realToks[realToks.length - 2];
	// Last token must be a pure page number (1–4 digits, optionally Roman numerals)
	if (!/^(\d{1,4}|[ivxlcdmIVXLCDM]{1,6})$/.test(lastTok.str.trim())) return false;
	// Gap between end of previous token and start of page-number token
	const gap = lastTok.x - (prevTok.x + prevTok.w);
	// Page-number token must be near the right margin (within 30px)
	const nearRight = lastTok.x + lastTok.w >= rightMargin - 30;
	// Gap must be substantial: > 10% of page width
	return nearRight && gap > rightMargin * 0.10;
}

const TOC_HEADINGS = /\b(contents?|table of contents?|daftar isi|daftar|目次|目錄|sommaire|inhalt|índice|оглавление)\b/i;

function detectTocPage(lines) {
	const nonEmpty = lines.filter(function (ln) { return ln.text.trim().length > 0; });
	if (nonEmpty.length < 3) return false;

	// Compute right margin from all tokens
	let rightMargin = 0;
	for (const ln of nonEmpty) {
		if (!ln.tokens) continue;
		for (const t of ln.tokens) {
			if (!t.isSpace) rightMargin = Math.max(rightMargin, t.x + t.w);
		}
	}

	const textMatches = nonEmpty.filter(function (ln) { return isTocLineText(ln.text); }).length;
	const coordMatches = rightMargin > 0
		? nonEmpty.filter(function (ln) { return isTocLineCoord(ln, rightMargin); }).length
		: 0;
	const tocCount = Math.max(textMatches, coordMatches);
	const ratio = tocCount / nonEmpty.length;

	if (ratio >= 0.35) return true;
	// Fewer matches but has a known TOC heading keyword
	if (tocCount >= 3 && nonEmpty.some(function (ln) { return TOC_HEADINGS.test(ln.text); })) return true;
	return false;
}

// Build the title/page split for a line, using both text patterns and coordinate info.
function buildTocLineInfo(ln) {
	const text = (typeof ln === "string" ? ln : ln.text || "").trim();

	// Text pattern: dot leader
	const m1 = text.match(/^(.*?)\s*[.·•‥…]{2,}\s*(\d{1,5})\s*$/);
	if (m1) return { title: m1[1].trim(), page: m1[2] };
	// Text pattern: whitespace leader (3+ spaces)
	const m2 = text.match(/^(.*?)\s{3,}(\d{1,4})\s*$/);
	if (m2) return { title: m2[1].trim(), page: m2[2] };

	// Coordinate split: find the gap between the last numeric token and what precedes it
	if (ln && ln.tokens) {
		const realToks = ln.tokens.filter(function (t) { return !t.isSpace && t.str.trim(); });
		if (realToks.length >= 2) {
			const last = realToks[realToks.length - 1];
			if (/^(\d{1,4}|[ivxlcdmIVXLCDM]{1,6})$/.test(last.str.trim())) {
				const titlePart = text.slice(0, text.lastIndexOf(last.str.trim())).trim();
				if (titlePart.length >= 2) return { title: titlePart, page: last.str.trim() };
			}
		}
	}
	return null;
}

function tocLinesToHtml(lines) {
	const nonEmpty = lines.filter(function (ln) { return ln.text.trim().length > 0; });
	let html = '<ul class="pdf-toc">';
	for (const ln of nonEmpty) {
		const text = ln.text.trim();
		const entry = buildTocLineInfo(ln);  // pass full line object for coord fallback
		if (entry) {
			html += '<li class="pdf-toc-entry"><span class="pdf-toc-title">'
				+ escapeHtml(entry.title)
				+ '</span><span class="pdf-toc-page">'
				+ escapeHtml(entry.page)
				+ '</span></li>';
		} else {
			html += '<li class="pdf-toc-heading">' + escapeHtml(text) + '</li>';
		}
	}
	html += '</ul>';
	return html;
}

// Unicode superscript digits (footnote markers rendered inline without HTML tags)
const SUPERSCRIPT_MAP = { "0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹" };
function toSuperscriptDigits(s) {
	return s.replace(/\d/g, function (d) { return SUPERSCRIPT_MAP[d] || d; });
}

// Builds lines array from raw items (shared between TOC detection and heuristic path).
// Inline footnote markers (small-font pure-digit tokens) are converted to Unicode superscript.
function pdfBuildLines(items) {
	const rawItems = [];
	for (const item of items) {
		if (item.type !== undefined || item.str === undefined) continue;
		const t = item.transform || [1, 0, 0, 1, 0, 0];
		rawItems.push({
			str: item.str, x: t[4], y: t[5],
			fs: Math.abs(t[3]) || item.height || 12,
			w: item.width || 0,
			hasEOL: !!item.hasEOL,
			isSpace: !item.str.trim() && item.str.length > 0,
		});
	}
	const sizes = rawItems.filter(function (it) { return !it.isSpace && it.str.trim(); })
		.map(function (it) { return it.fs; }).sort(function (a, b) { return a - b; });
	const baseFontSize = sizes[Math.floor(sizes.length / 2)] || 12;
	// Threshold: a number token this much smaller than median is an inline footnote marker
	const superscriptFsThresh = baseFontSize * 0.78;
	const thresh = baseFontSize * 0.55;

	const lineMap = [];
	for (const it of rawItems) {
		if (!it.isSpace && !it.str.trim()) continue;
		let placed = false;
		for (const ln of lineMap) {
			if (Math.abs(ln.y - it.y) <= thresh) { ln.tokens.push(it); placed = true; break; }
		}
		if (!placed) lineMap.push({ y: it.y, tokens: [it] });
	}
	for (const ln of lineMap) ln.tokens.sort(function (a, b) { return a.x - b.x; });
	lineMap.sort(function (a, b) { return b.y - a.y; });

	// Build text per line; convert small-font digit tokens to superscript Unicode
	const lines = [];
	for (const ln of lineMap) {
		let text = "";
		let prevWasSpace = false;
		for (let i = 0; i < ln.tokens.length; i++) {
			const tok = ln.tokens[i];
			if (tok.isSpace) { if (text && !text.endsWith(" ")) text += " "; prevWasSpace = true; continue; }
			if (!tok.str.trim()) continue;

			// Inline footnote marker: pure digits (1-3), significantly smaller font than body
			const strTrimmed = tok.str.trim();
			const isInlineFootnote = /^\d{1,3}$/.test(strTrimmed) && tok.fs < superscriptFsThresh;
			const strToAppend = isInlineFootnote ? toSuperscriptDigits(strTrimmed) : tok.str;

			if (!text) { text += strToAppend; }
			else if (prevWasSpace) { text += strToAppend; }
			else {
				const ref = ln.tokens.slice(0, i).reverse().find(function (t) { return !t.isSpace; }) || tok;
				const gap = tok.x - (ref.x + ref.w);
				// Inline footnote markers attach without space even with a small gap
				const sep = isInlineFootnote ? "" : (gap > ref.fs * 0.18 ? " " : "");
				text += sep + strToAppend;
			}
			prevWasSpace = false;
		}
		const cleaned = text.trim();
		if (!cleaned) continue;
		const first = ln.tokens.find(function (t) { return !t.isSpace && t.str.trim(); });
		// Average font size of this line's real tokens (used for footnote area detection)
		const realToks = ln.tokens.filter(function (t) { return !t.isSpace && t.str.trim(); });
		const avgFs = realToks.length
			? realToks.reduce(function (s, t) { return s + t.fs; }, 0) / realToks.length
			: baseFontSize;
		lines.push({ text: cleaned, y: ln.y, x0: first ? first.x : 0, tokens: ln.tokens, avgFs });
	}
	return { lines, baseFontSize };
}

// ── Entry point: try tagged path first, fall back to heuristic / TOC ─────────
function pdfTextContentToHtml(items) {
	if (!items || !items.length) return "<p>（" + (t("epub_empty_page") || "此頁無文字內容") + "）</p>";

	const hasMarkedContent = items.some(function (it) {
		return it.type === "beginMarkedContentProps" || it.type === "beginMarkedContent";
	});
	const hasParagraphTags = items.some(function (it) {
		return (it.type === "beginMarkedContentProps" || it.type === "beginMarkedContent") && it.tag === "P";
	});

	if (hasMarkedContent && hasParagraphTags) {
		// Tagged PDF: use pdf.js structure markers for reliable paragraph boundaries.
		// Artifacts (running headers, page numbers, footnote rules) are automatically skipped.
		const result = pdfTaggedToHtml(items);
		if (result) return result;
	}

	// Untagged PDF: fall back to coordinate-based heuristic segmentation.
	// But first check if this page is a table of contents — render it as a list instead.
	const built = pdfBuildLines(items);
	if (detectTocPage(built.lines)) return tocLinesToHtml(built.lines);
	return pdfHeuristicFromLines(built.lines, built.baseFontSize);
}

// PDF view mode: "split" | "text" | "canvas" — persisted in localStorage
let pdfViewMode = (function () { try { return localStorage.getItem("epubReaderPdfView") || "split"; } catch (_) { return "split"; } })();

function applyPdfViewMode(mode, splitDiv) {
	pdfViewMode = mode;
	try { localStorage.setItem("epubReaderPdfView", mode); } catch (_) {}
	if (!splitDiv) return;
	splitDiv.classList.remove("view-text", "view-canvas");
	if (mode === "text")   splitDiv.classList.add("view-text");
	if (mode === "canvas") splitDiv.classList.add("view-canvas");
}

async function renderPdfPage(index) {
	// Cleanup
	activeBlobUrls.forEach(function (url) { URL.revokeObjectURL(url); });
	activeBlobUrls = [];
	if (currentMouseupHandler) {
		document.removeEventListener("mouseup", currentMouseupHandler);
		currentMouseupHandler = null;
	}

	const pageNum = index + 1; // pdf.js is 1-indexed
	const pdfDoc = currentBook._pdfDoc;

	readingPane.innerHTML = "";

	let page;
	try {
		page = await pdfDoc.getPage(pageNum);
	} catch (e) {
		readingPane.innerHTML = "<p style='padding:32px;color:var(--text-muted)'>" + (t("epub_load_error") || "無法載入頁面") + " " + pageNum + "</p>";
		return;
	}

	// ── Page header with view-mode toggle buttons ─────────────────────────────
	const header = document.createElement("div");
	header.className = "pdf-page-header";
	const pageLabel = document.createElement("span");
	pageLabel.textContent = "— " + pageNum + " / " + currentBook.chapters.length + " —";

	function makeViewBtn(mode, icon, titleKey, defaultTitle) {
		const btn = document.createElement("button");
		btn.className = "pdf-view-btn" + (pdfViewMode === mode ? " active" : "");
		btn.textContent = icon;
		btn.title = t(titleKey) || defaultTitle;
		btn.addEventListener("click", function () {
			applyPdfViewMode(mode, splitDiv);
			header.querySelectorAll(".pdf-view-btn").forEach(function (b) {
				b.classList.toggle("active", b === btn);
			});
		});
		return btn;
	}

	header.appendChild(makeViewBtn("split",  "⊞", "pdf_view_split",  "分欄"));
	header.appendChild(pageLabel);
	header.appendChild(makeViewBtn("text",   "≡", "pdf_view_text",   "純文字"));
	header.appendChild(makeViewBtn("canvas", "🖼", "pdf_view_canvas", "純圖像"));
	readingPane.appendChild(header);

	// ── Split layout: canvas (left) + text (right) ───────────────────────────
	const paneWidth = Math.max(400, readingPane.clientWidth - 80);
	const canvasMaxPx = Math.floor(paneWidth * 0.48);
	const baseVp = page.getViewport({ scale: 1 });
	const scale = Math.min(2.5, canvasMaxPx / baseVp.width);
	const vp = page.getViewport({ scale });

	const splitDiv = document.createElement("div");
	splitDiv.className = "pdf-split";
	applyPdfViewMode(pdfViewMode, splitDiv); // restore saved mode

	// Left: canvas column — show skeleton while pdf.js renders
	const canvasCol = document.createElement("div");
	canvasCol.className = "pdf-canvas-col";
	const skeleton = document.createElement("div");
	skeleton.className = "pdf-canvas-skeleton";
	skeleton.style.cssText = "width:" + Math.round(vp.width) + "px;height:" + Math.round(vp.height) + "px;";
	canvasCol.appendChild(skeleton);
	splitDiv.appendChild(canvasCol);

	// Right: text wrapper — placeholder while extracting
	const textCol = document.createElement("div");
	textCol.className = "pdf-text-col";
	const wrapper = document.createElement("div");
	wrapper.className = "epub-chapter-wrapper";
	wrapper.lang = (currentBook && currentBook.language) || "en";
	wrapper.innerHTML = "<p style='color:var(--text-muted);font-size:13px'>" + (t("epub_loading") || "載入中…") + "</p>";
	textCol.appendChild(wrapper);
	splitDiv.appendChild(textCol);

	readingPane.appendChild(splitDiv);

	// Text extraction (starts immediately; canvas renders in parallel)
	const textPromise = page.getTextContent({ includeMarkedContent: true })
		.then(function (tc) { return pdfTextContentToHtml(tc.items); })
		.catch(function () { return "<p>（" + (t("epub_empty_page") || "此頁無文字內容") + "）</p>"; });

	// HiDPI-aware canvas — render at device pixel ratio for crisp output
	const dpr = Math.min(window.devicePixelRatio || 1, 3);
	const canvas = document.createElement("canvas");
	canvas.width  = Math.round(vp.width  * dpr);
	canvas.height = Math.round(vp.height * dpr);
	canvas.style.width  = Math.round(vp.width)  + "px";
	canvas.style.height = Math.round(vp.height) + "px";
	const ctx = canvas.getContext("2d");
	ctx.scale(dpr, dpr);

	const canvasRenderPromise = page.render({ canvasContext: ctx, viewport: vp }).promise
		.then(function () {
			// Swap skeleton → rendered canvas
			canvasCol.replaceChild(canvas, skeleton);
			canvas.style.cssText = "display:block;max-width:100%;height:auto;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,.15);";
		})
		.catch(function () { skeleton.remove(); });

	// Fill text as soon as extracted (don't wait for canvas)
	wrapper.innerHTML = await textPromise;

	await canvasRenderPromise;

	// Overlay clickable link annotations on the canvas
	attachPdfLinkAnnotations(page, canvasCol, canvas, vp, pdfDoc).catch(function () {});

	// Inject modal CSS, highlight words, attach handler
	ContentUiRef.ensureAddWordModalStyle(document);
	const lang = currentBook.language || "en";
	const srcLang = lang.split("-")[0].toLowerCase();
	const WordfreqUtils = globalThis.WordfreqUtils || null;
	if (WordfreqUtils && WordfreqUtils.isSupported(srcLang)) {
		await WordfreqUtils.initForLang(srcLang).catch(function () {});
	}
	readerPageProcessingState.pendingExampleMap = {};
	readerPageProcessingState.exampleMergeTimer = null;
	const deps = buildAnnotationDeps(lang);
	ContentPageProcessingRef.highlightWords(deps, [wrapper]);
	attachSelectionHandler();

	currentChapterIndex = index;
	chapterSelect.value = String(index);
	updateNavUI();
	updateTocActive(index);
	updateProgressBar();
	updateUrlHash(index);
	hideLoading();
}

async function renderChapter(index) {
	// Cleanup previous chapter
	activeBlobUrls.forEach(function (url) { URL.revokeObjectURL(url); });
	activeBlobUrls = [];
	if (currentMouseupHandler) {
		document.removeEventListener("mouseup", currentMouseupHandler);
		currentMouseupHandler = null;
	}
	if (currentLinkHandler) {
		readingPane.removeEventListener("click", currentLinkHandler);
		currentLinkHandler = null;
	}

	// PDF uses a different rendering path
	if (currentBook && currentBook._isPdf) {
		await renderPdfPage(index);
		// Show difficulty panel after PDF text is rendered
		const pdfLang = (currentBook.language || "en");
		const pdfSrcLang = pdfLang.split("-")[0].toLowerCase();
		const pdfWfu = globalThis.WordfreqUtils || null;
		if (globalThis.ContentDifficulty && pdfWfu && pdfWfu.isSupported(pdfSrcLang)) {
			globalThis.ContentDifficulty.analyzeAndShow({
				sourceLang: pdfLang,
				document,
				translate: function (word) {
					return WordStorage.getTranslationEngine().catch(function () { return "online"; }).then(function (engine) {
						return TranslationUtilsRef.requestPreferredTranslation({
							chromeRuntime: chrome.runtime, chromeI18n: chrome.i18n,
							wordStorage: WordStorage, text: word, sourceLang: pdfLang,
							translationEngine: engine,
							targetLang: TranslationUtilsRef.getBrowserTargetLang(navigator),
						});
					}).catch(function () { return null; });
				},
				translateWordInContext: function (opts) {
					return requestWordTranslationInContext({
						word: opts.word, sourceLang: pdfLang,
						targetLang: TranslationUtilsRef.getBrowserTargetLang(navigator),
						contextSentence: opts.sentence, contextWordPos: opts.wordPos,
					}).catch(function () { return null; });
				},
				getLemma: function (word) {
					return resolveLemma ? resolveLemma(word, pdfLang).then(function (r) { return (r && r.lemma) || null; }).catch(function () { return null; }) : Promise.resolve(null);
				},
			});
		}
		return;
	}

	const chapter = currentBook.chapters[index];
	let rawContent;
	try {
		rawContent = await currentBook.getChapterContent(chapter.href, chapter.opfDir);
	} catch (e) {
		console.error("epub-reader: failed to read chapter", chapter.href, e);
		readingPane.innerHTML = "<p style='padding:32px;color:#7b655b;'>" + (t("epub_load_error") || "無法載入章節") + "</p>";
		return;
	}

	// Parse XHTML, fall back to HTML
	const parser = new DOMParser();
	let chapterDoc = parser.parseFromString(rawContent, "application/xhtml+xml");
	if (chapterDoc.querySelector("parsererror")) {
		chapterDoc = parser.parseFromString(rawContent, "text/html");
	}

	sanitizeChapterDocument(chapterDoc);

	const bodyEl = chapterDoc.body || chapterDoc.documentElement;
	const bodyHtml = bodyEl ? bodyEl.innerHTML : "";

	readingPane.innerHTML = "";
	const wrapper = document.createElement("div");
	wrapper.className = "epub-chapter-wrapper";
	// Set lang so the browser uses the correct hyphenation dictionary
	wrapper.lang = (currentBook && currentBook.language) || "en";
	wrapper.innerHTML = bodyHtml;
	readingPane.appendChild(wrapper);

	// Resolve images (async, don't block render)
	const chapterDir = chapter.href.includes("/") ? chapter.href.slice(0, chapter.href.lastIndexOf("/") + 1) : "";
	resolveImages(wrapper, currentBook, chapterDir).catch(function () {});

	// Inject modal CSS
	ContentUiRef.ensureAddWordModalStyle(document);

	// Word highlighting
	readerPageProcessingState.pendingExampleMap = {};
	readerPageProcessingState.exampleMergeTimer = null;
	const chapterLang = currentBook.language || "en";
	const chapterSrcLang = chapterLang.split("-")[0].toLowerCase();
	const WordfreqUtils = globalThis.WordfreqUtils || null;
	if (WordfreqUtils && WordfreqUtils.isSupported(chapterSrcLang)) {
		await WordfreqUtils.initForLang(chapterSrcLang).catch(function () {});
	}
	const deps = buildAnnotationDeps(chapterLang);
	ContentPageProcessingRef.highlightWords(deps, [wrapper]);

	// Article difficulty panel
	if (globalThis.ContentDifficulty && WordfreqUtils && WordfreqUtils.isSupported(chapterSrcLang)) {
		globalThis.ContentDifficulty.analyzeAndShow({
			sourceLang: chapterLang,
			document,
			translate: function (word) {
				return WordStorage.getTranslationEngine().catch(function () { return "online"; }).then(function (engine) {
					return TranslationUtilsRef.requestPreferredTranslation({
						chromeRuntime: chrome.runtime,
						chromeI18n: chrome.i18n,
						wordStorage: WordStorage,
						text: word,
						sourceLang: chapterLang,
						translationEngine: engine,
						targetLang: TranslationUtilsRef.getBrowserTargetLang(navigator),
					});
				}).catch(function () { return null; });
			},
			translateWordInContext: function (opts) {
				return requestWordTranslationInContext({
					word: opts.word,
					sourceLang: chapterLang,
					targetLang: TranslationUtilsRef.getBrowserTargetLang(navigator),
					contextSentence: opts.sentence,
					contextWordPos: opts.wordPos,
				}).then(function (r) { return r || null; }).catch(function () { return null; });
			},
			getLemma: function (word) {
				return resolveLemma ? resolveLemma(word, chapterLang).then(function (r) { return (r && r.lemma) || null; }).catch(function () { return null; }) : Promise.resolve(null);
			},
		});
	}

	// Internal link navigation + selection/translation handler
	attachInternalLinkHandler();
	attachSelectionHandler();

	// Update UI state
	currentChapterIndex = index;
	chapterSelect.value = String(index);
	updateNavUI();
	updateTocActive(index);
	updateProgressBar();
	updateUrlHash(index);
	hideLoading();
}

// — Security sanitization —
function sanitizeChapterDocument(doc) {
	doc.querySelectorAll("script, iframe, object, embed, form").forEach(function (el) { el.remove(); });
	doc.querySelectorAll('link[rel="stylesheet"], link[rel="import"]').forEach(function (el) { el.remove(); });
	doc.querySelectorAll('meta[http-equiv]').forEach(function (el) { el.remove(); });

	const DANGEROUS_ATTRS = ["onclick", "onload", "onerror", "onmouseover", "onmouseout",
		"onfocus", "onblur", "onchange", "onsubmit", "onkeydown", "onkeyup", "onkeypress",
		"ondblclick", "oncontextmenu", "onpointerdown", "onpointerup", "ontouchstart",
		"ontouchend", "onauxclick", "onwheel", "onscroll", "ondragstart", "ondrop"];

	doc.querySelectorAll("*").forEach(function (el) {
		DANGEROUS_ATTRS.forEach(function (attr) { el.removeAttribute(attr); });
		const href = el.getAttribute("href");
		if (href && /^\s*javascript:/i.test(href)) el.removeAttribute("href");
		const src = el.getAttribute("src");
		if (src && (/^\s*javascript:/i.test(src) || /^\s*data:(?!image\/)/i.test(src))) {
			el.removeAttribute("src");
		}
		// Remove data: action on any element
		const action = el.getAttribute("action");
		if (action && /^\s*javascript:/i.test(action)) el.removeAttribute("action");
	});
}

// — Image resolution —
async function resolveImages(container, book, chapterDir) {
	// Collect all image references: <img src>, <image xlink:href>, <image href>
	const tasks = [];

	container.querySelectorAll("img[src]").forEach(function (el) {
		tasks.push({ el: el, getAttr: function () { return el.getAttribute("src"); }, setAttr: function (v) { el.src = v; } });
	});

	// SVG <image> — handles both xlink:href (ePub2) and href (SVG2)
	container.querySelectorAll("image").forEach(function (el) {
		const xlinkHref = el.getAttributeNS("http://www.w3.org/1999/xlink", "href") || el.getAttribute("xlink:href");
		const href = el.getAttribute("href");
		const raw = xlinkHref || href;
		if (raw) {
			tasks.push({
				el: el,
				getAttr: function () { return raw; },
				setAttr: function (v) {
					if (xlinkHref) el.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", v);
					else el.setAttribute("href", v);
				},
			});
		}
	});

	for (let i = 0; i < tasks.length; i++) {
		const rawSrc = tasks[i].getAttr();
		if (!rawSrc) continue;
		if (/^https?:\/\//i.test(rawSrc) || /^blob:/i.test(rawSrc)) continue;
		if (/^\s*data:image\//i.test(rawSrc)) continue;

		const resolvedPath = EpubParser.resolveHref(chapterDir, rawSrc);
		try {
			const blob = await book.getFileAsBlob(resolvedPath, "");
			const blobUrl = URL.createObjectURL(blob);
			activeBlobUrls.push(blobUrl);
			tasks[i].setAttr(blobUrl);
		} catch (e) {
			tasks[i].el.style.display = "none";
		}
	}
}

// — Mark learned —
function markLearned(word) {
	const lowerWord = word.toLowerCase();
	ContentUiRef.showConfirmModal({
		document, t: t,
		message: (t("mark_confirm_prefix") || "") + lowerWord + (t("mark_confirm_suffix") || ""),
	}).then(function (confirmed) {
		if (!confirmed) return;
		WordStorage.getWords().then(function (words) {
			if (!words[lowerWord]) return;
			words[lowerWord].learned = true;
			return WordStorage.saveWords(words, { syncMode: "immediate" }).then(function () {
				document.querySelectorAll(".plugin-highlight-word").forEach(function (span) {
					if (span.textContent.toLowerCase() === lowerWord) {
						// Replace span with plain text to remove all inline styles and event listeners
						const text = document.createTextNode(span.textContent);
						if (span.parentNode) span.parentNode.replaceChild(text, span);
					}
				});
			});
		}).catch(function (e) { console.error("markLearned failed:", e); });
	});
}

// — Annotation deps —
function buildAnnotationDeps(languageHint) {
	const WordfreqUtils = globalThis.WordfreqUtils || null;
	const srcLang = (languageHint || "en").split("-")[0].toLowerCase();
	const wfEnabled = !!(WordfreqUtils && WordfreqUtils.isSupported(srcLang));
	return {
		document, Node,
		skipTags: SKIP_TEXT_TAGS,
		isExtensionUiElement,
		isCurrentDomainExcluded: function () { return Promise.resolve(false); },
		showWordPreview: function (anchor, previewData, examples) { showWordPreview(anchor, previewData, examples, languageHint); },
		hideWordPreview: function (delay) { ContentLookupUiRef.hideWordPreview(delay); },
		WordStorage,
		splitIntoSentences: ExampleUtilsRef.splitIntoSentences,
		isLowInformationExample: ExampleUtilsRef.isLowInformationExample,
		normalizeText: function (text) { return (text || "").replace(/\s+/g, " ").trim(); },
		normalizeExampleList: ExampleUtilsRef.normalizeExampleList,
		hasContainmentRelation: ExampleUtilsRef.hasContainmentRelation,
		isTooSimilarToAny: ExampleUtilsRef.isTooSimilarToAny,
		enforceExampleLimit: ExampleUtilsRef.enforceExampleLimit,
		sortExamples: ExampleUtilsRef.sortExamples,
		maxExamplesPerWord: MAX_EXAMPLES_PER_WORD,
		languageHint: languageHint || "en",
		currentHref: function () {
			if (!currentBookHash) return location.href;
			const short = currentBookHash.slice(0, 8);
			const slug = titleToSlug(currentBookTitle);
			const hash = "#" + short + "/" + currentChapterIndex + (slug ? "/" + slug : "");
			const source = encodeURIComponent(currentBookTitle || "");
			return chrome.runtime.getURL("epub-reader.html") + "?source=" + source + hash;
		},
		markLearned: markLearned,
		openAddWordModal: showReaderAddWordModal,
		startContentTour: function () {},
		isBoundaryMatch: ContentPageProcessingRef.isBoundaryMatch,
		findWholeWordMatch: ExampleUtilsRef.findWholeWordMatch,
		detectLanguage: detectLang,
		translateWordInContext: translateWordInContext,
		WordfreqUtils: wfEnabled ? WordfreqUtils : null,
		state: {
			get pendingExampleMap() { return readerPageProcessingState.pendingExampleMap; },
			set pendingExampleMap(v) { readerPageProcessingState.pendingExampleMap = v; },
			get exampleMergeTimer() { return readerPageProcessingState.exampleMergeTimer; },
			set exampleMergeTimer(v) { readerPageProcessingState.exampleMergeTimer = v; },
			contentTourAttempted: true,
			contentTourPending: false,
		},
		onMergeError: function (e) { console.error("epub merge error:", e); },
		onHighlightError: function (e) { console.error("epub highlight error:", e); },
	};
}

// — Selection context helpers (mirrors content.js getRangeContextForWord) —
function getCleanContainerText(container) {
	const nodes = ContentPageProcessingRef.collectContainerTextNodes(container, {
		document, skipTags: SKIP_TEXT_TAGS, isExtensionUiElement,
	});
	let text = "";
	for (let i = 0; i < nodes.length; i++) text += (nodes[i] && nodes[i].nodeValue) || "";
	return text;
}

function getAbsoluteOffsetInContainer(range, container) {
	if (!range || !container) return null;
	const startContainer = range.startContainer;
	if (startContainer && startContainer.nodeType === Node.TEXT_NODE) {
		const baseOffset = ContentPageProcessingRef.computeNodeOffsetWithinContainer(startContainer, container, {
			document, skipTags: SKIP_TEXT_TAGS, isExtensionUiElement,
		});
		if (baseOffset >= 0) return baseOffset + Math.max(0, range.startOffset || 0);
	}
	return null;
}

function getSelectionContext(word, languageHint) {
	const selection = window.getSelection();
	if (!selection || !selection.rangeCount || !word) return null;
	const range = selection.getRangeAt(0);
	const container = ContentPageProcessingRef.findNearestContextContainerForNode(range.startContainer, { document }) || document.body;
	const absoluteOffset = getAbsoluteOffsetInContainer(range, container);
	if (absoluteOffset == null) return null;
	const lang = languageHint || (currentBook && currentBook.language) || document.documentElement.lang || navigator.language;
	return ContentPageProcessingRef.buildContextPayloadFromContainer(
		getCleanContainerText(container),
		word.trim(),
		absoluteOffset,
		lang,
		function (text, l) { return ExampleUtilsRef.splitIntoSentences(text, l || lang || "en"); }
	);
}

// ── Internal link navigation for EPUB / MOBI ─────────────────────────────────
// EPUB hrefs can be:
//   • "#anchorId"               — same chapter, scroll to anchor
//   • "chapter2.xhtml"          — different chapter (no anchor)
//   • "../Text/ch2.xhtml#s1"    — different chapter + anchor
//   • "filepos:12345"           — MOBI internal position (handled as chapter lookup)
//
// Resolution strategy:
//   1. Strip the fragment from the href.
//   2. Normalise the path relative to the current chapter's opfDir + href dir.
//   3. Find the matching chapter in currentBook.chapters by href.
//   4. Navigate to that chapter, then scroll to the anchor if present.
function resolveInternalHref(rawHref, currentChapter) {
	if (!rawHref) return null;
	const hashIdx = rawHref.indexOf("#");
	const fragment = hashIdx >= 0 ? rawHref.slice(hashIdx + 1) : "";
	const path     = hashIdx >= 0 ? rawHref.slice(0, hashIdx) : rawHref;

	// Same-chapter anchor only
	if (!path) return { chapterIndex: currentChapterIndex, anchor: fragment };

	// MOBI filepos: links — find the chapter whose _filepos is closest (≤) to target
	if (/^filepos:/i.test(rawHref)) {
		const target = parseInt(rawHref.replace(/^filepos:/i, ""), 10);
		if (isNaN(target)) return null;
		const chapters = currentBook && currentBook.chapters;
		if (!chapters) return null;
		// Find the chapter with the largest _filepos that is ≤ target
		let best = -1, bestPos = -1;
		for (let i = 0; i < chapters.length; i++) {
			const fp = chapters[i]._filepos;
			if (typeof fp === "number" && fp <= target && fp > bestPos) {
				bestPos = fp; best = i;
			}
		}
		return best >= 0 ? { chapterIndex: best, anchor: "" } : null;
	}

	// Normalise path relative to current chapter's directory
	const chapterHref = currentChapter ? currentChapter.href : "";
	const chapterDir  = chapterHref.includes("/") ? chapterHref.slice(0, chapterHref.lastIndexOf("/") + 1) : "";
	const opfDir      = (currentChapter && currentChapter.opfDir) || "";

	// Resolve ".." segments
	function normalisePath(base, rel) {
		if (/^https?:\/\//.test(rel) || /^data:/.test(rel)) return null; // external
		const parts = (base + rel).split("/");
		const out = [];
		for (const p of parts) {
			if (p === "..") out.pop();
			else if (p && p !== ".") out.push(p);
		}
		return out.join("/");
	}

	const normalised = normalisePath(opfDir + chapterDir, path);
	if (!normalised) return null;

	// Search chapters: match by full href (with opfDir prefix) or bare href
	const chapters = currentBook && currentBook.chapters;
	if (!chapters) return null;
	for (let i = 0; i < chapters.length; i++) {
		const ch = chapters[i];
		const fullHref = ch.opfDir ? ch.opfDir + "/" + ch.href : ch.href;
		if (fullHref === normalised || ch.href === normalised ||
		    ch.href === path || fullHref === path) {
			return { chapterIndex: i, anchor: fragment };
		}
	}
	// Fallback: basename match (some EPUBs use bare filenames)
	const base = normalised.slice(normalised.lastIndexOf("/") + 1);
	for (let i = 0; i < chapters.length; i++) {
		const chBase = chapters[i].href.slice(chapters[i].href.lastIndexOf("/") + 1);
		if (chBase === base) return { chapterIndex: i, anchor: fragment };
	}
	return null;
}

function scrollToAnchor(anchor) {
	if (!anchor) return;
	const el = document.getElementById(anchor) ||
	           readingPane.querySelector("[name='" + CSS.escape(anchor) + "']") ||
	           readingPane.querySelector("[id='" + CSS.escape(anchor) + "']");
	if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Attach a delegated click listener on readingPane that intercepts internal links.
// Returns the cleanup function.
let currentLinkHandler = null;
function attachInternalLinkHandler() {
	if (currentLinkHandler) readingPane.removeEventListener("click", currentLinkHandler);
	currentLinkHandler = function (e) {
		const a = e.target.closest("a[href]");
		if (!a) return;
		const href = a.getAttribute("href");
		if (!href) return;
		// Allow external links to open normally in a new tab
		if (/^https?:\/\//i.test(href)) { a.target = "_blank"; return; }
		// All other hrefs: intercept
		e.preventDefault();
		const chapter = currentBook && currentBook.chapters[currentChapterIndex];
		const target = resolveInternalHref(href, chapter);
		if (!target) return;
		if (target.chapterIndex !== currentChapterIndex) {
			renderChapter(target.chapterIndex).then(function () {
				if (target.anchor) setTimeout(function () { scrollToAnchor(target.anchor); }, 80);
			});
		} else {
			scrollToAnchor(target.anchor);
		}
	};
	readingPane.addEventListener("click", currentLinkHandler);
}

// ── PDF internal link annotations ────────────────────────────────────────────
// pdf.js page.getAnnotations() returns link annotations with destinations.
// We overlay transparent <div>s on the canvas column that navigate on click.
async function attachPdfLinkAnnotations(page, canvasCol, canvas, vp, pdfDoc) {
	let annots;
	try { annots = await page.getAnnotations(); } catch (_) { return; }

	const linkAnnots = annots.filter(function (a) { return a.subtype === "Link"; });
	if (!linkAnnots.length) return;

	// The canvas is scaled; map PDF-space rect to canvas-display-space rect.
	// canvas.style dimensions = canvas.width/height (no CSS scaling applied by us)
	// vp.transform maps PDF space → canvas pixel space: [sx, 0, 0, sy, tx, ty]
	const [sx, , , sy, tx, ty] = vp.transform;

	const overlay = document.createElement("div");
	overlay.style.cssText = "position:absolute;top:0;left:0;width:" + canvas.width + "px;height:" + canvas.height + "px;pointer-events:none;";
	// canvasCol needs position:relative for the overlay to be positioned against it
	canvasCol.style.position = "relative";
	canvasCol.appendChild(overlay);

	for (const annot of linkAnnots) {
		const rect = annot.rect; // [x1,y1,x2,y2] in PDF units, y-axis bottom-up
		// Map to canvas pixel coords (y flipped: PDF y=0 is bottom, canvas y=0 is top)
		const x1c = rect[0] * sx + tx;
		const y1c = canvas.height - (rect[3] * Math.abs(sy) + ty); // top in canvas space
		const x2c = rect[2] * sx + tx;
		const y2c = canvas.height - (rect[1] * Math.abs(sy) + ty); // bottom in canvas space
		const w = x2c - x1c, h = y2c - y1c;
		if (w <= 0 || h <= 0) continue;

		const btn = document.createElement("div");
		btn.style.cssText = "position:absolute;cursor:pointer;pointer-events:auto;" +
			"left:" + Math.round(x1c) + "px;top:" + Math.round(y1c) + "px;" +
			"width:" + Math.round(w) + "px;height:" + Math.round(h) + "px;";
		btn.title = ""; // suppress tooltip

		(function (a) {
			btn.addEventListener("click", function (e) {
				e.stopPropagation();
				// Internal page destination
				if (a.dest) {
					pdfDoc.getDestination(a.dest).then(function (dest) {
						if (!dest) return;
						// dest[0] is a page reference object
						return pdfDoc.getPageIndex(dest[0]).then(function (pageIdx) {
							renderChapter(pageIdx); // pageIdx is 0-based, matches our chapter index
						});
					}).catch(function () {});
					return;
				}
				if (a.unsafeUrl || a.url) {
					const url = a.unsafeUrl || a.url;
					if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener");
				}
			});
		})(annot);

		overlay.appendChild(btn);
	}
}

// — Selection / translation handler —
function attachSelectionHandler() {
	currentMouseupHandler = function () {
		const selectedText = window.getSelection().toString().trim();
		if (!(selectedText.length > 0 && selectedText.length <= 800)) return;
		WordStorage.getAutoTranslateOnSelect().then(function (enabled) {
			if (enabled) translateSelected(selectedText);
		}).catch(function () {
			translateSelected(selectedText);
		});
	};
	document.addEventListener("mouseup", currentMouseupHandler);
}

function translateSelected(text) {
	if (!ContentSelectionRef) return;
	const langHint = currentBook && currentBook.language || document.documentElement.lang || navigator.language;
	const selContext = getSelectionContext(text, langHint);
	ContentSelectionRef.translateSelection(text, {
		WordStorage,
		TranslationUtils: TranslationUtilsRef,
		DictionaryUtils: DictionaryUtilsRef,
		chromeRuntime: chrome.runtime,
		chromeI18n: chrome.i18n,
		navigator: window.navigator,
		shouldSkipTranslateAndDictionaryForLang,
		requestWordTranslationInContext: function (opts) {
			return requestWordTranslationInContext(Object.assign({}, opts, {
				contextSentence: (selContext && selContext.sentence) || opts.contextSentence,
				contextWordPos: (selContext && selContext.wordPos != null ? selContext.wordPos : opts.contextWordPos),
				sourceLang: opts.sourceLang || langHint,
				languageHint: langHint,
			}));
		},
		activeRequestIdRef: activeSelectionRequestIdRef,
		showTranslation,
		updateTranslationBox,
		appendDictionaryToTranslationBox,
		onBrowserFallback: function (result) {
			if (globalThis.UiToast) {
				const key = TranslationUtilsRef.getBrowserTranslationFallbackKey && TranslationUtilsRef.getBrowserTranslationFallbackKey(result && result.reason);
				if (key) UiToast.show(t(key), "error");
			}
		},
		onError: function (e) { console.error("epub-reader: translateSelected error", e); },
	});
}

// — Add word modal — delegates fully to lib/content-addword.js
function showReaderAddWordModal(word) {
	ContentAddWordRef.openAddWordModal(word, {
		document, t: t,
		WordStorage,
		LemmaUtils: LemmaUtilsRef,
		DictionaryUtils: DictionaryUtilsRef,
		ContentUi: ContentUiRef,
		TranslationUtils: TranslationUtilsRef,
		chromeRuntime: chrome.runtime,
		chromeI18n: chrome.i18n,
		resolveLemma,
		resolveLemmaVariations,
		normalizeDictionaryQuery: DictionaryUtilsRef.normalizeDictionaryQuery,
		supportsDictionaryBySourceLang: DictionaryUtilsRef.supportsDictionaryBySourceLang,
		shouldLookupDictionaryQuery: DictionaryUtilsRef.shouldLookupDictionaryQuery,
		translateWordInContext: function (opts) {
			return requestWordTranslationInContext({
				word: opts.word,
				sourceLang: opts.sourceLang || "auto",
				contextSentence: opts.contextSentence,
				contextWordPos: opts.contextWordPos,
				cacheOnly: true,
				allowRecentContextCache: true,
			}).then(function (translated) {
				if (translated) return translated;
				return TranslationUtilsRef.requestPreferredTranslation({
					chromeRuntime: chrome.runtime,
					chromeI18n: chrome.i18n,
					wordStorage: WordStorage,
					text: opts.word,
					sourceLang: opts.sourceLang || "auto",
				});
			});
		},
		getContextForWord: getContextForWord,
		onAfterSave: function (savedWord) { rehighlightCurrentChapter(savedWord); },
	}, {
		get current() { return readerAddWordModal; },
		set current(v) { readerAddWordModal = v; },
	});
}

// Re-scan the current chapter to highlight newly added word without full re-render.
function rehighlightCurrentChapter(newWord) {
	if (!currentBook) return;
	const wrapper = readingPane.querySelector(".epub-chapter-wrapper");
	if (!wrapper) return;
	const chapterLang = currentBook.language || "en";
	const deps = buildAnnotationDeps(chapterLang);
	// Collect only text nodes that are NOT already inside a highlight span
	// to avoid double-wrapping. Pass wrapper as root; ContentPageProcessing
	// skips nodes inside .plugin-highlight-word automatically via skipTags/isExtensionUiElement.
	ContentPageProcessingRef.highlightWords(deps, [wrapper]);
}

// — Nav UI —
function updateNavUI() {
	chapterSelect.value = String(currentChapterIndex);
	prevChapterBtn.disabled = currentChapterIndex <= 0;
	nextChapterBtn.disabled = !currentBook || currentChapterIndex >= currentBook.chapters.length - 1;
	if (chapterProgress && currentBook) {
		chapterProgress.textContent = (currentChapterIndex + 1) + " / " + currentBook.chapters.length;
	}
}

function updateTocActive(index) {
	if (!tocList) return;
	tocList.querySelectorAll(".toc-item").forEach(function (btn) {
		btn.classList.toggle("active", parseInt(btn.dataset.chapterIndex, 10) === index);
	});
	const active = tocList.querySelector(".toc-item.active");
	if (active) active.scrollIntoView({ block: "nearest" });
}

function updateProgressBar() {
	if (!progressFill || !currentBook) return;
	const pct = currentBook.chapters.length > 1
		? Math.round((currentChapterIndex / (currentBook.chapters.length - 1)) * 100)
		: 100;
	progressFill.style.width = pct + "%";
}

// — Utility —
// Quick non-cryptographic hash of the first 1KB; identifies a book in the shelf.
function computeBookHash(buffer) {
	const bytes = new Uint8Array(buffer, 0, Math.min(1000, buffer.byteLength));
	let hash = 0;
	for (let i = 0; i < bytes.length; i++) {
		hash = ((hash << 5) - hash + bytes[i]) | 0;
	}
	return (hash >>> 0).toString(16);
}

function debounce(fn, delay) {
	let timer = null;
	return function () {
		clearTimeout(timer);
		timer = setTimeout(fn, delay);
	};
}
