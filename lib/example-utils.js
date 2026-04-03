(function (global) {
	const SentenceSplitterRef = global.SentenceSplitter;
	const segmenterCache = new Map();

	function normalizeText(text) {
		return (text || "").replace(/\s+/g, " ").trim();
	}

	function normalizeLanguageHint(lang) {
		const raw = ((lang || "").trim().toLowerCase() || "en");
		if (!raw || raw === "auto") return "en";
		if (raw === "fil") return "tl";
		if (raw.startsWith("zh")) return "zh";
		return raw.split("-")[0] || "en";
	}

	function getWordSegmenter(lang) {
		if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return null;
		const locale = normalizeLanguageHint(lang);
		if (!segmenterCache.has(locale)) {
			try {
				segmenterCache.set(locale, new Intl.Segmenter(locale, { granularity: "word" }));
			} catch (_) {
				segmenterCache.set(locale, null);
			}
		}
		return segmenterCache.get(locale);
	}

	function foldForMatch(text, lang) {
		const locale = normalizeLanguageHint(lang);
		try {
			return String(text || "").toLocaleLowerCase(locale);
		} catch (_) {
			return String(text || "").toLowerCase();
		}
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
		const compactSentence = s.replace(/[^\p{L}\p{N}]+/gu, "");
		const compactWord = w.replace(/[^\p{L}\p{N}]+/gu, "");
		if (compactSentence && compactWord && compactSentence === compactWord) return true;
		return false;
	}

	function normalizeExampleEntry(entry) {
		if (typeof entry === "string") {
			const text = normalizeText(entry);
			return text
				? { text, pinned: false, createdAt: 0, pinnedAt: 0, translation: "", translatedAt: 0, sourceUrl: "", capturedAt: 0 }
				: null;
		}
		if (!entry || typeof entry !== "object") return null;
		const text = normalizeText(entry.text || "");
		if (!text) return null;
		return {
			text,
			pinned: !!entry.pinned,
			createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
			pinnedAt: typeof entry.pinnedAt === "number" ? entry.pinnedAt : 0,
			translation: typeof entry.translation === "string" ? entry.translation : "",
			translatedAt: typeof entry.translatedAt === "number" ? entry.translatedAt : 0,
			sourceUrl: typeof entry.sourceUrl === "string"
				? entry.sourceUrl
				: (typeof entry.url === "string" ? entry.url : ""),
			capturedAt: typeof entry.capturedAt === "number"
				? entry.capturedAt
				: (typeof entry.timestamp === "number" ? entry.timestamp : 0),
			contextScore: typeof entry.contextScore === "number" ? entry.contextScore : null,
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
			const aScore = typeof a.contextScore === "number" ? a.contextScore : -1;
			const bScore = typeof b.contextScore === "number" ? b.contextScore : -1;
			if (aScore !== bScore) return bScore - aScore;
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
		return sortExamples(pinned.concat(unpinned.slice(0, maxLimit)));
	}

	function isLikelyGarbageSentence(text) {
		const t = normalizeText(text);
		if (!t) return true;
		if (t.length < 8) return true;
		if (!/\p{L}/u.test(t)) return true;
		if (/(document\.getElementById|addEventListener|querySelector|function\s*\(|=>|var\s+\w+|const\s+\w+|let\s+\w+|return\s+|class\*=|elementor-|\.share-wrap|display\s*:|font-size\s*:|line-height\s*:|\b[a-z_$][a-z0-9_$]*\.[a-z_$][a-z0-9_$]*\s*\()/i.test(t)) {
			return true;
		}
		if (/[.#][a-z0-9_-]+\s*\{[^}]*:[^}]*;[^}]*\}/i.test(t)) return true;
		if (/\{[^}]*:[^}]*;[^}]*\}/.test(t) && /;/.test(t)) return true;
		if (/(https?:\/\/|\\u[0-9a-fA-F]{4}|__typename|item_logging_info|source_as_enum|Y2lkOmU6|&_nc_|\"id\":|\"name\":)/i.test(t)) {
			return true;
		}
		const structural = (t.match(/[{}[\]<>=\"_&]/g) || []).length;
		if (structural / t.length > 0.06) return true;
		const semicolons = (t.match(/;/g) || []).length;
		if (semicolons >= 2) return true;
		if (/\S{45,}/.test(t)) return true;
		return false;
	}

	function isReasonableExampleSentence(text) {
		const t = normalizeText(text);
		if (!t) return false;
		return t.length >= 8 && t.length <= 280;
	}

	function splitIntoSentencesFallback(text, lang) {
		const normalized = normalizeText(text);
		if (!normalized) return [];
		const longRawText = normalized.length > 280;
		if (!longRawText && isLikelyGarbageSentence(normalized)) return [];
		if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
			try {
				const segmenter = new Intl.Segmenter(lang || "en", { granularity: "sentence" });
				const segments = Array.from(segmenter.segment(normalized), (item) => normalizeText(item.segment));
				const sentences = segments.filter((s) => isReasonableExampleSentence(s) && !isLikelyGarbageSentence(s));
				if (sentences.length > 0) return sentences;
			} catch (_) {}
		}
		const matches = normalized.match(/[^.!?。！？؟؛۔\u0964\u0965\n]+[.!?。！？؟؛۔\u0964\u0965]?/g) || [];
		const sentences = matches
			.map((s) => normalizeText(s))
			.filter((s) => isReasonableExampleSentence(s) && !isLikelyGarbageSentence(s));
		if (sentences.length > 0) return sentences;
		if (!longRawText && isReasonableExampleSentence(normalized) && !isLikelyGarbageSentence(normalized)) {
			return [normalized];
		}
		return [];
	}

	function normalizeForSimilarity(text) {
		return normalizeText(text)
			.replace(/[^\p{L}\p{N}\s]/gu, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function tokenizeForSimilarity(text, lang) {
		const normalized = normalizeForSimilarity(text);
		if (!normalized) return [];
		const segmenter = getWordSegmenter(lang);
		if (segmenter) {
			const tokens = [];
			for (const part of segmenter.segment(normalized)) {
				if (!part || !part.isWordLike) continue;
				const token = foldForMatch(part.segment, lang).replace(/[^\p{L}\p{N}]+/gu, "").trim();
				if (token) tokens.push(token);
			}
			if (tokens.length > 0) return tokens;
		}
		return normalized
			.toLowerCase()
			.split(/\s+/)
			.map((item) => item.trim())
			.filter(Boolean);
	}

	function sentenceSimilarity(a, b, lang) {
		const tokensA = tokenizeForSimilarity(a, lang);
		const tokensB = tokenizeForSimilarity(b, lang);
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

	function getSimilarityThresholdForPair(a, b, defaultThreshold, lang) {
		const lenA = tokenizeForSimilarity(a, lang).length;
		const lenB = tokenizeForSimilarity(b, lang).length;
		const minLen = Math.min(lenA, lenB);
		if (minLen <= 4) return 0.62;
		if (minLen <= 6) return 0.74;
		return typeof defaultThreshold === "number" ? defaultThreshold : 0.88;
	}

	function isTooSimilarToAny(candidate, pool, defaultThreshold, lang) {
		for (let i = 0; i < pool.length; i += 1) {
			const threshold = getSimilarityThresholdForPair(candidate, pool[i], defaultThreshold, lang);
			if (sentenceSimilarity(candidate, pool[i], lang) >= threshold) return true;
		}
		return false;
	}

	function hasTokenContainment(containerTokens, innerTokens) {
		if (innerTokens.length === 0 || containerTokens.length < innerTokens.length) return false;
		for (let i = 0; i <= containerTokens.length - innerTokens.length; i += 1) {
			let matched = true;
			for (let j = 0; j < innerTokens.length; j += 1) {
				if (containerTokens[i + j] !== innerTokens[j]) {
					matched = false;
					break;
				}
			}
			if (matched) return true;
		}
		return false;
	}

	function hasContainmentRelation(candidate, pool, lang) {
		const c = normalizeText(candidate);
		if (!c) return true;
		const candidateTokens = tokenizeForSimilarity(candidate, lang);
		const foldedCandidate = foldForMatch(c, lang);
		for (let i = 0; i < pool.length; i += 1) {
			const p = normalizeText(pool[i]);
			if (!p) continue;
			const poolTokens = tokenizeForSimilarity(p, lang);
			if (
				hasTokenContainment(candidateTokens, poolTokens) ||
				hasTokenContainment(poolTokens, candidateTokens)
			) {
				return true;
			}
			if (candidateTokens.length > 0 && poolTokens.length > 0) {
				continue;
			}
			const foldedPool = foldForMatch(p, lang);
			if (foldedCandidate.includes(foldedPool) || foldedPool.includes(foldedCandidate)) return true;
		}
		return false;
	}

	function isWordChar(char) {
		return !!char && /[\p{L}\p{N}]/u.test(char);
	}

	function findWholeWordMatch(text, word, lang, fromIndex) {
		const rawText = String(text || "");
		const rawWord = String(word || "").trim();
		const startAt = typeof fromIndex === "number" ? fromIndex : 0;
		if (!rawText || !rawWord) return null;
		const segmenter = getWordSegmenter(lang);
		if (segmenter) {
			const foldedWord = foldForMatch(rawWord, lang);
			for (const part of segmenter.segment(rawText)) {
				if (!part || !part.isWordLike) continue;
				if (typeof part.index !== "number" || part.index < startAt) continue;
				if (foldForMatch(part.segment, lang) !== foldedWord) continue;
				return { index: part.index, length: part.segment.length };
			}
		}
		const lowerText = rawText.toLowerCase();
		const lowerWord = rawWord.toLowerCase();
		let cursor = startAt;
		while (cursor < rawText.length) {
			const index = lowerText.indexOf(lowerWord, cursor);
			if (index === -1) return null;
			const end = index + rawWord.length;
			const prev = index > 0 ? rawText[index - 1] : "";
			const next = end < rawText.length ? rawText[end] : "";
			if (!isWordChar(prev) && !isWordChar(next)) {
				return { index, length: rawWord.length };
			}
			cursor = index + 1;
		}
		return null;
	}

	function splitIntoSentences(text, lang) {
		const normalized = normalizeText(text);
		if (!normalized) return [];
		const sentences = SentenceSplitterRef && typeof SentenceSplitterRef.splitIntoSentences === "function"
			? SentenceSplitterRef.splitIntoSentences(normalized, lang || "en", splitIntoSentencesFallback)
			: splitIntoSentencesFallback(normalized, lang || "en");
		return sentences
			.map((item) => normalizeText(item))
			.filter((item) => isReasonableExampleSentence(item) && !isLikelyGarbageSentence(item));
	}

		global.ExampleUtils = {
			normalizeText,
			normalizeLanguageHint,
			getWordSegmenter,
			foldForMatch,
			stripOuterPunctuation,
			isLowInformationExample,
			normalizeExampleEntry,
		normalizeExampleList,
		sortExamples,
		enforceExampleLimit,
			isLikelyGarbageSentence,
			isReasonableExampleSentence,
			splitIntoSentencesFallback,
			normalizeForSimilarity,
			tokenizeForSimilarity,
			sentenceSimilarity,
			getSimilarityThresholdForPair,
			isTooSimilarToAny,
			hasContainmentRelation,
			findWholeWordMatch,
			splitIntoSentences,
		};
})(globalThis);
