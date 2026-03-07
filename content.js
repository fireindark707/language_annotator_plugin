// content.js
let addWordModal = null;
let confirmModal = null;
const MAX_EXAMPLES_PER_WORD = 20;
const EXAMPLE_SIMILARITY_THRESHOLD = 0.88;
let exampleMergeTimer = null;
let pendingExampleMap = {};
let wordPreviewCard = null;
let wordPreviewHideTimer = null;
const PREVIEW_TRANSLATE_CONCURRENCY = 2;
let previewSourceLangPromise = null;
let previewTranslateActive = 0;
const previewTranslateQueue = [];
const previewTranslateInflight = new Set();
const previewTranslateCache = new Map();
const lemmaCache = new Map();
let contentUiLang = "en";
let contentTourAttempted = false;
let contentSelectionTourAttempted = false;
const SIMPLEMMA_SUPPORTED_LANGS = new Set([
	"ast", "bg", "ca", "cs", "cy", "da", "de", "el", "en", "enm", "eo", "es", "et", "fa",
	"fi", "fr", "ga", "gd", "gl", "gv", "hbs", "hi", "hu", "hy", "id", "is", "it", "ka",
	"la", "lb", "lt", "lv", "mk", "ms", "nb", "nl", "nn", "pl", "pt", "ro", "ru", "se",
	"sk", "sl", "sq", "sv", "sw", "tl", "tr", "uk"
]);
const SKIP_TEXT_TAGS = new Set([
	"SCRIPT",
	"STYLE",
	"NOSCRIPT",
	"TEXTAREA",
	"INPUT",
	"SELECT",
	"OPTION",
	"CODE",
	"PRE",
]);

WordStorage.getUiLanguage()
	.then((lang) => {
		contentUiLang = lang || "en";
	})
	.catch(() => {
		contentUiLang = "en";
	});

function contentT(key) {
	if (globalThis.UiI18n && typeof globalThis.UiI18n.t === "function") {
		return globalThis.UiI18n.t(contentUiLang, key);
	}
	const fallback = {
		add_word_title: "Add Word",
		add_word_hint: "Please enter the meaning of this word",
		dict_selected_form: "Selected form",
		lemma_label: "Lemma",
		dict_via_lemma: "Dictionary result matched via lemma",
		lemma_available: "Lemma version available",
		use_lemma: "Use lemma",
		use_original: "Use original",
		using_lemma: "Using lemma",
		loading_translation: "Fetching translation...",
		cancel: "Cancel",
		save: "Save",
		apply: "Apply",
		confirm_action: "Confirm Action",
		confirm: "Confirm",
		meaning_placeholder: "For example: the meaning of this word in this context...",
		mark_confirm_prefix: "Mark \"",
		mark_confirm_suffix: "\" as learned?",
	};
	return fallback[key] || key;
}

function startContentTour(force) {
	if (!globalThis.UiTour) return;
	const run = force ? UiTour.start : UiTour.maybeStartOnce;
	run({
		storageKey: "content_v1",
		lang: contentUiLang,
		steps: UiTour.getSteps(contentUiLang, "content"),
	});
}

function startContentSelectionTour(force) {
	if (!globalThis.UiTour) return;
	const run = force ? UiTour.start : UiTour.maybeStartOnce;
	run({
		storageKey: "content_selection_v1",
		lang: contentUiLang,
		steps: UiTour.getSteps(contentUiLang, "contentSelection"),
	});
}

function isContextInvalidatedError(error) {
	return !!(error && typeof error.message === "string" && error.message.includes("Extension context invalidated"));
}

function getExampleText(entry) {
	if (typeof entry === "string") return (entry || "").replace(/\s+/g, " ").trim();
	if (entry && typeof entry === "object") return (entry.text || "").replace(/\s+/g, " ").trim();
	return "";
}

async function translatePreviewSentence(sentence) {
	if (!previewSourceLangPromise) {
		previewSourceLangPromise = WordStorage.getSourceLang().catch(() => "auto");
	}
	const sourceLang = await previewSourceLangPromise;
	return new Promise((resolve) => {
		chrome.runtime.sendMessage(
			{ action: "translate", text: sentence, sourceLang: sourceLang || "auto" },
			(response) => {
				if (chrome.runtime.lastError || !response || !response.translation) {
					resolve("");
					return;
				}
				resolve(response.translation);
			}
		);
	});
}

function runPreviewTranslateQueue() {
	while (
		previewTranslateActive < PREVIEW_TRANSLATE_CONCURRENCY &&
		previewTranslateQueue.length > 0
	) {
		const job = previewTranslateQueue.shift();
		previewTranslateActive += 1;
		Promise.resolve()
			.then(job)
			.catch(() => {})
			.finally(() => {
				previewTranslateActive -= 1;
				runPreviewTranslateQueue();
			});
	}
}

function queuePreviewTranslation(sentence, targetEl) {
	if (!sentence || !targetEl) return;
	const cached = previewTranslateCache.get(sentence);
	if (cached) {
		targetEl.textContent = cached;
		return;
	}
	if (previewTranslateInflight.has(sentence)) return;
	previewTranslateInflight.add(sentence);
	targetEl.textContent = "…";
	previewTranslateQueue.push(async () => {
		const translated = await translatePreviewSentence(sentence);
		previewTranslateInflight.delete(sentence);
		if (!translated) return;
		previewTranslateCache.set(sentence, translated);
		if (targetEl.isConnected) {
			targetEl.textContent = translated;
		}
	});
	runPreviewTranslateQueue();
}

function createPreviewHighlightedSentence(sentence, word) {
	const wrapper = document.createElement("div");
	const rawWord = (word || "").trim();
	if (!sentence || !rawWord) {
		wrapper.textContent = sentence || "";
		return wrapper;
	}
	const isCjkWord = isCjkText(rawWord);
	const lowerSentence = sentence.toLowerCase();
	const lowerWord = rawWord.toLowerCase();
	let cursor = 0;
	let matched = false;

	while (cursor < sentence.length) {
		const start = lowerSentence.indexOf(lowerWord, cursor);
		if (start === -1) break;
		const end = start + rawWord.length;
		if (!isBoundaryMatch(sentence, start, end, isCjkWord)) {
			cursor = start + 1;
			continue;
		}
		if (start > cursor) {
			wrapper.appendChild(document.createTextNode(sentence.slice(cursor, start)));
		}
		const mark = document.createElement("span");
		mark.style.background = "#efe0a8";
		mark.style.color = "#4b392c";
		mark.style.borderRadius = "6px 5px 7px 5px";
		mark.style.padding = "0 3px";
		mark.style.boxShadow = "inset 0 -1px 0 rgba(120, 98, 67, 0.12)";
		mark.textContent = sentence.slice(start, end);
		wrapper.appendChild(mark);
		cursor = end;
		matched = true;
	}

	if (!matched) {
		wrapper.textContent = sentence;
		return wrapper;
	}
	if (cursor < sentence.length) {
		wrapper.appendChild(document.createTextNode(sentence.slice(cursor)));
	}
	return wrapper;
}

function isExtensionUiElement(element) {
	if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
	if (element.id === "translationBox") return true;
	if (element.classList.contains("plugin-highlight-word")) return true;

	for (let i = 0; i < element.classList.length; i += 1) {
		if (element.classList[i].startsWith("la-")) return true;
	}
	return false;
}

function hostMatchesExcludedDomain(hostname, excludedDomain) {
	const host = (hostname || "").toLowerCase();
	const domain = (excludedDomain || "").toLowerCase();
	if (!host || !domain) return false;
	return host === domain || host.endsWith(`.${domain}`);
}

async function isCurrentDomainExcluded() {
	try {
		const excludedDomains = await WordStorage.getExcludedDomains();
		if (!Array.isArray(excludedDomains) || excludedDomains.length === 0) return false;
		const host = (location.hostname || "").toLowerCase();
		for (let i = 0; i < excludedDomains.length; i += 1) {
			if (hostMatchesExcludedDomain(host, excludedDomains[i])) return true;
		}
		return false;
	} catch (error) {
		return false;
	}
}

// 标记单词为已学会
function markLearned(word) {
	lowerCaseWord = word.toLowerCase();
	showConfirmModal(`${contentT("mark_confirm_prefix")}${lowerCaseWord}${contentT("mark_confirm_suffix")}`).then((confirmed) => {
		if (!confirmed) return;
		WordStorage.getWords().then((words) => {
			if (words[lowerCaseWord]) {
				words[lowerCaseWord].learned = true;
				WordStorage.saveWords(words).then(() => {
					// 可能需要刷新页面或以其他方式更新显示
					console.log(`Word: ${lowerCaseWord} marked as learned.`);
					// make all highlighted words with the same word has no style
					document
						.querySelectorAll(".plugin-highlight-word")
						.forEach((span) => {
							if (span.textContent.toLowerCase() === lowerCaseWord) {
								span.style.backgroundColor = "";
								span.style.cursor = "";
								span.style.color = "";
								span.title = "";
							}
						});
				}).catch((error) => {
					console.error("Failed to mark word as learned:", error);
				});
			}
		}).catch((error) => {
			console.error("Failed to load words:", error);
		});
	});
}

function ensureWordPreviewStyle() {
	if (document.getElementById("laWordPreviewStyle")) return;
	const style = document.createElement("style");
	style.id = "laWordPreviewStyle";
	style.textContent = `
		.la-word-preview {
			position: absolute;
			z-index: 2147483645;
			min-width: 260px;
			max-width: 420px;
			background: #fffaf3;
			border: 1px solid #dccabd;
			border-radius: 16px 14px 18px 13px;
			box-shadow: 0 14px 28px rgba(88, 63, 50, 0.14);
			padding: 11px 13px;
			color: #34251f;
			font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
			pointer-events: auto;
			animation: laWordPreviewIn 160ms ease-out;
		}
		.la-word-preview-meaning {
			font-size: 13px;
			font-weight: 700;
			line-height: 1.45;
			color: #7f5a4d;
		}
		.la-word-preview-list {
			margin: 8px 0 0;
			padding-left: 18px;
			font-size: 12px;
			line-height: 1.45;
			color: #4e3e36;
		}
		.la-word-preview-list li {
			margin-bottom: 4px;
		}
		.la-word-preview-trans {
			margin-top: 2px;
			font-size: 11px;
			color: #7a685d;
			border-left: 2px solid #ddd0c2;
			padding-left: 6px;
		}
		@keyframes laWordPreviewIn {
			from { opacity: 0; transform: translateY(5px) scale(0.985); }
			to { opacity: 1; transform: translateY(0) scale(1); }
		}
	`;
	document.head.appendChild(style);
}

