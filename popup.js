let uiLang = "zh-TW";
let sortMode = "recent_desc";
const MAX_EXAMPLES_PER_WORD = 20;
const ExampleUtilsRef = globalThis.ExampleUtils;
const TranslationUtilsRef = globalThis.TranslationUtils;
const enqueueTranslationJob = TranslationUtilsRef.createTaskQueue(2);

let cachedSourceLangPromise = null;
const translateInflight = new Set();
const translationMemoryCache = new Map();
const exampleObservers = new WeakMap();
const wordWriteLocks = new Map();
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

const fullscreenBtn = document.getElementById("fullscreenBtn");
const practiceBtn = document.getElementById("practiceBtn");
const sortModeSelect = document.getElementById("sortMode");
const wordsList = document.getElementById("wordsList");
const wordStats = document.getElementById("wordStats");
const languageStats = document.getElementById("languageStats");
const autoLangHint = document.getElementById("autoLangHint");
const helpBtn = document.getElementById("helpBtn");
let popupTourAttempted = false;

document.addEventListener("DOMContentLoaded", function () {
	WordStorage.getUiLanguage().then((lang) => {
		uiLang = lang || "zh-TW";
		applyUiText();
		refreshLanguageChip();
		updateWordsList();
	}).catch(() => {
		uiLang = "zh-TW";
		applyUiText();
		refreshLanguageChip();
		updateWordsList();
	});

	fullscreenBtn.addEventListener("click", function () {
		chrome.tabs.create({ url: chrome.runtime.getURL("words.html") });
	});
	practiceBtn.addEventListener("click", function () {
		chrome.tabs.create({ url: chrome.runtime.getURL("practice.html") });
	});

	sortModeSelect.addEventListener("change", function () {
		sortMode = sortModeSelect.value;
		updateWordsList();
	});

	if (helpBtn) {
		helpBtn.addEventListener("click", function () {
			if (!globalThis.UiTour) return;
			UiTour.reset("popup_v1").then(() => {
				window.setTimeout(() => startPopupTour(true), 40);
			});
		});
	}

});

function t(key) {
	return UiI18n.t(uiLang, key);
}

function startPopupTour(force) {
	if (!globalThis.UiTour) return;
	const run = force ? UiTour.start : UiTour.maybeStartOnce;
	run({
		storageKey: "popup_v1",
		lang: uiLang,
		steps: UiTour.getSteps(uiLang, "popup"),
	});
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
	return ExampleUtilsRef.normalizeExampleEntry(entry) || { text: "", pinned: false, createdAt: 0, pinnedAt: 0, translation: "", translatedAt: 0 };
}

function normalizeExamples(entries) {
	return ExampleUtilsRef.normalizeExampleList(entries);
}

function sortExamples(entries) {
	return ExampleUtilsRef.sortExamples(entries);
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
	return ExampleUtilsRef.enforceExampleLimit(entries.slice(), MAX_EXAMPLES_PER_WORD);
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
		sourceLang: sourceLang || "auto",
	});
}

function getExampleCacheKey(word, exampleText) {
	return `${word}__${exampleText}`;
}

function formatWordCount(pageCount, encounterCount) {
	return `${pageCount}p · ${encounterCount}x`;
}

function formatWordCountTooltip(pageCount, encounterCount) {
	return `${t("count_pages")}: ${pageCount} · ${t("count_encounters")}: ${encounterCount}`;
}

