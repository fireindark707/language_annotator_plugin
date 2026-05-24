(function (global) {
	"use strict";

	// Shared selection-translation logic used by both content.js and epub-reader.js.
	// deps: { document, WordStorage, TranslationUtils, DictionaryUtils, ContentLookupUi,
	//         chromeRuntime, chromeI18n, navigator,
	//         shouldSkipTranslateAndDictionaryForLang(detected)→bool,
	//         requestWordTranslationInContext(opts)→Promise<string>,   // optional; for contextual layer
	//         showTranslation(translation, opts),
	//         updateTranslationBox(translation, opts),
	//         appendDictionaryToTranslationBox(dictResponse, sourceLang),
	//         onError(e) }
	function translateSelection(text, deps) {
		var WordStorage = deps.WordStorage;
		var TranslationUtils = deps.TranslationUtils;
		var DictionaryUtils = deps.DictionaryUtils;
		var chromeRuntime = deps.chromeRuntime;
		var chromeI18n = deps.chromeI18n;
		var nav = deps.navigator || (typeof navigator !== "undefined" ? navigator : {});
		var shouldSkip = typeof deps.shouldSkipTranslateAndDictionaryForLang === "function"
			? deps.shouldSkipTranslateAndDictionaryForLang
			: function () { return false; };
		var requestWordInContext = typeof deps.requestWordTranslationInContext === "function"
			? deps.requestWordTranslationInContext
			: null;
		var showTranslationFn = deps.showTranslation;
		var updateTranslationBoxFn = deps.updateTranslationBox;
		var appendDictionaryFn = deps.appendDictionaryToTranslationBox;
		var onError = typeof deps.onError === "function" ? deps.onError : function (e) { console.error("translateSelection error:", e); };
		var activeRequestIdRef = deps.activeRequestIdRef || { value: 0 };

		var _dbg = "[translateSelection]";
		console.log(_dbg, "text:", JSON.stringify(text));

		Promise.all([
			detectLang(text, chromeRuntime, chromeI18n),
			WordStorage.getSourceLang(),
			typeof WordStorage.getTranslationEngine === "function"
				? WordStorage.getTranslationEngine().catch(function () { return "online"; })
				: Promise.resolve("online"),
			WordStorage.getDictionaryLookupEnabled().catch(function () { return true; }),
		]).then(function (results) {
			var detectedLang = results[0];
			var sourceLang = results[1];
			var translationEngine = results[2];
			var dictionaryEnabled = results[3];

			console.log(_dbg, "detectedLang:", detectedLang, "| sourceLang:", sourceLang, "| engine:", translationEngine, "| dictEnabled:", dictionaryEnabled);

			if (shouldSkip(detectedLang)) {
				console.log(_dbg, "SKIP: shouldSkipTranslateAndDictionaryForLang returned true for", detectedLang);
				return;
			}
			var targetLang = TranslationUtils.getBrowserTargetLang(nav) || "en";
			if (detectedLang && TranslationUtils.isSameLanguageFamily(detectedLang, targetLang)) {
				console.log(_dbg, "SKIP: detectedLang", detectedLang, "is same family as targetLang", targetLang);
				return;
			}

			var isSingleWord = TranslationUtils.isSingleWordLikeText(
				text,
				detectedLang || sourceLang || (typeof document !== "undefined" && document.documentElement && document.documentElement.lang) || nav.language || "en"
			);
			// chrome.i18n.detectLanguage is unreliable for single short words
			// (e.g. Indonesian "penuh" → "la", "senja" → "uk"). When the text is a
			// single word, trust sourceLang and treat detection as unreliable.
			var detectedMatchesSource = (isSingleWord || !detectedLang)
				? true
				: TranslationUtils.isSameLanguageFamily(detectedLang, sourceLang);
			var effectiveSourceLang = (sourceLang && !detectedMatchesSource) ? "auto" : (sourceLang || "auto");

			console.log(_dbg, "targetLang:", targetLang, "| isSingleWord:", isSingleWord, "| detectedMatchesSource:", detectedMatchesSource, "| effectiveSourceLang:", effectiveSourceLang);

			var requestId = activeRequestIdRef.value + 1;
			activeRequestIdRef.value = requestId;

			var contextualPromise = (isSingleWord && requestWordInContext)
				? (console.log(_dbg, "firing contextual translation, word:", text, "sourceLang:", effectiveSourceLang),
				   requestWordInContext({ word: text, sourceLang: effectiveSourceLang, targetLang: targetLang }))
				: Promise.resolve("");

			var preferredPromise = (console.log(_dbg, "firing preferred translation, engine:", translationEngine, "text:", text, "sourceLang:", effectiveSourceLang),
				TranslationUtils.requestPreferredTranslation({
					chromeRuntime: chromeRuntime,
					chromeI18n: chromeI18n,
					wordStorage: WordStorage,
					text: text,
					sourceLang: effectiveSourceLang,
					translationEngine: translationEngine,
					detectedLanguage: detectedLang,
					targetLang: targetLang,
					onBrowserFallback: typeof deps.onBrowserFallback === "function" ? deps.onBrowserFallback : function () {},
				}));

			var firstPromise = isSingleWord
				? new Promise(function (resolve) {
					var settled = 0;
					var resolved = false;
					function handle(source, translation) {
						console.log(_dbg, "race handle:", source, "→", JSON.stringify(translation), "| already resolved:", resolved);
						if (resolved) return;
						if (translation) { resolved = true; resolve({ source: source, translation: translation }); return; }
						settled++;
						if (settled >= 2) resolve({ source: source, translation: "" });
					}
					contextualPromise.then(function (t) { handle("contextual", t); }).catch(function (e) { console.log(_dbg, "contextual error:", e); handle("contextual", ""); });
					preferredPromise.then(function (t) { handle("preferred", t); }).catch(function (e) { console.log(_dbg, "preferred error:", e); handle("preferred", ""); });
				})
				: preferredPromise.then(function (t) { return { source: "preferred", translation: t }; });

			return firstPromise.then(function (result) {
				var translation = result && typeof result.translation === "string" ? result.translation : "";
				console.log(_dbg, "firstPromise resolved:", result && result.source, "→", JSON.stringify(translation));
				if (!translation) {
					console.log(_dbg, "SKIP: empty translation, nothing to show");
					return;
				}

				showTranslationFn(translation, isSingleWord ? {
					sourceWord: text.trim(),
					sourceLang: sourceLang,
					isContextual: !!(result && result.source === "contextual"),
				} : null);

				// Upgrade to contextual translation if preferred fired first
				if (isSingleWord && result && result.source === "preferred") {
					contextualPromise.then(function (contextualTranslation) {
						console.log(_dbg, "contextual upgrade:", JSON.stringify(contextualTranslation), "| requestId match:", activeRequestIdRef.value === requestId);
						if (!contextualTranslation) return;
						if (activeRequestIdRef.value !== requestId) return;
						if (updateTranslationBoxFn) updateTranslationBoxFn(contextualTranslation, { isContextual: true });
					}).catch(function () {});
				}

				var dictQuery = DictionaryUtils.normalizeDictionaryQuery(text);
				var dictConditions = {
					dictionaryEnabled: dictionaryEnabled,
					isSingleWord: isSingleWord,
					supportedLang: DictionaryUtils.supportsDictionaryBySourceLang(sourceLang),
					shouldLookup: DictionaryUtils.shouldLookupDictionaryQuery(dictQuery),
					detectedMatchesSource: detectedMatchesSource,
				};
				console.log(_dbg, "dict conditions:", dictConditions, "| query:", dictQuery);
				if (!(dictionaryEnabled && isSingleWord && DictionaryUtils.supportsDictionaryBySourceLang(sourceLang)
					&& DictionaryUtils.shouldLookupDictionaryQuery(dictQuery) && detectedMatchesSource)) {
					console.log(_dbg, "SKIP dict lookup");
					return;
				}

				try {
					chromeRuntime.sendMessage(
						{ action: "lookupDictionary", text: dictQuery, sourceLang: sourceLang || "auto" },
						function (dictResponse) {
							if (chromeRuntime.lastError) return;
							console.log(_dbg, "dict response:", dictResponse && dictResponse.found ? "found" : "not found", dictResponse);
							if (!dictResponse || !dictResponse.found) return;
							if (appendDictionaryFn) appendDictionaryFn(dictResponse, sourceLang || "auto");
						}
					);
				} catch (e) {
					if (e && typeof e.message === "string" && e.message.includes("Extension context invalidated")) return;
					throw e;
				}
			});
		}).catch(function (e) {
			if (e && typeof e.message === "string" && e.message.includes("Extension context invalidated")) return;
			console.error(_dbg, "outer catch:", e);
			onError(e);
		});
	}

	function detectLang(text, chromeRuntime, chromeI18n) {
		return new Promise(function (resolve) {
			try {
				if (!chromeI18n || typeof chromeI18n.detectLanguage !== "function") { resolve(""); return; }
				chromeI18n.detectLanguage(text || "", function (result) {
					if ((chromeRuntime && chromeRuntime.lastError)) { resolve(""); return; }
					if (!result || !Array.isArray(result.languages) || !result.languages[0]) { resolve(""); return; }
					resolve((result.languages[0].language || "").toLowerCase().split("-")[0] || "");
				});
			} catch (e) {
				resolve("");
			}
		});
	}

	global.ContentSelection = { translateSelection: translateSelection, detectLang: detectLang };
})(globalThis);
