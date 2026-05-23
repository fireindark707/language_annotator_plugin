(function (global) {
	function createAddWordModal(options) {
		const doc = (options && options.document) || document;
		const normalizedWord = String((options && options.normalizedWord) || "").trim().toLowerCase();
		const t = options && typeof options.t === "function" ? options.t : ((key) => key);
		const applyButtonStyle = options && typeof options.applyButtonStyle === "function"
			? options.applyButtonStyle
			: null;
		const applyTextareaStyle = options && typeof options.applyTextareaStyle === "function"
			? options.applyTextareaStyle
			: null;

		const overlay = doc.createElement("div");
		overlay.className = "la-addword-overlay";
		overlay.dataset.targetWord = normalizedWord;

		const modal = doc.createElement("div");
		modal.className = "la-addword-modal";

		const title = doc.createElement("h3");
		title.className = "la-addword-title";
		title.textContent = t("add_word_title");

		const wordLine = doc.createElement("div");
		wordLine.className = "la-addword-word";
		wordLine.textContent = normalizedWord;

		const hint = doc.createElement("div");
		hint.className = "la-addword-hint";
		hint.textContent = t("add_word_hint");

		const lemmaNotice = doc.createElement("div");
		lemmaNotice.className = "la-addword-lemma";
		lemmaNotice.style.display = "none";

		const lemmaText = doc.createElement("div");
		lemmaText.className = "la-addword-lemma-text";

		const lemmaBtn = doc.createElement("button");
		lemmaBtn.type = "button";
		lemmaBtn.className = "la-addword-lemma-btn";
		if (applyButtonStyle) applyButtonStyle(lemmaBtn, "lemma");

		lemmaNotice.appendChild(lemmaText);
		lemmaNotice.appendChild(lemmaBtn);

		const input = doc.createElement("textarea");
		input.className = "la-addword-input";
		input.placeholder = t("loading_translation");
		input.rows = 3;
		if (applyTextareaStyle) applyTextareaStyle(input);

		const dictPreview = doc.createElement("div");
		dictPreview.className = "la-addword-dict";
		dictPreview.style.display = "none";

		const dictTitle = doc.createElement("div");
		dictTitle.className = "la-addword-dict-title";
		dictTitle.textContent = t("dictionary");

		const dictList = doc.createElement("div");
		dictList.className = "la-addword-dict-list";

		dictPreview.appendChild(dictTitle);
		dictPreview.appendChild(dictList);

		const footer = doc.createElement("div");
		footer.className = "la-addword-footer";

		const cancelBtn = doc.createElement("button");
		cancelBtn.className = "la-addword-btn la-addword-cancel";
		cancelBtn.textContent = t("cancel");
		if (applyButtonStyle) applyButtonStyle(cancelBtn, "cancel");

		const saveBtn = doc.createElement("button");
		saveBtn.className = "la-addword-btn la-addword-save";
		saveBtn.textContent = t("save");
		if (applyButtonStyle) applyButtonStyle(saveBtn, "save");

		footer.appendChild(cancelBtn);
		footer.appendChild(saveBtn);
		modal.appendChild(title);
		modal.appendChild(wordLine);
		modal.appendChild(hint);
		modal.appendChild(lemmaNotice);
		modal.appendChild(input);
		modal.appendChild(dictPreview);
		modal.appendChild(footer);
		overlay.appendChild(modal);

		return {
			overlay,
			modal,
			title,
			wordLine,
			hint,
			lemmaNotice,
			lemmaText,
			lemmaBtn,
			input,
			dictPreview,
			dictTitle,
			dictList,
			footer,
			cancelBtn,
			saveBtn,
		};
	}

	function getTargetWord(overlay, normalizedWord) {
		const fallback = typeof normalizedWord === "string" ? normalizedWord : "";
		return String((overlay && overlay.dataset && overlay.dataset.targetWord) || fallback)
			.trim()
			.toLowerCase();
	}

	function updateWordLine(options) {
		const overlay = options && options.overlay;
		const normalizedWord = String((options && options.normalizedWord) || "").trim().toLowerCase();
		const wordLine = options && options.wordLine;
		const hint = options && options.hint;
		const t = options && typeof options.t === "function" ? options.t : ((key) => key);
		const targetWord = getTargetWord(overlay, normalizedWord);
		if (wordLine) wordLine.textContent = targetWord;
		if (!hint) return targetWord;
		if (targetWord && targetWord !== normalizedWord) {
			hint.textContent = `${t("add_word_hint")} (${t("using_lemma")}: ${targetWord})`;
			return targetWord;
		}
		hint.textContent = t("add_word_hint");
		return targetWord;
	}

	function setLemmaMode(options) {
		const overlay = options && options.overlay;
		const normalizedWord = String((options && options.normalizedWord) || "").trim().toLowerCase();
		const lemmaValue = String((options && options.lemmaValue) || "").trim().toLowerCase();
		const useLemma = !!(options && options.useLemma);
		const lemmaBtn = options && options.lemmaBtn;
		const t = options && typeof options.t === "function" ? options.t : ((key) => key);
		if (!overlay || !overlay.dataset) return normalizedWord;
		if (!lemmaValue || lemmaValue === normalizedWord) {
			overlay.dataset.targetWord = normalizedWord;
			if (lemmaBtn) lemmaBtn.textContent = t("use_lemma");
			return updateWordLine(options);
		}
		overlay.dataset.targetWord = useLemma ? lemmaValue : normalizedWord;
		if (lemmaBtn) {
			lemmaBtn.textContent = useLemma ? t("use_original") : t("use_lemma");
		}
		return updateWordLine(options);
	}

	function composeDictionaryMeaning(item) {
		const translated = item && item.definitionTranslated ? item.definitionTranslated : "";
		const original = item && item.definitionOriginal ? item.definitionOriginal : "";
		const composed = translated || original || "";
		if (!composed.trim()) return "";
		return item && item.pos ? `[${item.pos}] ${composed}` : composed;
	}

	function applyDictionarySelection(options) {
		const overlay = options && options.overlay;
		const item = options && options.item;
		const section = options && options.section;
		const index = options && typeof options.index === "number" ? options.index : 0;
		const input = options && options.input;
		const dictList = options && options.dictList;
		const row = options && options.row;
		const onUserEdit = options && typeof options.onUserEdit === "function"
			? options.onUserEdit
			: null;
		if (!overlay || !overlay.dataset || !item || !section) return;
		const text = composeDictionaryMeaning(item);
		if (input && text.trim()) input.value = text.trim();
		if (onUserEdit) onUserEdit();
		overlay.dataset.dictPos = item.pos || "";
		overlay.dataset.dictDefinitionOriginal = item.definitionOriginal || "";
		overlay.dataset.dictDefinitionTranslated = item.definitionTranslated || "";
		overlay.dataset.dictSource = section.source || "dictionary";
		overlay.dataset.dictUsedLemma = section.mode === "lemma" ? "1" : "";
		overlay.dataset.dictLookupLemma = section.mode === "lemma" ? (section.query || "") : "";
		overlay.dataset.dictQueryText = section.query || "";
		overlay.dataset.dictSelectedIndex = String(index);
		if (dictList && typeof dictList.querySelectorAll === "function") {
			dictList.querySelectorAll(".la-addword-dict-item").forEach((node) => {
				node.classList.remove("is-selected");
			});
		}
		if (row && row.classList) row.classList.add("is-selected");
	}

	function prefillMeaningFromTranslation(options) {
		const word = options && options.word ? options.word : "";
		const inputEl = options && options.inputEl;
		const isUserEdited = options && typeof options.isUserEdited === "function"
			? options.isUserEdited
			: (() => false);
		const modalOverlay = options && options.modalOverlay;
		const onDictionaryReady = options && typeof options.onDictionaryReady === "function"
			? options.onDictionaryReady
			: null;
		const deps = options && options.deps ? options.deps : {};
		const WordStorage = deps.WordStorage;
		const resolveLemma = deps.resolveLemma;
		const normalizeDictionaryQuery = deps.normalizeDictionaryQuery;
		const contentT = deps.contentT;
		const supportsDictionaryBySourceLang = deps.supportsDictionaryBySourceLang;
		const shouldLookupDictionaryQuery = deps.shouldLookupDictionaryQuery;
		const mapDictionarySections = deps.mapDictionarySections;
		const chromeRuntime = deps.chromeRuntime;
		const TranslationUtilsRef = deps.TranslationUtilsRef;
		const translateWordInContext = deps.translateWordInContext;
		if (!WordStorage || !inputEl || !modalOverlay || !chromeRuntime || typeof chromeRuntime.sendMessage !== "function") {
			return Promise.resolve();
		}

		return Promise.all([
			WordStorage.getSourceLang(),
			WordStorage.getDictionaryLookupEnabled().catch(() => true),
		]).then(async ([sourceLang, dictionaryEnabled]) => {
			const safeNormalize = typeof normalizeDictionaryQuery === "function"
				? normalizeDictionaryQuery
				: ((text) => (text || "").trim());
			const lemmaInfo = typeof resolveLemma === "function"
				? await resolveLemma(word, sourceLang || "auto").catch(() => ({
					query: safeNormalize(word),
					lemma: "",
					effectiveQuery: safeNormalize(word),
				}))
				: {
					query: safeNormalize(word),
					lemma: "",
					effectiveQuery: safeNormalize(word),
				};

			if (modalOverlay.isConnected) {
				modalOverlay.dataset.lemma = lemmaInfo.lemma || "";
			}

			Promise.resolve(
				typeof translateWordInContext === "function"
					? translateWordInContext({
						word,
						sourceLang: sourceLang || "auto",
						modalOverlay,
					})
					: (TranslationUtilsRef && typeof TranslationUtilsRef.requestRuntimeTranslation === "function"
						? TranslationUtilsRef.requestPreferredTranslation({
							chromeRuntime,
							chromeI18n: chrome.i18n,
							wordStorage: WordStorage,
							text: word,
							sourceLang: sourceLang || "auto",
						})
						: "")
			).then((translated) => {
				if (!modalOverlay.isConnected) return;
				if (translated && !isUserEdited() && inputEl.value.trim() === "") {
					inputEl.value = translated.trim();
				}
				inputEl.placeholder = contentT("meaning_placeholder");
			}).catch(() => {
				inputEl.placeholder = contentT("meaning_placeholder");
			});

			const dictQuery = safeNormalize(word);
			if (!(dictionaryEnabled && supportsDictionaryBySourceLang(sourceLang) && shouldLookupDictionaryQuery(dictQuery))) {
				return;
			}
			chromeRuntime.sendMessage(
				{ action: "lookupDictionary", text: dictQuery, sourceLang: sourceLang || "auto" },
				async (dictResponse) => {
					if (!modalOverlay.isConnected) return;
					if (chromeRuntime.lastError || !dictResponse || !dictResponse.found) return;
					const mappedSections = typeof mapDictionarySections === "function"
						? await mapDictionarySections(dictResponse, sourceLang || "auto")
						: [];
					if (!modalOverlay.isConnected) return;
					const nonEmptySections = mappedSections.filter((section) => Array.isArray(section.entries) && section.entries.length > 0);
					if (nonEmptySections.length === 0) return;
					const firstSection = nonEmptySections[0];
					const first = firstSection.entries[0];
					if (!first) return;
					modalOverlay.dataset.dictPos = first.pos || "";
					modalOverlay.dataset.dictDefinitionOriginal = first.definitionOriginal || "";
					modalOverlay.dataset.dictDefinitionTranslated = first.definitionTranslated || "";
					modalOverlay.dataset.dictSource = firstSection.source || "dictionary";
					modalOverlay.dataset.dictEntries = JSON.stringify(firstSection.entries);
					modalOverlay.dataset.dictSelectedIndex = "0";
					modalOverlay.dataset.dictUsedLemma = firstSection.mode === "lemma" ? "1" : "";
					modalOverlay.dataset.dictLookupLemma = firstSection.mode === "lemma" ? (firstSection.query || "") : "";
					modalOverlay.dataset.dictQueryText = firstSection.query || dictQuery;
					if (onDictionaryReady) {
						onDictionaryReady({
							source: dictResponse.source || firstSection.source || "dictionary",
							usedLemma: !!dictResponse.usedLemma,
							lemma: dictResponse.lemma || "",
							query: dictResponse.query || dictQuery,
							sections: mappedSections,
						});
					}
				}
			);
		}).catch(() => {
			inputEl.placeholder = contentT("meaning_placeholder");
		});
	}

	// Wire the save button with the full save logic (lemma resolution, dict metadata, storage).
	// deps: { WordStorage, LemmaUtils, normalizedWord, overlay, input, onClose, onError }
	function wireModalSaveButton(saveBtn, deps) {
		const WordStorage = deps.WordStorage;
		const LemmaUtils = deps.LemmaUtils;
		const normalizedWord = deps.normalizedWord || "";
		const overlay = deps.overlay;
		const input = deps.input;
		const onClose = typeof deps.onClose === "function" ? deps.onClose : function () { overlay.remove(); };
		const onError = typeof deps.onError === "function" ? deps.onError : function (e) { console.error("save word failed", e); };

		async function saveWord() {
			const meaning = input.value.trim();
			if (!meaning) return;
			try {
				const words = await WordStorage.getWords();
				const targetWord = getTargetWord(overlay, normalizedWord);
				const existing = words[targetWord] || words[normalizedWord];

				let dictEntries = [];
				try {
					dictEntries = JSON.parse(overlay.dataset.dictEntries || "[]");
					if (!Array.isArray(dictEntries)) dictEntries = [];
				} catch (_) { dictEntries = []; }
				const selectedIndexRaw = Number(overlay.dataset.dictSelectedIndex || "0");
				const selectedIndex = Number.isInteger(selectedIndexRaw) && selectedIndexRaw >= 0 ? selectedIndexRaw : 0;
				const dictPosValue = (overlay.dataset.dictPos || "").trim();
				const dictDefinitionOriginal = (overlay.dataset.dictDefinitionOriginal || "").trim();
				const dictDefinitionTranslated = (overlay.dataset.dictDefinitionTranslated || "").trim();
				const dictSource = (overlay.dataset.dictSource || "").trim();
				const dictionary = dictPosValue || dictDefinitionOriginal || dictDefinitionTranslated || dictEntries.length > 0
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
				const supportsLemma = LemmaUtils && typeof LemmaUtils.supportsLemmaBySourceLang === "function"
					? LemmaUtils.supportsLemmaBySourceLang(sourceLang)
					: false;
				let familyForms = [];
				if (supportsLemma && LemmaUtils && typeof LemmaUtils.normalizeFamilyForms === "function") {
					familyForms = LemmaUtils.normalizeFamilyForms([], lemmaValue, targetWord);
					if (deps.resolveLemmaVariations) {
						try {
							const result = await deps.resolveLemmaVariations(targetWord, lemmaValue, sourceLang);
							familyForms = Array.isArray(result.familyForms) ? result.familyForms : familyForms;
						} catch (_) {}
					}
				}

				words[targetWord] = {
					meaning: meaning,
					learned: false,
					createdAt: existing && existing.createdAt ? existing.createdAt : Date.now(),
					lemma: lemmaValue,
					familyForms: familyForms,
					dictionary: dictionary,
				};
				await WordStorage.saveWords(words, { syncMode: "immediate" });
				if (typeof deps.onAfterSave === "function") deps.onAfterSave(targetWord);
				onClose();
			} catch (e) {
				onError(e);
			}
		}

		saveBtn.addEventListener("click", saveWord);
		return saveWord;
	}

	// Full add-word modal: creates UI, wires save/cancel/keyboard, prefills translation + dict.
	// deps: { document, t, WordStorage, LemmaUtils, DictionaryUtils, ContentUi, TranslationUtils,
	//         chromeRuntime, chromeI18n, resolveLemma, resolveLemmaVariations,
	//         normalizeDictionaryQuery, supportsDictionaryBySourceLang, shouldLookupDictionaryQuery,
	//         translateWordInContext(opts)→Promise<string>, getContextForWord(word,opts)→context }
	// modalState (optional): { get current, set current } — tracks the single open modal instance
	function openAddWordModal(word, deps, modalState) {
		const doc = (deps && deps.document) || document;
		const t = typeof (deps && deps.t) === "function" ? deps.t : (function (k) { return k; });
		const WordStorageDep = deps && deps.WordStorage;
		const LemmaUtils = deps && deps.LemmaUtils;
		const DictionaryUtils = deps && deps.DictionaryUtils;
		const ContentUiDep = (deps && deps.ContentUi) || globalThis.ContentUi;
		const TranslationUtils = deps && deps.TranslationUtils;
		const chromeRuntime = deps && deps.chromeRuntime;
		const chromeI18n = deps && deps.chromeI18n;
		const resolveLemmaFn = deps && deps.resolveLemma;
		const resolveLemmaVariations = deps && deps.resolveLemmaVariations;
		const normalizeDictQ = (deps && deps.normalizeDictionaryQuery) || function (x) { return x; };
		const supportsDictLang = (deps && deps.supportsDictionaryBySourceLang) || function () { return false; };
		const shouldLookupDictQ = (deps && deps.shouldLookupDictionaryQuery) || function () { return false; };
		const translateWordInContextFn = deps && typeof deps.translateWordInContext === "function" ? deps.translateWordInContext : null;
		const getContextForWordFn = deps && typeof deps.getContextForWord === "function" ? deps.getContextForWord : null;

		if (ContentUiDep) ContentUiDep.ensureAddWordModalStyle(doc);

		// Close any previously open modal
		if (modalState && modalState.current) {
			modalState.current.remove();
			modalState.current = null;
		}

		const modalOptions = (word && typeof word === "object" && !Array.isArray(word)) ? word : { word: word };
		const normalizedWord = String(modalOptions.word || "").trim().toLowerCase();

		const capturedCtx = (!modalOptions.contextSentence && normalizedWord && getContextForWordFn)
			? getContextForWordFn(normalizedWord, { expectedWord: normalizedWord })
			: null;
		const modalContextSentence = modalOptions.contextSentence ||
			(capturedCtx && capturedCtx.found ? capturedCtx.sentence : "");
		const modalContextWordPos = typeof modalOptions.contextWordPos === "number"
			? modalOptions.contextWordPos
			: (capturedCtx && typeof capturedCtx.wordPos === "number" ? capturedCtx.wordPos : null);

		const modalUi = createAddWordModal({
			document: doc,
			normalizedWord: normalizedWord,
			t: t,
			applyButtonStyle: ContentUiDep ? ContentUiDep.applyModalButtonStyle : null,
			applyTextareaStyle: ContentUiDep ? ContentUiDep.applyModalTextareaStyle : null,
		});
		const overlay = modalUi.overlay;
		const wordLine = modalUi.wordLine;
		const hint = modalUi.hint;
		const lemmaNotice = modalUi.lemmaNotice;
		const lemmaText = modalUi.lemmaText;
		const lemmaBtn = modalUi.lemmaBtn;
		const input = modalUi.input;
		const dictPreview = modalUi.dictPreview;
		const dictTitle = modalUi.dictTitle;
		const dictList = modalUi.dictList;
		const cancelBtn = modalUi.cancelBtn;
		const saveBtn = modalUi.saveBtn;
		let userEdited = false;

		doc.body.appendChild(overlay);
		if (modalState) modalState.current = overlay;
		input.focus();
		input.addEventListener("input", function () { userEdited = true; });

		function localGetTargetWord() {
			return getTargetWord(overlay, normalizedWord);
		}
		function localSetLemmaMode(useLemma, lemmaValue) {
			return setLemmaMode({ overlay: overlay, normalizedWord: normalizedWord, lemmaValue: lemmaValue, useLemma: useLemma, wordLine: wordLine, hint: hint, lemmaBtn: lemmaBtn, t: t });
		}

		function closeModal() {
			overlay.remove();
			if (modalState && modalState.current === overlay) modalState.current = null;
			doc.removeEventListener("keydown", onKeyDown, true);
		}

		function onKeyDown(event) {
			if (event.key === "Escape") { closeModal(); return; }
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "enter") { saveWord(); }
		}

		const saveWord = wireModalSaveButton(saveBtn, {
			WordStorage: WordStorageDep,
			LemmaUtils: LemmaUtils,
			normalizedWord: normalizedWord,
			overlay: overlay,
			input: input,
			onClose: closeModal,
			onError: function (e) { console.error("openAddWordModal: save failed", e); },
			resolveLemmaVariations: resolveLemmaVariations,
			onAfterSave: deps && typeof deps.onAfterSave === "function" ? deps.onAfterSave : null,
		});

		cancelBtn.addEventListener("click", closeModal);
		overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
		doc.addEventListener("keydown", onKeyDown, true);

		function mapDictionarySectionsFn(dictResponse, sourceLang) {
			if (!DictionaryUtils || typeof DictionaryUtils.mapDictionarySections !== "function") {
				return Promise.resolve({ sections: [] });
			}
			return DictionaryUtils.mapDictionarySections(dictResponse, sourceLang, {
				maxEntries: 3,
				translateEntry: function (definition, lang) {
					if (!TranslationUtils) return Promise.resolve(definition);
					return TranslationUtils.requestPreferredTranslation({
						chromeRuntime: chromeRuntime,
						chromeI18n: chromeI18n,
						wordStorage: WordStorageDep,
						text: definition,
						sourceLang: lang || "auto",
					});
				},
			});
		}

		prefillMeaningFromTranslation({
			word: normalizedWord,
			wordLineEl: wordLine,
			inputEl: input,
			isUserEdited: function () { return userEdited; },
			modalOverlay: overlay,
			onDictionaryReady: function (dictPayload) {
				var sections = dictPayload && Array.isArray(dictPayload.sections) ? dictPayload.sections : [];
				var hasAnyEntries = sections.some(function (s) { return Array.isArray(s.entries) && s.entries.length > 0; });
				if (!hasAnyEntries) { dictPreview.style.display = "none"; return; }
				dictPreview.style.display = "block";
				dictTitle.textContent = t("dictionary");
				var availableLemma = String((dictPayload && dictPayload.lemma) || overlay.dataset.lemma || "").trim().toLowerCase();
				if (availableLemma && availableLemma !== normalizedWord) {
					lemmaNotice.style.display = "";
					lemmaText.textContent = t("lemma_available") + ": " + availableLemma;
					lemmaBtn.textContent = t("use_lemma");
					lemmaBtn.onclick = function () {
						var usingLemma = localGetTargetWord() === availableLemma;
						localSetLemmaMode(!usingLemma, availableLemma);
					};
				} else {
					lemmaNotice.style.display = "none";
					lemmaBtn.onclick = null;
					localSetLemmaMode(false, "");
				}
				if (DictionaryUtils && typeof DictionaryUtils.renderInteractiveDictionarySections === "function") {
					DictionaryUtils.renderInteractiveDictionarySections(dictList, sections, {
						document: doc,
						emptyText: t("no_dict_entries"),
						getSectionTitle: function (section) {
							return DictionaryUtils.getDictionarySectionLabel(t, section.mode, section.query) + " · " + DictionaryUtils.getDictionarySourceLabel(section.source);
						},
						decorateSection: function (sectionWrap, section, sectionIndex) {
							sectionWrap.className = "la-addword-dict-section";
							if (sectionIndex > 0) sectionWrap.classList.add("is-secondary");
						},
						decorateSectionTitle: function (sectionTitle) {
							sectionTitle.className = "la-addword-dict-section-title";
						},
						createApplyButton: function () {
							var applyBtn = doc.createElement("button");
							applyBtn.type = "button";
							applyBtn.className = "la-addword-dict-apply";
							applyBtn.textContent = t("apply");
							if (ContentUiDep) ContentUiDep.applyModalButtonStyle(applyBtn, "apply");
							return applyBtn;
						},
						onApply: function (opts) {
							applyDictionarySelection({ overlay: overlay, item: opts.item, section: opts.section, index: opts.index, input: input, dictList: dictList, row: opts.row, onUserEdit: function () { userEdited = true; } });
						},
					});
				}
				var firstRow = dictList.querySelector(".la-addword-dict-item");
				if (firstRow) firstRow.classList.add("is-selected");
			},
			deps: {
				WordStorage: WordStorageDep,
				resolveLemma: resolveLemmaFn,
				normalizeDictionaryQuery: normalizeDictQ,
				contentT: t,
				supportsDictionaryBySourceLang: supportsDictLang,
				shouldLookupDictionaryQuery: shouldLookupDictQ,
				mapDictionarySections: mapDictionarySectionsFn,
				TranslationUtilsRef: TranslationUtils,
				chromeRuntime: chromeRuntime,
				translateWordInContext: translateWordInContextFn
					? function (opts) { return translateWordInContextFn(Object.assign({ contextSentence: modalContextSentence, contextWordPos: modalContextWordPos }, opts)); }
					: null,
			},
		});

		updateWordLine({ overlay: overlay, normalizedWord: normalizedWord, wordLine: wordLine, hint: hint, t: t });
	}

	global.ContentAddWord = {
		createAddWordModal,
		openAddWordModal,
		wireModalSaveButton,
		getTargetWord,
		updateWordLine,
		setLemmaMode,
		composeDictionaryMeaning,
		applyDictionarySelection,
		prefillMeaningFromTranslation,
	};
})(globalThis);
