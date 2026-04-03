// background.js
if (typeof importScripts === "function") {
	importScripts("lib/dictionary-utils.js");
	importScripts("lib/lemma-utils.js");
	importScripts("lib/translation-utils.js");
	importScripts("lib/storage-merge-utils.js");
	importScripts("packages/simplemma.bundle.js");
	importScripts("packages/clever-translate.iife.min.js");
	importScripts("storage.js");
}

const SIMPLEMMA_DICTIONARY_BASE_URL = LemmaUtils.SIMPLEMMA_DICTIONARY_BASE_URL;
const lemmaProvider = LemmaUtils.createSimplemmaLemmaProvider({
	simplemmaGlobal: globalThis.simplemma,
	dictionaryBaseUrl: SIMPLEMMA_DICTIONARY_BASE_URL,
});
const getLemmaForQuery = lemmaProvider.getLemmaForQuery;
const getVariationsForLemma = lemmaProvider.getVariationsForLemma;
const contextualTranslators = new Map();
const contextualTranslationCache = new Map();
const contextualTranslationInflight = new Map();
const MAX_CONTEXTUAL_TRANSLATION_CACHE_ENTRIES = 300;

chrome.runtime.onInstalled.addListener(function () {
	chrome.contextMenus.create({
		id: "addWord",
		title: "Add Word to Annotator Vocabulary",
		contexts: ["selection"],
	});

	WordStorage.init();
});

chrome.runtime.onStartup.addListener(function () {
	WordStorage.init();
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
	if (info.menuItemId === "addWord" && info.selectionText) {
		const word = info.selectionText.trim();
		if (!tab || !tab.id) return;
		chrome.tabs.sendMessage(tab.id, { action: "openAddWordModal", word: word }, function () {
			if (chrome.runtime.lastError) {
				console.error("Failed to open add-word modal:", chrome.runtime.lastError);
			}
		});
	}
});

function translateWithGoogle(text, sourceLang, targetLang) {
	return TranslationUtils.translateWithGoogle(text, sourceLang, targetLang, {
		fetchJsonSafe: DictionaryUtils.fetchJsonSafe,
		defaultTargetLang: navigator.language || "en",
	});
}

function detectLanguageWithChromeI18n(text) {
	return new Promise((resolve) => {
		try {
			if (!chrome || !chrome.i18n || typeof chrome.i18n.detectLanguage !== "function") {
				resolve("");
				return;
			}
			chrome.i18n.detectLanguage(text || "", (result) => {
				if (chrome.runtime.lastError || !result || !Array.isArray(result.languages) || result.languages.length === 0) {
					resolve("");
					return;
				}
				const top = result.languages[0] || {};
				resolve(TranslationUtils.normalizeTranslationLang(top.language || ""));
			});
		} catch (_) {
			resolve("");
		}
	});
}

async function translationMatchesTargetLanguage(text, targetLang) {
	const normalizedText = typeof text === "string" ? text.trim() : "";
	const normalizedTargetLang =
		TranslationUtils.normalizeTranslationLang(targetLang) ||
		TranslationUtils.getBrowserTargetLang(navigator) ||
		"en";
	if (!normalizedText || !normalizedTargetLang) return true;
	const detectedLang = await detectLanguageWithChromeI18n(normalizedText);
	if (!detectedLang) return true;
	if (typeof TranslationUtils.isSameLanguageFamily !== "function") return true;
	return TranslationUtils.isSameLanguageFamily(detectedLang, normalizedTargetLang);
}

function getContextualTranslator(sourceLang, targetLang) {
	const CleverTranslateRef = globalThis.CleverTranslate;
	const ContextualTranslator = CleverTranslateRef && CleverTranslateRef.ContextualTranslator;
	if (typeof ContextualTranslator !== "function") return null;
	const normalizedSourceLang = (TranslationUtils.normalizeTranslationLang(sourceLang) || "auto");
	const normalizedTargetLang = (
		TranslationUtils.normalizeTranslationLang(targetLang) ||
		TranslationUtils.normalizeTranslationLang(navigator.language) ||
		"en"
	);
	const cacheKey = `${normalizedSourceLang}__${normalizedTargetLang}`;
	if (!contextualTranslators.has(cacheKey)) {
		contextualTranslators.set(cacheKey, new ContextualTranslator({
			sourceLang: normalizedSourceLang,
			targetLang: normalizedTargetLang,
		}));
	}
	return contextualTranslators.get(cacheKey) || null;
}

function buildContextualTranslationResponse(translation, method, usedContext, fallback) {
	return {
		translation: typeof translation === "string" ? translation : "",
		method: typeof method === "string" ? method : "",
		usedContext: !!usedContext,
		fallback: !!fallback,
	};
}

