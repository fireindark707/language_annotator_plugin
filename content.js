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
		mark.style.background = "#fff3a3";
		mark.style.color = "#2a2210";
		mark.style.borderRadius = "4px";
		mark.style.padding = "0 2px";
		mark.style.boxShadow = "inset 0 -1px 0 rgba(0, 0, 0, 0.08)";
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
	showConfirmModal(`標記「${lowerCaseWord}」為已學會？`).then((confirmed) => {
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
			background: #ffffff;
			border: 1px solid #f0c9cf;
			border-radius: 12px;
			box-shadow: 0 14px 34px rgba(145, 15, 30, 0.2);
			padding: 10px 12px;
			color: #2a1014;
			font-family: "Manrope", "Noto Sans TC", "SF Pro Text", sans-serif;
			pointer-events: auto;
			animation: laWordPreviewIn 120ms ease-out;
		}
		.la-word-preview-meaning {
			font-size: 13px;
			font-weight: 700;
			line-height: 1.45;
			color: #7f1d2a;
		}
		.la-word-preview-list {
			margin: 8px 0 0;
			padding-left: 18px;
			font-size: 12px;
			line-height: 1.45;
			color: #344054;
		}
		.la-word-preview-list li {
			margin-bottom: 4px;
		}
		.la-word-preview-trans {
			margin-top: 2px;
			font-size: 11px;
			color: #667085;
			border-left: 2px solid #e4e7ec;
			padding-left: 6px;
		}
		@keyframes laWordPreviewIn {
			from { opacity: 0; transform: translateY(4px) scale(0.985); }
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
	span.style.backgroundColor = "#fff3a3";
	span.style.cursor = "pointer";
	span.style.color = "#2a2210";
	span.style.padding = "0 2px";
	span.style.borderRadius = "4px";
	span.style.boxShadow = "inset 0 -1px 0 rgba(0, 0, 0, 0.08)";
	span.title = "";
	span.addEventListener("mouseenter", () => {
		span.style.backgroundColor = "#ffe978";
		showWordPreview(span, meaning, examples);
	});
	span.addEventListener("mouseleave", () => {
		span.style.backgroundColor = "#fff3a3";
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

function stripOuterPunctuation(text) {
	return (text || "")
		.replace(/^[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{};:,./<>?\\|]+/u, "")
		.replace(/[\s"'“”‘’`~!@#$%^&*()\-_=+\[\]{};:,./<>?\\|]+$/u, "");
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

function isTooSimilarToAny(candidate, pool) {
	for (let i = 0; i < pool.length; i += 1) {
		if (sentenceSimilarity(candidate, pool[i]) >= EXAMPLE_SIMILARITY_THRESHOLD) {
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
			if (!storedWords[word]) continue;
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
	}).catch((error) => {
		console.error("Failed to highlight words:", error);
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
	title.textContent = "新增單字";

	const wordLine = document.createElement("div");
	wordLine.className = "la-addword-word";
	wordLine.textContent = normalizedWord;

	const hint = document.createElement("div");
	hint.className = "la-addword-hint";
	hint.textContent = "請輸入這個單字的意思";

	const input = document.createElement("textarea");
	input.className = "la-addword-input";
	input.placeholder = "正在取得翻譯...";
	input.rows = 3;
	let userEdited = false;

	const footer = document.createElement("div");
	footer.className = "la-addword-footer";

	const cancelBtn = document.createElement("button");
	cancelBtn.className = "la-addword-btn la-addword-cancel";
	cancelBtn.textContent = "取消";

	const saveBtn = document.createElement("button");
	saveBtn.className = "la-addword-btn la-addword-save";
	saveBtn.textContent = "儲存";

	footer.appendChild(cancelBtn);
	footer.appendChild(saveBtn);
	modal.appendChild(title);
	modal.appendChild(wordLine);
	modal.appendChild(hint);
	modal.appendChild(input);
	modal.appendChild(footer);
	overlay.appendChild(modal);
	document.body.appendChild(overlay);
	addWordModal = overlay;
	input.focus();
	input.addEventListener("input", () => {
		userEdited = true;
	});

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
			const existing = words[normalizedWord];
			words[normalizedWord] = {
				meaning: meaning,
				learned: false,
				createdAt: existing && existing.createdAt ? existing.createdAt : Date.now(),
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
	prefillMeaningFromTranslation(normalizedWord, input, () => userEdited, overlay);
}

function ensureAddWordModalStyle() {
	if (document.getElementById("laAddWordStyle")) return;
	const style = document.createElement("style");
	style.id = "laAddWordStyle";
	style.textContent = `
		.la-addword-overlay {
			position: fixed;
			inset: 0;
			background: rgba(30, 12, 14, 0.28);
			z-index: 2147483646;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 16px;
			animation: laFadeIn 140ms ease-out;
		}
		.la-addword-modal {
			width: min(520px, 96vw);
			background: #ffffff;
			border: 1px solid #efc8cd;
			border-radius: 14px;
			box-shadow: 0 20px 38px rgba(145, 15, 30, 0.2);
			padding: 16px;
			color: #2a1014;
			font-family: "Manrope", "Noto Sans TC", "SF Pro Text", sans-serif;
			animation: laRiseIn 170ms ease-out;
		}
		.la-addword-title {
			margin: 0;
			font-size: 18px;
			font-weight: 800;
		}
		.la-addword-word {
			margin-top: 8px;
			font-size: 14px;
			font-weight: 700;
			color: #ab1d2a;
		}
		.la-addword-hint {
			margin-top: 10px;
			font-size: 12px;
			color: #7d4a52;
		}
		.la-addword-input {
			width: 100%;
			margin-top: 8px;
			border: 1px solid #efc8cd;
			border-radius: 10px;
			padding: 10px;
			font-size: 14px;
			line-height: 1.4;
			resize: vertical;
			outline: none;
		}
		.la-addword-input:focus {
			border-color: #d91f26;
			box-shadow: 0 0 0 3px rgba(217, 31, 38, 0.12);
		}
		.la-addword-footer {
			margin-top: 12px;
			display: flex;
			justify-content: flex-end;
			gap: 8px;
		}
		.la-addword-btn {
			border: 0;
			border-radius: 9px;
			padding: 8px 12px;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
		}
		.la-addword-cancel {
			background: #ffe9ec;
			color: #8f1f2d;
		}
		.la-addword-save {
			background: #d91f26;
			color: #ffffff;
		}
		.la-confirm-overlay {
			position: fixed;
			inset: 0;
			background: rgba(30, 12, 14, 0.28);
			z-index: 2147483646;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 16px;
			animation: laFadeIn 140ms ease-out;
		}
		.la-confirm-modal {
			width: min(420px, 94vw);
			background: #ffffff;
			border: 1px solid #efc8cd;
			border-radius: 14px;
			box-shadow: 0 20px 38px rgba(145, 15, 30, 0.2);
			padding: 16px;
			color: #2a1014;
			font-family: "Manrope", "Noto Sans TC", "SF Pro Text", sans-serif;
			animation: laRiseIn 170ms ease-out;
		}
		.la-confirm-title {
			margin: 0 0 8px 0;
			font-size: 16px;
			font-weight: 800;
		}
		.la-confirm-desc {
			margin: 0;
			font-size: 13px;
			color: #7d4a52;
			line-height: 1.45;
		}
		.la-confirm-footer {
			margin-top: 14px;
			display: flex;
			justify-content: flex-end;
			gap: 8px;
		}
		.la-confirm-btn {
			border: 0;
			border-radius: 9px;
			padding: 8px 12px;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
		}
		.la-confirm-cancel {
			background: #ffe9ec;
			color: #8f1f2d;
		}
		.la-confirm-ok {
			background: #d91f26;
			color: #ffffff;
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
		title.textContent = "確認操作";

		const desc = document.createElement("p");
		desc.className = "la-confirm-desc";
		desc.textContent = message;

		const footer = document.createElement("div");
		footer.className = "la-confirm-footer";

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "la-confirm-btn la-confirm-cancel";
		cancelBtn.textContent = "取消";

		const okBtn = document.createElement("button");
		okBtn.className = "la-confirm-btn la-confirm-ok";
		okBtn.textContent = "確認";

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

function prefillMeaningFromTranslation(word, inputEl, isUserEdited, modalOverlay) {
	WordStorage.getSourceLang().then((sourceLang) => {
		chrome.runtime.sendMessage(
			{ action: "translate", text: word, sourceLang: sourceLang || "auto" },
			(response) => {
				if (!modalOverlay.isConnected) return;
				if (chrome.runtime.lastError) {
					inputEl.placeholder = "例如：這個詞在句子中的意思...";
					return;
				}
				const translated = response && response.translation ? response.translation.trim() : "";
				if (translated && !isUserEdited() && inputEl.value.trim() === "") {
					inputEl.value = translated;
				}
				inputEl.placeholder = "例如：這個詞在句子中的意思...";
			}
		);
	}).catch(() => {
		inputEl.placeholder = "例如：這個詞在句子中的意思...";
	});
}

// 勾选后自动翻译
document.addEventListener("mouseup", function () {
	const selectedText = window.getSelection().toString().trim();
	if (!(selectedText.length > 0 && selectedText.length <= 800)) return;
	WordStorage.getAutoTranslateOnSelect().then((enabled) => {
		if (enabled) translateText(selectedText);
	}).catch((error) => {
		console.error("Failed to read auto-translate setting:", error);
		translateText(selectedText);
	});
});

function translateText(text) {
	WordStorage.getSourceLang().then((sourceLang) => {
		// 使用sourceLang进行翻译请求
		chrome.runtime.sendMessage(
			{ action: "translate", text: text, sourceLang: sourceLang },
			function (response) {
				showTranslation(response.translation);
			}
		);
	}).catch((error) => {
		console.error("Failed to get source language:", error);
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
	translationBox.style.setProperty('background', '#ffffff', 'important');
	translationBox.style.setProperty('color', '#000000', 'important');
	translationBox.style.setProperty('border', '1px solid #e6b8bc', 'important');
	translationBox.style.setProperty('border-radius', '12px', 'important');
	translationBox.style.setProperty('box-shadow', '0 12px 28px rgba(145, 15, 30, 0.22)', 'important');
	translationBox.style.setProperty('opacity', '1', 'important');
	translationBox.style.setProperty('mix-blend-mode', 'normal', 'important');
	translationBox.style.setProperty('backdrop-filter', 'blur(2px)', 'important');
	translationBox.style.zIndex = '10000';
	translationBox.style.maxWidth = `${window.innerWidth / 3}px`; // 设置最大宽度为屏幕宽度的1/3
	translationBox.style.overflow = 'auto'; // 超出部分显示滚动条
	translationBox.style.minWidth = '220px';
	translationBox.style.padding = '10px 30px 10px 10px';
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
	closeBtn.style.color = "#9b3a44";
	closeBtn.style.fontSize = "14px";
	closeBtn.style.cursor = "pointer";
	closeBtn.style.lineHeight = "1";
	closeBtn.style.padding = "0 2px";
	closeBtn.style.zIndex = "1";

	const body = document.createElement("div");
	body.style.fontSize = "13px";
	body.style.lineHeight = "1.5";
	body.textContent = translation;

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

	document.body.appendChild(translationBox);

	// 自动移除浮框，例如10秒后
	setTimeout(() => {
		closeBox();
	}, 10000);
}

function ensureTranslationUiStyles() {
	if (document.getElementById("pluginTranslationStyle")) return;
	const style = document.createElement("style");
	style.id = "pluginTranslationStyle";
	style.textContent = `
		@keyframes pluginTranslationIn {
			from { opacity: 0; transform: translateY(6px) scale(0.98); }
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
