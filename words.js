let showAllWords = false;
let uiLang = "zh-TW";
let sortMode = "recent_desc";
let searchKeyword = "";
const MAX_EXAMPLES_PER_WORD = 20;
const MAX_TRANSLATE_CONCURRENCY = 2;
const SEARCH_DEBOUNCE_MS = 350;
const LEMMA_BACKFILL_CONCURRENCY = 3;
const DictionaryUtilsRef = globalThis.DictionaryUtils || {};
const LemmaUtilsRef = globalThis.LemmaUtils || {};
const ExampleUtilsRef = globalThis.ExampleUtils || {};
const TranslationUtilsRef = globalThis.TranslationUtils || {};

let cachedSourceLangPromise = null;
const translateInflight = new Set();
const translationMemoryCache = new Map();
const enqueueTranslationJob = typeof TranslationUtilsRef.createTaskQueue === "function"
	? TranslationUtilsRef.createTaskQueue(MAX_TRANSLATE_CONCURRENCY)
	: null;
const exampleObservers = new WeakMap();
const wordWriteLocks = new Map();
const lemmaCache = new Map();
let lemmaBackfillStarted = false;
let lemmaBackfillPromise = null;
function getEncounterCount(wordData) {
	const count = wordData && typeof wordData.encounterCount === "number" ? wordData.encounterCount : 0;
	const examples = Array.isArray(wordData && wordData.examples) ? wordData.examples.length : 0;
	return Math.max(count, examples);
}

function getPageCount(wordData) {
	const count = wordData && typeof wordData.pageCount === "number" ? wordData.pageCount : 0;
	const keys = Array.isArray(wordData && wordData.encounterPageKeys)
		? wordData.encounterPageKeys.filter((x) => typeof x === "string" && x)
		: [];
	const derived = keys.length;
	return Math.max(count, derived);
}

function formatWordCount(pageCount, encounterCount) {
	return `${pageCount}p · ${encounterCount}x`;
}

function formatWordCountTooltip(pageCount, encounterCount) {
	return `${t("count_pages")}: ${pageCount} · ${t("count_encounters")}: ${encounterCount}`;
}

function retriggerEffect(element, className) {
	if (!element) return;
	element.classList.remove(className);
	void element.offsetWidth;
	element.classList.add(className);
	window.setTimeout(() => {
		element.classList.remove(className);
	}, 700);
}

function toggleAnimatedPanel(panel, shouldOpen) {
	if (!panel) return;
	panel.classList.remove("fx-panel-open", "fx-panel-close");
	if (shouldOpen) {
		panel.style.display = "block";
		void panel.offsetWidth;
		panel.classList.add("fx-panel-open");
		return;
	}
	panel.classList.add("fx-panel-close");
	window.setTimeout(() => {
		panel.style.display = "none";
		panel.classList.remove("fx-panel-close");
	}, 170);
}

const toggleViewBtn = document.getElementById("toggleViewBtn");
const practiceBtn = document.getElementById("practiceBtn");
const sortModeSelect = document.getElementById("sortMode");
const wordsList = document.getElementById("wordsList");
const dictWordsList = document.getElementById("dictWordsList");
const localResultBlock = document.getElementById("localResultBlock");
const dictResultBlock = document.getElementById("dictResultBlock");
const wordStats = document.getElementById("wordStats");
const languageStats = document.getElementById("languageStats");
const autoLangHint = document.getElementById("autoLangHint");
const closeBtn = document.getElementById("closeBtn");
const searchInput = document.getElementById("searchInput");
const helpBtn = document.getElementById("helpBtn");
let dictSearchReqId = 0;
let searchDebounceTimer = null;
let wordsTourAttempted = false;

document.addEventListener("DOMContentLoaded", function () {
	WordStorage.getUiLanguage().then((lang) => {
		uiLang = lang || "zh-TW";
		applyUiText();
		refreshLanguageChip();
		updateWordsList();
		backfillMissingLemmas();
	}).catch(() => {
		uiLang = "zh-TW";
		applyUiText();
		refreshLanguageChip();
		updateWordsList();
		backfillMissingLemmas();
	});

	toggleViewBtn.addEventListener("click", function () {
		showAllWords = !showAllWords;
		toggleViewBtn.textContent = showAllWords ? t("show_unlearned") : t("show_all");
		updateWordsList();
	});

	practiceBtn.addEventListener("click", function () {
		chrome.tabs.create({ url: chrome.runtime.getURL("practice.html") });
	});

	sortModeSelect.addEventListener("change", function () {
		sortMode = sortModeSelect.value;
		updateWordsList();
	});

	searchInput.addEventListener("input", function () {
		if (searchDebounceTimer) {
			window.clearTimeout(searchDebounceTimer);
		}
		searchDebounceTimer = window.setTimeout(() => {
			searchKeyword = (searchInput.value || "").trim().toLowerCase();
			updateWordsList();
		}, SEARCH_DEBOUNCE_MS);
	});

	closeBtn.addEventListener("click", function () {
		window.close();
	});

	if (helpBtn) {
		helpBtn.addEventListener("click", function () {
			if (!globalThis.UiTour) return;
			UiTour.reset("words_v1").then(() => {
				window.setTimeout(() => startWordsTour(true), 40);
			});
		});
	}
});

