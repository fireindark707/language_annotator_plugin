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
		dictTitle.textContent = "Dictionary";

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

			chromeRuntime.sendMessage(
				{ action: "translate", text: word, sourceLang: sourceLang || "auto" },
				(response) => {
					if (!modalOverlay.isConnected) return;
					if (chromeRuntime.lastError) {
						inputEl.placeholder = contentT("meaning_placeholder");
						return;
					}
					const translated = response && response.translation ? response.translation.trim() : "";
					if (translated && !isUserEdited() && inputEl.value.trim() === "") {
						inputEl.value = translated;
					}
					inputEl.placeholder = contentT("meaning_placeholder");
				}
			);

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

	global.ContentAddWord = {
		createAddWordModal,
		getTargetWord,
		updateWordLine,
		setLemmaMode,
		composeDictionaryMeaning,
		applyDictionarySelection,
		prefillMeaningFromTranslation,
	};
})(globalThis);
