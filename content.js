// content.js
let addWordModal = null;
let confirmModal = null;
const MAX_EXAMPLES_PER_WORD = 20;
const EXAMPLE_SIMILARITY_THRESHOLD = 0.88;
const lemmaCache = new Map();
let contentUiLang = "en";
let contentTourAttempted = false;
let contentSelectionTourAttempted = false;
const DictionaryUtilsRef = globalThis.DictionaryUtils || {};
const LemmaUtilsRef = globalThis.LemmaUtils || {};
const ExampleUtilsRef = globalThis.ExampleUtils || {};
const ContentAddWordRef = globalThis.ContentAddWord || {};
const ContentTranslationRef = globalThis.ContentTranslation || {};
const ContentPageProcessingRef = globalThis.ContentPageProcessing || {};
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
		lemma_label: "Lemma",
		dict_via_lemma: "Dictionary result matched via lemma",
		lemma_available: "Lemma version available",
		use_lemma: "Use lemma",
		use_original: "Use original",
		using_lemma: "Using lemma",
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

function startContentTour(force) {
	if (!globalThis.UiTour) return;
	const run = force ? UiTour.start : UiTour.maybeStartOnce;
	run({
		storageKey: "content_v1",
		lang: contentUiLang,
		steps: UiTour.getSteps(contentUiLang, "content"),
	});
}

function startContentSelectionTour(force) {
	if (!globalThis.UiTour) return;
	const run = force ? UiTour.start : UiTour.maybeStartOnce;
	run({
		storageKey: "content_selection_v1",
		lang: contentUiLang,
		steps: UiTour.getSteps(contentUiLang, "contentSelection"),
	});
}

function isContextInvalidatedError(error) {
	return !!(error && typeof error.message === "string" && error.message.includes("Extension context invalidated"));
}

function getExampleText(entry) {
	if (typeof entry === "string") return (entry || "").replace(/\s+/g, " ").trim();
	if (entry && typeof entry === "object") return (entry.text || "").replace(/\s+/g, " ").trim();
	return "";
}

function queuePreviewTranslation(sentence, targetEl) {
	if (typeof ContentTranslationRef.queuePreviewTranslation === "function") {
		ContentTranslationRef.queuePreviewTranslation(sentence, targetEl, {
			WordStorage,
			chromeRuntime: chrome.runtime,
		});
		return;
	}
}

