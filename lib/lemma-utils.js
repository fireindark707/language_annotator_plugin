(function (global) {
	const SIMPLEMMA_DICTIONARY_BASE_URL =
		"https://media.githubusercontent.com/media/fireindark707/simplelemma_js/main/src/data/";
	const SIMPLEMMA_SUPPORTED_LANGS = new Set([
		"ast", "bg", "ca", "cs", "cy", "da", "de", "el", "en", "enm", "eo", "es", "et", "fa",
		"fi", "fr", "ga", "gd", "gl", "gv", "hbs", "hi", "hu", "hy", "id", "is", "it", "ka",
		"la", "lb", "lt", "lv", "mk", "ms", "nb", "nl", "nn", "pl", "pt", "ro", "ru", "se",
		"sk", "sl", "sq", "sv", "sw", "tl", "tr", "uk"
	]);

	function normalizeLemmaSourceLang(sourceLang) {
		const base = (((sourceLang || "").split("-")[0]) || "").toLowerCase();
		if (!base || base === "auto") return "";
		if (base === "fil") return "tl";
		return base;
	}

	function supportsLemmaBySourceLang(sourceLang) {
		const lang = normalizeLemmaSourceLang(sourceLang);
		return !!lang && SIMPLEMMA_SUPPORTED_LANGS.has(lang);
	}

	function supportsRuntimeLemmaBySourceLang(sourceLang, simplemmaGlobal) {
		const lang = normalizeLemmaSourceLang(sourceLang);
		if (!lang) return false;
		if (simplemmaGlobal && Array.isArray(simplemmaGlobal.SUPPORTED_LANGUAGES)) {
			return simplemmaGlobal.SUPPORTED_LANGUAGES.includes(lang);
		}
		return SIMPLEMMA_SUPPORTED_LANGS.has(lang);
	}

	function createRuntimeLemmaResolver(options) {
		const normalizeQuery = options && typeof options.normalizeQuery === "function"
			? options.normalizeQuery
			: ((text) => (text || "").trim());
		const sendMessage = options && typeof options.sendMessage === "function"
			? options.sendMessage
			: null;
		const cache = (options && options.cache) || new Map();

		return function resolveLemma(text, sourceLang) {
			const query = normalizeQuery(text);
			const lang = normalizeLemmaSourceLang(sourceLang);
			if (!query || !lang || !supportsLemmaBySourceLang(lang) || !sendMessage) {
				return Promise.resolve({ query, lemma: "", effectiveQuery: query, lang });
			}
			const cacheKey = `${lang}__${query.toLowerCase()}`;
			if (cache.has(cacheKey)) return Promise.resolve(cache.get(cacheKey));
			return new Promise((resolve) => {
				sendMessage(
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
						cache.set(cacheKey, payload);
						resolve(payload);
					}
				);
			});
		};
	}

	function createSimplemmaLemmaProvider(options) {
		const simplemmaGlobal = options && options.simplemmaGlobal;
		const dictionaryBaseUrl = (options && options.dictionaryBaseUrl) || SIMPLEMMA_DICTIONARY_BASE_URL;
		let lemmaService = null;

		function getLemmaService() {
			if (lemmaService) return lemmaService;
			if (!simplemmaGlobal) return null;
			const factory = new simplemmaGlobal.FetchDictionaryFactory(dictionaryBaseUrl);
			const strategy = new simplemmaGlobal.DefaultStrategy({ dictionaryFactory: factory });
			lemmaService = new simplemmaGlobal.Lemmatizer({ lemmatizationStrategy: strategy });
			return lemmaService;
		}

		return function getLemmaForQuery(text, sourceLang) {
			const query = (text || "").trim();
			const lang = normalizeLemmaSourceLang(sourceLang);
			if (!query || !lang || !supportsRuntimeLemmaBySourceLang(lang, simplemmaGlobal)) {
				return Promise.resolve({ found: false, lemma: "", lang });
			}
			const service = getLemmaService();
			if (!service || typeof service.lemmatizeAsync !== "function") {
				return Promise.resolve({ found: false, lemma: "", lang });
			}
			return service.lemmatizeAsync(query, lang)
				.then((lemma) => {
					const normalized = typeof lemma === "string" ? lemma.trim() : "";
					if (!normalized) return { found: false, lemma: "", lang };
					return { found: true, lemma: normalized, lang };
				})
				.catch(() => ({ found: false, lemma: "", lang }));
		};
	}

	global.LemmaUtils = {
		SIMPLEMMA_DICTIONARY_BASE_URL,
		SIMPLEMMA_SUPPORTED_LANGS,
		normalizeLemmaSourceLang,
		supportsLemmaBySourceLang,
		supportsRuntimeLemmaBySourceLang,
		createRuntimeLemmaResolver,
		createSimplemmaLemmaProvider,
	};
})(globalThis);
