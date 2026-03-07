(function (global) {
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

	global.LemmaUtils = {
		SIMPLEMMA_SUPPORTED_LANGS,
		normalizeLemmaSourceLang,
		supportsLemmaBySourceLang,
	};
})(globalThis);