function buildContextualTranslationCacheKey(sentence, word, wordPos, sourceLang, targetLang) {
	const normalizedSentence = typeof sentence === "string" ? sentence.trim().replace(/\s+/g, " ") : "";
	const normalizedWord = typeof word === "string" ? word.trim().toLowerCase() : "";
	const normalizedSourceLang = TranslationUtils.normalizeTranslationLang(sourceLang) || "auto";
	const normalizedTargetLang =
		TranslationUtils.normalizeTranslationLang(targetLang) ||
		TranslationUtils.normalizeTranslationLang(navigator.language) ||
		"en";
	const normalizedWordPos =
		typeof wordPos === "number" && Number.isFinite(wordPos) && wordPos >= 0
			? String(wordPos)
			: "";
	return `${normalizedSourceLang}__${normalizedTargetLang}__${normalizedWordPos}__${normalizedWord}__${normalizedSentence}`;
}

function rememberContextualTranslation(cacheKey, result) {
	if (!cacheKey) return result;
	if (contextualTranslationCache.has(cacheKey)) {
		contextualTranslationCache.delete(cacheKey);
	}
	contextualTranslationCache.set(cacheKey, result);
	while (contextualTranslationCache.size > MAX_CONTEXTUAL_TRANSLATION_CACHE_ENTRIES) {
		const oldestKey = contextualTranslationCache.keys().next().value;
		if (oldestKey === undefined) break;
		contextualTranslationCache.delete(oldestKey);
	}
	return result;
}

async function translateContextualWordWithFallback(sentence, word, wordPos, sourceLang, targetLang) {
	const normalizedSentence = typeof sentence === "string" ? sentence.trim() : "";
	const normalizedWord = typeof word === "string" ? word.trim() : "";
	const normalizedSourceLang = (sourceLang || "auto");
	const normalizedTargetLang =
		targetLang ||
		TranslationUtils.getBrowserTargetLang(navigator) ||
		"en";
	const cacheKey = buildContextualTranslationCacheKey(
		normalizedSentence,
		normalizedWord,
		wordPos,
		normalizedSourceLang,
		normalizedTargetLang
	);

	async function fallbackTranslate(method) {
		const translation = normalizedWord
			? await translateWithGoogle(normalizedWord, normalizedSourceLang, normalizedTargetLang).catch(() => "")
			: "";
		return rememberContextualTranslation(
			cacheKey,
			buildContextualTranslationResponse(translation, method, false, true)
		);
	}

	if (cacheKey && contextualTranslationCache.has(cacheKey)) {
		return contextualTranslationCache.get(cacheKey);
	}
	if (cacheKey && contextualTranslationInflight.has(cacheKey)) {
		return contextualTranslationInflight.get(cacheKey);
	}

	if (!normalizedSentence || !normalizedWord) {
		return fallbackTranslate("Fallback: Missing Context");
	}

	const translationPromise = (async () => {
		try {
		const translator = getContextualTranslator(normalizedSourceLang, normalizedTargetLang);
		if (!translator || typeof translator.extractWordTranslation !== "function") {
			return fallbackTranslate("Fallback: Context Translator Unavailable");
		}
		const options = {};
		if (typeof wordPos === "number" && Number.isFinite(wordPos) && wordPos >= 0) {
			options.wordPos = wordPos;
		}
		const result = await translator.extractWordTranslation(normalizedSentence, normalizedWord, options);
		if (result && typeof result.translation === "string" && result.translation.trim()) {
			const translation = result.translation.trim();
			const matchesTargetLanguage = await translationMatchesTargetLanguage(translation, normalizedTargetLang);
			if (!matchesTargetLanguage) {
				return fallbackTranslate("Fallback: Target Language Mismatch");
			}
			return rememberContextualTranslation(
				cacheKey,
				buildContextualTranslationResponse(translation, result.method || "", true, false)
			);
		}
		return fallbackTranslate(result && typeof result.method === "string" ? result.method : "Fallback: Empty Contextual Translation");
		} catch (error) {
			return fallbackTranslate(`Error: ${error && error.message ? error.message : "Contextual translation failed"}`);
		}
	})();
	if (cacheKey) {
		contextualTranslationInflight.set(cacheKey, translationPromise);
	}
	return translationPromise.finally(() => {
		if (cacheKey) {
			contextualTranslationInflight.delete(cacheKey);
		}
	});
}

