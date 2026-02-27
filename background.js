// background.js
if (typeof importScripts === "function") {
	importScripts("storage.js");
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
	const sl = sourceLang || "auto";
	const tl = targetLang || navigator.language || "en";
	const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&hl=en-US&dt=t&dt=bd&dj=1&source=input&q=${encodeURIComponent(text)}`;
	return fetchJsonSafe(apiUrl)
		.then((data) => {
			if (data && data.sentences && data.sentences.length > 0) {
				return data.sentences.map((s) => s.trans).join(" ");
			}
			return "";
		});
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

function dedupEntries(entries) {
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
	return fetchJsonSafe(url)
		.then((data) => {
			const entries = [];
			flattenDictionaryEntries(data, entries, "");
			const dedup = dedupEntries(entries);
			return { found: dedup.length > 0, source: "kateglo", entries: dedup.slice(0, 5) };
		});
}

function lookupEnglishFreeDictionary(word) {
	return lookupFreeDictionaryByLang(word, "en");
}

function lookupFreeDictionaryByLang(word, sourceLang) {
	const base = ((sourceLang || "").split("-")[0] || "").toLowerCase();
	const lang = base === "fil" ? "tl" : base;
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
		const dedup = dedupEntries(entries);
		return { found: dedup.length > 0, source: "dictionaryapi", entries: dedup.slice(0, 5) };
	});
}

function parseJotobaEntries(data) {
	const words = Array.isArray(data && data.words) ? data.words : [];
	const entries = [];
	words.forEach((item) => {
		const senses = Array.isArray(item && item.senses) ? item.senses : [];
		senses.forEach((sense) => {
			const pos = Array.isArray(sense && sense.pos)
				? sense.pos.map((p) => (typeof p === "string" ? p : "")).filter((x) => !!x).join(", ")
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
	return dedupEntries(entries);
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
			})
				.then((data2) => {
					dedup = parseJotobaEntries(data2);
					return { found: dedup.length > 0, source: "jotoba", entries: dedup.slice(0, 5) };
				});
		});
}

function stripHtmlTags(text) {
	return (text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text) {
	return (text || "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

function normalizeWiktionaryDefinition(raw) {
	return decodeHtmlEntities(stripHtmlTags(raw || ""));
}

function getWiktionaryLanguageKeys(baseLang) {
	const normalized = (baseLang || "").toLowerCase();
	const aliasMap = {
		fil: ["fil", "tl"],
		tl: ["tl", "fil"],
		zh: ["zh", "zh-hans", "zh-hant"],
	};
	const aliases = aliasMap[normalized] || [normalized];
	return Array.from(new Set(aliases.filter((x) => !!x)));
}

function matchesLanguageName(languageText, baseLang) {
	const text = (languageText || "").toLowerCase();
	if (!text) return false;
	const nameMap = {
		en: ["english"],
		id: ["indonesian"],
		ja: ["japanese"],
		tl: ["tagalog", "filipino"],
		fil: ["tagalog", "filipino"],
		ms: ["malay"],
		es: ["spanish"],
		fr: ["french"],
		de: ["german"],
		pt: ["portuguese"],
		ru: ["russian"],
		ko: ["korean"],
		zh: ["chinese", "mandarin"],
	};
	const probes = nameMap[(baseLang || "").toLowerCase()] || [];
	return probes.some((p) => text.includes(p));
}

function lookupWiktionaryDictionary(word, sourceLang) {
	const baseLang = ((sourceLang || "").split("-")[0] || "").toLowerCase();
	const lang = baseLang === "fil" ? "tl" : baseLang;
	const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
	return fetchJsonSafe(url)
		.then((data) => {
			if (!data || typeof data !== "object") {
				return { found: false, source: "wiktionary", entries: [] };
			}

			const targetKeys = getWiktionaryLanguageKeys(baseLang === "fil" ? "tl" : baseLang);
			const directEntries = [];
			targetKeys.forEach((key) => {
				if (Array.isArray(data[key])) {
					directEntries.push.apply(directEntries, data[key]);
				}
			});

			let pickedEntries = directEntries;
			if (pickedEntries.length === 0 && Array.isArray(data.other)) {
				pickedEntries = data.other.filter((entry) =>
					matchesLanguageName(entry && entry.language, baseLang === "fil" ? "tl" : baseLang)
				);
			}
			if (pickedEntries.length === 0) {
				return { found: false, source: "wiktionary", entries: [] };
			}

			const entries = [];
			const seen = new Set();
			pickedEntries.forEach((entry) => {
				const pos = typeof entry.partOfSpeech === "string" ? entry.partOfSpeech.trim() : "";
				const defs = Array.isArray(entry.definitions) ? entry.definitions : [];
				defs.forEach((d) => {
					const definition = normalizeWiktionaryDefinition(d && d.definition);
					if (!definition) return;
					const key = `${pos.toLowerCase()}__${definition.toLowerCase()}`;
					if (seen.has(key)) return;
					seen.add(key);
					entries.push({ pos, definition });
				});
			});

			return {
				found: entries.length > 0,
				source: "wiktionary",
				entries: entries.slice(0, 5),
			};
		});
}

function tryLookupChain(tasks) {
	const run = (index) => {
		if (index >= tasks.length) return Promise.resolve({ found: false, source: "", entries: [] });
		return tasks[index]().then((result) => {
			if (result && result.found) return result;
			return run(index + 1);
		}).catch(() => run(index + 1));
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

		let lookupPromise = null;
		let sourceName = "wiktionary";
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

		lookupPromise
			.then((result) => sendResponse(result))
			.catch((error) => {
				if (!(error && error.name === "TypeError")) {
					console.error("Dictionary lookup failed:", error);
				}
				sendResponse({ found: false, source: sourceName, entries: [] });
			});
		return true; // Indicates that the response is asynchronous
	}
});
