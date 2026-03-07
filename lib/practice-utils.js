(function (global) {
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

	function buildClozeStimulus(word, examples) {
		const cleanedWord = (word || "").trim();
		if (!cleanedWord || !Array.isArray(examples) || examples.length === 0) return "";
		const candidates = shuffle(examples.map(normalizeExampleText).filter((x) => x.length > cleanedWord.length + 2));
		if (!candidates.length) return "";
		const pattern = new RegExp(`\\b${escapeRegExp(cleanedWord)}\\b`, "i");
		for (let i = 0; i < candidates.length; i += 1) {
			const sentence = candidates[i];
			if (!pattern.test(sentence)) continue;
			return sentence.replace(pattern, "_____");
		}
		return "";
	}

	global.PracticeUtils = {
		shuffle,
		chooseDistractors,
		getReviewedWordsUnique,
		getQuestionPool,
		normalizeExampleText,
		buildClozeStimulus,
	};
})(globalThis);