function formatExampleTime(ts) {
	if (!ts) return "";
	try {
		return new Date(ts).toLocaleString();
	} catch (error) {
		return "";
	}
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

	enqueueTranslationJob(async () => {
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
	document.title = t("popup_title");
	document.getElementById("popupTitle").textContent = t("popup_title");
	document.getElementById("popupSubtitle").textContent = t("popup_subtitle");
	document.getElementById("settingsLink").textContent = t("settings");
	fullscreenBtn.textContent = t("fullscreen");
	practiceBtn.textContent = t("practice_mode");
	autoLangHint.textContent = t("auto_hint");
	sortModeSelect.options[0].textContent = t("sort_recent");
	sortModeSelect.options[1].textContent = t("sort_alpha");
	if (sortModeSelect.options[2]) sortModeSelect.options[2].textContent = t("sort_freq");
	if (helpBtn && globalThis.UiTour) {
		helpBtn.title = UiTour.getLabel(uiLang, "replay");
		helpBtn.setAttribute("aria-label", UiTour.getLabel(uiLang, "replay"));
	}
}

function refreshLanguageChip() {
	WordStorage.getSourceLang().then((sourceLang) => {
		languageStats.textContent = `${t("source_lang")}：${sourceLang}`;
		autoLangHint.style.display = sourceLang === "auto" ? "block" : "none";
	}).catch((error) => {
		console.error("Failed to load source language:", error);
		languageStats.textContent = `${t("source_lang")}：auto`;
		autoLangHint.style.display = "block";
	});
}

function updateWordsList() {
	wordsList.innerHTML = "";

	WordStorage.getWords().then((words) => {
		const allWordsArray = Object.keys(words);
		if (sortMode === "alpha_asc") {
			allWordsArray.sort((a, b) => a.localeCompare(b));
		} else if (sortMode === "freq_desc") {
			allWordsArray.sort((a, b) => {
				const ad = getPageCount(words[a]);
				const bd = getPageCount(words[b]);
				const af = getEncounterCount(words[a]);
				const bf = getEncounterCount(words[b]);
				if (bd !== ad) return bd - ad;
				if (bf !== af) return bf - af;
				return a.localeCompare(b);
			});
		} else {
			allWordsArray.sort((a, b) => {
				const at = words[a] && words[a].createdAt ? words[a].createdAt : 0;
				const bt = words[b] && words[b].createdAt ? words[b].createdAt : 0;
				if (bt !== at) return bt - at;
				return a.localeCompare(b);
			});
		}
		const unlearnedCount = allWordsArray.filter((word) => !words[word].learned).length;
		const wordsArray = allWordsArray.filter((word) => !words[word].learned);
		wordStats.textContent = `${t("words")}：${allWordsArray.length} | ${t("unlearned")}：${unlearnedCount}`;

		wordsArray.forEach((word) => {
			const wordItem = document.createElement("div");
			wordItem.className = "word-item";

			const wordTop = document.createElement("div");
			wordTop.className = "word-top";

			const wordMain = document.createElement("div");
			wordMain.className = "word-main";

			const wordLabelRow = document.createElement("div");
			wordLabelRow.className = "word-label-row";

			const wordToolbar = document.createElement("div");
			wordToolbar.className = "word-toolbar";

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
			if (lemmaValue && lemmaValue.toLowerCase() !== word.toLowerCase()) {
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

			const toggleLearnedButton = document.createElement("button");
			toggleLearnedButton.textContent = "✓";
			toggleLearnedButton.className = "word-tool action-learned";
			toggleLearnedButton.title = words[word].learned ? t("unmark") : t("mark");
			toggleLearnedButton.setAttribute("aria-label", words[word].learned ? t("unmark") : t("mark"));
			toggleLearnedButton.classList.toggle("is-active", !!words[word].learned);
			toggleLearnedButton.addEventListener("click", function () {
				retriggerEffect(toggleLearnedButton, "fx-learned");
				retriggerEffect(wordItem, "fx-row-learned");
				toggleLearned(word);
			});

			const exampleButton = document.createElement("button");
			let exampleCount = Array.isArray(words[word].examples) ? words[word].examples.length : 0;
			exampleButton.textContent = "≡";
			exampleButton.className = "word-tool action-example";
			exampleButton.dataset.count = String(exampleCount);

			const audioButton = document.createElement("button");
			audioButton.textContent = "🔊";
			audioButton.className = "word-tool action-audio";
			audioButton.title = t("pronounce");
			audioButton.setAttribute("aria-label", t("pronounce"));
			audioButton.addEventListener("click", function () {
				retriggerEffect(audioButton, "fx-audio");
				retriggerEffect(wordItem, "fx-row-audio");
				const utterance = new SpeechSynthesisUtterance(word);
				WordStorage.getSourceLang().then((sourceLang) => {
					utterance.lang = sourceLang;
					const voices = window.speechSynthesis.getVoices();
					for (let i = 0; i < voices.length; i += 1) {
						if (voices[i].lang === utterance.lang) {
							utterance.voice = voices[i];
							break;
						}
					}
					speechSynthesis.speak(utterance);
				});
			});

			const deleteButton = document.createElement("button");
			deleteButton.textContent = "✕";
			deleteButton.className = "word-tool action-delete";
			deleteButton.title = t("delete");
			deleteButton.setAttribute("aria-label", t("delete"));
			deleteButton.addEventListener("click", function () {
				retriggerEffect(deleteButton, "fx-delete");
				deleteWord(word, wordItem);
			});

			const exampleWrap = document.createElement("div");
			exampleWrap.className = "example-wrap";
			exampleWrap.style.display = "none";
			const examples = Array.isArray(words[word].examples) ? words[word].examples : [];
			let examplesRendered = false;

			function syncExampleButtonState(expanded = exampleWrap.style.display !== "none") {
				exampleButton.textContent = expanded ? "▾" : "≡";
				exampleButton.dataset.count = String(exampleCount);
				exampleButton.title = expanded
					? `${t("collapse")} (${exampleCount})`
					: `${t("examples")} (${exampleCount})`;
				exampleButton.setAttribute(
					"aria-label",
					expanded
						? `${t("collapse")} (${exampleCount})`
						: `${t("examples")} (${exampleCount})`
				);
				exampleButton.classList.toggle("is-active", expanded);
			}
			syncExampleButtonState();

			exampleButton.addEventListener("click", function () {
				const expanded = exampleWrap.style.display !== "none";
				retriggerEffect(exampleButton, "fx-example");
				retriggerEffect(wordItem, "fx-row-example");
				toggleAnimatedPanel(exampleWrap, !expanded);
				syncExampleButtonState(!expanded);
				if (!expanded && !examplesRendered) {
					renderExamples(exampleWrap, examples, word, (count) => {
						exampleCount = count;
						syncExampleButtonState();
					});
					examplesRendered = true;
				}
			});

			wordLabelRow.appendChild(wordSpan);
			wordLabelRow.appendChild(countSpan);
			wordMain.appendChild(wordLabelRow);
			wordMain.appendChild(meaningSpan);
			wordTop.appendChild(wordMain);
			wordToolbar.appendChild(audioButton);
			wordToolbar.appendChild(exampleButton);
			wordToolbar.appendChild(toggleLearnedButton);
			wordToolbar.appendChild(deleteButton);
			wordTop.appendChild(wordToolbar);
			wordItem.appendChild(wordTop);
			wordItem.appendChild(exampleWrap);
			wordsList.appendChild(wordItem);
		});

		if (!wordsList.hasChildNodes()) {
			const emptyMessage = document.createElement("p");
			emptyMessage.className = "empty";
			emptyMessage.textContent = t("empty_words");
			wordsList.appendChild(emptyMessage);
		}
		if (!popupTourAttempted) {
			popupTourAttempted = true;
			window.setTimeout(() => startPopupTour(false), 180);
		}
	}).catch((error) => {
		console.error("Failed to load words:", error);
		wordStats.textContent = `${t("words")}：-`;
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
	}).catch((error) => {
		if (wordItem) {
			wordItem.classList.remove("is-deleting");
		}
		console.error("Failed to delete word:", error);
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
	}).catch((error) => {
		console.error("Failed to toggle learned state:", error);
		UiToast.show(t("save_failed"), "error");
	});
}
