(function (global) {
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
		return sortExamples(pinned.concat(unpinned.slice(0, maxLimit)));
	}

	function isLikelyGarbageSentence(text) {
		const t = normalizeText(text);
		if (!t) return true;
		if (t.length < 8 || t.length > 160) return true;
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

	function getSimilarityThresholdForPair(a, b, defaultThreshold) {
		const lenA = tokenizeForSimilarity(a).length;
		const lenB = tokenizeForSimilarity(b).length;
		const minLen = Math.min(lenA, lenB);
		if (minLen <= 4) return 0.62;
		if (minLen <= 6) return 0.74;
		return typeof defaultThreshold === "number" ? defaultThreshold : 0.88;
	}

	function isTooSimilarToAny(candidate, pool, defaultThreshold) {
		for (let i = 0; i < pool.length; i += 1) {
			const threshold = getSimilarityThresholdForPair(candidate, pool[i], defaultThreshold);
			if (sentenceSimilarity(candidate, pool[i]) >= threshold) return true;
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

	function splitIntoSentences(text, lang) {
		const normalized = normalizeText(text);
		if (!normalized) return [];
		if (isLikelyGarbageSentence(normalized)) return [];
		if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
			try {
				const segmenter = new Intl.Segmenter(lang || "en", { granularity: "sentence" });
				const segments = Array.from(segmenter.segment(normalized), (item) => normalizeText(item.segment));
				const sentences = segments.filter((s) => s.length >= 8 && !isLikelyGarbageSentence(s));
				if (sentences.length > 0) return sentences;
			} catch (_) {}
		}
		const matches = normalized.match(/[^.!?。！？؟؛۔\u0964\u0965\n]+[.!?。！？؟؛۔\u0964\u0965]?/g) || [];
		const sentences = matches.map((s) => normalizeText(s)).filter((s) => !isLikelyGarbageSentence(s));
		if (sentences.length > 0) return sentences;
		return isLikelyGarbageSentence(normalized) ? [] : [normalized];
	}

	global.ExampleUtils = {
		normalizeText,
		stripOuterPunctuation,
		isLowInformationExample,
		normalizeExampleEntry,
		normalizeExampleList,
		sortExamples,
		enforceExampleLimit,
		isLikelyGarbageSentence,
		normalizeForSimilarity,
		tokenizeForSimilarity,
		sentenceSimilarity,
		getSimilarityThresholdForPair,
		isTooSimilarToAny,
		hasContainmentRelation,
		splitIntoSentences,
	};
})(globalThis);