function refreshLanguageChip() {
	WordStorage.getSourceLang().then((lang) => {
		languageStats.textContent = `${t("source_lang")}：${lang}`;
		autoLangHint.style.display = lang === "auto" ? "block" : "none";
	}).catch(() => {
		languageStats.textContent = `${t("source_lang")}：auto`;
		autoLangHint.style.display = "block";
	});
}

function t(key) {
	return UiI18n.t(uiLang, key);
}

function startWordsTour(force) {
	if (!globalThis.UiTour) return;
	const run = force ? UiTour.start : UiTour.maybeStartOnce;
	run({
		storageKey: "words_v1",
		lang: uiLang,
		steps: UiTour.getSteps(uiLang, "words"),
	});
}

const normalizeDictionaryQuery = DictionaryUtilsRef.normalizeDictionaryQuery || (() => "");
const supportsDictionaryBySourceLang = DictionaryUtilsRef.supportsDictionaryBySourceLang || (() => false);
const getDictionarySourceLabel = DictionaryUtilsRef.getDictionarySourceLabel || (() => "Dictionary");
const normalizeLemmaSourceLang = LemmaUtilsRef.normalizeLemmaSourceLang || function (sourceLang) {
	const base = (((sourceLang || "").split("-")[0]) || "").toLowerCase();
	return base === "auto" ? "" : base;
};
const supportsLemmaBySourceLang = LemmaUtilsRef.supportsLemmaBySourceLang || function () {
	return false;
};

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

function createLimiter(limit) {
	let active = 0;
	const queue = [];
	const runNext = () => {
		if (active >= limit || queue.length === 0) return;
		const job = queue.shift();
		active += 1;
		Promise.resolve()
			.then(job.fn)
			.then(job.resolve, job.reject)
			.finally(() => {
				active -= 1;
				runNext();
			});
	};
	return function schedule(fn) {
		return new Promise((resolve, reject) => {
			queue.push({ fn, resolve, reject });
			runNext();
		});
	};
}

function backfillMissingLemmas() {
	if (lemmaBackfillStarted) return lemmaBackfillPromise || Promise.resolve(0);
	lemmaBackfillStarted = true;
	lemmaBackfillPromise = Promise.all([
		WordStorage.getSourceLang(),
		WordStorage.getWords(),
	]).then(async ([sourceLang, words]) => {
		if (!supportsLemmaBySourceLang(sourceLang)) return 0;
		const wordList = Object.keys(words || {});
		const missing = wordList.filter((word) => {
			const data = words[word] || {};
			return !(typeof data.lemma === "string" && data.lemma.trim());
		});
		if (missing.length === 0) return 0;

		const schedule = createLimiter(LEMMA_BACKFILL_CONCURRENCY);
		const updates = await Promise.all(
			missing.map((word) => schedule(async () => {
				const result = await resolveLemma(word, sourceLang);
				const lemma = (result && typeof result.lemma === "string" ? result.lemma : "").trim();
				if (!lemma) return null;
				return { word, lemma };
			}))
		);

		let changed = 0;
		updates.filter(Boolean).forEach(({ word, lemma }) => {
			const current = words[word] || {};
			if ((current.lemma || "").trim() === lemma) return;
			words[word] = Object.assign({}, current, { lemma });
			changed += 1;
		});

		if (changed > 0) {
			await WordStorage.saveWords(words);
		}
		return changed;
	}).then((changed) => {
		if (changed > 0) updateWordsList();
		return changed;
	}).catch((error) => {
		console.error("Failed to backfill lemmas in words view:", error);
		return 0;
	});
	return lemmaBackfillPromise;
}