function createPreviewHighlightedSentence(sentence, word) {
	if (typeof ContentTranslationRef.createPreviewHighlightedSentence === "function") {
		return ContentTranslationRef.createPreviewHighlightedSentence(sentence, word, {
			document,
			isCjkText,
			isBoundaryMatch,
		});
	}
	const wrapper = document.createElement("div");
	wrapper.textContent = sentence || "";
	return wrapper;
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
	showConfirmModal(`${contentT("mark_confirm_prefix")}${lowerCaseWord}${contentT("mark_confirm_suffix")}`).then((confirmed) => {
		if (!confirmed) return;
		WordStorage.getWords().then((words) => {
			if (words[lowerCaseWord]) {
				words[lowerCaseWord].learned = true;
				WordStorage.saveWords(words).then(() => {
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
	if (typeof ContentTranslationRef.hideWordPreview === "function") {
		ContentTranslationRef.hideWordPreview(delay);
	}
}

function showWordPreview(anchor, meaning, examples) {
	if (typeof ContentTranslationRef.showWordPreview === "function") {
		ContentTranslationRef.showWordPreview(anchor, meaning, examples, {
			document,
			WordStorage,
			chromeRuntime: chrome.runtime,
			getExampleText,
			isCjkText,
			isBoundaryMatch,
		});
	}
}

function isCjkText(text) {
	if (typeof ContentPageProcessingRef.isCjkText === "function") {
		return ContentPageProcessingRef.isCjkText(text);
	}
	return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text || "");
}

function isBoundaryMatch(text, start, end, cjkWord) {
	if (typeof ContentPageProcessingRef.isBoundaryMatch === "function") {
		return ContentPageProcessingRef.isBoundaryMatch(text, start, end, cjkWord);
	}
	if (cjkWord) return true;
	const prev = start > 0 ? text[start - 1] : "";
	const next = end < text.length ? text[end] : "";
	return !(/[\p{L}\p{N}]/u.test(prev)) && !(/[\p{L}\p{N}]/u.test(next));
}

function normalizeText(text) {
	return (text || "").replace(/\s+/g, " ").trim();
}

function stripOuterPunctuation(text) {
	if (typeof ExampleUtilsRef.stripOuterPunctuation === "function") {
		return ExampleUtilsRef.stripOuterPunctuation(text);
	}
	return (text || "")
		.replace(/^[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{};:,./<>?\\|]+/u, "")
		.replace(/[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{};:,./<>?\\|]+$/u, "");
}

function normalizeDictionaryQuery(text) {
	if (typeof DictionaryUtilsRef.normalizeDictionaryQuery === "function") {
		return DictionaryUtilsRef.normalizeDictionaryQuery(text);
	}
	const cleaned = stripOuterPunctuation((text || "").trim());
	if (!cleaned) return "";
	return cleaned.split(/\s+/)[0] || "";
}

function normalizeLemmaSourceLang(sourceLang) {
	if (typeof LemmaUtilsRef.normalizeLemmaSourceLang === "function") {
		return LemmaUtilsRef.normalizeLemmaSourceLang(sourceLang);
	}
	const base = (((sourceLang || "").split("-")[0]) || "").toLowerCase();
	if (!base || base === "auto") return "";
	if (base === "fil") return "tl";
	return base;
}

function supportsLemmaBySourceLang(sourceLang) {
	if (typeof LemmaUtilsRef.supportsLemmaBySourceLang === "function") {
		return LemmaUtilsRef.supportsLemmaBySourceLang(sourceLang);
	}
	return !!normalizeLemmaSourceLang(sourceLang);
}

function resolveLemma(text, sourceLang) {
	const query = normalizeDictionaryQuery(text);
	const lang = normalizeLemmaSourceLang(sourceLang);
	if (!query || !lang || !supportsLemmaBySourceLang(lang)) {
		return Promise.resolve({ query, lemma: "", effectiveQuery: query, lang });
	}
	const cacheKey = `${lang}__${query.toLowerCase()}`;
	if (lemmaCache.has(cacheKey)) return Promise.resolve(lemmaCache.get(cacheKey));
	return new Promise((resolve) => {
		chrome.runtime.sendMessage(
			{ action: "getLemma", text: query, sourceLang: lang },
			(response) => {
				const lemma = response && response.found && typeof response.lemma === "string"
					? response.lemma.trim()
					: "";
				const payload = {
					query,
					lemma,
					effectiveQuery: lemma || query,
					lang,
				};
				lemmaCache.set(cacheKey, payload);
				resolve(payload);
			}
		);
	});
}

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

async function shouldSkipTranslateAndDictionary(text) {
	const detected = await detectTextLanguageWithBrowserApi(text);
	if (!detected) return false;
	const browserLang = getBrowserBaseLang();
	const normalizedDetected = detected === "fil" ? "tl" : detected;
	const normalizedBrowser = browserLang === "fil" ? "tl" : browserLang;
	if (normalizedDetected === "zh" && normalizedBrowser === "zh") return true;
	return normalizedDetected === normalizedBrowser;
}

function shouldLookupDictionaryQuery(query) {
	const q = (query || "").trim();
	if (!q) return false;
	if (q.length < 2 || q.length > 32) return false;
	// At least one letter from any script; reject pure digits/symbols.
	if (!/[\p{L}]/u.test(q)) return false;
	return true;
}

function supportsDictionaryBySourceLang(sourceLang) {
	if (typeof DictionaryUtilsRef.supportsDictionaryBySourceLang === "function") {
		return DictionaryUtilsRef.supportsDictionaryBySourceLang(sourceLang);
	}
	const normalized = (sourceLang || "").toLowerCase();
	return !!normalized && normalized !== "auto";
}

function getDictionarySourceLabel(source) {
	if (typeof DictionaryUtilsRef.getDictionarySourceLabel === "function") {
		return DictionaryUtilsRef.getDictionarySourceLabel(source);
	}
	return "Dictionary";
}

function getDictionarySectionLabel(mode, query) {
	if (typeof DictionaryUtilsRef.getDictionarySectionLabel === "function") {
		return DictionaryUtilsRef.getDictionarySectionLabel(contentT, mode, query);
	}
	if (mode === "lemma") {
		return `${contentT("lemma_label")}: ${query}`;
	}
	return `${contentT("dict_selected_form")}: ${query}`;
}

function getAddWordTargetWord(overlay, normalizedWord) {
	if (typeof ContentAddWordRef.getTargetWord === "function") {
		return ContentAddWordRef.getTargetWord(overlay, normalizedWord);
	}
	return String((overlay && overlay.dataset && overlay.dataset.targetWord) || normalizedWord || "")
		.trim()
		.toLowerCase();
}

function updateAddWordLineState(options) {
	if (typeof ContentAddWordRef.updateWordLine === "function") {
		return ContentAddWordRef.updateWordLine(options);
	}
	const targetWord = getAddWordTargetWord(options && options.overlay, options && options.normalizedWord);
	if (options && options.wordLine) options.wordLine.textContent = targetWord;
	if (options && options.hint) {
		options.hint.textContent = targetWord && targetWord !== options.normalizedWord
			? `${contentT("add_word_hint")} (${contentT("using_lemma")}: ${targetWord})`
			: contentT("add_word_hint");
	}
	return targetWord;
}

function setAddWordLemmaMode(options) {
	if (typeof ContentAddWordRef.setLemmaMode === "function") {
		return ContentAddWordRef.setLemmaMode(options);
	}
	const overlay = options && options.overlay;
	const normalizedWord = String((options && options.normalizedWord) || "").trim().toLowerCase();
	const lemmaValue = String((options && options.lemmaValue) || "").trim().toLowerCase();
	if (!overlay || !overlay.dataset) return normalizedWord;
	overlay.dataset.targetWord = options && options.useLemma && lemmaValue && lemmaValue !== normalizedWord
		? lemmaValue
		: normalizedWord;
	return updateAddWordLineState(options);
}

function applyAddWordDictionarySelection(options) {
	if (typeof ContentAddWordRef.applyDictionarySelection === "function") {
		return ContentAddWordRef.applyDictionarySelection(options);
	}
	const item = options && options.item;
	const section = options && options.section;
	if (!item || !section) return;
	const composed = item.definitionTranslated || item.definitionOriginal || "";
	const text = item.pos ? `[${item.pos}] ${composed}` : composed;
	if (options && options.input && text.trim()) options.input.value = text.trim();
	if (options && typeof options.onUserEdit === "function") options.onUserEdit();
	if (options && options.overlay && options.overlay.dataset) {
		options.overlay.dataset.dictPos = item.pos || "";
		options.overlay.dataset.dictDefinitionOriginal = item.definitionOriginal || "";
		options.overlay.dataset.dictDefinitionTranslated = item.definitionTranslated || "";
		options.overlay.dataset.dictSource = section.source || "dictionary";
		options.overlay.dataset.dictUsedLemma = section.mode === "lemma" ? "1" : "";
		options.overlay.dataset.dictLookupLemma = section.mode === "lemma" ? (section.query || "") : "";
		options.overlay.dataset.dictQueryText = section.query || "";
		options.overlay.dataset.dictSelectedIndex = String(options && typeof options.index === "number" ? options.index : 0);
	}
}

function mapDictionarySections(dictResponse, sourceLang) {
	if (typeof DictionaryUtilsRef.mapDictionarySections === "function") {
		return DictionaryUtilsRef.mapDictionarySections(dictResponse, sourceLang, {
			maxEntries: 3,
			translateEntry(definition, lang) {
				return new Promise((resolve) => {
					chrome.runtime.sendMessage(
						{
							action: "translate",
							text: definition,
							sourceLang: lang || "auto",
						},
						(defResp) => {
							const translated =
								!chrome.runtime.lastError && defResp && defResp.translation
									? defResp.translation
									: "";
							resolve(translated);
						}
					);
				});
			},
		});
	}
	return Promise.resolve([]);
}

function isLowInformationExample(sentence, word) {
	if (typeof ExampleUtilsRef.isLowInformationExample === "function") {
		return ExampleUtilsRef.isLowInformationExample(sentence, word);
	}
	return true;
}

function normalizeExampleEntry(entry) {
	if (typeof ExampleUtilsRef.normalizeExampleEntry === "function") {
		return ExampleUtilsRef.normalizeExampleEntry(entry);
	}
	return null;
}

function normalizeExampleList(entries) {
	if (typeof ExampleUtilsRef.normalizeExampleList === "function") {
		return ExampleUtilsRef.normalizeExampleList(entries);
	}
	return [];
}

function sortExamples(entries) {
	if (typeof ExampleUtilsRef.sortExamples === "function") {
		return ExampleUtilsRef.sortExamples(entries);
	}
	return entries;
}

function enforceExampleLimit(entries, maxLimit) {
	if (typeof ExampleUtilsRef.enforceExampleLimit === "function") {
		return ExampleUtilsRef.enforceExampleLimit(entries, maxLimit);
	}
	return entries;
}

function isLikelyGarbageSentence(text) {
	if (typeof ExampleUtilsRef.isLikelyGarbageSentence === "function") {
		return ExampleUtilsRef.isLikelyGarbageSentence(text);
	}
	return false;
}

function normalizeForSimilarity(text) {
	return normalizeText(text)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function tokenizeForSimilarity(text) {
	if (typeof ExampleUtilsRef.tokenizeForSimilarity === "function") {
		return ExampleUtilsRef.tokenizeForSimilarity(text);
	}
	const normalized = normalizeForSimilarity(text);
	return normalized ? normalized.split(" ") : [];
}

function sentenceSimilarity(a, b) {
	if (typeof ExampleUtilsRef.sentenceSimilarity === "function") {
		return ExampleUtilsRef.sentenceSimilarity(a, b);
	}
	return 0;
}

function getSimilarityThresholdForPair(a, b) {
	if (typeof ExampleUtilsRef.getSimilarityThresholdForPair === "function") {
		return ExampleUtilsRef.getSimilarityThresholdForPair(a, b, EXAMPLE_SIMILARITY_THRESHOLD);
	}
	return EXAMPLE_SIMILARITY_THRESHOLD;
}

function isTooSimilarToAny(candidate, pool) {
	if (typeof ExampleUtilsRef.isTooSimilarToAny === "function") {
		return ExampleUtilsRef.isTooSimilarToAny(candidate, pool, EXAMPLE_SIMILARITY_THRESHOLD);
	}
	return false;
}

function hasContainmentRelation(candidate, pool) {
	if (typeof ExampleUtilsRef.hasContainmentRelation === "function") {
		return ExampleUtilsRef.hasContainmentRelation(candidate, pool);
	}
	return false;
}

function splitIntoSentences(text) {
	if (typeof ExampleUtilsRef.splitIntoSentences === "function") {
		const lang =
			document.documentElement.lang ||
			(typeof navigator !== "undefined" ? navigator.language : "en");
		return ExampleUtilsRef.splitIntoSentences(text, lang || "en");
	}
	return [];
}

const contentPageProcessingState = {
	exampleMergeTimer: null,
	pendingExampleMap: {},
};

function getContentPageProcessingDeps() {
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
		currentHref: () => location.href,
		markLearned,
		startContentTour,
		state: {
			get pendingExampleMap() { return contentPageProcessingState.pendingExampleMap; },
			set pendingExampleMap(value) { contentPageProcessingState.pendingExampleMap = value; },
			get exampleMergeTimer() { return contentPageProcessingState.exampleMergeTimer; },
			set exampleMergeTimer(value) { contentPageProcessingState.exampleMergeTimer = value; },
			get contentTourAttempted() { return contentTourAttempted; },
			set contentTourAttempted(value) { contentTourAttempted = value; },
		},
		onMergeError(error) {
			console.error("Failed to merge examples:", error);
		},
		onHighlightError(error) {
			if (!isContextInvalidatedError(error)) {
				console.error("Failed to highlight words:", error);
			}
		},
	};
}

function highlightWords() {
	if (typeof ContentPageProcessingRef.highlightWords === "function") {
		return ContentPageProcessingRef.highlightWords(getContentPageProcessingDeps());
	}
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === "openAddWordModal" && request.word) {
		showAddWordModal(request.word);
		sendResponse({ ok: true });
	}
});

function showAddWordModal(word) {
	ensureAddWordModalStyle();
	if (addWordModal) addWordModal.remove();

	const normalizedWord = word.trim().toLowerCase();
	const modalUi = typeof ContentAddWordRef.createAddWordModal === "function"
		? ContentAddWordRef.createAddWordModal({
			document,
			normalizedWord,
			t: contentT,
			applyButtonStyle: applyModalButtonStyle,
			applyTextareaStyle: applyModalTextareaStyle,
		})
		: null;
	const overlay = modalUi ? modalUi.overlay : document.createElement("div");
	const wordLine = modalUi ? modalUi.wordLine : document.createElement("div");
	const hint = modalUi ? modalUi.hint : document.createElement("div");
	const lemmaNotice = modalUi ? modalUi.lemmaNotice : document.createElement("div");
	const lemmaText = modalUi ? modalUi.lemmaText : document.createElement("div");
	const lemmaBtn = modalUi ? modalUi.lemmaBtn : document.createElement("button");
	const input = modalUi ? modalUi.input : document.createElement("textarea");
	let userEdited = false;
	const dictPreview = modalUi ? modalUi.dictPreview : document.createElement("div");
	const dictTitle = modalUi ? modalUi.dictTitle : document.createElement("div");
	const dictList = modalUi ? modalUi.dictList : document.createElement("div");
	const cancelBtn = modalUi ? modalUi.cancelBtn : document.createElement("button");
	const saveBtn = modalUi ? modalUi.saveBtn : document.createElement("button");
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
			words[targetWord] = {
				meaning: meaning,
				learned: false,
				createdAt: existing && existing.createdAt ? existing.createdAt : Date.now(),
				lemma: (overlay.dataset.lemma || "").trim() || (existing && typeof existing.lemma === "string" ? existing.lemma : ""),
				dictionary: dictionary,
			};
			await WordStorage.saveWords(words);
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
			if (typeof DictionaryUtilsRef.renderInteractiveDictionarySections === "function") {
				DictionaryUtilsRef.renderInteractiveDictionarySections(dictList, sections, {
					document,
					emptyText: contentT("no_dict_entries"),
					getSectionTitle: (section) => `${getDictionarySectionLabel(section.mode, section.query)} · ${getDictionarySourceLabel(section.source)}`,
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
						applyModalButtonStyle(applyBtn, "apply");
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
			} else {
				dictList.innerHTML = "";
			}
		}
	);
	updateWordLine();
}

function ensureAddWordModalStyle() {
	if (document.getElementById("laAddWordStyle")) return;
	const style = document.createElement("style");
	style.id = "laAddWordStyle";
	style.textContent = `
		.la-addword-overlay {
			position: fixed;
			inset: 0;
			background: rgba(83, 61, 50, 0.24);
			z-index: 2147483646;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 16px;
			animation: laFadeIn 140ms ease-out;
		}
		.la-addword-modal {
			width: min(520px, 96vw);
			background: #fffaf3;
			border: 1px solid #dccabd;
			border-radius: 18px 15px 20px 16px;
			box-shadow: 0 18px 30px rgba(88, 63, 50, 0.16);
			padding: 16px;
			color: #34251f;
			font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
			animation: laRiseIn 170ms ease-out;
		}
		.la-addword-title {
			margin: 0;
			font-size: 18px;
			font-weight: 800;
			font-family: "Noto Serif TC", "Hiragino Mincho ProN", "Yu Mincho", serif;
		}
		.la-addword-modal button,
		.la-addword-modal textarea,
		.la-confirm-modal button {
			all: unset;
			box-sizing: border-box;
			font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
			line-height: 1.4;
			letter-spacing: normal;
			text-transform: none;
			-webkit-appearance: none;
			appearance: none;
		}
		.la-addword-word {
			margin-top: 8px;
			font-size: 14px;
			font-weight: 700;
			color: #8f5143;
		}
		.la-addword-hint {
			margin-top: 10px;
			font-size: 12px;
			color: #7b655b;
		}
		.la-addword-lemma {
			margin-top: 8px;
			padding: 8px 10px;
			border: 1px dashed #dcc8b8;
			border-radius: 12px 10px 14px 10px;
			background: #fff8f1;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
		}
		.la-addword-lemma-text {
			font-size: 12px;
			line-height: 1.45;
			color: #7a6258;
		}
		.la-addword-modal .la-addword-lemma-btn {
			display: inline-flex !important;
			align-items: center !important;
			justify-content: center !important;
			min-height: 32px !important;
			border: 1px solid #dcc8b8 !important;
			border-radius: 10px 9px 11px 8px !important;
			padding: 5px 9px !important;
			font-size: 11px !important;
			font-weight: 700 !important;
			cursor: pointer !important;
			background-color: #fffdf9 !important;
			color: #8a5f50 !important;
			flex: 0 0 auto !important;
			text-decoration: none !important;
		}
		.la-addword-input {
			display: block;
			width: 100%;
			margin-top: 8px;
			border: 1px solid #dccabd;
			border-radius: 14px 12px 16px 11px;
			padding: 10px;
			font-size: 14px;
			line-height: 1.4;
			resize: vertical;
			outline: none;
		}
		.la-addword-input:focus {
			border-color: #a55143;
			box-shadow: 0 0 0 3px rgba(165, 81, 67, 0.12);
		}
		.la-addword-footer {
			margin-top: 12px;
			display: flex;
			justify-content: flex-end;
			gap: 8px;
		}
		.la-addword-dict {
			margin-top: 10px;
			padding: 8px 10px;
			border: 1px solid #e2d3c6;
			border-radius: 14px 12px 16px 11px;
			background: #fffdf9;
		}
		.la-addword-dict-title {
			font-size: 11px;
			font-weight: 700;
			color: #8b6c53;
		}
		.la-addword-dict-list {
			display: grid;
			gap: 8px;
			margin-top: 6px;
		}
		.la-addword-dict-section {
			display: grid;
			gap: 8px;
		}
		.la-addword-dict-section.is-secondary {
			padding-top: 8px;
			border-top: 1px dashed #e2d3c6;
		}
		.la-addword-dict-section-title {
			font-size: 11px;
			font-weight: 800;
			color: #8b6c53;
		}
		.la-addword-dict-item {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: end;
			column-gap: 10px;
			border: 1px solid #ded0c3;
			border-radius: 12px 10px 14px 10px;
			background: #fffaf5;
			padding: 6px 8px;
		}
		.la-addword-dict-item.is-selected {
			border-color: #a55143;
			box-shadow: 0 0 0 2px rgba(165, 81, 67, 0.12);
		}
		.la-addword-dict-body {
			min-width: 0;
		}
		.la-addword-dict-pos {
			font-size: 10px;
			color: #8c7567;
		}
		.la-addword-dict-original {
			margin-top: 2px;
			font-size: 12px;
			line-height: 1.45;
			color: #5a473d;
		}
		.la-addword-dict-translated {
			margin-top: 3px;
			font-size: 12px;
			line-height: 1.45;
			color: #6d5d56;
			border-left: 2px solid #ddd0c2;
			padding-left: 6px;
		}
		.la-addword-modal .la-addword-dict-apply {
			display: inline-flex !important;
			align-items: center !important;
			justify-content: center !important;
			align-self: end !important;
			margin-top: 0 !important;
			margin-bottom: 1px !important;
			min-height: 32px !important;
			min-width: 52px !important;
			border: 0 !important;
			border-radius: 10px 9px 11px 8px !important;
			padding: 4px 8px !important;
			font-size: 11px !important;
			font-weight: 700 !important;
			cursor: pointer !important;
			background-color: #b26b54 !important;
			color: #fffaf3 !important;
			text-decoration: none !important;
		}
		@media (max-width: 460px) {
			.la-addword-dict-item {
				grid-template-columns: 1fr;
				row-gap: 8px;
			}
			.la-addword-modal .la-addword-dict-apply {
				justify-self: start !important;
			}
		}
		.la-addword-modal .la-addword-btn {
			display: inline-flex !important;
			align-items: center !important;
			justify-content: center !important;
			min-height: 40px !important;
			border: 1px solid #d8c7b8 !important;
			border-radius: 12px 10px 14px 10px !important;
			padding: 8px 12px !important;
			font-size: 13px !important;
			font-weight: 700 !important;
			cursor: pointer !important;
			text-decoration: none !important;
		}
		.la-addword-modal .la-addword-cancel {
			background-color: #f4eadf !important;
			color: #7a6155 !important;
		}
		.la-addword-modal .la-addword-save {
			background-color: #a55143 !important;
			border-color: #9a5b49 !important;
			color: #fffaf3 !important;
		}
		.la-confirm-overlay {
			position: fixed;
			inset: 0;
			background: rgba(83, 61, 50, 0.24);
			z-index: 2147483646;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 16px;
			animation: laFadeIn 140ms ease-out;
		}
		.la-confirm-modal {
			width: min(420px, 94vw);
			background: #fffaf3;
			border: 1px solid #dccabd;
			border-radius: 18px 15px 20px 16px;
			box-shadow: 0 18px 30px rgba(88, 63, 50, 0.16);
			padding: 16px;
			color: #34251f;
			font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
			animation: laRiseIn 170ms ease-out;
		}
		.la-confirm-title {
			margin: 0 0 8px 0;
			font-size: 16px;
			font-weight: 800;
			font-family: "Noto Serif TC", "Hiragino Mincho ProN", "Yu Mincho", serif;
		}
		.la-confirm-desc {
			margin: 0;
			font-size: 13px;
			color: #7b655b;
			line-height: 1.45;
		}
		.la-confirm-footer {
			margin-top: 14px;
			display: flex;
			justify-content: flex-end;
			gap: 8px;
		}
		.la-confirm-modal .la-confirm-btn {
			display: inline-flex !important;
			align-items: center !important;
			justify-content: center !important;
			min-height: 40px !important;
			border: 1px solid #d8c7b8 !important;
			border-radius: 12px 10px 14px 10px !important;
			padding: 8px 12px !important;
			font-size: 13px !important;
			font-weight: 700 !important;
			cursor: pointer !important;
			text-decoration: none !important;
		}
		.la-confirm-modal .la-confirm-cancel {
			background-color: #f4eadf !important;
			color: #7a6155 !important;
		}
		.la-confirm-modal .la-confirm-ok {
			background-color: #a55143 !important;
			border-color: #9a5b49 !important;
			color: #fffaf3 !important;
		}
		@keyframes laFadeIn {
			from { opacity: 0; }
			to { opacity: 1; }
		}
		@keyframes laRiseIn {
			from { opacity: 0; transform: translateY(8px) scale(0.985); }
			to { opacity: 1; transform: translateY(0) scale(1); }
		}
	`;
	document.head.appendChild(style);
}

function applyModalControlBaseStyle(element) {
	element.style.setProperty("box-sizing", "border-box", "important");
	element.style.setProperty("font-family", '"Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif', "important");
	element.style.setProperty("line-height", "1.4", "important");
	element.style.setProperty("letter-spacing", "normal", "important");
	element.style.setProperty("text-transform", "none", "important");
	element.style.setProperty("text-decoration", "none", "important");
	element.style.setProperty("appearance", "none", "important");
	element.style.setProperty("-webkit-appearance", "none", "important");
	element.style.setProperty("background-image", "none", "important");
	element.style.setProperty("box-shadow", "none", "important");
	element.style.setProperty("outline", "none", "important");
}

function applyModalButtonStyle(button, variant) {
	applyModalControlBaseStyle(button);
	button.type = button.type || "button";
	button.style.setProperty("display", "inline-flex", "important");
	button.style.setProperty("align-items", "center", "important");
	button.style.setProperty("justify-content", "center", "important");
	button.style.setProperty("vertical-align", "middle", "important");
	button.style.setProperty("cursor", "pointer", "important");
	button.style.setProperty("user-select", "none", "important");
	button.style.setProperty("white-space", "nowrap", "important");
	button.style.setProperty("font-weight", "700", "important");
	button.style.setProperty("margin", "0", "important");

	const presetMap = {
		lemma: {
			minHeight: "32px",
			padding: "5px 9px",
			fontSize: "11px",
			border: "1px solid #dcc8b8",
			borderRadius: "10px 9px 11px 8px",
			backgroundColor: "#fffdf9",
			color: "#8a5f50"
		},
		apply: {
			minHeight: "32px",
			padding: "4px 8px",
			fontSize: "11px",
			border: "0 solid transparent",
			borderRadius: "10px 9px 11px 8px",
			backgroundColor: "#b26b54",
			color: "#fffaf3",
			marginTop: "6px"
		},
		cancel: {
			minHeight: "40px",
			padding: "8px 12px",
			fontSize: "13px",
			border: "1px solid #d8c7b8",
			borderRadius: "12px 10px 14px 10px",
			backgroundColor: "#f4eadf",
			color: "#7a6155"
		},
		save: {
			minHeight: "40px",
			padding: "8px 12px",
			fontSize: "13px",
			border: "1px solid #9a5b49",
			borderRadius: "12px 10px 14px 10px",
			backgroundColor: "#a55143",
			color: "#fffaf3"
		},
		confirmCancel: {
			minHeight: "40px",
			padding: "8px 12px",
			fontSize: "13px",
			border: "1px solid #d8c7b8",
			borderRadius: "12px 10px 14px 10px",
			backgroundColor: "#f4eadf",
			color: "#7a6155"
		},
		confirmOk: {
			minHeight: "40px",
			padding: "8px 12px",
			fontSize: "13px",
			border: "1px solid #9a5b49",
			borderRadius: "12px 10px 14px 10px",
			backgroundColor: "#a55143",
			color: "#fffaf3"
		}
	};

	const preset = presetMap[variant];
	if (!preset) return;
	for (const [key, value] of Object.entries(preset)) {
		const cssProperty = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
		button.style.setProperty(cssProperty, value, "important");
	}
}

function applyModalTextareaStyle(textarea) {
	applyModalControlBaseStyle(textarea);
	textarea.style.setProperty("display", "block", "important");
	textarea.style.setProperty("width", "100%", "important");
	textarea.style.setProperty("margin-top", "8px", "important");
	textarea.style.setProperty("border", "1px solid #dccabd", "important");
	textarea.style.setProperty("border-radius", "14px 12px 16px 11px", "important");
	textarea.style.setProperty("padding", "10px", "important");
	textarea.style.setProperty("font-size", "14px", "important");
	textarea.style.setProperty("background-color", "#fffdf9", "important");
	textarea.style.setProperty("color", "#34251f", "important");
	textarea.style.setProperty("resize", "vertical", "important");
	textarea.style.setProperty("white-space", "pre-wrap", "important");
	textarea.style.setProperty("min-height", "92px", "important");
}

function showConfirmModal(message) {
	ensureAddWordModalStyle();
	if (confirmModal) confirmModal.remove();

	return new Promise((resolve) => {
		const overlay = document.createElement("div");
		overlay.className = "la-confirm-overlay";

		const modal = document.createElement("div");
		modal.className = "la-confirm-modal";

		const title = document.createElement("h3");
		title.className = "la-confirm-title";
		title.textContent = contentT("confirm_action");

		const desc = document.createElement("p");
		desc.className = "la-confirm-desc";
		desc.textContent = message;

		const footer = document.createElement("div");
		footer.className = "la-confirm-footer";

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "la-confirm-btn la-confirm-cancel";
		cancelBtn.textContent = contentT("cancel");
		applyModalButtonStyle(cancelBtn, "confirmCancel");

		const okBtn = document.createElement("button");
		okBtn.className = "la-confirm-btn la-confirm-ok";
		okBtn.textContent = contentT("confirm");
		applyModalButtonStyle(okBtn, "confirmOk");

		footer.appendChild(cancelBtn);
		footer.appendChild(okBtn);
		modal.appendChild(title);
		modal.appendChild(desc);
		modal.appendChild(footer);
		overlay.appendChild(modal);
		document.body.appendChild(overlay);
		confirmModal = overlay;

		function close(value) {
			overlay.remove();
			if (confirmModal === overlay) confirmModal = null;
			document.removeEventListener("keydown", onKeyDown, true);
			resolve(value);
		}

		function onKeyDown(event) {
			if (event.key === "Escape") close(false);
			if (event.key === "Enter") close(true);
		}

		cancelBtn.addEventListener("click", () => close(false));
		okBtn.addEventListener("click", () => close(true));
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) close(false);
		});
		document.addEventListener("keydown", onKeyDown, true);
		okBtn.focus();
	});
}

function prefillMeaningFromTranslation(word, wordLineEl, inputEl, isUserEdited, modalOverlay, onDictionaryReady) {
	if (typeof ContentAddWordRef.prefillMeaningFromTranslation === "function") {
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
				chromeRuntime: chrome.runtime,
			},
		});
	}
	inputEl.placeholder = contentT("meaning_placeholder");
	return Promise.resolve();
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
		WordStorage.getDictionaryLookupEnabled().catch(() => true),
	]).then(([sourceLang, dictionaryEnabled]) => {
		const isSingleWord = !/\s/.test((text || "").trim());
		chrome.runtime.sendMessage(
			{ action: "translate", text: text, sourceLang: sourceLang },
			function (response) {
				const translation = response && response.translation ? response.translation : "";
				showTranslation(translation);
				const dictQuery = normalizeDictionaryQuery(text);
				if (!(dictionaryEnabled && isSingleWord && supportsDictionaryBySourceLang(sourceLang) && shouldLookupDictionaryQuery(dictQuery))) return;
				chrome.runtime.sendMessage(
					{ action: "lookupDictionary", text: dictQuery, sourceLang: sourceLang || "auto" },
					(dictResponse) => {
						if (chrome.runtime.lastError || !dictResponse || !dictResponse.found) return;
						appendDictionaryToTranslationBox(dictResponse, sourceLang || "auto");
					}
				);
			}
		);
		});
	}).catch((error) => {
		if (!isContextInvalidatedError(error)) {
			console.error("Failed to get source language:", error);
		}
	});
}