function ensureWordPreviewCard() {
	ensureWordPreviewStyle();
	if (wordPreviewCard && wordPreviewCard.isConnected) return wordPreviewCard;
	wordPreviewCard = document.createElement("div");
	wordPreviewCard.className = "la-word-preview";
	wordPreviewCard.style.display = "none";
	wordPreviewCard.addEventListener("mouseenter", () => {
		if (wordPreviewHideTimer) clearTimeout(wordPreviewHideTimer);
	});
	wordPreviewCard.addEventListener("mouseleave", () => {
		hideWordPreview(70);
	});
	document.body.appendChild(wordPreviewCard);
	return wordPreviewCard;
}

function hideWordPreview(delay) {
	if (!wordPreviewCard) return;
	if (wordPreviewHideTimer) clearTimeout(wordPreviewHideTimer);
	wordPreviewHideTimer = setTimeout(() => {
		if (wordPreviewCard) wordPreviewCard.style.display = "none";
	}, typeof delay === "number" ? delay : 0);
}

function showWordPreview(anchor, meaning, examples) {
	const card = ensureWordPreviewCard();
	if (wordPreviewHideTimer) clearTimeout(wordPreviewHideTimer);
	card.innerHTML = "";

	const meaningEl = document.createElement("div");
	meaningEl.className = "la-word-preview-meaning";
	meaningEl.textContent = meaning || "";
	card.appendChild(meaningEl);

	const items = (examples || [])
		.map(getExampleText)
		.filter((text) => text.length > 0)
		.slice(0, 3);
	if (items.length > 0) {
		const list = document.createElement("ol");
		list.className = "la-word-preview-list";
		items.forEach((sentence) => {
			const li = document.createElement("li");
			const text = createPreviewHighlightedSentence(sentence, anchor.textContent || "");
			const trans = document.createElement("div");
			trans.className = "la-word-preview-trans";
			trans.textContent = "…";
			li.appendChild(text);
			li.appendChild(trans);
			queuePreviewTranslation(sentence, trans);
			list.appendChild(li);
		});
		card.appendChild(list);
	}

	card.style.display = "block";
	const rect = anchor.getBoundingClientRect();
	const cardRect = card.getBoundingClientRect();
	let left = rect.left + window.scrollX;
	let top = rect.bottom + window.scrollY + 8;
	const maxLeft = window.scrollX + window.innerWidth - cardRect.width - 10;
	if (left > maxLeft) left = Math.max(window.scrollX + 10, maxLeft);
	const maxTop = window.scrollY + window.innerHeight - cardRect.height - 10;
	if (top > maxTop) top = rect.top + window.scrollY - cardRect.height - 8;
	card.style.left = `${Math.max(window.scrollX + 8, left)}px`;
	card.style.top = `${Math.max(window.scrollY + 8, top)}px`;
}

// 创建高亮显示的span元素
function createHighlightSpan(word, meaning, examples) {
	const span = document.createElement("span");
	span.className = "plugin-highlight-word";
	span.textContent = word;
	span.style.backgroundColor = "#efe0a8";
	span.style.cursor = "pointer";
	span.style.color = "#4b392c";
	span.style.padding = "0 3px";
	span.style.borderRadius = "6px 5px 7px 5px";
	span.style.boxShadow = "inset 0 -1px 0 rgba(120, 98, 67, 0.12)";
	span.title = "";
	span.addEventListener("mouseenter", () => {
		span.style.backgroundColor = "#e4d295";
		showWordPreview(span, meaning, examples);
	});
	span.addEventListener("mouseleave", () => {
		span.style.backgroundColor = "#efe0a8";
		hideWordPreview(70);
	});
	// span.addEventListener("click", () => markLearned(word));
	return span;
}

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCjkText(text) {
	return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text || "");
}

function isWordChar(char) {
	return !!char && /[\p{L}\p{N}]/u.test(char);
}

function isBoundaryMatch(text, start, end, cjkWord) {
	if (cjkWord) return true;
	const prev = start > 0 ? text[start - 1] : "";
	const next = end < text.length ? text[end] : "";
	return !isWordChar(prev) && !isWordChar(next);
}

function findNextWholeWordIndex(text, lowerText, word, fromIndex) {
	const lowerWord = (word || "").toLowerCase();
	const cjkWord = isCjkText(word);
	let searchFrom = fromIndex;

	while (searchFrom < text.length) {
		const idx = lowerText.indexOf(lowerWord, searchFrom);
		if (idx === -1) return -1;
		const end = idx + word.length;
		if (isBoundaryMatch(text, idx, end, cjkWord)) {
			return idx;
		}
		searchFrom = idx + 1;
	}
	return -1;
}

function containsWord(text, word) {
	const trimmed = (word || "").trim();
	if (!trimmed) return false;
	const rawText = text || "";
	const lowerText = rawText.toLowerCase();
	return findNextWholeWordIndex(rawText, lowerText, trimmed.toLowerCase(), 0) !== -1;
}

function normalizeText(text) {
	return (text || "").replace(/\s+/g, " ").trim();
}

function normalizePageKey(url) {
	if (!url) return "";
	try {
		const u = new URL(url);
		return `${u.origin}${u.pathname}`;
	} catch (error) {
		return normalizeText(url);
	}
}

function getDerivedPageCountFromExamples(wordData) {
	const examples = Array.isArray(wordData && wordData.examples) ? wordData.examples : [];
	const keys = new Set();
	for (let i = 0; i < examples.length; i += 1) {
		const entry = examples[i] || {};
		const key = normalizePageKey(entry.sourceUrl || entry.url || "");
		if (key) keys.add(key);
	}
	return keys.size;
}

function stripOuterPunctuation(text) {
	return (text || "")
		.replace(/^[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{};:,./<>?\\|]+/u, "")
		.replace(/[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{};:,./<>?\\|]+$/u, "");
}

function normalizeDictionaryQuery(text) {
	const cleaned = stripOuterPunctuation((text || "").trim());
	if (!cleaned) return "";
	return cleaned.split(/\s+/)[0] || "";
}

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

function resolveLemma(text, sourceLang) {
	const query = normalizeDictionaryQuery(text);
	const lang = normalizeLemmaSourceLang(sourceLang);
	if (!query || !lang || !supportsLemmaBySourceLang(lang)) {
		return Promise.resolve({ query, lemma: "", effectiveQuery: query, lang });
	}
	const cacheKey = `${lang}__${query.toLowerCase()}`;
	if (lemmaCache.has(cacheKey)) return Promise.resolve(lemmaCache.get(cacheKey));
	return new Promise((resolve) => {
		chrome.runtime.sendMessage(
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
				lemmaCache.set(cacheKey, payload);
				resolve(payload);
			}
		);
	});
}

function getBrowserBaseLang() {
	const lang = (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en").toLowerCase();
	const base = (lang.split("-")[0] || "en");
	// Normalize Chinese variants (zh-TW / zh-CN / zh-HK ...) into one bucket.
	if (base === "zh") return "zh";
	return base;
}

function detectTextLanguageWithBrowserApi(text) {
	return new Promise((resolve) => {
		try {
			if (!chrome || !chrome.i18n || typeof chrome.i18n.detectLanguage !== "function") {
				resolve("");
				return;
			}
			chrome.i18n.detectLanguage(text || "", (result) => {
				if (chrome.runtime.lastError || !result || !Array.isArray(result.languages)) {
					resolve("");
					return;
				}
				if (result.languages.length === 0) {
					resolve("");
					return;
				}
				const top = result.languages[0];
				const lang = (top && top.language ? top.language : "").toLowerCase();
				resolve((lang.split("-")[0] || ""));
			});
		} catch (_) {
			resolve("");
		}
	});
}

async function shouldSkipTranslateAndDictionary(text) {
	const detected = await detectTextLanguageWithBrowserApi(text);
	if (!detected) return false;
	const browserLang = getBrowserBaseLang();
	const normalizedDetected = detected === "fil" ? "tl" : detected;
	const normalizedBrowser = browserLang === "fil" ? "tl" : browserLang;
	if (normalizedDetected === "zh" && normalizedBrowser === "zh") return true;
	return normalizedDetected === normalizedBrowser;
}

function shouldLookupDictionaryQuery(query) {
	const q = (query || "").trim();
	if (!q) return false;
	if (q.length < 2 || q.length > 32) return false;
	// At least one letter from any script; reject pure digits/symbols.
	if (!/[\p{L}]/u.test(q)) return false;
	return true;
}

function supportsDictionaryBySourceLang(sourceLang) {
	const normalized = (sourceLang || "").toLowerCase();
	if (!normalized || normalized === "auto") return false;
	const base = normalized.split("-")[0];
	const supported = new Set([
		"ar", "bn", "cs", "de", "el", "en", "es", "fa", "fil", "fr",
		"he", "hi", "hu", "id", "it", "ja", "jv", "km", "ko", "lo",
		"ms", "my", "nl", "pl", "pt", "ro", "ru", "su", "sv", "sw",
		"ta", "te", "th", "tl", "tr", "ur", "vi", "zh",
	]);
	return supported.has(base);
}

function getDictionarySourceLabel(source) {
	const normalized = (source || "").toLowerCase();
	if (normalized === "kateglo") return "Kateglo";
	if (normalized === "dictionaryapi") return "Free Dictionary";
	if (normalized === "jotoba") return "Jotoba";
	if (normalized === "wiktionary") return "Wiktionary";
	return "Dictionary";
}

function getDictionarySectionLabel(mode, query) {
	if (mode === "lemma") {
		return `${contentT("lemma_label")}: ${query}`;
	}
	return `${contentT("dict_selected_form")}: ${query}`;
}

function mapDictionarySections(dictResponse, sourceLang) {
	const sections = Array.isArray(dictResponse && dictResponse.sections)
		? dictResponse.sections
		: [];
	const effectiveSections = sections.length > 0
		? sections
		: [{
			mode: dictResponse && dictResponse.usedLemma ? "lemma" : "surface",
			query: dictResponse && dictResponse.usedLemma ? (dictResponse.lemma || "") : (dictResponse && dictResponse.query ? dictResponse.query : ""),
			lemma: dictResponse && dictResponse.lemma ? dictResponse.lemma : "",
			source: dictResponse && dictResponse.source ? dictResponse.source : "dictionary",
			found: !!(dictResponse && dictResponse.found),
			entries: Array.isArray(dictResponse && dictResponse.entries) ? dictResponse.entries : [],
		}];

	return Promise.all(effectiveSections.map((section) => {
		const rawEntries = Array.isArray(section.entries)
			? section.entries.filter((item) => item && item.definition).slice(0, 3)
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
		return Promise.all(rawEntries.map((entry) => new Promise((resolve) => {
			chrome.runtime.sendMessage(
				{
					action: "translate",
					text: entry.definition,
					sourceLang: sourceLang || "auto",
				},
				(defResp) => {
					const translated =
						!chrome.runtime.lastError && defResp && defResp.translation
							? defResp.translation
							: "";
					resolve({
						pos: entry.pos || "",
						definitionOriginal: entry.definition || "",
						definitionTranslated: translated,
					});
				}
			);
		}))).then((mappedEntries) => ({
			mode: section.mode || "surface",
			query: section.query || "",
			lemma: section.lemma || "",
			source: section.source || "dictionary",
			entries: mappedEntries.filter(Boolean),
		}));
	}));
}

function isLowInformationExample(sentence, word) {
	const s = stripOuterPunctuation(normalizeText(sentence)).toLowerCase();
	const w = stripOuterPunctuation(normalizeText(word)).toLowerCase();
	if (!s || !w) return true;
	if (/(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})(\/|\b)/i.test(s)) return true;
	if (s.length < w.length * 2) return true;
	if (s === w) return true;

	// If removing non-letter/digit chars leaves just the target word, it adds no context.
	const compactSentence = s.replace(/[^\p{L}\p{N}]+/gu, "");
	const compactWord = w.replace(/[^\p{L}\p{N}]+/gu, "");
	if (compactSentence && compactWord && compactSentence === compactWord) return true;
	return false;
}

