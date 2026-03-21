(function (global) {
	const DIFFICULTY_STYLE_ID = "laDifficultyPanelStyle";
	const DIFFICULTY_PANEL_ID = "laDifficultyPanel";

	function ensureDifficultyPanelStyle(doc) {
		if (doc.getElementById(DIFFICULTY_STYLE_ID)) return;
		const style = doc.createElement("style");
		style.id = DIFFICULTY_STYLE_ID;
		style.textContent = [
			".la-difficulty-panel{all:unset;box-sizing:border-box;position:fixed;bottom:20px;left:20px;",
			"z-index:2147483644;",
			"background:rgba(255,250,243,0.80);",
			"backdrop-filter:blur(14px) saturate(1.3);",
			"-webkit-backdrop-filter:blur(14px) saturate(1.3);",
			"border:1px solid rgba(220,202,189,0.55);",
			"border-radius:14px 16px 10px 18px;",
			"box-shadow:0 6px 20px rgba(88,63,50,0.10),0 1px 3px rgba(88,63,50,0.06);",
			"padding:10px 13px 11px;",
			"min-width:168px;max-width:220px;",
			"font-family:'Noto Sans TC','Hiragino Sans','Yu Gothic UI',sans-serif;",
			"font-size:12px;color:#34251f;",
			"animation:laDifficultyIn 240ms ease-out;pointer-events:auto;}",

			".la-difficulty-panel-head{display:flex;justify-content:space-between;",
			"align-items:center;gap:6px;margin-bottom:6px;}",

			".la-difficulty-panel-label{font-size:10px;font-weight:700;color:#9a7a6d;",
			"letter-spacing:0.06em;text-transform:uppercase;}",

			".la-difficulty-panel-close{all:unset;cursor:pointer;",
			"display:flex;align-items:center;justify-content:center;",
			"width:22px;height:22px;border-radius:50%;",
			"color:#b09080;font-size:15px;line-height:1;",
			"transition:background 140ms,color 140ms;}",
			".la-difficulty-panel-close:hover{background:rgba(165,81,67,0.13);color:#8e4337;}",

			".la-difficulty-panel-level{font-size:20px;font-weight:800;color:#5f4035;",
			"font-family:'Noto Serif TC','Hiragino Mincho ProN','Yu Mincho',serif;",
			"letter-spacing:0.02em;margin-bottom:8px;}",

			".la-difficulty-panel-breakdown{display:flex;height:4px;border-radius:3px;",
			"overflow:hidden;gap:1px;margin-bottom:7px;}",
			".la-difficulty-panel-seg-A1{background:#c8c0b4;}",
			".la-difficulty-panel-seg-A2{background:#44AA44;}",
			".la-difficulty-panel-seg-B1{background:#0088FF;}",
			".la-difficulty-panel-seg-B2{background:#AA00FF;}",
			".la-difficulty-panel-seg-C1{background:#FFD700;}",
			".la-difficulty-panel-seg-C2{background:#FF0000;}",

			".la-difficulty-panel-stats{font-size:10px;color:#8a7268;line-height:1.6;}",

			".la-c2-gloss{font-size:0.82em;color:#9a8070;",
			"background:rgba(185,162,145,0.13);",
			"border-radius:3px;padding:0 3px;margin-left:1px;}",

			"@keyframes laDifficultyIn{",
			"from{opacity:0;transform:translateY(10px) scale(0.96);}",
			"to{opacity:1;transform:translateY(0) scale(1);}",
			"}",
		].join("");
		(doc.head || doc.documentElement).appendChild(style);
	}

	function extractArticleText(doc) {
		const selectors = "p, article, section, blockquote, li";
		const elements = doc.querySelectorAll(selectors);
		const parts = [];
		elements.forEach(function (el) {
			if (el.closest && (
				el.closest("[class^='la-']") ||
				el.closest("[id^='la']") ||
				el.closest("[id='" + DIFFICULTY_PANEL_ID + "']")
			)) return;
			const text = (el.innerText || el.textContent || "").trim();
			if (text.length > 20) parts.push(text);
		});
		return parts.join(" ");
	}

	// zh/ja/ko: unspaced scripts — each character is its own word unit
	function isCharLevelLang(lang) {
		return lang === "zh" || lang === "ja" || lang === "ko";
	}

	// th and other scripts with very short words need minLen=1 but are space-separated
	function isShortWordLang(lang) {
		return lang === "th";
	}

	function tokenizeArticle(text, maxTokens, sourceLang) {
		const limit = typeof maxTokens === "number" ? maxTokens : 500;
		const tokens = new Set();
		if (isCharLevelLang(sourceLang)) {
			// Unspaced CJK: each Unicode letter codepoint is its own word unit
			for (const ch of (text || "")) {
				if (tokens.size >= limit) break;
				if (/\p{L}/u.test(ch)) tokens.add(ch.toLowerCase());
			}
		} else {
			const minLen = isShortWordLang(sourceLang) ? 1 : 3;
			const regex = /\p{L}+/gu;
			let match;
			while ((match = regex.exec(text)) !== null) {
				if (tokens.size >= limit) break;
				const token = match[0].toLowerCase();
				if (token.length >= minLen) tokens.add(token);
			}
		}
		return Array.from(tokens);
	}

	// Uses the same 6-tier CEFR system as WordfreqUtils.getDifficultyTier.
	// level = first CEFR tier where cumulative coverage (that tier and below) >= 90%
	// e.g. if A1+A2 words cover 92% of tokens, article is A2 level.
	// lemmaZipfMap: optional Map<token, effectiveZipf> — pre-resolved lemma-adjusted scores
	function computeDistribution(tokens, sourceLang, lemmaZipfMap) {
		const WordfreqUtils = global.WordfreqUtils;
		if (!WordfreqUtils || !WordfreqUtils.isReady(sourceLang)) return null;
		let a1 = 0, a2 = 0, b1 = 0, b2 = 0, c1 = 0, c2 = 0, scored = 0;
		const c2Tokens = new Set();
		for (let i = 0; i < tokens.length; i += 1) {
			const zipf = (lemmaZipfMap && lemmaZipfMap.has(tokens[i]))
				? lemmaZipfMap.get(tokens[i])
				: WordfreqUtils.getZipf(tokens[i], sourceLang);
			const tier = WordfreqUtils.getDifficultyTier(zipf, sourceLang);
			if (tier === null) continue;
			scored += 1;
			if (tier === "A1")      a1 += 1;
			else if (tier === "A2") a2 += 1;
			else if (tier === "B1") b1 += 1;
			else if (tier === "B2") b2 += 1;
			else if (tier === "C1") c1 += 1;
			else                  { c2 += 1; c2Tokens.add(tokens[i]); }
		}
		if (scored === 0) return null;
		// Cumulative coverage: first tier where cumulative count / scored >= 0.9
		const threshold = 0.90;
		let level;
		if (a1 / scored >= threshold)                         level = "A1";
		else if ((a1 + a2) / scored >= threshold)             level = "A2";
		else if ((a1 + a2 + b1) / scored >= threshold)        level = "B1";
		else if ((a1 + a2 + b1 + b2) / scored >= threshold)   level = "B2";
		else if ((a1 + a2 + b1 + b2 + c1) / scored >= threshold) level = "C1";
		else                                                   level = "C2";
		return { a1, a2, b1, b2, c1, c2, scored, level, c2Tokens };
	}

	function buildPanel(doc, stats) {
		const total = stats.scored;
		const segs = [
			{ key: "A1", count: stats.a1 },
			{ key: "A2", count: stats.a2 },
			{ key: "B1", count: stats.b1 },
			{ key: "B2", count: stats.b2 },
			{ key: "C1", count: stats.c1 },
			{ key: "C2", count: stats.c2 },
		];

		const panel = doc.createElement("div");
		panel.className = "la-difficulty-panel";
		panel.id = DIFFICULTY_PANEL_ID;

		const head = doc.createElement("div");
		head.className = "la-difficulty-panel-head";

		const label = doc.createElement("div");
		label.className = "la-difficulty-panel-label";
		label.textContent = "Article Difficulty";

		const closeBtn = doc.createElement("button");
		closeBtn.type = "button";
		closeBtn.className = "la-difficulty-panel-close";
		closeBtn.textContent = "\u00d7";
		closeBtn.title = "Close";
		closeBtn.addEventListener("click", function () { panel.remove(); });

		head.appendChild(label);
		head.appendChild(closeBtn);

		const LEVEL_COLORS = { A1: "#a0988e", A2: "#44AA44", B1: "#0088FF", B2: "#AA00FF", C1: "#c8a000", C2: "#FF0000" };
		const levelEl = doc.createElement("div");
		levelEl.className = "la-difficulty-panel-level";
		levelEl.textContent = stats.level;
		levelEl.style.color = LEVEL_COLORS[stats.level] || "#5f4035";

		const bar = doc.createElement("div");
		bar.className = "la-difficulty-panel-breakdown";

		segs.forEach(function (seg) {
			if (seg.count <= 0) return;
			const el = doc.createElement("div");
			el.className = "la-difficulty-panel-seg-" + seg.key;
			el.style.flex = String(Math.round((seg.count / total) * 100));
			bar.appendChild(el);
		});

		const statsEl = doc.createElement("div");
		statsEl.className = "la-difficulty-panel-stats";
		const cumulative = { A1: stats.a1, A2: stats.a1 + stats.a2, B1: stats.a1 + stats.a2 + stats.b1,
			B2: stats.a1 + stats.a2 + stats.b1 + stats.b2,
			C1: stats.a1 + stats.a2 + stats.b1 + stats.b2 + stats.c1, C2: total };
		const coveragePct = Math.round(cumulative[stats.level] / total * 100);
		statsEl.textContent = total + " words \u00b7 " + coveragePct + "% \u2264 " + stats.level;

		panel.appendChild(head);
		panel.appendChild(levelEl);
		panel.appendChild(bar);
		panel.appendChild(statsEl);
		return panel;
	}

	// Find the start index of `word` (lowercase) as a whole word in `text`/`lower`.
	// Returns -1 if not found.
	function findC2WordStart(text, lower, word) {
		const isWordChar = function (c) { return c && /[\p{L}\p{N}]/u.test(c); };
		let i = 0;
		while (i < lower.length) {
			const idx = lower.indexOf(word, i);
			if (idx === -1) return -1;
			const end = idx + word.length;
			if (!isWordChar(lower[idx - 1]) && !isWordChar(lower[end])) return idx;
			i = idx + 1;
		}
		return -1;
	}

	// Insert inline gloss spans after C2 words in article text nodes.
	// translations: Map<word(lowercase), translatedString>
	function annotateC2InDoc(doc, translations) {
		const MAX_PER_WORD = 3;
		const occurrences = new Map();
		const seen = new Set();
		const nodes = [];

		// Collect text nodes from article-like elements, skipping extension UI and highlights
		doc.querySelectorAll("p, li, blockquote, article, section").forEach(function (el) {
			if (el.closest && (
				el.closest("[class^='la-']") ||
				el.closest("[id^='la']") ||
				el.closest("[id='" + DIFFICULTY_PANEL_ID + "']")
			)) return;
			(function walk(n) {
				if (n.nodeType === 1) {
					// Skip already-highlighted words and extension elements
					if (n.classList && (
						n.classList.contains("plugin-highlight-word") ||
						n.classList.contains("la-c2-gloss")
					)) return;
					n.childNodes.forEach(walk);
				} else if (n.nodeType === 3) {
					if (!seen.has(n) && (n.nodeValue || "").trim().length > 1) {
						seen.add(n);
						nodes.push(n);
					}
				}
			}(el));
		});

		for (let ni = 0; ni < nodes.length; ni++) {
			const node = nodes[ni];
			if (!node.parentNode) continue;

			const text = node.nodeValue;
			const lower = text.toLowerCase();

			// Find the leftmost C2 word in this text node
			let bestWord = null, bestIdx = -1;
			translations.forEach(function (_, word) {
				if ((occurrences.get(word) || 0) >= MAX_PER_WORD) return;
				const idx = findC2WordStart(text, lower, word);
				if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
					bestIdx = idx;
					bestWord = word;
				}
			});

			if (bestIdx === -1 || !bestWord) continue;

			occurrences.set(bestWord, (occurrences.get(bestWord) || 0) + 1);
			const endIdx = bestIdx + bestWord.length;

			const before = doc.createTextNode(text.slice(0, endIdx));
			const gloss = doc.createElement("span");
			gloss.className = "la-c2-gloss";
			gloss.textContent = " (" + translations.get(bestWord) + ")";
			const remainder = text.slice(endIdx);

			const parent = node.parentNode;
			parent.insertBefore(before, node);
			parent.insertBefore(gloss, node);
			if (remainder) {
				const after = doc.createTextNode(remainder);
				parent.insertBefore(after, node);
				nodes.push(after); // re-queue remainder to catch more C2 words in same run
			}
			parent.removeChild(node);
		}
	}

	function analyzeAndShow(options) {
		const sourceLang = options && options.sourceLang;
		const doc = (options && options.document) || document;
		const translateFn = options && options.translate;
		const getLemmaFn = options && options.getLemma; // (word) => Promise<string|null>
		const WordfreqUtils = global.WordfreqUtils;

		if (!sourceLang || sourceLang === "auto") return;
		if (!WordfreqUtils || !WordfreqUtils.isSupported(sourceLang)) return;

		WordfreqUtils.initForLang(sourceLang).then(async function (ready) {
			if (!ready) return;

			ensureDifficultyPanelStyle(doc);

			const existing = doc.getElementById(DIFFICULTY_PANEL_ID);
			if (existing) existing.remove();

			// Clear any previous C2 gloss annotations
			doc.querySelectorAll(".la-c2-gloss").forEach(function (el) { el.remove(); });

			const text = extractArticleText(doc);
			if (!text || text.length < 100) return;

			const tokens = tokenizeArticle(text, 500, sourceLang);
			if (tokens.length < 20) return;

			// Pre-resolve lemmas for C1/C2 tokens so inflected forms of common words
			// aren't penalized — use max(zipf(word), zipf(lemma)) for scoring.
			let lemmaZipfMap = null;
			if (getLemmaFn && !isCharLevelLang(sourceLang)) {
				const c1c2 = tokens.filter(function (t) {
					const z = WordfreqUtils.getZipf(t, sourceLang);
					const tier = WordfreqUtils.getDifficultyTier(z, sourceLang);
					return tier === "C1" || tier === "C2";
				});
				if (c1c2.length > 0) {
					const pairs = await Promise.all(c1c2.map(async function (word) {
						try {
							const lemma = await getLemmaFn(word);
							if (!lemma) return null;
							const lowerLemma = lemma.toLowerCase();
							if (lowerLemma === word) return null;
							const lemmaZipf = WordfreqUtils.getZipf(lowerLemma, sourceLang);
							if (lemmaZipf === null) return null;
							const wordZipf = WordfreqUtils.getZipf(word, sourceLang);
							const effective = (wordZipf === null) ? lemmaZipf : Math.max(wordZipf, lemmaZipf);
							if (effective <= (wordZipf || 0)) return null; // no improvement
							return [word, effective];
						} catch (_) { return null; }
					}));
					const valid = pairs.filter(Boolean);
					if (valid.length > 0) lemmaZipfMap = new Map(valid);
				}
			}

			const stats = computeDistribution(tokens, sourceLang, lemmaZipfMap);
			if (!stats) return;

			const panel = buildPanel(doc, stats);
			(doc.body || doc.documentElement).appendChild(panel);

			// Annotate C2 words with inline translations (skip CJK — individual chars are too short to gloss)
			if (translateFn && stats.c2Tokens && stats.c2Tokens.size > 0 && !isCharLevelLang(sourceLang)) {
				const c2Words = Array.from(stats.c2Tokens)
					.filter(function (w) { return w.length >= 3; })
					.slice(0, 20);
				Promise.all(c2Words.map(function (word) {
					return Promise.resolve(translateFn(word))
						.then(function (t) { return t ? [word, t] : null; })
						.catch(function () { return null; });
				})).then(function (results) {
					const translations = new Map(results.filter(Boolean));
					if (translations.size > 0) annotateC2InDoc(doc, translations);
				}).catch(function () {});
			}
		}).catch(function () {});
	}

	global.ContentDifficulty = { analyzeAndShow, extractArticleText, tokenizeArticle, computeDistribution };
})(globalThis);
