(function (global) {
	// Derived from the rs (script map) object inside wordfreq.iife.js
	const SUPPORTED_LANGS = new Set([
		"ar", "be", "bg", "bn", "cs", "da", "de", "el", "en", "es",
		"fa", "fi", "fr", "he", "hi", "hu", "id", "it",
		"ja", "ko", "lt", "lv", "mk", "nb", "nl", "pl", "pt",
		"ro", "ru", "sk", "sl", "sv", "th", "tr", "uk", "ur", "vi", "zh",
	]);
	const DATA_BASE_URL = "https://raw.githubusercontent.com/fireindark707/wordfreq_js/main/data";
	const instances = new Map(); // lang -> { wf, ready, promise }

	function normalizeLang(lang) {
		if (!lang || lang === "auto") return "";
		return ((lang.split("-")[0]) || "").toLowerCase();
	}

	function isSupported(lang) {
		return SUPPORTED_LANGS.has(normalizeLang(lang));
	}

	function isReady(lang) {
		const e = instances.get(normalizeLang(lang));
		return !!(e && e.ready);
	}

	function initForLang(lang) {
		const key = normalizeLang(lang);
		if (!key || !SUPPORTED_LANGS.has(key)) return Promise.resolve(false);
		if (instances.has(key)) {
			const existing = instances.get(key);
			return existing.promise.then(() => existing.ready);
		}
		const entry = { wf: null, ready: false, promise: null };
		instances.set(key, entry);
		const Lib = global.WordfreqLib;
		if (!Lib) {
			entry.promise = Promise.resolve(false);
			return entry.promise;
		}
		const { Wordfreq, BrowserDataFetcher } = Lib;
		const fetcher = new BrowserDataFetcher(DATA_BASE_URL);
		const sizes = ["small"];
		function tryNext(i) {
			if (i >= sizes.length) return Promise.resolve(false);
			entry.wf = new Wordfreq(key, fetcher, sizes[i]);
			return entry.wf.init()
				.then(() => { entry.ready = true; return true; })
				.catch(() => tryNext(i + 1));
		}
		entry.promise = tryNext(0);
		return entry.promise;
	}

	function getZipf(word, lang) {
		const e = instances.get(normalizeLang(lang));
		if (!e || !e.ready || !e.wf) return null;
		try {
			return e.wf.zipfFrequency((word || "").toLowerCase());
		} catch (_) {
			return null;
		}
	}

	// Per-language Zipf thresholds: [A1_min, A2_min, B1_min, B2_min, C1_min]
	// Derived from vocabulary-size cutoffs (>500/>2k/>5k/>10k/>20k words per language).
	// null C1_min (vi) means no C1 tier — everything below B2 is C2.
	const LANG_THRESHOLDS = {
		ar:  [5.2, 4.7, 4.3, 4.0, 3.6],
		bg:  [5.2, 4.6, 4.2, 3.8, 3.4],
		bn:  [5.4, 4.8, 4.3, 3.9, 3.4],
		ca:  [5.2, 4.6, 4.1, 3.7, 3.2],
		cs:  [5.2, 4.7, 4.3, 3.9, 3.6],
		da:  [5.2, 4.6, 4.1, 3.7, 3.2],
		de:  [5.2, 4.6, 4.1, 3.8, 3.4],
		el:  [5.1, 4.6, 4.2, 3.8, 3.5],
		en:  [5.3, 4.7, 4.2, 3.7, 3.2],
		es:  [5.2, 4.6, 4.1, 3.8, 3.3],
		fa:  [5.4, 4.8, 4.3, 3.8, 3.3],
		fi:  [5.3, 4.7, 4.3, 4.0, 3.6],
		fil: [5.1, 4.6, 4.1, 3.7, 3.3],
		fr:  [5.2, 4.6, 4.1, 3.7, 3.3],
		he:  [5.3, 4.7, 4.3, 4.0, 3.7],
		hi:  [5.3, 4.7, 4.1, 3.7, 3.2],
		hu:  [5.2, 4.6, 4.2, 3.9, 3.5],
		id:  [5.4, 4.7, 4.2, 3.8, 3.3],
		is:  [5.2, 4.6, 4.1, 3.8, 3.4],
		it:  [5.2, 4.6, 4.2, 3.8, 3.4],
		ja:  [5.2, 4.6, 4.2, 3.8, 3.3],
		ko:  [5.3, 4.6, 4.1, 3.7, 3.2],
		lt:  [5.2, 4.7, 4.3, 4.0, 3.6],
		lv:  [5.2, 4.7, 4.3, 4.0, 3.6],
		mk:  [5.2, 4.6, 4.2, 3.8, 3.4],
		ms:  [5.4, 4.7, 4.2, 3.7, 3.2],
		nb:  [5.2, 4.6, 4.1, 3.7, 3.2],
		nl:  [5.2, 4.6, 4.1, 3.7, 3.2],
		pl:  [5.2, 4.6, 4.2, 3.9, 3.6],
		pt:  [5.2, 4.6, 4.2, 3.8, 3.3],
		ro:  [5.2, 4.6, 4.2, 3.9, 3.5],
		ru:  [5.2, 4.6, 4.3, 3.9, 3.6],
		sh:  [5.2, 4.6, 4.2, 3.9, 3.5],
		sk:  [5.2, 4.6, 4.3, 3.9, 3.6],
		sl:  [5.1, 4.6, 4.2, 3.9, 3.6],
		sv:  [5.2, 4.5, 4.1, 3.7, 3.2],
		ta:  [5.3, 4.8, 4.4, 4.0, 3.7],
		tr:  [5.3, 4.7, 4.3, 4.0, 3.6],
		uk:  [5.2, 4.7, 4.3, 3.9, 3.5],
		ur:  [5.3, 4.7, 4.2, 3.7, 3.1],
		vi:  [5.6, 4.5, 3.6, 3.0, null],
		zh:  [5.4, 4.8, 4.3, 3.9, 3.4],
	};
	// Fallback for languages not in the table (approximate median)
	const DEFAULT_THRESHOLDS = [5.2, 4.6, 4.2, 3.8, 3.4];

	// Returns CEFR tier string for a word's Zipf score, using per-language thresholds.
	// zipf <= 0 means not in dataset — returns null (excluded from scoring).
	function getDifficultyTier(zipf, lang) {
		if (zipf === null || zipf === undefined || zipf <= 0) return null;
		const t = LANG_THRESHOLDS[normalizeLang(lang)] || DEFAULT_THRESHOLDS;
		if (zipf >= t[0]) return "A1";
		if (zipf >= t[1]) return "A2";
		if (zipf >= t[2]) return "B1";
		if (zipf >= t[3]) return "B2";
		if (t[4] !== null && zipf >= t[4]) return "C1";
		return "C2";
	}

	global.WordfreqUtils = {
		SUPPORTED_LANGS,
		isSupported,
		isReady,
		initForLang,
		getZipf,
		getDifficultyTier,
	};
})(globalThis);