function normalizeExampleEntry(entry) {
	if (typeof entry === "string") {
		const text = normalizeText(entry);
		return text ? { text, pinned: false, createdAt: 0 } : null;
	}
	if (!entry || typeof entry !== "object") return null;
	const text = normalizeText(entry.text || "");
	if (!text) return null;
	return {
		text,
		pinned: !!entry.pinned,
		createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
		pinnedAt: typeof entry.pinnedAt === "number" ? entry.pinnedAt : 0,
		sourceUrl: typeof entry.sourceUrl === "string"
			? entry.sourceUrl
			: (typeof entry.url === "string" ? entry.url : ""),
		capturedAt: typeof entry.capturedAt === "number"
			? entry.capturedAt
			: (typeof entry.timestamp === "number" ? entry.timestamp : 0),
	};
}

function normalizeExampleList(entries) {
	if (!Array.isArray(entries)) return [];
	const out = [];
	for (let i = 0; i < entries.length; i += 1) {
		const parsed = normalizeExampleEntry(entries[i]);
		if (parsed) out.push(parsed);
	}
	return out;
}

function sortExamples(entries) {
	return entries.sort((a, b) => {
		if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
		if (a.pinned && b.pinned) {
			const aPinnedAt = a.pinnedAt || 0;
			const bPinnedAt = b.pinnedAt || 0;
			if (bPinnedAt !== aPinnedAt) return bPinnedAt - aPinnedAt;
		}
		const aCreatedAt = a.createdAt || 0;
		const bCreatedAt = b.createdAt || 0;
		if (bCreatedAt !== aCreatedAt) return bCreatedAt - aCreatedAt;
		return a.text.localeCompare(b.text);
	});
}

function enforceExampleLimit(entries, maxLimit) {
	const pinned = entries.filter((item) => item.pinned);
	const unpinned = entries.filter((item) => !item.pinned);
	if (unpinned.length <= maxLimit) {
		return sortExamples(pinned.concat(unpinned));
	}
	const kept = pinned.concat(unpinned.slice(0, maxLimit));
	return sortExamples(kept);
}