function showTranslation(translation) {
	if (typeof ContentTranslationRef.showTranslation === "function") {
		return ContentTranslationRef.showTranslation(translation, { document });
	}
	return null;
}

function appendDictionaryToTranslationBox(dictResponse, sourceLang) {
	if (typeof ContentTranslationRef.appendDictionaryToTranslationBox === "function") {
		return ContentTranslationRef.appendDictionaryToTranslationBox(dictResponse, sourceLang, {
			document,
			DictionaryUtilsRef,
			contentT,
			getDictionarySectionLabel,
			getDictionarySourceLabel,
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
}

// 以下为事件监听和初始化代码

function scheduleHighlight(delay) {
	if (typeof ContentPageProcessingRef.scheduleHighlight === "function") {
		return ContentPageProcessingRef.scheduleHighlight(delay, {
			highlightWords,
		});
	}
}

function checkUrlAndHighlight() {
	if (typeof ContentPageProcessingRef.checkUrlAndHighlight === "function") {
		return ContentPageProcessingRef.checkUrlAndHighlight({
			getLocationHref: () => location.href,
			highlightWords,
		});
	}
}

function setupNavigationWatchers() {
	if (typeof ContentPageProcessingRef.setupNavigationWatchers === "function") {
		return ContentPageProcessingRef.setupNavigationWatchers({
			history,
			window,
			document,
			MutationObserver,
			getLocationHref: () => location.href,
			highlightWords,
		});
	}
}

window.addEventListener("load", () => {
	highlightWords();
	setupNavigationWatchers();
});
