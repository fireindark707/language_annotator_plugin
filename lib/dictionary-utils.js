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

	function shouldLookupDictionaryQuery(query) {
		const q = (query || "").trim();
		if (!q) return false;
		if (q.length < 2 || q.length > 32) return false;
		if (!/[\p{L}]/u.test(q)) return false;
		return true;
	}

	function supportsDictionaryBySourceLang(sourceLang) {
		const normalized = (sourceLang || "").toLowerCase();
		if (!normalized || normalized === "auto") return false;
		const base = normalized.split("-")[0];
		return DICTIONARY_SUPPORTED_LANGS.has(base);
	}

	function normalizeDictionaryLang(sourceLang) {
		const base = ((sourceLang || "").split("-")[0] || "").toLowerCase();
		if (!base || base === "auto") return "";
		return base === "fil" ? "tl" : base;
	}

	function getDictionarySourceLabel(source) {
		const normalized = (source || "").toLowerCase();
		if (normalized === "kateglo") return "Kateglo";
		if (normalized === "dictionaryapi") return "Free Dictionary";
		if (normalized === "jotoba") return "Jotoba";
		return "Dictionary";
	}

	function fetchJsonSafe(url, options) {
		const MAX_RETRIES = 1;
		const TIMEOUT_MS = 6000;
		const run = (attempt) => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
			const requestOptions = Object.assign({}, options || {}, { signal: controller.signal });
			return fetch(url, requestOptions)
				.then((response) => {
					clearTimeout(timer);
					if (!response.ok) return null;
					return response.text().then((text) => {
						const trimmed = (text || "").trim();
						if (!trimmed) return null;
						if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
						try {
							return JSON.parse(trimmed);
						} catch (error) {
							return null;
						}
					});
				})
				.catch((error) => {
					clearTimeout(timer);
					const message = (error && error.message ? error.message : "").toLowerCase();
					const retriable =
						error && (
							error.name === "AbortError" ||
							error.name === "TypeError" ||
							message.includes("failed to fetch") ||
							message.includes("network")
						);
					if (retriable && attempt < MAX_RETRIES) return run(attempt + 1);
					return null;
				});
		};
		return run(0);
	}

	function flattenDictionaryEntries(node, out, inheritedPos) {
		if (!node) return;
		if (Array.isArray(node)) {
			node.forEach((item) => flattenDictionaryEntries(item, out, inheritedPos));
			return;
		}
		if (typeof node !== "object") return;
		const pos =
			node.kelas ||
			node.class ||
			node.pos ||
			node.jenis_kata ||
			node.lex_class_name ||
			node.lex_class_ref ||
			inheritedPos ||
			"";
		const definition =
			node.arti ||
			node.definisi ||
			node.definition ||
			node.def_text ||
			node.def ||
			node.deskripsi ||
			node.desc ||
			"";
		if (typeof definition === "string" && definition.trim()) {
			out.push({
				pos: typeof pos === "string" ? pos.trim() : "",
				definition: definition.trim(),
			});
		}
		Object.keys(node).forEach((key) => {
			flattenDictionaryEntries(node[key], out, pos);
		});
	}

	function dedupDictionaryEntries(entries) {
		const seen = new Set();
		const dedup = [];
		(entries || []).forEach((item) => {
			const definition = (item && item.definition ? item.definition : "").trim();
			const pos = (item && item.pos ? item.pos : "").trim();
			if (!definition) return;
			const key = `${pos.toLowerCase()}__${definition.toLowerCase()}`;
			if (seen.has(key)) return;
			seen.add(key);
			dedup.push({ pos, definition });
		});
		return dedup;
	}

	function lookupKateglo(word) {
		const url = `https://kateglo.lostfocus.org/api.php?format=json&phrase=${encodeURIComponent(word)}`;
		return fetchJsonSafe(url).then((data) => {
			const entries = [];
			flattenDictionaryEntries(data, entries, "");
			const dedup = dedupDictionaryEntries(entries);
			return { found: dedup.length > 0, source: "kateglo", entries: dedup.slice(0, 5) };
		});
	}

	function lookupFreeDictionaryByLang(word, sourceLang) {
		const lang = normalizeDictionaryLang(sourceLang);
		if (!lang) return Promise.resolve({ found: false, source: "dictionaryapi", entries: [] });
		const url = `https://freedictionaryapi.com/api/v1/entries/${encodeURIComponent(lang)}/${encodeURIComponent(word)}`;
		return fetchJsonSafe(url).then((data) => {
			if (!data || !Array.isArray(data.entries)) return { found: false, source: "dictionaryapi", entries: [] };
			const entries = [];
			data.entries.forEach((entry) => {
				const pos = typeof entry.partOfSpeech === "string" ? entry.partOfSpeech.trim() : "";
				const senses = Array.isArray(entry && entry.senses) ? entry.senses : [];
				senses.forEach((sense) => {
					const definition = typeof sense.definition === "string" ? sense.definition.trim() : "";
					if (!definition) return;
					entries.push({ pos, definition });
				});
			});
			const dedup = dedupDictionaryEntries(entries);
			return { found: dedup.length > 0, source: "dictionaryapi", entries: dedup.slice(0, 5) };
		});
	}

	function lookupEnglishFreeDictionary(word) {
		return lookupFreeDictionaryByLang(word, "en");
	}

	function parseJotobaEntries(data) {
		const words = Array.isArray(data && data.words) ? data.words : [];
		const entries = [];
		words.forEach((item) => {
			const senses = Array.isArray(item && item.senses) ? item.senses : [];
			senses.forEach((sense) => {
				const pos = Array.isArray(sense && sense.pos)
					? sense.pos.map((p) => (typeof p === "string" ? p : "")).filter(Boolean).join(", ")
					: "";
				const glosses = Array.isArray(sense && sense.glosses) ? sense.glosses : [];
				glosses.forEach((gloss) => {
					const definition = typeof gloss === "string"
						? gloss.trim()
						: (gloss && typeof gloss.text === "string" ? gloss.text.trim() : "");
					if (!definition) return;
					entries.push({ pos, definition });
				});
			});
		});
		return dedupDictionaryEntries(entries);
	}

	function lookupJotobaJapaneseDictionary(word) {
		const getUrl = `https://jotoba.de/api/search/words?query=${encodeURIComponent(word)}`;
		return fetchJsonSafe(getUrl)
			.then((data) => {
				let dedup = parseJotobaEntries(data);
				if (dedup.length > 0) {
					return { found: true, source: "jotoba", entries: dedup.slice(0, 5) };
				}
				return fetchJsonSafe("https://jotoba.de/api/search/words", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ query: word }),
				}).then((data2) => {
					dedup = parseJotobaEntries(data2);
					return { found: dedup.length > 0, source: "jotoba", entries: dedup.slice(0, 5) };
				});
			});
	}

	function tryLookupChain(tasks) {
		const run = (index) => {
			if (index >= tasks.length) return Promise.resolve({ found: false, source: "", entries: [] });
			return tasks[index]()
				.then((result) => (result && result.found ? result : run(index + 1)))
				.catch(() => run(index + 1));
		};
		return run(0);
	}

	function isIndonesianSourceLang(sourceLang) {
		const normalized = (sourceLang || "").toLowerCase();
		return normalized === "id" || normalized.startsWith("id-");
	}

	function isEnglishSourceLang(sourceLang) {
		const normalized = (sourceLang || "").toLowerCase();
		return normalized === "en" || normalized.startsWith("en-");
	}

	function isJapaneseSourceLang(sourceLang) {
		const normalized = (sourceLang || "").toLowerCase();
		return normalized === "ja" || normalized.startsWith("ja-");
	}

	function buildDictionaryLookup(text, sourceLang) {
		let lookupPromise = null;
		let sourceName = "dictionaryapi";
		if (isIndonesianSourceLang(sourceLang)) {
			lookupPromise = tryLookupChain([
				() => lookupKateglo(text),
				() => lookupFreeDictionaryByLang(text, sourceLang),
			]);
			sourceName = "kateglo";
		} else if (isEnglishSourceLang(sourceLang)) {
			lookupPromise = tryLookupChain([
				() => lookupEnglishFreeDictionary(text),
				() => lookupFreeDictionaryByLang(text, sourceLang),
			]);
			sourceName = "dictionaryapi";
		} else if (isJapaneseSourceLang(sourceLang)) {
			lookupPromise = tryLookupChain([
				() => lookupJotobaJapaneseDictionary(text),
				() => lookupFreeDictionaryByLang(text, sourceLang),
			]);
			sourceName = "jotoba";
		} else {
			lookupPromise = lookupFreeDictionaryByLang(text, sourceLang);
			sourceName = "dictionaryapi";
		}
		return { lookupPromise, sourceName };
	}

	function normalizeStoredDictionaryEntries(wordData) {
		if (!wordData || typeof wordData !== "object" || !wordData.dictionary) return [];
		const dict = wordData.dictionary;
		if (Array.isArray(dict.entries)) {
			return dict.entries
				.map((item) => ({
					pos: typeof item.pos === "string" ? item.pos : "",
					definitionOriginal: typeof item.definitionOriginal === "string" ? item.definitionOriginal : "",
					definitionTranslated: typeof item.definitionTranslated === "string" ? item.definitionTranslated : "",
				}))
				.filter((item) => item.definitionOriginal || item.definitionTranslated);
		}
		const fallbackOriginal = typeof dict.definitionOriginal === "string" ? dict.definitionOriginal : "";
		const fallbackTranslated = typeof dict.definitionTranslated === "string" ? dict.definitionTranslated : "";
		if (!fallbackOriginal && !fallbackTranslated) return [];
		return [{
			pos: typeof dict.pos === "string" ? dict.pos : "",
			definitionOriginal: fallbackOriginal,
			definitionTranslated: fallbackTranslated,
		}];
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
		shouldLookupDictionaryQuery,
		supportsDictionaryBySourceLang,
		normalizeDictionaryLang,
		getDictionarySourceLabel,
		fetchJsonSafe,
		flattenDictionaryEntries,
		dedupDictionaryEntries,
		lookupKateglo,
		lookupFreeDictionaryByLang,
		lookupEnglishFreeDictionary,
		parseJotobaEntries,
		lookupJotobaJapaneseDictionary,
		tryLookupChain,
		isIndonesianSourceLang,
		isEnglishSourceLang,
		isJapaneseSourceLang,
		buildDictionaryLookup,
		getEffectiveDictionarySections,
		getDictionarySectionLabel,
		mapDictionarySections,
		renderPassiveDictionarySections,
		renderInteractiveDictionarySections,
		normalizeStoredDictionaryEntries,
	};
})(globalThis);