function isLikelyGarbageSentence(text) {
	const t = normalizeText(text);
	if (!t) return true;
	if (t.length < 8 || t.length > 160) return true;
	if (!/\p{L}/u.test(t)) return true;

	// Filter CSS/JS/template-like payloads.
	if (
		/(document\.getElementById|addEventListener|querySelector|function\s*\(|=>|var\s+\w+|const\s+\w+|let\s+\w+|return\s+|class\*=|elementor-|\.share-wrap|display\s*:|font-size\s*:|line-height\s*:)/i.test(
			t
		)
	) {
		return true;
	}
	if (/[.#][a-z0-9_-]+\s*\{[^}]*:[^}]*;[^}]*\}/i.test(t)) return true; // CSS block
	if (/\{[^}]*:[^}]*;[^}]*\}/.test(t) && /;/.test(t)) return true; // style-like object/block

	// Filter common JSON / tracking / query-string fragments.
	if (
		/(https?:\/\/|\\u[0-9a-fA-F]{4}|__typename|item_logging_info|source_as_enum|Y2lkOmU6|&_nc_|"id":|"name":)/i.test(
			t
		)
	) {
		return true;
	}

	// Too many structural chars usually means machine payload.
	const structural = (t.match(/[{}[\]<>="_&]/g) || []).length;
	if (structural / t.length > 0.06) return true;
	const semicolons = (t.match(/;/g) || []).length;
	if (semicolons >= 2) return true;

	// Very long token is often an encoded id / query segment.
	if (/\S{45,}/.test(t)) return true;

	return false;
}

function normalizeForSimilarity(text) {
	return normalizeText(text)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function tokenizeForSimilarity(text) {
	const normalized = normalizeForSimilarity(text);
	return normalized ? normalized.split(" ") : [];
}

function sentenceSimilarity(a, b) {
	const tokensA = tokenizeForSimilarity(a);
	const tokensB = tokenizeForSimilarity(b);
	if (tokensA.length === 0 || tokensB.length === 0) return 0;

	const setA = new Set(tokensA);
	const setB = new Set(tokensB);
	let intersection = 0;
	setA.forEach((token) => {
		if (setB.has(token)) intersection += 1;
	});
	const union = setA.size + setB.size - intersection;
	if (union === 0) return 0;

	const jaccard = intersection / union;
	const lengthRatio = Math.min(tokensA.length, tokensB.length) / Math.max(tokensA.length, tokensB.length);
	return jaccard * 0.75 + lengthRatio * 0.25;
}

function getSimilarityThresholdForPair(a, b) {
	const lenA = tokenizeForSimilarity(a).length;
	const lenB = tokenizeForSimilarity(b).length;
	const minLen = Math.min(lenA, lenB);
	// Short template-like titles should be deduped more aggressively.
	if (minLen <= 4) return 0.62;
	if (minLen <= 6) return 0.74;
	return EXAMPLE_SIMILARITY_THRESHOLD;
}

function isTooSimilarToAny(candidate, pool) {
	for (let i = 0; i < pool.length; i += 1) {
		const threshold = getSimilarityThresholdForPair(candidate, pool[i]);
		if (sentenceSimilarity(candidate, pool[i]) >= threshold) {
			return true;
		}
	}
	return false;
}

function hasContainmentRelation(candidate, pool) {
	const c = normalizeText(candidate).toLowerCase();
	if (!c) return true;
	for (let i = 0; i < pool.length; i += 1) {
		const p = normalizeText(pool[i]).toLowerCase();
		if (!p) continue;
		if (c.includes(p) || p.includes(c)) return true;
	}
	return false;
}

function getContextTextForNode(node) {
	const parentElement = node.parentElement;
	if (!parentElement) return normalizeText(node.nodeValue || "");
	const container = parentElement.closest("p, li, article, section, blockquote, td");
	const text = container ? container.textContent : (parentElement.textContent || node.nodeValue);
	const normalized = normalizeText(text || "");
	if (normalized.length > 2500) return "";
	return normalized;
}

function splitIntoSentences(text) {
	const normalized = normalizeText(text);
	if (!normalized) return [];

	// Prefer language-aware sentence segmentation when available.
	if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
		try {
			const lang =
				document.documentElement.lang ||
				(typeof navigator !== "undefined" ? navigator.language : "en");
			const segmenter = new Intl.Segmenter(lang || "en", { granularity: "sentence" });
			const segments = Array.from(segmenter.segment(normalized), (item) => normalizeText(item.segment));
			const sentences = segments.filter((s) => s.length >= 8);
			if (sentences.length > 0) return sentences;
		} catch (error) {
			// Fallback to regex rules below.
		}
	}

	// Fallback: broader multilingual punctuation, including Arabic and Devanagari.
	const matches =
		normalized.match(/[^.!?。！？؟؛۔\u0964\u0965\n]+[.!?。！？؟؛۔\u0964\u0965]?/g) || [];
	const sentences = matches
		.map((s) => normalizeText(s))
		.filter((s) => !isLikelyGarbageSentence(s));
	if (sentences.length > 0) return sentences;
	return isLikelyGarbageSentence(normalized) ? [] : [normalized];
}

function collectExampleCandidates(bodyTextNodes, storedWordsArray, storedWords) {
	const candidates = {};
	for (let i = 0; i < bodyTextNodes.length; i += 1) {
		const node = bodyTextNodes[i];
		const contextText = getContextTextForNode(node);
		if (!contextText || contextText.length < 8) continue;
		const sentences = splitIntoSentences(contextText);
		if (sentences.length === 0) continue;

		for (let w = 0; w < storedWordsArray.length; w += 1) {
			const word = storedWordsArray[w];
			if (!storedWords[word] || storedWords[word].learned) continue;
			if (!containsWord(contextText, word)) continue;

			for (let s = 0; s < sentences.length; s += 1) {
				const sentence = sentences[s];
				if (!containsWord(sentence, word)) continue;
				if (isLowInformationExample(sentence, word)) continue;
				if (!candidates[word]) candidates[word] = [];
				candidates[word].push({
					text: sentence,
					sourceUrl: location.href,
					capturedAt: Date.now(),
				});
			}
		}
	}
	return candidates;
}

function enqueueExampleCandidates(candidates) {
	const words = Object.keys(candidates);
	if (words.length === 0) return;

	words.forEach((word) => {
		if (!pendingExampleMap[word]) pendingExampleMap[word] = [];
		pendingExampleMap[word] = pendingExampleMap[word].concat(candidates[word]);
	});

	if (exampleMergeTimer) clearTimeout(exampleMergeTimer);
	exampleMergeTimer = setTimeout(async () => {
		const batch = pendingExampleMap;
		pendingExampleMap = {};
		exampleMergeTimer = null;
		try {
			const wordsData = await WordStorage.getWords();
			let changed = false;

				Object.keys(batch).forEach((word) => {
					if (!wordsData[word]) return;
					if (wordsData[word].learned) return;
					const existing = normalizeExampleList(wordsData[word].examples);
				const existingSet = new Set(existing.map((item) => item.text.toLowerCase()));
				const incoming = batch[word]
					.map((item) => {
						const text = normalizeText(item && item.text ? item.text : "");
						if (!text) return null;
						return {
							text,
							sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : "",
							capturedAt: typeof item.capturedAt === "number" ? item.capturedAt : Date.now(),
						};
					})
					.filter((item) => !!item);
				const newOnes = [];
				const comparisonPool = existing.map((item) => item.text);

					for (let i = incoming.length - 1; i >= 0; i -= 1) {
						const sample = incoming[i];
						if (isLowInformationExample(sample.text, word)) continue;
						const key = sample.text.toLowerCase();
						if (existingSet.has(key)) {
						for (let e = 0; e < existing.length; e += 1) {
							const existingItem = existing[e];
							if (existingItem.text.toLowerCase() !== key) continue;
							let touched = false;
							if (!existingItem.sourceUrl && sample.sourceUrl) {
								existingItem.sourceUrl = sample.sourceUrl;
								touched = true;
							}
							if (!existingItem.capturedAt && sample.capturedAt) {
								existingItem.capturedAt = sample.capturedAt;
								if (!existingItem.createdAt) existingItem.createdAt = sample.capturedAt;
								touched = true;
							}
							if (touched) changed = true;
							break;
						}
						continue;
						}
						if (newOnes.find((x) => x.text.toLowerCase() === key)) continue;
						if (hasContainmentRelation(sample.text, comparisonPool)) continue;
						if (isTooSimilarToAny(sample.text, comparisonPool)) continue;
						newOnes.push(sample);
						comparisonPool.push(sample.text);
					}

					if (newOnes.length === 0) return;
					const merged = newOnes.map((item, index) => ({
						text: item.text,
						pinned: false,
					createdAt: item.capturedAt || (Date.now() + index),
					sourceUrl: item.sourceUrl || "",
					capturedAt: item.capturedAt || 0,
				})).concat(existing);
					wordsData[word].examples = enforceExampleLimit(
						sortExamples(merged),
						MAX_EXAMPLES_PER_WORD
					);
					const prevCount =
						typeof wordsData[word].encounterCount === "number"
							? wordsData[word].encounterCount
							: 0;
					const nextCount = prevCount + newOnes.length;
					const currentExampleCount = Array.isArray(wordsData[word].examples)
						? wordsData[word].examples.length
						: 0;
					wordsData[word].encounterCount = Math.max(nextCount, currentExampleCount);

					const existingPageKeys = Array.isArray(wordsData[word].encounterPageKeys)
						? wordsData[word].encounterPageKeys.filter((x) => typeof x === "string" && x)
						: [];
					const pageKeySet = new Set(existingPageKeys);
					const currentPageKey = normalizePageKey(location.href);
					let newPageHits = 0;
					// DF rule: only +1 when this page contributes at least one NEW example.
					if (newOnes.length > 0 && currentPageKey && !pageKeySet.has(currentPageKey)) {
						pageKeySet.add(currentPageKey);
						newPageHits = 1;
					}
					wordsData[word].encounterPageKeys = Array.from(pageKeySet).slice(-300);
					const prevPageCount =
						typeof wordsData[word].pageCount === "number"
							? wordsData[word].pageCount
							: getDerivedPageCountFromExamples(wordsData[word]);
					const derivedPageCount = getDerivedPageCountFromExamples(wordsData[word]);
					wordsData[word].pageCount = Math.max(prevPageCount + newPageHits, derivedPageCount);
					changed = true;
				});

			if (changed) {
				await WordStorage.saveWords(wordsData);
			}
		} catch (error) {
			console.error("Failed to merge examples:", error);
		}
	}, 1200);
}

function highlightWords() {
	isCurrentDomainExcluded().then((excluded) => {
		if (excluded) return;
	WordStorage.getWords().then((storedWords) => {
		// sort storedWords by length from long to short
		const storedWordsArray = Object.keys(storedWords);
		storedWordsArray.sort((a, b) => b.length - a.length);
		const bodyTextNodes = findTextNodes(document.body);
		const replacements = [];
		const exampleCandidates = collectExampleCandidates(
			bodyTextNodes,
			storedWordsArray,
			storedWords
		);

		// 收集需要替换的信息 old
		// bodyTextNodes.forEach((node) => {
		// 	const checked_words = [];
		// 	const words = node.nodeValue.split(/\s+/);
		// 	let newNodeValue = node.nodeValue;
		// 	words.forEach((word) => {
		// 		const lowerCaseWord = word.toLowerCase();
		// 		if (checked_words.includes(lowerCaseWord)) {
		// 			return;
		// 		}
		// 		if (
		// 			lowerCaseWord.length >= 3 &&
		// 			storedWords[lowerCaseWord] &&
		// 			!storedWords[lowerCaseWord].learned
		// 		) {
		// 			const regex = new RegExp(`\\b${word}\\b`, "gi");
		// 			const replacementHtml = createHighlightSpan(
		// 				word,
		// 				storedWords[lowerCaseWord].meaning
		// 			).outerHTML;
		// 			newNodeValue = newNodeValue.replace(regex, replacementHtml);
		// 		}
		// 		checked_words.push(lowerCaseWord);
		// 	});
		// 	if (newNodeValue !== node.nodeValue) {
		// 		replacements.push({ node, newNodeValue });
		// 	}
		// });

		// 收集需要替换的信息（安全 DOM 组装，不使用 innerHTML）
		bodyTextNodes.forEach((node) => {
			const fragment = buildHighlightedFragment(
				node.nodeValue,
				storedWordsArray,
				storedWords
			);
			if (fragment) {
				replacements.push({ node, fragment });
			}
		});

		// 执行 DOM 更新
		replacements.forEach(({ node, fragment }) => {
			const parent = node.parentNode;
			if (!parent) return;
			parent.insertBefore(fragment, node);
			parent.removeChild(node);
		});
		enqueueExampleCandidates(exampleCandidates);
		addClickEventToHighlightedWords();
		if (!contentTourAttempted && document.querySelector(".plugin-highlight-word")) {
			contentTourAttempted = true;
			window.setTimeout(() => startContentTour(false), 260);
		}
		}).catch((error) => {
			if (!isContextInvalidatedError(error)) {
				console.error("Failed to highlight words:", error);
			}
		});
		});
	}

function buildHighlightedFragment(text, storedWordsArray, storedWords) {
	const lowerText = text.toLowerCase();
	let cursor = 0;
	let hasMatch = false;
	const fragment = document.createDocumentFragment();

	while (cursor < text.length) {
		let bestWord = null;
		let bestIndex = -1;

		for (let i = 0; i < storedWordsArray.length; i += 1) {
			const word = storedWordsArray[i];
			if (!storedWords[word] || storedWords[word].learned) continue;
			const idx = findNextWholeWordIndex(text, lowerText, word, cursor);
			if (idx === -1) continue;
			if (bestIndex === -1 || idx < bestIndex || (idx === bestIndex && word.length > bestWord.length)) {
				bestIndex = idx;
				bestWord = word;
			}
		}

		if (bestIndex === -1 || !bestWord) break;

		if (bestIndex > cursor) {
			fragment.appendChild(document.createTextNode(text.slice(cursor, bestIndex)));
		}

			const matchedText = text.slice(bestIndex, bestIndex + bestWord.length);
			fragment.appendChild(
				createHighlightSpan(
					matchedText,
					storedWords[bestWord].meaning,
					Array.isArray(storedWords[bestWord].examples)
						? storedWords[bestWord].examples
						: []
				)
			);
		hasMatch = true;
		cursor = bestIndex + bestWord.length;
	}

	if (!hasMatch) return null;
	if (cursor < text.length) {
		fragment.appendChild(document.createTextNode(text.slice(cursor)));
	}
	return fragment;
}

// 查找文本节点
function findTextNodes(element) {
	let textNodes = [];
	if (element) {
		if (
			element.nodeType === Node.ELEMENT_NODE &&
			(SKIP_TEXT_TAGS.has(element.tagName) || isExtensionUiElement(element))
		) {
			return textNodes;
		}
		element.childNodes.forEach((node) => {
			if (
				node.nodeType === Node.TEXT_NODE &&
				node.nodeValue.trim().length >= 2 &&
				!(node.parentElement && isExtensionUiElement(node.parentElement))
			) {
				textNodes.push(node);
			} else {
				textNodes = textNodes.concat(findTextNodes(node));
			}
		});
	}
	return textNodes;
}

// 为高亮单词添加点击事件监听器的函数
function addClickEventToHighlightedWords() {
	document.querySelectorAll(".plugin-highlight-word").forEach((span) => {
		span.addEventListener("click", () => markLearned(span.textContent));
	});
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === "openAddWordModal" && request.word) {
		showAddWordModal(request.word);
		sendResponse({ ok: true });
	}
});

function showAddWordModal(word) {
	ensureAddWordModalStyle();
	if (addWordModal) addWordModal.remove();

	const normalizedWord = word.trim().toLowerCase();
	const overlay = document.createElement("div");
	overlay.className = "la-addword-overlay";

	const modal = document.createElement("div");
	modal.className = "la-addword-modal";

	const title = document.createElement("h3");
	title.className = "la-addword-title";
	title.textContent = contentT("add_word_title");

	const wordLine = document.createElement("div");
	wordLine.className = "la-addword-word";
	wordLine.textContent = normalizedWord;

	const hint = document.createElement("div");
	hint.className = "la-addword-hint";
	hint.textContent = contentT("add_word_hint");

	const lemmaNotice = document.createElement("div");
	lemmaNotice.className = "la-addword-lemma";
	lemmaNotice.style.display = "none";

	const lemmaText = document.createElement("div");
	lemmaText.className = "la-addword-lemma-text";

	const lemmaBtn = document.createElement("button");
	lemmaBtn.type = "button";
	lemmaBtn.className = "la-addword-lemma-btn";
	applyModalButtonStyle(lemmaBtn, "lemma");

	lemmaNotice.appendChild(lemmaText);
	lemmaNotice.appendChild(lemmaBtn);

	const input = document.createElement("textarea");
	input.className = "la-addword-input";
	input.placeholder = contentT("loading_translation");
	input.rows = 3;
	applyModalTextareaStyle(input);
	let userEdited = false;

	const dictPreview = document.createElement("div");
	dictPreview.className = "la-addword-dict";
	dictPreview.style.display = "none";

	const dictTitle = document.createElement("div");
	dictTitle.className = "la-addword-dict-title";
	dictTitle.textContent = "Dictionary";

	const dictList = document.createElement("div");
	dictList.className = "la-addword-dict-list";

	dictPreview.appendChild(dictTitle);
	dictPreview.appendChild(dictList);

	const footer = document.createElement("div");
	footer.className = "la-addword-footer";

	const cancelBtn = document.createElement("button");
	cancelBtn.className = "la-addword-btn la-addword-cancel";
	cancelBtn.textContent = contentT("cancel");
	applyModalButtonStyle(cancelBtn, "cancel");

	const saveBtn = document.createElement("button");
	saveBtn.className = "la-addword-btn la-addword-save";
	saveBtn.textContent = contentT("save");
	applyModalButtonStyle(saveBtn, "save");

	footer.appendChild(cancelBtn);
	footer.appendChild(saveBtn);
	modal.appendChild(title);
	modal.appendChild(wordLine);
	modal.appendChild(hint);
	modal.appendChild(lemmaNotice);
	modal.appendChild(input);
	modal.appendChild(dictPreview);
	modal.appendChild(footer);
	overlay.appendChild(modal);
	document.body.appendChild(overlay);
	addWordModal = overlay;
	overlay.dataset.targetWord = normalizedWord;
	input.focus();
	input.addEventListener("input", () => {
		userEdited = true;
	});

	function getTargetWord() {
		return (overlay.dataset.targetWord || normalizedWord).trim().toLowerCase();
	}

	function updateWordLine() {
		const targetWord = getTargetWord();
		wordLine.textContent = targetWord;
		if (targetWord !== normalizedWord) {
			hint.textContent = `${contentT("add_word_hint")} (${contentT("using_lemma")}: ${targetWord})`;
			return;
		}
		hint.textContent = contentT("add_word_hint");
	}

	function setLemmaMode(useLemma, lemmaValue) {
		const normalizedLemma = (lemmaValue || "").trim().toLowerCase();
		if (!normalizedLemma || normalizedLemma === normalizedWord) {
			overlay.dataset.targetWord = normalizedWord;
			updateWordLine();
			return;
		}
		overlay.dataset.targetWord = useLemma ? normalizedLemma : normalizedWord;
		updateWordLine();
		lemmaBtn.textContent = useLemma ? contentT("use_original") : contentT("use_lemma");
	}

	function closeModal() {
		overlay.remove();
		if (addWordModal === overlay) addWordModal = null;
		document.removeEventListener("keydown", onKeyDown, true);
	}

	function onKeyDown(event) {
		if (event.key === "Escape") closeModal();
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "enter") saveWord();
	}

async function saveWord() {
		const meaning = input.value.trim();
		if (!meaning) return;
		try {
			const words = await WordStorage.getWords();
			const targetWord = getTargetWord();
			const existing = words[targetWord] || words[normalizedWord];
			let dictEntries = [];
			try {
				dictEntries = JSON.parse(overlay.dataset.dictEntries || "[]");
				if (!Array.isArray(dictEntries)) dictEntries = [];
			} catch (error) {
				dictEntries = [];
			}
			const selectedIndexRaw = Number(overlay.dataset.dictSelectedIndex || "0");
			const selectedIndex =
				Number.isInteger(selectedIndexRaw) && selectedIndexRaw >= 0
					? selectedIndexRaw
					: 0;
			const dictPosValue = (overlay.dataset.dictPos || "").trim();
			const dictDefinitionOriginal = (overlay.dataset.dictDefinitionOriginal || "").trim();
			const dictDefinitionTranslated = (overlay.dataset.dictDefinitionTranslated || "").trim();
			const dictSource = (overlay.dataset.dictSource || "").trim();
			const dictionary =
				dictPosValue || dictDefinitionOriginal || dictDefinitionTranslated || dictEntries.length > 0
					? {
						pos: dictPosValue,
						definitionOriginal: dictDefinitionOriginal,
						definitionTranslated: dictDefinitionTranslated,
						source: dictSource || "dictionary",
						usedLemma: overlay.dataset.dictUsedLemma === "1",
						lookupLemma: (overlay.dataset.dictLookupLemma || "").trim(),
						queryText: (overlay.dataset.dictQueryText || "").trim(),
						entries: dictEntries,
						selectedIndex: Math.min(selectedIndex, Math.max(dictEntries.length - 1, 0)),
						updatedAt: Date.now(),
					}
					: (existing && existing.dictionary ? existing.dictionary : null);
			words[targetWord] = {
				meaning: meaning,
				learned: false,
				createdAt: existing && existing.createdAt ? existing.createdAt : Date.now(),
				lemma: (overlay.dataset.lemma || "").trim() || (existing && typeof existing.lemma === "string" ? existing.lemma : ""),
				dictionary: dictionary,
			};
			await WordStorage.saveWords(words);
			closeModal();
		} catch (error) {
			console.error("Failed to save word:", error);
		}
	}

	cancelBtn.addEventListener("click", closeModal);
	saveBtn.addEventListener("click", saveWord);
	overlay.addEventListener("click", (event) => {
		if (event.target === overlay) closeModal();
	});
	document.addEventListener("keydown", onKeyDown, true);
	prefillMeaningFromTranslation(
		normalizedWord,
		wordLine,
		input,
		() => userEdited,
		overlay,
		(dictPayload) => {
			const sections = dictPayload && Array.isArray(dictPayload.sections)
				? dictPayload.sections
				: [];
			const hasAnyEntries = sections.some((section) => Array.isArray(section.entries) && section.entries.length > 0);
			if (!hasAnyEntries) {
				dictPreview.style.display = "none";
				return;
			}
			dictPreview.style.display = "block";
			dictTitle.textContent = contentT("dictionary");
			const availableLemma = String((dictPayload && dictPayload.lemma) || overlay.dataset.lemma || "").trim().toLowerCase();
			if (availableLemma && availableLemma !== normalizedWord) {
				lemmaNotice.style.display = "";
				lemmaText.textContent = `${contentT("lemma_available")}: ${availableLemma}`;
				lemmaBtn.textContent = contentT("use_lemma");
				lemmaBtn.onclick = () => {
					const usingLemma = getTargetWord() === availableLemma;
					setLemmaMode(!usingLemma, availableLemma);
				};
			} else {
				lemmaNotice.style.display = "none";
				lemmaBtn.onclick = null;
				setLemmaMode(false, "");
			}
			dictList.innerHTML = "";
			sections.forEach((section, sectionIndex) => {
				const sectionWrap = document.createElement("div");
				sectionWrap.className = "la-addword-dict-section";
				if (sectionIndex > 0) sectionWrap.classList.add("is-secondary");

				const sectionTitle = document.createElement("div");
				sectionTitle.className = "la-addword-dict-section-title";
				sectionTitle.textContent = `${getDictionarySectionLabel(section.mode, section.query)} · ${getDictionarySourceLabel(section.source)}`;
				sectionWrap.appendChild(sectionTitle);

				if (!Array.isArray(section.entries) || section.entries.length === 0) {
					const empty = document.createElement("div");
					empty.className = "la-addword-dict-original";
					empty.textContent = contentT("no_dict_entries");
					sectionWrap.appendChild(empty);
					dictList.appendChild(sectionWrap);
					return;
				}

				section.entries.forEach((item, index) => {
					const row = document.createElement("div");
					row.className = "la-addword-dict-item";
					if (sectionIndex === 0 && index === 0) row.classList.add("is-selected");

					const bodyWrap = document.createElement("div");
					bodyWrap.className = "la-addword-dict-body";

					const pos = document.createElement("div");
					pos.className = "la-addword-dict-pos";
					pos.textContent = item.pos ? `[${item.pos}]` : "";

					const original = document.createElement("div");
					original.className = "la-addword-dict-original";
					original.textContent = item.definitionOriginal;

					const translated = document.createElement("div");
					translated.className = "la-addword-dict-translated";
					translated.textContent = item.definitionTranslated || "";

					const applyBtn = document.createElement("button");
					applyBtn.type = "button";
					applyBtn.className = "la-addword-dict-apply";
					applyBtn.textContent = contentT("apply");
					applyModalButtonStyle(applyBtn, "apply");
					applyBtn.addEventListener("click", () => {
						const composed = item.definitionTranslated || item.definitionOriginal || "";
						const text = item.pos ? `[${item.pos}] ${composed}` : composed;
						if (text.trim()) input.value = text.trim();
						userEdited = true;
						overlay.dataset.dictPos = item.pos || "";
						overlay.dataset.dictDefinitionOriginal = item.definitionOriginal || "";
						overlay.dataset.dictDefinitionTranslated = item.definitionTranslated || "";
						overlay.dataset.dictSource = section.source || "dictionary";
						overlay.dataset.dictUsedLemma = section.mode === "lemma" ? "1" : "";
						overlay.dataset.dictLookupLemma = section.mode === "lemma" ? (section.query || "") : "";
						overlay.dataset.dictQueryText = section.query || "";
						overlay.dataset.dictSelectedIndex = String(index);
						dictList.querySelectorAll(".la-addword-dict-item").forEach((node) => {
							node.classList.remove("is-selected");
						});
						row.classList.add("is-selected");
					});

					bodyWrap.appendChild(pos);
					bodyWrap.appendChild(original);
					bodyWrap.appendChild(translated);
					row.appendChild(bodyWrap);
					row.appendChild(applyBtn);
					sectionWrap.appendChild(row);
				});
				dictList.appendChild(sectionWrap);
			});
		}
	);
	updateWordLine();
}

