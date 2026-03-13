(function (global) {
	const CLOZE_MIN_TOKENS = 4;
	const CLOZE_MAX_TOKENS = 20;
	const CLOZE_MIN_CODEPOINTS = 12;
	const CLOZE_MIN_CODEPOINTS_COMPACT = 8;
	const CLOZE_MAX_CODEPOINTS = 140;
	const CLOZE_MAX_NOISE_RATIO = 0.12;
	const WORDLIKE_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-·][\p{L}\p{M}\p{N}]+)*/u;
	const DIGIT_RE = /\p{N}/gu;
	const SYMBOL_RE = /[^\p{L}\p{M}\p{N}\s.,!?;:'"“”‘’()\[\]{}\-]/gu;
	const COMPACT_SCRIPT_BASES = new Set(["zh", "ja", "ko", "th", "km", "lo", "my"]);

	function shuffle(arr) {
		const list = arr.slice();
		for (let i = list.length - 1; i > 0; i -= 1) {
			const j = Math.floor(Math.random() * (i + 1));
			[list[i], list[j]] = [list[j], list[i]];
		}
		return list;
	}

	function chooseDistractors(base, field, answer, count) {
		const pool = shuffle(base.filter((x) => x[field] && x[field] !== answer));
		return pool.slice(0, count).map((x) => x[field]);
	}

	function getReviewedWordsUnique(words) {
		return Array.from(new Set((Array.isArray(words) ? words : []).filter(Boolean)));
	}

	function getQuestionPool(words) {
		return (Array.isArray(words) ? words : []).filter((x) => x && x.word && x.meaning && !x.learned);
	}

	function escapeRegExp(text) {
		return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	function normalizeExampleText(example) {
		if (!example) return "";
		if (typeof example === "string") return example.trim();
		if (typeof example === "object" && typeof example.text === "string") return example.text.trim();
		return "";
	}

	function getCodePointLength(text) {
		return Array.from(String(text || "")).length;
	}

	function normalizeLanguageBase(languageHint) {
		const raw = typeof languageHint === "string" ? languageHint.trim().toLowerCase() : "";
		if (!raw || raw === "auto") return "";
		if (raw.startsWith("zh-cn") || raw.startsWith("zh-sg") || raw.startsWith("zh-tw") || raw.startsWith("zh-hk") || raw.startsWith("zh-mo")) {
			return "zh";
		}
		return raw.split("-")[0];
	}

	function getWordSegmenter(languageHint) {
		if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return null;
		try {
			return new Intl.Segmenter(languageHint || undefined, { granularity: "word" });
		} catch (_) {
			try {
				return new Intl.Segmenter(undefined, { granularity: "word" });
			} catch (_) {
				return null;
			}
		}
	}

	function foldForMatch(text, languageHint) {
		const value = String(text || "").normalize("NFKC");
		try {
			return value.toLocaleLowerCase(languageHint || undefined);
		} catch (_) {
			return value.toLocaleLowerCase();
		}
	}

	function countWordLikeTokens(text, languageHint) {
		const value = String(text || "").trim();
		if (!value) return 0;
		const segmenter = getWordSegmenter(languageHint);
		if (segmenter) {
			let count = 0;
			for (const part of segmenter.segment(value)) {
				if (!part || !part.isWordLike) continue;
				count += 1;
			}
			return count;
		}
		const matches = value.match(new RegExp(WORDLIKE_RE.source, "gu")) || [];
		return matches.length;
	}

	function countNoiseChars(text) {
		const value = String(text || "");
		const digitMatches = value.match(DIGIT_RE) || [];
		const symbolMatches = value.match(SYMBOL_RE) || [];
		return digitMatches.length + symbolMatches.length;
	}

	function findWholeWordMatch(sentence, word, languageHint) {
		const value = normalizeExampleText(sentence);
		const cleanedWord = (word || "").trim();
		if (!value || !cleanedWord) return null;
		const segmenter = getWordSegmenter(languageHint);
		if (segmenter) {
			const foldedWord = foldForMatch(cleanedWord, languageHint);
			for (const part of segmenter.segment(value)) {
				if (!part || !part.isWordLike) continue;
				if (foldForMatch(part.segment, languageHint) !== foldedWord) continue;
				return {
					index: part.index,
					length: part.segment.length,
				};
			}
		}
		const base = normalizeLanguageBase(languageHint);
		if (COMPACT_SCRIPT_BASES.has(base)) {
			const index = value.indexOf(cleanedWord);
			if (index !== -1) {
				return { index, length: cleanedWord.length };
			}
		}
		const pattern = new RegExp(`\\b${escapeRegExp(cleanedWord)}\\b`, "i");
		const match = pattern.exec(value);
		if (!match) return null;
		return {
			index: match.index,
			length: match[0].length,
		};
	}

	function isSuitableClozeSentence(sentence, word, languageHint) {
		const value = normalizeExampleText(sentence);
		const cleanedWord = (word || "").trim();
		if (!value || !cleanedWord) return false;
		const base = normalizeLanguageBase(languageHint);
		const minCodepoints = COMPACT_SCRIPT_BASES.has(base)
			? CLOZE_MIN_CODEPOINTS_COMPACT
			: CLOZE_MIN_CODEPOINTS;
		const codePointLength = getCodePointLength(value);
		if (codePointLength < minCodepoints || codePointLength > CLOZE_MAX_CODEPOINTS) {
			return false;
		}
		const tokenCount = countWordLikeTokens(value, languageHint);
		if (tokenCount < CLOZE_MIN_TOKENS || tokenCount > CLOZE_MAX_TOKENS) {
			return false;
		}
		const noiseRatio = countNoiseChars(value) / Math.max(codePointLength, 1);
		if (noiseRatio > CLOZE_MAX_NOISE_RATIO) {
			return false;
		}
		if (value.length <= cleanedWord.length + 2) return false;
		return !!findWholeWordMatch(value, cleanedWord, languageHint);
	}

	function buildClozeStimulus(word, examples, languageHint) {
		const cleanedWord = (word || "").trim();
		if (!cleanedWord || !Array.isArray(examples) || examples.length === 0) return "";
		const candidates = shuffle(
			examples
				.map(normalizeExampleText)
				.filter((sentence) => isSuitableClozeSentence(sentence, cleanedWord, languageHint))
		);
		if (!candidates.length) return "";
		for (let i = 0; i < candidates.length; i += 1) {
			const sentence = candidates[i];
			const match = findWholeWordMatch(sentence, cleanedWord, languageHint);
			if (!match) continue;
			return `${sentence.slice(0, match.index)}_____${sentence.slice(match.index + match.length)}`;
		}
		return "";
	}

	global.PracticeUtils = {
		shuffle,
		chooseDistractors,
		getReviewedWordsUnique,
		getQuestionPool,
		normalizeExampleText,
		isSuitableClozeSentence,
		buildClozeStimulus,
	};
})(globalThis);
