// background.js
if (typeof importScripts === "function") {
	importScripts("lib/dictionary-utils.js");
	importScripts("lib/lemma-utils.js");
	importScripts("lib/translation-utils.js");
	importScripts("lib/storage-merge-utils.js");
	importScripts("packages/simplemma.bundle.js");
	importScripts("storage.js");
}

const SIMPLEMMA_DICTIONARY_BASE_URL =
	"https://media.githubusercontent.com/media/fireindark707/simplelemma_js/main/src/data/";
let lemmaService = null;

function normalizeLemmaLang(sourceLang) {
	const base = (((sourceLang || "").split("-")[0]) || "").toLowerCase();
	if (!base || base === "auto") return "";
	if (base === "fil") return "tl";
	return base;
}

function supportsLemmaLang(sourceLang) {
	const lang = normalizeLemmaLang(sourceLang);
	if (!lang || !globalThis.simplemma || !Array.isArray(simplemma.SUPPORTED_LANGUAGES)) return false;
	return simplemma.SUPPORTED_LANGUAGES.includes(lang);
}

function getLemmaService() {
	if (lemmaService) return lemmaService;
	if (!globalThis.simplemma) return null;
	const factory = new simplemma.FetchDictionaryFactory(SIMPLEMMA_DICTIONARY_BASE_URL);
	const strategy = new simplemma.DefaultStrategy({ dictionaryFactory: factory });
	lemmaService = new simplemma.Lemmatizer({ lemmatizationStrategy: strategy });
	return lemmaService;
}

function getLemmaForQuery(text, sourceLang) {
	const query = (text || "").trim();
	const lang = normalizeLemmaLang(sourceLang);
	if (!query || !lang || !supportsLemmaLang(lang)) {
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
}

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

	if (request.action === "getLemma") {
		getLemmaForQuery(request.text, request.sourceLang)
			.then((result) => sendResponse(result))
			.catch(() => sendResponse({ found: false, lemma: "", lang: normalizeLemmaLang(request.sourceLang) }));
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