function ensureAddWordModalStyle() {
	if (document.getElementById("laAddWordStyle")) return;
	const style = document.createElement("style");
	style.id = "laAddWordStyle";
	style.textContent = `
		.la-addword-overlay {
			position: fixed;
			inset: 0;
			background: rgba(83, 61, 50, 0.24);
			z-index: 2147483646;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 16px;
			animation: laFadeIn 140ms ease-out;
		}
		.la-addword-modal {
			width: min(520px, 96vw);
			background: #fffaf3;
			border: 1px solid #dccabd;
			border-radius: 18px 15px 20px 16px;
			box-shadow: 0 18px 30px rgba(88, 63, 50, 0.16);
			padding: 16px;
			color: #34251f;
			font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
			animation: laRiseIn 170ms ease-out;
		}
		.la-addword-title {
			margin: 0;
			font-size: 18px;
			font-weight: 800;
			font-family: "Noto Serif TC", "Hiragino Mincho ProN", "Yu Mincho", serif;
		}
		.la-addword-modal button,
		.la-addword-modal textarea,
		.la-confirm-modal button {
			all: unset;
			box-sizing: border-box;
			font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
			line-height: 1.4;
			letter-spacing: normal;
			text-transform: none;
			-webkit-appearance: none;
			appearance: none;
		}
		.la-addword-word {
			margin-top: 8px;
			font-size: 14px;
			font-weight: 700;
			color: #8f5143;
		}
		.la-addword-hint {
			margin-top: 10px;
			font-size: 12px;
			color: #7b655b;
		}
		.la-addword-lemma {
			margin-top: 8px;
			padding: 8px 10px;
			border: 1px dashed #dcc8b8;
			border-radius: 12px 10px 14px 10px;
			background: #fff8f1;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
		}
		.la-addword-lemma-text {
			font-size: 12px;
			line-height: 1.45;
			color: #7a6258;
		}
		.la-addword-modal .la-addword-lemma-btn {
			display: inline-flex !important;
			align-items: center !important;
			justify-content: center !important;
			min-height: 32px !important;
			border: 1px solid #dcc8b8 !important;
			border-radius: 10px 9px 11px 8px !important;
			padding: 5px 9px !important;
			font-size: 11px !important;
			font-weight: 700 !important;
			cursor: pointer !important;
			background-color: #fffdf9 !important;
			color: #8a5f50 !important;
			flex: 0 0 auto !important;
			text-decoration: none !important;
		}
		.la-addword-input {
			display: block;
			width: 100%;
			margin-top: 8px;
			border: 1px solid #dccabd;
			border-radius: 14px 12px 16px 11px;
			padding: 10px;
			font-size: 14px;
			line-height: 1.4;
			resize: vertical;
			outline: none;
		}
		.la-addword-input:focus {
			border-color: #a55143;
			box-shadow: 0 0 0 3px rgba(165, 81, 67, 0.12);
		}
		.la-addword-footer {
			margin-top: 12px;
			display: flex;
			justify-content: flex-end;
			gap: 8px;
		}
		.la-addword-dict {
			margin-top: 10px;
			padding: 8px 10px;
			border: 1px solid #e2d3c6;
			border-radius: 14px 12px 16px 11px;
			background: #fffdf9;
		}
		.la-addword-dict-title {
			font-size: 11px;
			font-weight: 700;
			color: #8b6c53;
		}
		.la-addword-dict-list {
			display: grid;
			gap: 8px;
			margin-top: 6px;
		}
		.la-addword-dict-section {
			display: grid;
			gap: 8px;
		}
		.la-addword-dict-section.is-secondary {
			padding-top: 8px;
			border-top: 1px dashed #e2d3c6;
		}
		.la-addword-dict-section-title {
			font-size: 11px;
			font-weight: 800;
			color: #8b6c53;
		}
		.la-addword-dict-item {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: end;
			column-gap: 10px;
			border: 1px solid #ded0c3;
			border-radius: 12px 10px 14px 10px;
			background: #fffaf5;
			padding: 6px 8px;
		}
		.la-addword-dict-item.is-selected {
			border-color: #a55143;
			box-shadow: 0 0 0 2px rgba(165, 81, 67, 0.12);
		}
		.la-addword-dict-body {
			min-width: 0;
		}
		.la-addword-dict-pos {
			font-size: 10px;
			color: #8c7567;
		}
		.la-addword-dict-original {
			margin-top: 2px;
			font-size: 12px;
			line-height: 1.45;
			color: #5a473d;
		}
		.la-addword-dict-translated {
			margin-top: 3px;
			font-size: 12px;
			line-height: 1.45;
			color: #6d5d56;
			border-left: 2px solid #ddd0c2;
			padding-left: 6px;
		}
		.la-addword-modal .la-addword-dict-apply {
			display: inline-flex !important;
			align-items: center !important;
			justify-content: center !important;
			align-self: end !important;
			margin-top: 0 !important;
			margin-bottom: 1px !important;
			min-height: 32px !important;
			min-width: 52px !important;
			border: 0 !important;
			border-radius: 10px 9px 11px 8px !important;
			padding: 4px 8px !important;
			font-size: 11px !important;
			font-weight: 700 !important;
			cursor: pointer !important;
			background-color: #b26b54 !important;
			color: #fffaf3 !important;
			text-decoration: none !important;
		}
		@media (max-width: 460px) {
			.la-addword-dict-item {
				grid-template-columns: 1fr;
				row-gap: 8px;
			}
			.la-addword-modal .la-addword-dict-apply {
				justify-self: start !important;
			}
		}
		.la-addword-modal .la-addword-btn {
			display: inline-flex !important;
			align-items: center !important;
			justify-content: center !important;
			min-height: 40px !important;
			border: 1px solid #d8c7b8 !important;
			border-radius: 12px 10px 14px 10px !important;
			padding: 8px 12px !important;
			font-size: 13px !important;
			font-weight: 700 !important;
			cursor: pointer !important;
			text-decoration: none !important;
		}
		.la-addword-modal .la-addword-cancel {
			background-color: #f4eadf !important;
			color: #7a6155 !important;
		}
		.la-addword-modal .la-addword-save {
			background-color: #a55143 !important;
			border-color: #9a5b49 !important;
			color: #fffaf3 !important;
		}
		.la-confirm-overlay {
			position: fixed;
			inset: 0;
			background: rgba(83, 61, 50, 0.24);
			z-index: 2147483646;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 16px;
			animation: laFadeIn 140ms ease-out;
		}
		.la-confirm-modal {
			width: min(420px, 94vw);
			background: #fffaf3;
			border: 1px solid #dccabd;
			border-radius: 18px 15px 20px 16px;
			box-shadow: 0 18px 30px rgba(88, 63, 50, 0.16);
			padding: 16px;
			color: #34251f;
			font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
			animation: laRiseIn 170ms ease-out;
		}
		.la-confirm-title {
			margin: 0 0 8px 0;
			font-size: 16px;
			font-weight: 800;
			font-family: "Noto Serif TC", "Hiragino Mincho ProN", "Yu Mincho", serif;
		}
		.la-confirm-desc {
			margin: 0;
			font-size: 13px;
			color: #7b655b;
			line-height: 1.45;
		}
		.la-confirm-footer {
			margin-top: 14px;
			display: flex;
			justify-content: flex-end;
			gap: 8px;
		}
		.la-confirm-modal .la-confirm-btn {
			display: inline-flex !important;
			align-items: center !important;
			justify-content: center !important;
			min-height: 40px !important;
			border: 1px solid #d8c7b8 !important;
			border-radius: 12px 10px 14px 10px !important;
			padding: 8px 12px !important;
			font-size: 13px !important;
			font-weight: 700 !important;
			cursor: pointer !important;
			text-decoration: none !important;
		}
		.la-confirm-modal .la-confirm-cancel {
			background-color: #f4eadf !important;
			color: #7a6155 !important;
		}
		.la-confirm-modal .la-confirm-ok {
			background-color: #a55143 !important;
			border-color: #9a5b49 !important;
			color: #fffaf3 !important;
		}
		@keyframes laFadeIn {
			from { opacity: 0; }
			to { opacity: 1; }
		}
		@keyframes laRiseIn {
			from { opacity: 0; transform: translateY(8px) scale(0.985); }
			to { opacity: 1; transform: translateY(0) scale(1); }
		}
	`;
	document.head.appendChild(style);
}

