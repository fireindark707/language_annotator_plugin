(function (global) {
	const DICTIONARY_SUPPORTED_LANGS = new Set([
		"ar", "bn", "cs", "de", "el", "en", "es", "fa", "fil", "fr",
		"he", "hi", "hu", "id", "it", "ja", "jv", "km", "ko", "lo",
		"ms", "my", "nl", "pl", "pt", "ro", "ru", "su", "sv", "sw",
		"ta", "te", "th", "tl", "tr", "ur", "vi", "zh",
	]);

	function normalizeDictionaryQuery(text) {
		const cleaned = (text || "")
			.trim()
			.replace(/^[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{};:,./<>?\\|]+/u, "")
			.replace(/[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{};:,./<>?\\|]+$/u, "");
		if (!cleaned) return "";
		const firstToken = cleaned.split(/\s+/)[0] || "";
		return firstToken
			.replace(/^[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{};:,./<>?\\|]+/u, "")
			.replace(/[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{};:,./<>?\\|]+$/u, "");
	}

	function supportsDictionaryBySourceLang(sourceLang) {
		const normalized = (sourceLang || "").toLowerCase();
		if (!normalized || normalized === "auto") return false;
		const base = normalized.split("-")[0];
		return DICTIONARY_SUPPORTED_LANGS.has(base);
	}

	function getDictionarySourceLabel(source) {
		const normalized = (source || "").toLowerCase();
		if (normalized === "kateglo") return "Kateglo";
		if (normalized === "dictionaryapi") return "Free Dictionary";
		if (normalized === "jotoba") return "Jotoba";
		return "Dictionary";
	}

	function getEffectiveDictionarySections(dictResponse) {
		const sections = Array.isArray(dictResponse && dictResponse.sections)
			? dictResponse.sections
			: [];
		if (sections.length > 0) return sections;
		return [{
			mode: dictResponse && dictResponse.usedLemma ? "lemma" : "surface",
			query: dictResponse && dictResponse.usedLemma
				? (dictResponse.lemma || "")
				: (dictResponse && dictResponse.query ? dictResponse.query : ""),
			lemma: dictResponse && dictResponse.lemma ? dictResponse.lemma : "",
			source: dictResponse && dictResponse.source ? dictResponse.source : "dictionary",
			found: !!(dictResponse && dictResponse.found),
			entries: Array.isArray(dictResponse && dictResponse.entries) ? dictResponse.entries : [],
		}];
	}

	function getDictionarySectionLabel(t, mode, query) {
		if (mode === "lemma") {
			return `${t("lemma_label")}: ${query}`;
		}
		return `${t("dict_selected_form")}: ${query}`;
	}

	function mapDictionarySections(dictResponse, sourceLang, options) {
		const translateEntry = options && typeof options.translateEntry === "function"
			? options.translateEntry
			: (() => Promise.resolve(""));
		const maxEntries = options && typeof options.maxEntries === "number" ? options.maxEntries : 3;
		const sections = getEffectiveDictionarySections(dictResponse);
		return Promise.all(sections.map((section) => {
			const rawEntries = Array.isArray(section.entries)
				? section.entries.filter((item) => item && item.definition).slice(0, maxEntries)
				: [];
			if (rawEntries.length === 0) {
				return Promise.resolve({
					mode: section.mode || "surface",
					query: section.query || "",
					lemma: section.lemma || "",
					source: section.source || "dictionary",
					entries: [],
				});
			}
			return Promise.all(rawEntries.map((entry) =>
				translateEntry(entry.definition || "", sourceLang || "auto").then((translated) => ({
					pos: entry.pos || "",
					definitionOriginal: entry.definition || "",
					definitionTranslated: translated || "",
				}))
			)).then((mappedEntries) => ({
				mode: section.mode || "surface",
				query: section.query || "",
				lemma: section.lemma || "",
				source: section.source || "dictionary",
				entries: mappedEntries.filter(Boolean),
			}));
		}));
	}

	function renderPassiveDictionarySections(container, sections, options) {
		if (!container) return;
		const doc = (options && options.document) || document;
		const titleText = options && options.titleText;
		const emptyText = options && options.emptyText ? options.emptyText : "";
		const getSectionTitle = options && typeof options.getSectionTitle === "function"
			? options.getSectionTitle
			: ((section) => section.query || "");
		const decorateTitle = options && typeof options.decorateTitle === "function"
			? options.decorateTitle
			: null;
		const renderEntry = options && typeof options.renderEntry === "function"
			? options.renderEntry
			: (() => doc.createElement("div"));
		const decorateSection = options && typeof options.decorateSection === "function"
			? options.decorateSection
			: null;

		container.innerHTML = "";
		if (titleText) {
			const title = doc.createElement("div");
			title.textContent = titleText;
			if (decorateTitle) decorateTitle(title);
			container.appendChild(title);
		}

		sections.forEach((section, sectionIndex) => {
			const sectionWrap = doc.createElement("div");
			if (decorateSection) decorateSection(sectionWrap, section, sectionIndex);

			const sectionTitle = doc.createElement("div");
			sectionTitle.textContent = getSectionTitle(section);
			sectionWrap.appendChild(sectionTitle);

			const entries = Array.isArray(section.entries) ? section.entries : [];
			if (entries.length === 0) {
				const empty = doc.createElement("div");
				empty.textContent = emptyText;
				sectionWrap.appendChild(empty);
				container.appendChild(sectionWrap);
				return;
			}

			entries.forEach((item, index) => {
				sectionWrap.appendChild(renderEntry(item, section, index));
			});
			container.appendChild(sectionWrap);
		});
	}

	function renderInteractiveDictionarySections(container, sections, options) {
		if (!container) return;
		const doc = (options && options.document) || document;
		const emptyText = options && options.emptyText ? options.emptyText : "";
		const getSectionTitle = options && typeof options.getSectionTitle === "function"
			? options.getSectionTitle
			: ((section) => section.query || "");
		const decorateSection = options && typeof options.decorateSection === "function"
			? options.decorateSection
			: null;
		const decorateSectionTitle = options && typeof options.decorateSectionTitle === "function"
			? options.decorateSectionTitle
			: null;
		const decorateEntryRow = options && typeof options.decorateEntryRow === "function"
			? options.decorateEntryRow
			: null;
		const createApplyButton = options && typeof options.createApplyButton === "function"
			? options.createApplyButton
			: null;
		const onApply = options && typeof options.onApply === "function"
			? options.onApply
			: null;

		container.innerHTML = "";
		sections.forEach((section, sectionIndex) => {
			const sectionWrap = doc.createElement("div");
			if (decorateSection) decorateSection(sectionWrap, section, sectionIndex);

			const sectionTitle = doc.createElement("div");
			sectionTitle.textContent = getSectionTitle(section);
			if (decorateSectionTitle) decorateSectionTitle(sectionTitle, section, sectionIndex);
			sectionWrap.appendChild(sectionTitle);

			const entries = Array.isArray(section.entries) ? section.entries : [];
			if (entries.length === 0) {
				const empty = doc.createElement("div");
				empty.textContent = emptyText;
				sectionWrap.appendChild(empty);
				container.appendChild(sectionWrap);
				return;
			}

			entries.forEach((item, index) => {
				const row = doc.createElement("div");
				const bodyWrap = doc.createElement("div");
				const pos = doc.createElement("div");
				const original = doc.createElement("div");
				const translated = doc.createElement("div");

				row.className = "la-addword-dict-item";
				bodyWrap.className = "la-addword-dict-body";
				pos.className = "la-addword-dict-pos";
				original.className = "la-addword-dict-original";
				translated.className = "la-addword-dict-translated";
				if (decorateEntryRow) decorateEntryRow(row, item, section, index);

				pos.textContent = item && item.pos ? `[${item.pos}]` : "";
				original.textContent = item && item.definitionOriginal ? item.definitionOriginal : "";
				translated.textContent = item && item.definitionTranslated ? item.definitionTranslated : "";

				bodyWrap.appendChild(pos);
				bodyWrap.appendChild(original);
				bodyWrap.appendChild(translated);
				row.appendChild(bodyWrap);

				if (createApplyButton) {
					const applyBtn = createApplyButton(item, section, index, row);
					if (applyBtn) {
						if (onApply) {
							applyBtn.addEventListener("click", () => onApply({ item, section, index, row }));
						}
						row.appendChild(applyBtn);
					}
				}

				sectionWrap.appendChild(row);
			});
			container.appendChild(sectionWrap);
		});
	}

	global.DictionaryUtils = {
		DICTIONARY_SUPPORTED_LANGS,
		normalizeDictionaryQuery,
		supportsDictionaryBySourceLang,
		getDictionarySourceLabel,
		getEffectiveDictionarySections,
		getDictionarySectionLabel,
		mapDictionarySections,
		renderPassiveDictionarySections,
		renderInteractiveDictionarySections,
	};
})(globalThis);
