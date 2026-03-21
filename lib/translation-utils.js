(function (global) {
	const browserTranslatorCache = new Map();
	const browserTranslatorQueueCache = new Map();
	const segmenterCache = new Map();
	const WORD_TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-·][\p{L}\p{M}\p{N}]+)*/gu;
	const SENTENCE_PUNCTUATION_RE = /[\r\n\t.!?;:。！？；：؟؛।॥၊።។]/u;
	const WRAPPING_PUNCTUATION_RE = /^[\s"'“”‘’`\[({<]+|[\s"'“”‘’`\])}>.,!?;:。！？；：]+$/gu;

	function requestRuntimeTranslation(options) {
		const chromeRuntime = options && options.chromeRuntime;
		const text = typeof (options && options.text) === "string" ? options.text : "";
		const sourceLang = (options && options.sourceLang) || "auto";
		const targetLang = options && options.targetLang;
		if (!chromeRuntime || typeof chromeRuntime.sendMessage !== "function" || !text.trim()) {
			return Promise.resolve("");
		}
		return new Promise((resolve) => {
			const payload = { action: "translate", text, sourceLang };
			if (targetLang) payload.targetLang = targetLang;
			chromeRuntime.sendMessage(payload, (response) => {
				if (chromeRuntime.lastError || !response || typeof response.translation !== "string") {
					resolve("");
					return;
				}
				resolve(response.translation || "");
			});
		});
	}

	function normalizeTranslationLang(lang) {
		const raw = typeof lang === "string" ? lang.trim() : "";
		if (!raw || raw.toLowerCase() === "auto") return "";
		const lower = raw.toLowerCase();
		if (lower === "fil") return "tl";
		if (lower.startsWith("zh-cn") || lower.startsWith("zh-sg")) return "zh-CN";
		if (lower.startsWith("zh-tw") || lower.startsWith("zh-hk") || lower.startsWith("zh-mo")) return "zh-TW";
		const parts = raw.split("-");
		if (parts.length === 1) return parts[0].toLowerCase();
		return `${parts[0].toLowerCase()}-${parts.slice(1).join("-")}`;
	}

	function getLanguageBase(lang) {
		const normalized = normalizeTranslationLang(lang);
		if (!normalized) return "";
		const base = normalized.split("-")[0] || "";
		if (base === "fil") return "tl";
		if (base === "zh") return "zh";
		// Indonesian and Malay are mutually intelligible; Chrome frequently
		// misidentifies one as the other, so treat them as the same family.
		if (base === "ms") return "id";
		return base.toLowerCase();
	}

	function isSameLanguageFamily(left, right) {
		const a = getLanguageBase(left);
		const b = getLanguageBase(right);
		if (!a || !b) return false;
		return a === b;
	}

	function getBrowserTargetLang(navigatorObject) {
		const nav = navigatorObject || global.navigator;
		return normalizeTranslationLang(nav && typeof nav.language === "string" ? nav.language : "en") || "en";
	}

	function isManualSourceLanguage(sourceLang) {
		return !!normalizeTranslationLang(sourceLang);
	}

	function isChromeBrowserEnvironment(navigatorObject) {
		const nav = navigatorObject || global.navigator || {};
		const brands = nav.userAgentData && Array.isArray(nav.userAgentData.brands)
			? nav.userAgentData.brands
			: [];
		if (brands.length > 0) {
			return brands.some((brand) => /Google Chrome|Chromium/i.test((brand && brand.brand) || ""));
		}
		const ua = String(nav.userAgent || "");
		if (!ua) return false;
		if (/Firefox|Edg\/|OPR\/|Opera|DuckDuckGo|Vivaldi/i.test(ua)) return false;
		return /Chrome\/|Chromium\//i.test(ua);
	}

	function getCodePointLength(text) {
		return Array.from(String(text || "")).length;
	}

	function trimWordWrappers(text) {
		return String(text || "").replace(WRAPPING_PUNCTUATION_RE, "").trim();
	}

	function getWordSegmenter(languageHint) {
		if (!global.Intl || typeof global.Intl.Segmenter !== "function") return null;
		const locale = normalizeTranslationLang(languageHint) || "en";
		if (!segmenterCache.has(locale)) {
			try {
				segmenterCache.set(locale, new global.Intl.Segmenter(locale, { granularity: "word" }));
			} catch (_) {
				segmenterCache.set(locale, null);
			}
		}
		return segmenterCache.get(locale);
	}

	function isSingleWordLikeText(text, languageHint) {
		const raw = String(text || "").trim();
		if (!raw) return false;
		if (getCodePointLength(raw) >= 24) return false;

		const cleaned = trimWordWrappers(raw);
		if (!cleaned) return false;
		if (SENTENCE_PUNCTUATION_RE.test(cleaned)) return false;
		const segmenter = getWordSegmenter(languageHint);
		if (segmenter) {
			let wordCount = 0;
			let wordLength = 0;
			for (const part of segmenter.segment(cleaned)) {
				if (!part || !part.isWordLike) continue;
				wordCount += 1;
				if (wordCount > 1) return false;
				wordLength = getCodePointLength(part.segment);
			}
			return wordCount === 1 && wordLength < 20;
		}

		const tokenMatches = cleaned.match(WORD_TOKEN_RE) || [];
		return tokenMatches.length === 1 && getCodePointLength(tokenMatches[0]) < 20;
	}

	function getBrowserTranslationFallbackKey(reason) {
		if (reason === "chrome_only" || reason === "api_unavailable") return "browser_translation_requires_chrome";
		if (reason === "manual_source_required") return "browser_translation_requires_manual_source";
		if (reason === "same_language") return "browser_translation_same_language";
		if (reason === "browser_translate_failed") return "browser_translation_failed";
		return "browser_translation_pair_unavailable";
	}

	function detectLanguageWithChromeI18n(text, chromeI18n) {
		const api = chromeI18n && typeof chromeI18n.detectLanguage === "function"
			? chromeI18n
			: null;
		if (!api || !(text || "").trim()) return Promise.resolve("");
		return new Promise((resolve) => {
			try {
				api.detectLanguage(text || "", (result) => {
					if (
						global.chrome &&
						global.chrome.runtime &&
						global.chrome.runtime.lastError
					) {
						resolve("");
						return;
					}
					const languages = result && Array.isArray(result.languages) ? result.languages : [];
					if (languages.length === 0) {
						resolve("");
						return;
					}
					const top = languages[0] || {};
					resolve(normalizeTranslationLang(top.language || ""));
				});
			} catch (_) {
				resolve("");
			}
		});
	}

	function validateBrowserTranslationPair(options) {
		const navigatorObject = (options && options.navigatorObject) || global.navigator;
		const sourceLang = normalizeTranslationLang(options && options.sourceLang);
		const targetLang = normalizeTranslationLang(
			(options && options.targetLang) || getBrowserTargetLang(navigatorObject)
		);
		const translatorGlobal = (options && options.translatorGlobal) || global.Translator;
		if (!sourceLang) {
			return Promise.resolve({
				supported: false,
				reason: "manual_source_required",
				availability: "",
				sourceLang,
				targetLang,
			});
		}
		if (!isChromeBrowserEnvironment(navigatorObject)) {
			return Promise.resolve({
				supported: false,
				reason: "chrome_only",
				availability: "",
				sourceLang,
				targetLang,
			});
		}
		if (!targetLang || isSameLanguageFamily(sourceLang, targetLang)) {
			return Promise.resolve({
				supported: false,
				reason: "same_language",
				availability: "",
				sourceLang,
				targetLang,
			});
		}
		if (!translatorGlobal || typeof translatorGlobal.availability !== "function" || typeof translatorGlobal.create !== "function") {
			return Promise.resolve({
				supported: false,
				reason: "api_unavailable",
				availability: "",
				sourceLang,
				targetLang,
			});
		}
		return Promise.resolve(
			translatorGlobal.availability({
				sourceLanguage: sourceLang,
				targetLanguage: targetLang,
			})
		).then((availability) => ({
			supported: !!availability && availability !== "unavailable",
			reason: availability && availability !== "unavailable" ? "" : "pair_unavailable",
			availability: availability || "",
			sourceLang,
			targetLang,
		})).catch(() => ({
			supported: false,
			reason: "pair_unavailable",
			availability: "",
			sourceLang,
			targetLang,
		}));
	}

	function getBrowserTranslatorQueue(pairKey) {
		if (!browserTranslatorQueueCache.has(pairKey)) {
			browserTranslatorQueueCache.set(pairKey, createTaskQueue(1));
		}
		return browserTranslatorQueueCache.get(pairKey);
	}

	function ensureBrowserTranslator(options) {
		const sourceLang = normalizeTranslationLang(options && options.sourceLang);
		const targetLang = normalizeTranslationLang(options && options.targetLang);
		const translatorGlobal = (options && options.translatorGlobal) || global.Translator;
		if (!sourceLang || !targetLang || !translatorGlobal || typeof translatorGlobal.create !== "function") {
			return Promise.resolve(null);
		}
		const pairKey = `${sourceLang}__${targetLang}`;
		const cached = browserTranslatorCache.get(pairKey);
		if (cached) return Promise.resolve(cached);
		return Promise.resolve(
			translatorGlobal.create({
				sourceLanguage: sourceLang,
				targetLanguage: targetLang,
			})
		).then((translator) => {
			if (translator) {
				browserTranslatorCache.set(pairKey, translator);
			}
			return translator || null;
		}).catch(() => null);
	}

	function translateWithBrowser(text, sourceLang, targetLang, options) {
		const normalizedSource = normalizeTranslationLang(sourceLang);
		const normalizedTarget = normalizeTranslationLang(targetLang);
		const pairKey = `${normalizedSource}__${normalizedTarget}`;
		const queue = getBrowserTranslatorQueue(pairKey);
		return new Promise((resolve) => {
			queue(async () => {
				const translator = await ensureBrowserTranslator({
					sourceLang: normalizedSource,
					targetLang: normalizedTarget,
					translatorGlobal: options && options.translatorGlobal,
				});
				if (!translator || typeof translator.translate !== "function") {
					resolve("");
					return;
				}
				try {
					const translated = await translator.translate(text || "");
					resolve(typeof translated === "string" ? translated : "");
				} catch (_) {
					resolve("");
				}
			});
		});
	}

	function getOnlineSourceLang(sourceLang, detectedLang) {
		return normalizeTranslationLang(detectedLang) || normalizeTranslationLang(sourceLang) || "auto";
	}

	async function resolveTranslationEngine(options) {
		if (options && typeof options.translationEngine === "string") {
			return options.translationEngine === "browser" ? "browser" : "online";
		}
		const wordStorage = options && options.wordStorage;
		if (wordStorage && typeof wordStorage.getTranslationEngine === "function") {
			try {
				const engine = await wordStorage.getTranslationEngine();
				return engine === "browser" ? "browser" : "online";
			} catch (_) {
				return "online";
			}
		}
		return "online";
	}

	async function requestPreferredTranslation(options) {
		const text = typeof (options && options.text) === "string" ? options.text : "";
		const sourceLang = (options && options.sourceLang) || "auto";
		const targetLang = normalizeTranslationLang(
			(options && options.targetLang) || getBrowserTargetLang(options && options.navigatorObject)
		);
		const engine = await resolveTranslationEngine(options);
		if (!text.trim()) return "";
		if (engine !== "browser") {
			return requestRuntimeTranslation({
				chromeRuntime: options && options.chromeRuntime,
				text,
				sourceLang,
				targetLang,
			});
		}

		const detectedLang = normalizeTranslationLang(
			(options && options.detectedLanguage) ||
			await detectLanguageWithChromeI18n(text, options && options.chromeI18n)
		);
		if (detectedLang && isSameLanguageFamily(detectedLang, targetLang)) {
			return "";
		}
		if (isSingleWordLikeText(text, detectedLang || sourceLang)) {
			return requestRuntimeTranslation({
				chromeRuntime: options && options.chromeRuntime,
				text,
				sourceLang: getOnlineSourceLang(sourceLang, detectedLang),
				targetLang,
			});
		}

		const pair = await validateBrowserTranslationPair({
			sourceLang,
			targetLang,
			navigatorObject: options && options.navigatorObject,
			translatorGlobal: options && options.translatorGlobal,
		});
			if (!pair.supported) {
				if (typeof (options && options.onBrowserFallback) === "function") {
					options.onBrowserFallback(pair);
				}
				return requestRuntimeTranslation({
					chromeRuntime: options && options.chromeRuntime,
					text,
					sourceLang: getOnlineSourceLang(sourceLang, detectedLang),
					targetLang,
				});
			}

		if (detectedLang && isSameLanguageFamily(detectedLang, sourceLang)) {
			const translated = await translateWithBrowser(text, pair.sourceLang, pair.targetLang, {
				translatorGlobal: options && options.translatorGlobal,
			});
			if (translated) return translated;
			if (typeof (options && options.onBrowserFallback) === "function") {
				options.onBrowserFallback({
					supported: true,
					reason: "browser_translate_failed",
					availability: pair.availability,
					sourceLang: pair.sourceLang,
					targetLang: pair.targetLang,
				});
			}
		}

		return requestRuntimeTranslation({
			chromeRuntime: options && options.chromeRuntime,
			text,
			sourceLang: getOnlineSourceLang(sourceLang, detectedLang),
			targetLang,
		});
	}

	function buildGoogleTranslateUrl(text, sourceLang, targetLang, defaultTargetLang) {
		const sl = sourceLang || "auto";
		const tl = targetLang || defaultTargetLang || "en";
		return `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&hl=en-US&dt=t&dt=bd&dj=1&source=input&q=${encodeURIComponent(text)}`;
	}

	function translateWithGoogle(text, sourceLang, targetLang, deps) {
		const fetchJsonSafe = deps && deps.fetchJsonSafe;
		const defaultTargetLang = deps && deps.defaultTargetLang;
		if (typeof fetchJsonSafe !== "function") {
			return Promise.resolve("");
		}
		const apiUrl = buildGoogleTranslateUrl(text, sourceLang, targetLang, defaultTargetLang);
		return fetchJsonSafe(apiUrl)
			.then((data) => {
				if (data && data.sentences && data.sentences.length > 0) {
					return data.sentences.map((s) => s.trans).join(" ");
				}
				return "";
			});
	}

	function createTaskQueue(limit) {
		let active = 0;
		const queue = [];

		function runNext() {
			while (active < limit && queue.length > 0) {
				const job = queue.shift();
				active += 1;
				Promise.resolve()
					.then(job)
					.catch(() => {})
					.finally(() => {
						active -= 1;
						runNext();
					});
			}
		}

		return function enqueue(job) {
			queue.push(job);
			runNext();
		};
	}

	global.TranslationUtils = {
		requestRuntimeTranslation,
		requestPreferredTranslation,
		buildGoogleTranslateUrl,
		translateWithGoogle,
		createTaskQueue,
		normalizeTranslationLang,
		getLanguageBase,
		isSameLanguageFamily,
		getBrowserTargetLang,
		isManualSourceLanguage,
		isChromeBrowserEnvironment,
		isSingleWordLikeText,
		getBrowserTranslationFallbackKey,
		detectLanguageWithChromeI18n,
		validateBrowserTranslationPair,
		translateWithBrowser,
	};
})(globalThis);
