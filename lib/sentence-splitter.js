(function (global) {
	let initPromise = null;
	let sentencexApi = null;
	let initFailed = false;
	const MAX_CACHE_ENTRIES = 120;
	const splitCache = new Map();

	const GLOBAL_ABBREVIATIONS = new Set([
		"mr", "mrs", "ms", "dr", "prof", "sr", "sra", "jr",
		"no", "etc", "vs", "fig", "est", "st",
		"a", "i", "u", "e",
	]);

	const LANGUAGE_ABBREVIATIONS = {
		id: new Set(["kep", "hlm", "ds", "dr", "sdr", "prof", "no", "dll"]),
		en: new Set(["mr", "mrs", "ms", "dr", "prof", "st", "no", "etc", "vs"]),
		es: new Set(["sr", "sra", "srta", "dr", "dra", "prof", "ud"]),
		de: new Set(["z", "b", "bzw", "ca", "nr", "dr", "prof"]),
		pt: new Set(["sr", "sra", "srta", "dr", "dra", "prof", "dep", "art"]),
		fr: new Set(["m", "mme", "mlle", "dr", "pr", "etc"]),
		ru: new Set(["г", "ул", "д", "рис", "им"]),
		ar: new Set(["د", "أ", "ا"]),
		ja: new Set(["a", "i"]),
		zh: new Set(["a", "i"]),
	};

	function normalizeLanguage(lang) {
		const raw = ((lang || "").trim().toLowerCase() || "en");
		if (raw.startsWith("zh")) return "zh";
		if (raw.startsWith("pt")) return "pt";
		if (raw.startsWith("es")) return "es";
		if (raw.startsWith("de")) return "de";
		if (raw.startsWith("fr")) return "fr";
		if (raw.startsWith("ru")) return "ru";
		if (raw.startsWith("ar")) return "ar";
		if (raw.startsWith("ja")) return "ja";
		if (raw.startsWith("id") || raw.startsWith("in")) return "id";
		return raw.split("-")[0] || "en";
	}

	function getModuleUrl() {
		if (
			typeof chrome !== "undefined" &&
			chrome.runtime &&
			typeof chrome.runtime.getURL === "function"
		) {
			return chrome.runtime.getURL("packages/sentencex_wasm.js");
		}
		if (
			typeof browser !== "undefined" &&
			browser.runtime &&
			typeof browser.runtime.getURL === "function"
		) {
			return browser.runtime.getURL("packages/sentencex_wasm.js");
		}
		const script = document.currentScript;
		const base = script && script.src ? script.src : new URL("../lib/sentence-splitter.js", location.href).href;
		return new URL("../packages/sentencex_wasm.js", base).href;
	}

	function normalizeSegmentText(text) {
		return (text || "").replace(/\s+/g, " ").trim();
	}

	function getCacheKey(text, lang) {
		return `${normalizeLanguage(lang)}::${text}`;
	}

	function readCache(text, lang) {
		const key = getCacheKey(text, lang);
		if (!splitCache.has(key)) return null;
		const cached = splitCache.get(key);
		splitCache.delete(key);
		splitCache.set(key, cached);
		return cached.slice();
	}

	function writeCache(text, lang, segments) {
		const key = getCacheKey(text, lang);
		splitCache.set(key, Array.isArray(segments) ? segments.slice() : []);
		if (splitCache.size <= MAX_CACHE_ENTRIES) return;
		const firstKey = splitCache.keys().next().value;
		if (firstKey) splitCache.delete(firstKey);
	}

	function getAbbreviationSet(lang) {
		const normalized = normalizeLanguage(lang);
		const set = new Set(GLOBAL_ABBREVIATIONS);
		const specific = LANGUAGE_ABBREVIATIONS[normalized];
		if (specific) {
			specific.forEach((item) => set.add(item));
		}
		return set;
	}

	function getLastToken(segment) {
		const trimmed = (segment || "").trim();
		const match = trimmed.match(/([\p{L}\p{N}]+)\.\s*$/u);
		return match ? match[1].toLowerCase() : "";
	}

	function startsWithSentenceContinuation(text) {
		const trimmed = (text || "").trim();
		if (!trimmed) return false;
		if (/^[)\]}'"”’»]+/u.test(trimmed)) return true;
		if (/^[\p{Ll}\p{Lo}]/u.test(trimmed)) return true;
		if (/^[A-Z]\.$/.test(trimmed)) return true;
		if (/^[A-Z][a-z]/.test(trimmed)) return true;
		return false;
	}

	function shouldMergeSegments(previous, current, lang) {
		const prev = normalizeSegmentText(previous);
		const next = normalizeSegmentText(current);
		if (!prev || !next) return false;
		const prevTrimmed = prev.trim();
		if (!/[.!?。！？؟؛۔\u0964\u0965]\s*$/u.test(prev)) return false;

		const abbreviationSet = getAbbreviationSet(lang);
		const lastToken = getLastToken(prev);
		if (lastToken && abbreviationSet.has(lastToken)) return true;

		if (/\b[\p{L}]\.\s*$/u.test(prev)) return true;
		if (/\b(?:[\p{L}]\.\s*){1,4}$/u.test(prev)) return true;
		if (/^[A-Z]\.$/.test(prevTrimmed) && startsWithSentenceContinuation(next)) return true;
		if (/\([^)]+\.\s*$/u.test(prev) && startsWithSentenceContinuation(next)) return true;
		return false;
	}

	function repairSegments(segments, lang) {
		const repaired = [];
		for (let i = 0; i < segments.length; i += 1) {
			const current = normalizeSegmentText(segments[i]);
			if (!current) continue;
			if (repaired.length === 0) {
				repaired.push(current);
				continue;
			}
			const previous = repaired[repaired.length - 1];
			if (shouldMergeSegments(previous, current, lang)) {
				repaired[repaired.length - 1] = normalizeSegmentText(`${previous} ${current}`);
				continue;
			}
			repaired.push(current);
		}
		return repaired.map((segment) => normalizeSegmentText(
			segment.replace(/\b([A-Za-z])\.\s+([A-Za-z])\.(?=\s*[\p{L}\p{N}])/gu, "$1.$2.")
		));
	}

	async function init() {
		if (sentencexApi) return sentencexApi;
		if (initFailed) return null;
		if (!initPromise) {
			initPromise = import(getModuleUrl())
				.then(async (mod) => {
					await mod.default();
					sentencexApi = mod;
					return sentencexApi;
				})
				.catch((error) => {
					initFailed = true;
					console.warn("Sentence splitter init fallback to built-in segmenters:", error);
					return null;
				});
		}
		return initPromise;
	}

	function startInit() {
		void init();
	}

	function splitIntoSentences(text, lang, fallbackSplit) {
		const normalizedText = normalizeSegmentText(text);
		if (!normalizedText) return [];
		const cached = readCache(normalizedText, lang);
		if (cached) return cached;
		if (!sentencexApi || typeof sentencexApi.segment !== "function") {
			if (!initPromise && !initFailed) {
				void init();
			}
			const fallback = typeof fallbackSplit === "function" ? fallbackSplit(normalizedText, lang) : [normalizedText];
			writeCache(normalizedText, lang, fallback);
			return fallback;
		}
		try {
			const normalizedLang = normalizeLanguage(lang);
			const raw = sentencexApi.segment(normalizedLang, normalizedText);
			const segments = Array.isArray(raw) ? raw.map(normalizeSegmentText).filter(Boolean) : [];
			const repaired = repairSegments(segments, normalizedLang);
			if (repaired.length > 0) {
				writeCache(normalizedText, normalizedLang, repaired);
				return repaired;
			}
		} catch (error) {
			console.warn("Sentence splitter runtime fallback to built-in segmenters:", error);
		}
		const fallback = typeof fallbackSplit === "function" ? fallbackSplit(normalizedText, lang) : [normalizedText];
		writeCache(normalizedText, lang, fallback);
		return fallback;
	}

		global.SentenceSplitter = {
			init,
			startInit,
			splitIntoSentences,
			repairSegments,
			normalizeLanguage,
			__setApiForTests(mockApi) {
				sentencexApi = mockApi || null;
				initPromise = null;
				initFailed = false;
			},
			__resetForTests() {
				sentencexApi = null;
				initPromise = null;
				initFailed = false;
				splitCache.clear();
			},
			__resetCacheForTests() {
				splitCache.clear();
			},
		};
})(globalThis);
