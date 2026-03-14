// content.js
let addWordModal = null;
const MAX_EXAMPLES_PER_WORD = 20;
let contentUiLang = "en";
let contentTourAttempted = false;
let contentTourPending = false;
let contentSelectionTourAttempted = false;
let contentLanguageHint = "";
let contentLanguageHintHref = "";
let contentLanguageHintPromise = null;
let contentLanguageHintSample = "";
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
	return !!(error && typeof error.message === "string" && error.message.includes("Extension context invalidated"));
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

	const normalizedWord = word.trim().toLowerCase();
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

function prefillMeaningFromTranslation(word, wordLineEl, inputEl, isUserEdited, modalOverlay, onDictionaryReady) {
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
		return TranslationUtilsRef.requestPreferredTranslation({
			chromeRuntime: chrome.runtime,
			chromeI18n: chrome.i18n,
			wordStorage: WordStorage,
			text,
			sourceLang,
			translationEngine,
			detectedLanguage: detectedLang,
			targetLang: TranslationUtilsRef.getBrowserTargetLang(window.navigator),
			onBrowserFallback(result) {
				showContentBrowserTranslationFallback(result && result.reason);
			},
		}).then((translation) => {
			if (!translation) return;
			showTranslation(translation);
			const dictQuery = normalizeDictionaryQuery(text);
			const detectedMatchesSource = detectedLang
				? TranslationUtilsRef.isSameLanguageFamily(detectedLang, sourceLang)
				: true;
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

function showTranslation(translation) {
	return ContentLookupUiRef.showTranslation(translation, {
		document,
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

function setupNavigationWatchers() {
	return ContentPageProcessingRef.setupNavigationWatchers({
		history,
		window,
		document,
		MutationObserver,
		getLocationHref: () => location.href,
		highlightWords,
	});
}

window.addEventListener("load", () => {
	highlightWords();
	setupNavigationWatchers();
});