function applyModalControlBaseStyle(element) {
	element.style.setProperty("box-sizing", "border-box", "important");
	element.style.setProperty("font-family", '"Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif', "important");
	element.style.setProperty("line-height", "1.4", "important");
	element.style.setProperty("letter-spacing", "normal", "important");
	element.style.setProperty("text-transform", "none", "important");
	element.style.setProperty("text-decoration", "none", "important");
	element.style.setProperty("appearance", "none", "important");
	element.style.setProperty("-webkit-appearance", "none", "important");
	element.style.setProperty("background-image", "none", "important");
	element.style.setProperty("box-shadow", "none", "important");
	element.style.setProperty("outline", "none", "important");
}

function applyModalButtonStyle(button, variant) {
	applyModalControlBaseStyle(button);
	button.type = button.type || "button";
	button.style.setProperty("display", "inline-flex", "important");
	button.style.setProperty("align-items", "center", "important");
	button.style.setProperty("justify-content", "center", "important");
	button.style.setProperty("vertical-align", "middle", "important");
	button.style.setProperty("cursor", "pointer", "important");
	button.style.setProperty("user-select", "none", "important");
	button.style.setProperty("white-space", "nowrap", "important");
	button.style.setProperty("font-weight", "700", "important");
	button.style.setProperty("margin", "0", "important");

	const presetMap = {
		lemma: {
			minHeight: "32px",
			padding: "5px 9px",
			fontSize: "11px",
			border: "1px solid #dcc8b8",
			borderRadius: "10px 9px 11px 8px",
			backgroundColor: "#fffdf9",
			color: "#8a5f50"
		},
		apply: {
			minHeight: "32px",
			padding: "4px 8px",
			fontSize: "11px",
			border: "0 solid transparent",
			borderRadius: "10px 9px 11px 8px",
			backgroundColor: "#b26b54",
			color: "#fffaf3",
			marginTop: "6px"
		},
		cancel: {
			minHeight: "40px",
			padding: "8px 12px",
			fontSize: "13px",
			border: "1px solid #d8c7b8",
			borderRadius: "12px 10px 14px 10px",
			backgroundColor: "#f4eadf",
			color: "#7a6155"
		},
		save: {
			minHeight: "40px",
			padding: "8px 12px",
			fontSize: "13px",
			border: "1px solid #9a5b49",
			borderRadius: "12px 10px 14px 10px",
			backgroundColor: "#a55143",
			color: "#fffaf3"
		},
		confirmCancel: {
			minHeight: "40px",
			padding: "8px 12px",
			fontSize: "13px",
			border: "1px solid #d8c7b8",
			borderRadius: "12px 10px 14px 10px",
			backgroundColor: "#f4eadf",
			color: "#7a6155"
		},
		confirmOk: {
			minHeight: "40px",
			padding: "8px 12px",
			fontSize: "13px",
			border: "1px solid #9a5b49",
			borderRadius: "12px 10px 14px 10px",
			backgroundColor: "#a55143",
			color: "#fffaf3"
		}
	};

	const preset = presetMap[variant];
	if (!preset) return;
	for (const [key, value] of Object.entries(preset)) {
		const cssProperty = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
		button.style.setProperty(cssProperty, value, "important");
	}
}