function updateSearchLayout(hasLocalResults, hasKeyword) {
	if (!hasKeyword) {
		localResultBlock.style.display = "block";
		dictResultBlock.style.display = "none";
		return;
	}

	if (hasLocalResults) {
		localResultBlock.style.display = "block";
		dictResultBlock.style.display = "block";
		return;
	}

	localResultBlock.style.display = "none";
	dictResultBlock.style.display = "block";
}

function renderDictionarySearchResults(hasLocalResults) {
	const keyword = (searchKeyword || "").trim();
	if (!keyword) {
		updateSearchLayout(hasLocalResults, false);
		return;
	}
	updateSearchLayout(hasLocalResults, true);

	const query = normalizeDictionaryQuery(keyword);
	if (!query) {
		dictWordsList.innerHTML = `<div class="empty">${t("search_prompt")}</div>`;
		return;
	}

	const reqId = ++dictSearchReqId;
	dictWordsList.innerHTML = `<div class="empty">${t("dict_searching")}</div>`;
	Promise.all([
		WordStorage.getSourceLang(),
		WordStorage.getDictionaryLookupEnabled().catch(() => true),
	]).then(([sourceLang, dictEnabled]) => {
		if (reqId !== dictSearchReqId) return;
		if (!(dictEnabled && supportsDictionaryBySourceLang(sourceLang))) {
			dictWordsList.innerHTML = `<div class="empty">${t("dict_disabled_lang")}</div>`;
			return;
		}
		chrome.runtime.sendMessage(
			{ action: "lookupDictionary", text: query, sourceLang: sourceLang || "auto" },
			(response) => {
				if (reqId !== dictSearchReqId) return;
				if (chrome.runtime.lastError || !response || !response.found || !Array.isArray(response.entries)) {
					dictWordsList.innerHTML = `<div class="empty">${t("dict_no_result")}</div>`;
					return;
				}
				const effectiveSections = typeof DictionaryUtilsRef.getEffectiveDictionarySections === "function"
					? DictionaryUtilsRef.getEffectiveDictionarySections(response)
					: [];
				const hasAnyEntries = effectiveSections.some((section) => Array.isArray(section.entries) && section.entries.length > 0);
				if (!hasAnyEntries) {
					dictWordsList.innerHTML = `<div class="empty">${t("dict_no_result")}</div>`;
					return;
				}
				const wrap = document.createElement("div");
				effectiveSections.forEach((section, sectionIndex) => {
					const sectionWrap = document.createElement("div");
					sectionWrap.className = "dict-search-section";
					if (sectionIndex > 0) sectionWrap.classList.add("is-secondary");
					const sectionTitle = document.createElement("div");
					sectionTitle.className = "dict-section-title";
					const sectionLabel = typeof DictionaryUtilsRef.getDictionarySectionLabel === "function"
						? DictionaryUtilsRef.getDictionarySectionLabel(t, section.mode, section.query)
						: section.query;
					sectionTitle.textContent = `${sectionLabel} · ${getDictionarySourceLabel(section.source)}`;
					sectionWrap.appendChild(sectionTitle);
					const items = Array.isArray(section.entries) ? section.entries.slice(0, 5) : [];
					if (items.length === 0) {
						const empty = document.createElement("div");
						empty.className = "empty";
						empty.textContent = t("no_dict_entries");
						sectionWrap.appendChild(empty);
						wrap.appendChild(sectionWrap);
						return;
					}
					items.forEach((item) => {
						const row = document.createElement("div");
						row.className = "dict-search-item";
						const body = document.createElement("div");
						body.className = "dict-search-body";
						const pos = item && item.pos ? `[${item.pos}]` : "";
						const text = item && item.definition ? item.definition : "";
						const title = document.createElement("div");
						title.className = "dict-search-original";
						title.textContent = text;
						if (pos) {
							const posEl = document.createElement("div");
							posEl.className = "dict-pos";
							posEl.textContent = pos;
							body.appendChild(posEl);
						}
						body.appendChild(title);

						const trans = document.createElement("div");
						trans.className = "dict-search-translation";
						trans.textContent = "…";
						body.appendChild(trans);
						row.appendChild(body);

						TranslationUtilsRef.requestRuntimeTranslation({
							chromeRuntime: chrome.runtime,
							text,
							sourceLang: sourceLang || "auto",
						}).then((translated) => {
							if (!row.isConnected) return;
							trans.textContent = translated || "";
						}).catch(() => {
							if (!row.isConnected) return;
							trans.textContent = "";
						});
						sectionWrap.appendChild(row);
					});
					wrap.appendChild(sectionWrap);
				});
				dictWordsList.innerHTML = "";
				dictWordsList.appendChild(wrap);
			}
		);
	}).catch(() => {
		if (reqId !== dictSearchReqId) return;
		dictWordsList.innerHTML = `<div class="empty">${t("dict_search_failed")}</div>`;
	});
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

function normalizeExampleEntry(entry) {
	if (typeof ExampleUtilsRef.normalizeExampleEntry === "function") {
		return ExampleUtilsRef.normalizeExampleEntry(entry) || { text: "", pinned: false, createdAt: 0, pinnedAt: 0, translation: "", translatedAt: 0 };
	}
	return { text: "", pinned: false, createdAt: 0, pinnedAt: 0, translation: "", translatedAt: 0 };
}

function normalizeExamples(entries) {
	if (typeof ExampleUtilsRef.normalizeExampleList === "function") {
		return ExampleUtilsRef.normalizeExampleList(entries);
	}
	if (!Array.isArray(entries)) return [];
	return entries.map(normalizeExampleEntry).filter((item) => item.text.trim().length > 0);
}

function sortExamples(entries) {
	if (typeof ExampleUtilsRef.sortExamples === "function") {
		return ExampleUtilsRef.sortExamples(entries);
	}
	return entries;
}

function getExampleIdentity(example) {
	return `${(example && example.text) || ""}__${(example && example.capturedAt) || 0}__${(example && example.sourceUrl) || ""}`;
}

function findExampleIndexByIdentity(listItems, target) {
	const targetId = getExampleIdentity(target);
	for (let i = 0; i < listItems.length; i += 1) {
		if (getExampleIdentity(listItems[i]) === targetId) return i;
	}
	for (let i = 0; i < listItems.length; i += 1) {
		if ((listItems[i].text || "").trim() === (target.text || "").trim()) return i;
	}
	return -1;
}

function trimExamples(entries) {
	if (typeof ExampleUtilsRef.enforceExampleLimit === "function") {
		return ExampleUtilsRef.enforceExampleLimit(entries.slice(), MAX_EXAMPLES_PER_WORD);
	}
	return entries;
}

function createHighlightedSentenceElement(sentence, word) {
	const wrapper = document.createElement("div");
	wrapper.className = "example-sentence";
	if (!sentence) return wrapper;

	const rawWord = (word || "").trim();
	if (!rawWord) {
		wrapper.textContent = sentence;
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
		const span = document.createElement("span");
		span.className = "example-word";
		span.textContent = sentence.slice(start, end);
		wrapper.appendChild(span);
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

async function translateExampleSentence(sentence) {
	if (!cachedSourceLangPromise) {
		cachedSourceLangPromise = WordStorage.getSourceLang().catch(() => "auto");
	}
	const sourceLang = await cachedSourceLangPromise;
	return TranslationUtilsRef.requestRuntimeTranslation({
		chromeRuntime: chrome.runtime,
		text: sentence,
		sourceLang,
	});
}

function getExampleCacheKey(word, exampleText) {
	return `${word}__${exampleText}`;
}

function formatExampleTime(ts) {
	if (!ts) return "";
	try {
		return new Date(ts).toLocaleString();
	} catch (error) {
		return "";
	}
}

function formatExampleHost(url) {
	if (!url) return "";
	try {
		return new URL(url).host;
	} catch (error) {
		return url;
	}
}

function enqueueWordWrite(word, task) {
	const prev = wordWriteLocks.get(word) || Promise.resolve();
	const next = prev
		.then(() => task())
		.catch(() => {});
	wordWriteLocks.set(word, next);
	return next.finally(() => {
		if (wordWriteLocks.get(word) === next) {
			wordWriteLocks.delete(word);
		}
	});
}

function saveExampleTranslation(word, example, translation) {
	return updateExamplesForWord(word, (listItems) => {
		const idx = findExampleIndexByIdentity(listItems, example);
		if (idx === -1) return listItems;
		listItems[idx].translation = translation;
		listItems[idx].translatedAt = Date.now();
		return listItems;
	});
}

function requestExampleTranslation(word, example, translationEl) {
	if (!translationEl || !example || !example.text) return;
	const cacheKey = getExampleCacheKey(word, example.text);
	const memCached = translationMemoryCache.get(cacheKey);
	if (memCached) {
		translationEl.textContent = memCached;
		return;
	}
	if (translateInflight.has(cacheKey)) return;
	translateInflight.add(cacheKey);
	translationEl.textContent = "…";

	const enqueue = enqueueTranslationJob || ((job) => Promise.resolve().then(job));
	enqueue(async () => {
		const translated = await translateExampleSentence(example.text);
		translateInflight.delete(cacheKey);
		if (!translated) return;
		translationMemoryCache.set(cacheKey, translated);
		if (translationEl.isConnected) {
			translationEl.textContent = translated;
		}
		saveExampleTranslation(word, example, translated).catch(() => {});
	});
}

function updateExamplesForWord(word, updater) {
	return enqueueWordWrite(word, () => WordStorage.getWords().then((words) => {
		if (!words[word]) return false;
		const existing = Array.isArray(words[word].examples) ? words[word].examples : [];
		const current = normalizeExamples(existing);
		const next = updater(current.slice());
		words[word].examples = trimExamples(next);
		return WordStorage.saveWords(words).then(() => true);
	}));
}

function renderExamples(exampleWrap, examples, word, onCountChange) {
	const normalizedExamples = sortExamples(normalizeExamples(examples));
	if (typeof onCountChange === "function") onCountChange(normalizedExamples.length);
	const existingObserver = exampleObservers.get(exampleWrap);
	if (existingObserver) {
		existingObserver.disconnect();
		exampleObservers.delete(exampleWrap);
	}
	exampleWrap.innerHTML = "";
	const list = document.createElement("ol");
	list.className = "example-list";

	if (normalizedExamples.length === 0) {
		const li = document.createElement("li");
		li.textContent = t("no_examples");
		list.appendChild(li);
		exampleWrap.appendChild(list);
		return;
	}

	normalizedExamples.forEach((example) => {
		const li = document.createElement("li");
		const item = document.createElement("div");
		item.className = "example-item";

		const content = document.createElement("div");
		content.className = "example-content";
		content.appendChild(createHighlightedSentenceElement(example.text, word));

		const translation = document.createElement("div");
		translation.className = "example-translation";
		translation.textContent = example.translation || "";
		content.appendChild(translation);

		const meta = document.createElement("div");
		meta.className = "example-meta";
		const sourceLink = document.createElement("a");
		sourceLink.className = "example-link";
		sourceLink.href = example.sourceUrl || "#";
		sourceLink.target = "_blank";
		sourceLink.rel = "noreferrer noopener";
		sourceLink.textContent = formatExampleHost(example.sourceUrl) || "unknown";
		if (!example.sourceUrl) sourceLink.style.pointerEvents = "none";
		const timeSpan = document.createElement("span");
		timeSpan.className = "example-time";
		timeSpan.textContent = formatExampleTime(example.capturedAt || example.createdAt);
		meta.appendChild(sourceLink);
		meta.appendChild(timeSpan);
		content.appendChild(meta);

		const removeBtn = document.createElement("button");
		removeBtn.className = "example-remove";
		removeBtn.textContent = "🗑️";
		removeBtn.title = t("remove_example");
		removeBtn.addEventListener("click", function () {
			updateExamplesForWord(word, (listItems) => {
				const idx = findExampleIndexByIdentity(listItems, example);
				if (idx === -1) return listItems;
				listItems.splice(idx, 1);
				return listItems;
			}).then((removed) => {
				if (!removed) return;
				WordStorage.getWords().then((latestWords) => {
					const latestExamples = Array.isArray(latestWords[word] && latestWords[word].examples)
						? latestWords[word].examples
						: [];
					renderExamples(exampleWrap, latestExamples, word, onCountChange);
					UiToast.show(t("deleted"), "success");
				});
			}).catch((error) => {
				console.error("Failed to remove example:", error);
				UiToast.show(t("save_failed"), "error");
			});
		});

			const pinBtn = document.createElement("button");
			pinBtn.className = "example-remove";
			pinBtn.textContent = example.pinned ? "📌" : "📍";
			pinBtn.title = example.pinned ? t("unpin_example") : t("pin_example");
		pinBtn.addEventListener("click", function () {
			updateExamplesForWord(word, (listItems) => {
				const idx = findExampleIndexByIdentity(listItems, example);
				const target = idx === -1 ? null : listItems[idx];
				if (!target) return listItems;
				target.pinned = !target.pinned;
				target.pinnedAt = target.pinned ? Date.now() : 0;
				return sortExamples(listItems);
			}).then((updated) => {
				if (!updated) return;
				WordStorage.getWords().then((latestWords) => {
					const latestExamples = Array.isArray(latestWords[word] && latestWords[word].examples)
						? latestWords[word].examples
						: [];
					renderExamples(exampleWrap, latestExamples, word, onCountChange);
					UiToast.show(t("saved"), "success");
				});
			}).catch((error) => {
				console.error("Failed to pin example:", error);
				UiToast.show(t("save_failed"), "error");
			});
		});

			const exampleActions = document.createElement("div");
			exampleActions.className = "example-actions";
			exampleActions.appendChild(pinBtn);
			exampleActions.appendChild(removeBtn);

			item.appendChild(content);
			item.appendChild(exampleActions);
			li.appendChild(item);
			list.appendChild(li);

		if (!example.translation) {
			translation.textContent = "…";
		}
		if (!example.translation) {
			li.dataset.needsTranslation = "1";
		}
		li._exampleData = example;
		li._translationEl = translation;
	});

	exampleWrap.appendChild(list);
	const observer = new IntersectionObserver((entries, obs) => {
		entries.forEach((entry) => {
			if (!entry.isIntersecting) return;
			const item = entry.target;
			if (item.dataset.needsTranslation !== "1") {
				obs.unobserve(item);
				return;
			}
			item.dataset.needsTranslation = "0";
			requestExampleTranslation(word, item._exampleData, item._translationEl);
			obs.unobserve(item);
		});
	}, { root: exampleWrap, threshold: 0.1 });
	exampleObservers.set(exampleWrap, observer);
	list.querySelectorAll("li").forEach((li) => {
		if (li.dataset.needsTranslation === "1") observer.observe(li);
	});
}

function applyUiText() {
	document.documentElement.lang = UiI18n.langAttr(uiLang);
	document.documentElement.dir = UiI18n.dir(uiLang);
	document.title = t("fullscreen");
	document.getElementById("wordsTitle").textContent = t("fullscreen");
	document.getElementById("wordsSubtitle").textContent = t("popup_subtitle");
	document.getElementById("settingsLink").textContent = t("settings");
	document.getElementById("searchInput").placeholder = t("search_prompt");
	document.getElementById("localResultTitle").textContent = t("local_saved_words");
	document.getElementById("dictResultTitle").textContent = t("dictionary_search_results");
	closeBtn.textContent = t("close_tab");
	practiceBtn.textContent = t("practice_mode");
	toggleViewBtn.textContent = showAllWords ? t("show_unlearned") : t("show_all");
	autoLangHint.textContent = t("auto_hint");
	sortModeSelect.options[0].textContent = t("sort_recent");
	sortModeSelect.options[1].textContent = t("sort_alpha");
	if (sortModeSelect.options[2]) sortModeSelect.options[2].textContent = t("sort_freq");
	if (helpBtn && globalThis.UiTour) {
		helpBtn.title = UiTour.getLabel(uiLang, "replay");
		helpBtn.setAttribute("aria-label", UiTour.getLabel(uiLang, "replay"));
	}
}

const normalizeDictionaryEntries = DictionaryUtilsRef.normalizeStoredDictionaryEntries || (() => []);

function matchWordWithSearch(word, wordData, keyword) {
	if (!keyword) return true;
	const meaning = ((wordData && wordData.meaning) || "").toLowerCase();
	if (word.toLowerCase().includes(keyword) || meaning.includes(keyword)) return true;
	const dictEntries = normalizeDictionaryEntries(wordData);
	for (let i = 0; i < dictEntries.length; i += 1) {
		const item = dictEntries[i];
		if ((item.pos || "").toLowerCase().includes(keyword)) return true;
		if ((item.definitionOriginal || "").toLowerCase().includes(keyword)) return true;
		if ((item.definitionTranslated || "").toLowerCase().includes(keyword)) return true;
	}
	return false;
}

function updateWordsList() {
	wordsList.innerHTML = "";
	WordStorage.getWords().then((words) => {
		const allWords = Object.keys(words);
		if (sortMode === "alpha_asc") {
			allWords.sort((a, b) => a.localeCompare(b));
		} else if (sortMode === "freq_desc") {
			allWords.sort((a, b) => {
				const ad = getPageCount(words[a]);
				const bd = getPageCount(words[b]);
				const af = getEncounterCount(words[a]);
				const bf = getEncounterCount(words[b]);
				if (bd !== ad) return bd - ad;
				if (bf !== af) return bf - af;
				return a.localeCompare(b);
			});
		} else {
			allWords.sort((a, b) => {
				const at = words[a] && words[a].createdAt ? words[a].createdAt : 0;
				const bt = words[b] && words[b].createdAt ? words[b].createdAt : 0;
				if (bt !== at) return bt - at;
				return a.localeCompare(b);
			});
		}

		const unlearnedCount = allWords.filter((w) => !words[w].learned).length;
		wordStats.textContent = `${t("words")}：${allWords.length} | ${t("unlearned")}：${unlearnedCount}`;

		let renderedCount = 0;
			allWords.forEach((word) => {
				if (!showAllWords && words[word].learned) return;
				if (!matchWordWithSearch(word, words[word], searchKeyword)) return;
				renderedCount += 1;
				const wordItem = document.createElement("div");
				wordItem.className = "word-item";

				const wordHeader = document.createElement("div");
				wordHeader.className = "word-header";

				const wordMain = document.createElement("div");
				wordMain.className = "word-main";

				const wordLine = document.createElement("div");
				wordLine.className = "word-line";

				const wordSpan = document.createElement("span");
				wordSpan.className = `word${words[word].learned ? " learned" : ""}`;
				wordSpan.textContent = word;
				const encounterCount = getEncounterCount(words[word]);
				const pageCount = getPageCount(words[word]);
				const countSpan = document.createElement("span");
				countSpan.className = "word-count";
				const countTooltip = formatWordCountTooltip(pageCount, encounterCount);
				countSpan.textContent = formatWordCount(pageCount, encounterCount);
				countSpan.title = countTooltip;
				countSpan.setAttribute("aria-label", countTooltip);

				const meaningSpan = document.createElement("div");
				meaningSpan.className = "word-meaning";
				const meaningText = words[word].meaning || "";

				const lemmaValue = typeof words[word].lemma === "string" ? words[word].lemma.trim() : "";
				let lemmaSpan = null;
				if (lemmaValue) {
					lemmaSpan = document.createElement("span");
					lemmaSpan.className = "word-lemma";
					lemmaSpan.textContent = `${t("lemma_label")}: ${lemmaValue}`;
				}
				if (lemmaSpan) {
					meaningSpan.appendChild(lemmaSpan);
					if (meaningText) {
						meaningSpan.appendChild(document.createTextNode(" "));
					}
				}
				meaningSpan.appendChild(document.createTextNode(meaningText));

				const actionWrap = document.createElement("div");
				actionWrap.className = "word-actions";

			const audioButton = document.createElement("button");
			audioButton.className = "action-audio";
			audioButton.textContent = `🔊 ${t("pronounce")}`;
			audioButton.addEventListener("click", function () {
				retriggerEffect(audioButton, "fx-audio");
				retriggerEffect(wordItem, "fx-row-audio");
				const utterance = new SpeechSynthesisUtterance(word);
				WordStorage.getSourceLang().then((sourceLang) => {
					utterance.lang = sourceLang;
					speechSynthesis.speak(utterance);
				});
			});

			const markButton = document.createElement("button");
			markButton.className = words[word].learned ? "action-unlearn" : "action-learn";
			markButton.textContent = words[word].learned ? t("unmark") : t("mark");
			markButton.addEventListener("click", function () {
				retriggerEffect(markButton, "fx-learned");
				retriggerEffect(wordItem, "fx-row-learned");
				toggleLearned(word);
			});

			const deleteButton = document.createElement("button");
			deleteButton.className = "action-delete";
			deleteButton.textContent = t("delete");
			deleteButton.addEventListener("click", function () {
				retriggerEffect(deleteButton, "fx-delete");
				deleteWord(word, wordItem);
			});

			const exampleButton = document.createElement("button");
			exampleButton.className = "action-example";
			let exampleCount = Array.isArray(words[word].examples) ? words[word].examples.length : 0;
			function syncExampleButtonText(expanded = exampleWrap.style.display !== "none") {
				exampleButton.textContent = expanded
					? `${t("collapse")}(${exampleCount})`
					: `${t("examples")}(${exampleCount})`;
			}
			exampleButton.textContent = `${t("examples")}(${exampleCount})`;

			const exampleWrap = document.createElement("div");
			exampleWrap.className = "example-wrap";
			exampleWrap.style.display = "none";
			const examples = Array.isArray(words[word].examples) ? words[word].examples : [];
			let examplesRendered = false;

			const dictionaryEntries = normalizeDictionaryEntries(words[word]);
			const dictButton = document.createElement("button");
			dictButton.className = "action-dict";
			let dictCount = dictionaryEntries.length;
			const dictWrap = document.createElement("div");
			dictWrap.className = "dict-wrap";
			dictWrap.style.display = "none";
			let dictRendered = false;

			function syncDictButtonText() {
				const expanded = dictWrap.style.display !== "none";
				dictButton.textContent = expanded
					? `${t("collapse")}${t("dictionary")}(${dictCount})`
					: `${t("dictionary")}(${dictCount})`;
			}
			syncDictButtonText();

			function renderDictionary() {
				dictWrap.innerHTML = "";
				const dictMeta = words[word] && words[word].dictionary && typeof words[word].dictionary === "object"
					? words[word].dictionary
					: null;
				if (dictMeta && dictMeta.usedLemma && dictMeta.lookupLemma) {
					const note = document.createElement("div");
					note.className = "dict-lemma-note";
					note.textContent = `${t("dict_via_lemma")}: ${dictMeta.lookupLemma}`;
					dictWrap.appendChild(note);
				}
				const list = document.createElement("ol");
				list.className = "dict-list";
				if (dictionaryEntries.length === 0) {
					const li = document.createElement("li");
					li.textContent = t("no_dict_entries");
					list.appendChild(li);
					dictWrap.appendChild(list);
					return;
				}
				dictionaryEntries.forEach((entry) => {
					const li = document.createElement("li");
					const posEl = document.createElement("div");
					posEl.className = "dict-pos";
					posEl.textContent = entry.pos ? `[${entry.pos}]` : "";
					const originalEl = document.createElement("div");
					originalEl.className = "dict-original";
					originalEl.textContent = entry.definitionOriginal || "";
					const translatedEl = document.createElement("div");
					translatedEl.className = "dict-translated";
					translatedEl.textContent = entry.definitionTranslated || "";
					li.appendChild(posEl);
					li.appendChild(originalEl);
					li.appendChild(translatedEl);
					list.appendChild(li);
				});
				dictWrap.appendChild(list);
			}

			exampleButton.addEventListener("click", function () {
				const expanded = exampleWrap.style.display !== "none";
				retriggerEffect(exampleButton, "fx-example");
				retriggerEffect(wordItem, "fx-row-example");
				toggleAnimatedPanel(exampleWrap, !expanded);
				syncExampleButtonText(!expanded);
				if (!expanded && !examplesRendered) {
					renderExamples(exampleWrap, examples, word, (count) => {
						exampleCount = count;
						syncExampleButtonText();
					});
					examplesRendered = true;
				}
			});

				dictButton.addEventListener("click", function () {
					const expanded = dictWrap.style.display !== "none";
					dictWrap.style.display = expanded ? "none" : "block";
					syncDictButtonText();
				if (!expanded && !dictRendered) {
					renderDictionary();
					dictRendered = true;
				}
			});

				actionWrap.appendChild(audioButton);
				actionWrap.appendChild(markButton);
				actionWrap.appendChild(exampleButton);
				actionWrap.appendChild(dictButton);
				actionWrap.appendChild(deleteButton);
				wordLine.appendChild(wordSpan);
				wordLine.appendChild(countSpan);
				wordMain.appendChild(wordLine);
				wordMain.appendChild(meaningSpan);
				wordHeader.appendChild(wordMain);
				wordHeader.appendChild(actionWrap);
				wordItem.appendChild(wordHeader);
				wordItem.appendChild(exampleWrap);
				wordItem.appendChild(dictWrap);
				wordsList.appendChild(wordItem);
		});

			if (!wordsList.hasChildNodes() && !searchKeyword) {
				const empty = document.createElement("div");
				empty.className = "empty";
				empty.textContent = t("empty_words");
				wordsList.appendChild(empty);
			}
			if (!wordsTourAttempted) {
				wordsTourAttempted = true;
				window.setTimeout(() => startWordsTour(false), 220);
			}
			updateSearchLayout(renderedCount > 0, !!searchKeyword);
			renderDictionarySearchResults(renderedCount > 0);
		});
	}

function deleteWord(word, wordItem) {
	if (wordItem) {
		wordItem.classList.add("is-deleting");
	}
	const runDelete = () => WordStorage.getWords().then((words) => {
		delete words[word];
		return WordStorage.saveWords(words);
	});
	const promise = wordItem ? new Promise((resolve) => window.setTimeout(resolve, 210)).then(runDelete) : runDelete();
	promise.then(() => {
		updateWordsList();
		UiToast.show(t("deleted"), "success");
	}).catch(() => {
		if (wordItem) {
			wordItem.classList.remove("is-deleting");
		}
		UiToast.show(t("save_failed"), "error");
	});
}

function toggleLearned(word) {
	new Promise((resolve) => window.setTimeout(resolve, 170)).then(() => WordStorage.getWords()).then((words) => {
		words[word].learned = !words[word].learned;
		return WordStorage.saveWords(words);
	}).then(() => {
		updateWordsList();
		UiToast.show(t("saved"), "success");
	}).catch(() => {
		UiToast.show(t("save_failed"), "error");
	});
}