function lookupDictionaryWithLemmaFallback(text, sourceLang) {
	const originalQuery = (text || "").trim();
	const normalizedSourceLang = (sourceLang || "auto").toLowerCase();
	const originalLookup = DictionaryUtils.buildDictionaryLookup(originalQuery, normalizedSourceLang);
	return originalLookup.lookupPromise.then((originalResult) => {
		const originalSection = {
			mode: "surface",
			query: originalQuery,
			lemma: "",
			source: (originalResult && originalResult.source) || originalLookup.sourceName,
			found: !!(originalResult && originalResult.found),
			entries: originalResult && Array.isArray(originalResult.entries) ? originalResult.entries : [],
		};
		return getLemmaForQuery(originalQuery, normalizedSourceLang).then((lemmaResult) => {
			const lemma = lemmaResult && lemmaResult.found ? (lemmaResult.lemma || "").trim() : "";
			if (!lemma || lemma.toLowerCase() === originalQuery.toLowerCase()) {
				const primary = originalSection.found ? originalSection : null;
				return {
					found: originalSection.found,
					source: originalSection.source,
					entries: primary ? primary.entries : [],
					query: originalQuery,
					usedLemma: false,
					lemma: "",
					sections: [originalSection],
				};
			}
			const lemmaLookup = DictionaryUtils.buildDictionaryLookup(lemma, normalizedSourceLang);
			return lemmaLookup.lookupPromise.then((lemmaLookupResult) => {
				const lemmaSection = {
					mode: "lemma",
					query: lemma,
					lemma,
					source: (lemmaLookupResult && lemmaLookupResult.source) || lemmaLookup.sourceName,
					found: !!(lemmaLookupResult && lemmaLookupResult.found),
					entries: lemmaLookupResult && Array.isArray(lemmaLookupResult.entries) ? lemmaLookupResult.entries : [],
				};
				const primary = originalSection.found ? originalSection : (lemmaSection.found ? lemmaSection : null);
				return {
					found: !!primary,
					source: primary ? primary.source : originalSection.source,
					entries: primary ? primary.entries : [],
					query: originalQuery,
					usedLemma: !originalSection.found && lemmaSection.found,
					lemma,
					sections: [originalSection, lemmaSection],
				};
			});
		});
	});
}

// 用于翻译文本的消息监听器
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
	if (request.action === "translate") {
		translateWithGoogle(request.text, request.sourceLang || "auto", request.targetLang)
			.then((translation) => {
				sendResponse({ translation: translation || "" });
			})
			.catch((error) => {
				console.error("Error translating text:", error);
				sendResponse({ translation: "" });
			});
		return true; // Indicates that the response is asynchronous
	}

	if (request.action === "translateContextualWord") {
		translateContextualWordWithFallback(
			request.sentence,
			request.word,
			request.wordPos,
			request.sourceLang || "auto",
			request.targetLang
		)
			.then((result) => sendResponse(result))
			.catch((error) => {
				console.error("Error translating contextual word:", error);
				sendResponse(buildContextualTranslationResponse("", `Error: ${error && error.message ? error.message : "Unknown error"}`, false, true));
			});
		return true;
	}

	if (request.action === "getLemma") {
		getLemmaForQuery(request.text, request.sourceLang)
			.then((result) => sendResponse(result))
			.catch(() => sendResponse({ found: false, lemma: "", lang: LemmaUtils.normalizeLemmaSourceLang(request.sourceLang) }));
		return true;
	}

	if (request.action === "getLemmaVariations") {
		getVariationsForLemma(request.lemma || request.text, request.sourceLang, request.text)
			.then((result) => sendResponse(result))
			.catch(() => sendResponse({
				found: false,
				lemma: typeof request.lemma === "string" ? request.lemma.trim() : "",
				lang: LemmaUtils.normalizeLemmaSourceLang(request.sourceLang),
				familyForms: [],
			}));
		return true;
	}

	if (request.action === "lookupDictionary") {
		const sourceLang = (request.sourceLang || "auto").toLowerCase();
		const text = (request.text || "").trim();
		if (!text) {
			sendResponse({ found: false, source: "", entries: [] });
			return false;
		}
		if (!sourceLang || sourceLang === "auto") {
			sendResponse({ found: false, source: "", entries: [] });
			return false;
		}

		lookupDictionaryWithLemmaFallback(text, sourceLang)
			.then((result) => sendResponse(result))
			.catch((error) => {
				if (!(error && error.name === "TypeError")) {
					console.error("Dictionary lookup failed:", error);
				}
				sendResponse({ found: false, source: "dictionaryapi", entries: [], query: text, usedLemma: false, lemma: "", sections: [] });
			});
		return true; // Indicates that the response is asynchronous
	}
});