function applyModalTextareaStyle(textarea) {
	applyModalControlBaseStyle(textarea);
	textarea.style.setProperty("display", "block", "important");
	textarea.style.setProperty("width", "100%", "important");
	textarea.style.setProperty("margin-top", "8px", "important");
	textarea.style.setProperty("border", "1px solid #dccabd", "important");
	textarea.style.setProperty("border-radius", "14px 12px 16px 11px", "important");
	textarea.style.setProperty("padding", "10px", "important");
	textarea.style.setProperty("font-size", "14px", "important");
	textarea.style.setProperty("background-color", "#fffdf9", "important");
	textarea.style.setProperty("color", "#34251f", "important");
	textarea.style.setProperty("resize", "vertical", "important");
	textarea.style.setProperty("white-space", "pre-wrap", "important");
	textarea.style.setProperty("min-height", "92px", "important");
}

function showConfirmModal(message) {
	ensureAddWordModalStyle();
	if (confirmModal) confirmModal.remove();

	return new Promise((resolve) => {
		const overlay = document.createElement("div");
		overlay.className = "la-confirm-overlay";

		const modal = document.createElement("div");
		modal.className = "la-confirm-modal";

		const title = document.createElement("h3");
		title.className = "la-confirm-title";
		title.textContent = contentT("confirm_action");

		const desc = document.createElement("p");
		desc.className = "la-confirm-desc";
		desc.textContent = message;

		const footer = document.createElement("div");
		footer.className = "la-confirm-footer";

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "la-confirm-btn la-confirm-cancel";
		cancelBtn.textContent = contentT("cancel");
		applyModalButtonStyle(cancelBtn, "confirmCancel");

		const okBtn = document.createElement("button");
		okBtn.className = "la-confirm-btn la-confirm-ok";
		okBtn.textContent = contentT("confirm");
		applyModalButtonStyle(okBtn, "confirmOk");

		footer.appendChild(cancelBtn);
		footer.appendChild(okBtn);
		modal.appendChild(title);
		modal.appendChild(desc);
		modal.appendChild(footer);
		overlay.appendChild(modal);
		document.body.appendChild(overlay);
		confirmModal = overlay;

		function close(value) {
			overlay.remove();
			if (confirmModal === overlay) confirmModal = null;
			document.removeEventListener("keydown", onKeyDown, true);
			resolve(value);
		}

		function onKeyDown(event) {
			if (event.key === "Escape") close(false);
			if (event.key === "Enter") close(true);
		}

		cancelBtn.addEventListener("click", () => close(false));
		okBtn.addEventListener("click", () => close(true));
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) close(false);
		});
		document.addEventListener("keydown", onKeyDown, true);
		okBtn.focus();
	});
}

function prefillMeaningFromTranslation(word, wordLineEl, inputEl, isUserEdited, modalOverlay, onDictionaryReady) {
	Promise.all([
		WordStorage.getSourceLang(),
		WordStorage.getDictionaryLookupEnabled().catch(() => true),
	]).then(async ([sourceLang, dictionaryEnabled]) => {
		const lemmaInfo = await resolveLemma(word, sourceLang || "auto").catch(() => ({
			query: normalizeDictionaryQuery(word),
			lemma: "",
			effectiveQuery: normalizeDictionaryQuery(word),
		}));
		if (modalOverlay.isConnected) {
			modalOverlay.dataset.lemma = lemmaInfo.lemma || "";
		}
		chrome.runtime.sendMessage(
			{ action: "translate", text: word, sourceLang: sourceLang || "auto" },
			(response) => {
				if (!modalOverlay.isConnected) return;
				if (chrome.runtime.lastError) {
					inputEl.placeholder = contentT("meaning_placeholder");
					return;
				}
				const translated = response && response.translation ? response.translation.trim() : "";
				if (translated && !isUserEdited() && inputEl.value.trim() === "") {
					inputEl.value = translated;
				}
				inputEl.placeholder = contentT("meaning_placeholder");
			}
		);

		const dictQuery = normalizeDictionaryQuery(word);
		if (!(dictionaryEnabled && supportsDictionaryBySourceLang(sourceLang) && shouldLookupDictionaryQuery(dictQuery))) return;
		chrome.runtime.sendMessage(
			{ action: "lookupDictionary", text: dictQuery, sourceLang: sourceLang || "auto" },
			async (dictResponse) => {
				if (!modalOverlay.isConnected) return;
				if (chrome.runtime.lastError || !dictResponse || !dictResponse.found) return;
				const mappedSections = await mapDictionarySections(dictResponse, sourceLang || "auto");
				if (!modalOverlay.isConnected) return;
				const nonEmptySections = mappedSections.filter((section) => Array.isArray(section.entries) && section.entries.length > 0);
				if (nonEmptySections.length === 0) return;
				const firstSection = nonEmptySections[0];
				const first = firstSection.entries[0];
				if (!first) return;
				modalOverlay.dataset.dictPos = first.pos || "";
				modalOverlay.dataset.dictDefinitionOriginal = first.definitionOriginal || "";
				modalOverlay.dataset.dictDefinitionTranslated = first.definitionTranslated || "";
				modalOverlay.dataset.dictSource = firstSection.source || "dictionary";
				modalOverlay.dataset.dictEntries = JSON.stringify(firstSection.entries);
				modalOverlay.dataset.dictSelectedIndex = "0";
				modalOverlay.dataset.dictUsedLemma = firstSection.mode === "lemma" ? "1" : "";
				modalOverlay.dataset.dictLookupLemma = firstSection.mode === "lemma" ? (firstSection.query || "") : "";
				modalOverlay.dataset.dictQueryText = firstSection.query || dictQuery;
				if (typeof onDictionaryReady === "function") {
					onDictionaryReady({
						source: dictResponse.source || firstSection.source || "dictionary",
						usedLemma: !!dictResponse.usedLemma,
						lemma: dictResponse.lemma || "",
						query: dictResponse.query || dictQuery,
						sections: mappedSections,
					});
				}
			}
		);
	}).catch(() => {
		inputEl.placeholder = contentT("meaning_placeholder");
	});
}

// 勾选后自动翻译
document.addEventListener("mouseup", function () {
	const selectedText = window.getSelection().toString().trim();
	if (!(selectedText.length > 0 && selectedText.length <= 800)) return;
	WordStorage.getAutoTranslateOnSelect().then((enabled) => {
		if (enabled) translateText(selectedText);
	}).catch((error) => {
		if (!isContextInvalidatedError(error)) {
			console.error("Failed to read auto-translate setting:", error);
		}
		translateText(selectedText);
	});
});

function translateText(text) {
	shouldSkipTranslateAndDictionary(text).then((shouldSkip) => {
		if (shouldSkip) return;
		return Promise.all([
		WordStorage.getSourceLang(),
		WordStorage.getDictionaryLookupEnabled().catch(() => true),
	]).then(([sourceLang, dictionaryEnabled]) => {
		const isSingleWord = !/\s/.test((text || "").trim());
		chrome.runtime.sendMessage(
			{ action: "translate", text: text, sourceLang: sourceLang },
			function (response) {
				const translation = response && response.translation ? response.translation : "";
				showTranslation(translation);
				const dictQuery = normalizeDictionaryQuery(text);
				if (!(dictionaryEnabled && isSingleWord && supportsDictionaryBySourceLang(sourceLang) && shouldLookupDictionaryQuery(dictQuery))) return;
				chrome.runtime.sendMessage(
					{ action: "lookupDictionary", text: dictQuery, sourceLang: sourceLang || "auto" },
					(dictResponse) => {
						if (chrome.runtime.lastError || !dictResponse || !dictResponse.found) return;
						appendDictionaryToTranslationBox(dictResponse, sourceLang || "auto");
					}
				);
			}
		);
		});
	}).catch((error) => {
		if (!isContextInvalidatedError(error)) {
			console.error("Failed to get source language:", error);
		}
	});
}

function showTranslation(translation) {
	ensureTranslationUiStyles();

	// 先检查并移除已存在的浮动框
	const existingBox = document.getElementById("translationBox");
	if (existingBox) {
		existingBox.remove();
	}

	// 获取选中文本的位置信息
	const selection = window.getSelection();
	if (!selection.rangeCount) return; // 确保有选中的内容
  
	let range = selection.getRangeAt(0);
	let rect = range.getBoundingClientRect();
  
	// 创建浮框显示翻译结果
	const translationBox = document.createElement('div');
	translationBox.id = 'translationBox';
	translationBox.style.position = 'absolute';
	translationBox.style.left = `${rect.left + window.scrollX}px`; // 使用选中文本的左边界加上页面滚动的位移
	translationBox.style.top = `${rect.bottom + window.scrollY + 10}px`; // 选中文本的下边界作为顶部位置，加上页面滚动的位移，并增加一些偏移量
	translationBox.style.padding = '0';
	translationBox.style.setProperty('background', '#fffaf3', 'important');
	translationBox.style.setProperty('color', '#34251f', 'important');
	translationBox.style.setProperty('border', '1px solid #dccabd', 'important');
	translationBox.style.setProperty('border-radius', '16px 14px 18px 13px', 'important');
	translationBox.style.setProperty('box-shadow', '0 14px 28px rgba(88, 63, 50, 0.16)', 'important');
	translationBox.style.setProperty('opacity', '1', 'important');
	translationBox.style.setProperty('mix-blend-mode', 'normal', 'important');
	translationBox.style.setProperty('backdrop-filter', 'blur(1px)', 'important');
	translationBox.style.zIndex = '10000';
	translationBox.style.maxWidth = `${window.innerWidth / 3}px`; // 设置最大宽度为屏幕宽度的1/3
	translationBox.style.overflow = 'auto'; // 超出部分显示滚动条
	translationBox.style.minWidth = '220px';
	translationBox.style.padding = '11px 34px 11px 12px';
	translationBox.style.animation = "pluginTranslationIn 180ms ease-out";
	translationBox.style.willChange = "transform, opacity";
	translationBox.style.pointerEvents = "auto";

	const closeBtn = document.createElement("button");
	closeBtn.textContent = "×";
	closeBtn.setAttribute("aria-label", "Close");
	closeBtn.style.position = "absolute";
	closeBtn.style.right = "8px";
	closeBtn.style.top = "6px";
	closeBtn.style.border = "0";
	closeBtn.style.background = "transparent";
	closeBtn.style.color = "#8f6f62";
	closeBtn.style.fontSize = "14px";
	closeBtn.style.cursor = "pointer";
	closeBtn.style.lineHeight = "1";
	closeBtn.style.padding = "0 2px";
	closeBtn.style.zIndex = "1";

	const body = document.createElement("div");
	body.style.fontSize = "13px";
	body.style.lineHeight = "1.5";
	body.textContent = translation;

	const dictWrap = document.createElement("div");
	dictWrap.id = "translationDictionary";
	dictWrap.style.marginTop = "8px";
	dictWrap.style.paddingTop = "8px";
	dictWrap.style.borderTop = "1px solid #e1d4c7";
	dictWrap.style.fontSize = "12px";
	dictWrap.style.lineHeight = "1.45";
	dictWrap.style.color = "#6a5a52";
	dictWrap.style.display = "none";

	let pointerDownInside = false;
	let startX = 0;
	let startY = 0;
	let moved = false;

	function hasSelectedTextInsideBox() {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
		for (let i = 0; i < sel.rangeCount; i += 1) {
			const range = sel.getRangeAt(i);
			const node = range.commonAncestorContainer;
			const target = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
			if (target && translationBox.contains(target)) return true;
		}
		return false;
	}

	function cleanup() {
		document.removeEventListener("mousedown", onMouseDown, true);
		document.removeEventListener("mousemove", onMouseMove, true);
		document.removeEventListener("mouseup", onMouseUp, true);
	}

	function closeBox() {
		cleanup();
		translationBox.remove();
	}

	function onMouseDown(event) {
		pointerDownInside = translationBox.contains(event.target);
		startX = event.clientX;
		startY = event.clientY;
		moved = false;
	}

	function onMouseMove(event) {
		if (!pointerDownInside) return;
		if (Math.abs(event.clientX - startX) > 3 || Math.abs(event.clientY - startY) > 3) {
			moved = true;
		}
	}

	function onMouseUp() {
		if (hasSelectedTextInsideBox()) return;
		if (pointerDownInside && moved) return;
		closeBox();
	}

	closeBtn.addEventListener("click", function (event) {
		event.stopPropagation();
		closeBox();
	});

	document.addEventListener("mousedown", onMouseDown, true);
	document.addEventListener("mousemove", onMouseMove, true);
	document.addEventListener("mouseup", onMouseUp, true);

	translationBox.appendChild(closeBtn);
	translationBox.appendChild(body);
	translationBox.appendChild(dictWrap);

	document.body.appendChild(translationBox);

	// 自动移除浮框，例如10秒后
	setTimeout(() => {
		closeBox();
	}, 10000);
}

function appendDictionaryToTranslationBox(dictResponse, sourceLang) {
	const dictWrap = document.getElementById("translationDictionary");
	if (!dictWrap || !dictResponse) return;
	const sections = Array.isArray(dictResponse.sections)
		? dictResponse.sections
		: [];
	const effectiveSections = sections.length > 0
		? sections
		: [{
			mode: dictResponse.usedLemma ? "lemma" : "surface",
			query: dictResponse.usedLemma ? (dictResponse.lemma || "") : (dictResponse.query || ""),
			lemma: dictResponse.lemma || "",
			source: dictResponse.source || "dictionary",
			found: !!dictResponse.found,
			entries: Array.isArray(dictResponse.entries) ? dictResponse.entries : [],
		}];
	dictWrap.innerHTML = "";
	dictWrap.style.display = "block";
	const title = document.createElement("div");
	title.textContent = contentT("dictionary");
	title.style.fontWeight = "700";
	title.style.marginBottom = "6px";
	title.style.color = "#856a5f";
	dictWrap.appendChild(title);
	effectiveSections.forEach((section, sectionIndex) => {
		const sectionWrap = document.createElement("div");
		sectionWrap.style.marginTop = sectionIndex === 0 ? "0" : "8px";
		if (sectionIndex > 0) {
			sectionWrap.style.paddingTop = "8px";
			sectionWrap.style.borderTop = "1px dashed #e1d4c7";
		}
		const sectionTitle = document.createElement("div");
		sectionTitle.textContent = `${getDictionarySectionLabel(section.mode, section.query)} · ${getDictionarySourceLabel(section.source)}`;
		sectionTitle.style.fontSize = "11px";
		sectionTitle.style.fontWeight = "700";
		sectionTitle.style.marginBottom = "4px";
		sectionTitle.style.color = "#8c6c59";
		sectionWrap.appendChild(sectionTitle);

		const entries = Array.isArray(section.entries) ? section.entries.slice(0, 3) : [];
		if (entries.length === 0) {
			const empty = document.createElement("div");
			empty.textContent = contentT("no_dict_entries");
			empty.style.fontSize = "11px";
			empty.style.color = "#9a8478";
			sectionWrap.appendChild(empty);
			dictWrap.appendChild(sectionWrap);
			return;
		}

		entries.forEach((item) => {
			const row = document.createElement("div");
			row.style.marginTop = "5px";
			const pos = document.createElement("div");
			pos.style.fontSize = "11px";
			pos.style.color = "#8b7368";
			pos.textContent = item.pos ? `[${item.pos}]` : "";
			const def = document.createElement("div");
			def.textContent = "…";
			row.appendChild(pos);
			row.appendChild(def);
			sectionWrap.appendChild(row);
			chrome.runtime.sendMessage(
				{
					action: "translate",
					text: item.definition || "",
					sourceLang: sourceLang || "auto",
				},
				(transResp) => {
					if (chrome.runtime.lastError || !transResp) return;
					const translated = transResp.translation || "";
					def.textContent = translated || (item.definition || "");
				}
			);
		});
		dictWrap.appendChild(sectionWrap);
	});
	if (!contentSelectionTourAttempted && document.getElementById("translationBox")) {
		contentSelectionTourAttempted = true;
		window.setTimeout(() => startContentSelectionTour(false), 220);
	}
}

function ensureTranslationUiStyles() {
	if (document.getElementById("pluginTranslationStyle")) return;
	const style = document.createElement("style");
	style.id = "pluginTranslationStyle";
	style.textContent = `
		@keyframes pluginTranslationIn {
			from { opacity: 0; transform: translateY(7px) scale(0.985); }
			to { opacity: 1; transform: translateY(0) scale(1); }
		}
	`;
	document.head.appendChild(style);
}

// 以下为事件监听和初始化代码

let lastUrl = location.href;
let highlightDebounceTimer = null;
let ignoreMutationsUntil = 0;

function scheduleHighlight(delay) {
	if (highlightDebounceTimer) clearTimeout(highlightDebounceTimer);
	highlightDebounceTimer = setTimeout(() => {
		ignoreMutationsUntil = Date.now() + 500;
		highlightWords();
	}, delay || 120);
}

function checkUrlAndHighlight() {
	const currentUrl = location.href;
	if (lastUrl !== currentUrl) {
		lastUrl = currentUrl;
		scheduleHighlight(80);
	}
}

function setupNavigationWatchers() {
	const originalPushState = history.pushState;
	const originalReplaceState = history.replaceState;

	history.pushState = function () {
		originalPushState.apply(this, arguments);
		checkUrlAndHighlight();
	};

	history.replaceState = function () {
		originalReplaceState.apply(this, arguments);
		checkUrlAndHighlight();
	};

	window.addEventListener("popstate", checkUrlAndHighlight);
	window.addEventListener("hashchange", checkUrlAndHighlight);

	const observer = new MutationObserver(() => {
		if (Date.now() < ignoreMutationsUntil) return;
		// SPA 页面内容异步更新时，合并高频变更，避免频繁重跑
		scheduleHighlight(180);
		checkUrlAndHighlight();
	});
	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
}

window.addEventListener("load", () => {
	highlightWords();
	setupNavigationWatchers();
});
