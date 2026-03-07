(function (global) {
	function estimateBytes(value) {
		return new TextEncoder().encode(JSON.stringify(value)).length;
	}

	function splitWordsToShards(words, targetShardBytes) {
		const entries = Object.entries(words);
		const shards = [];
		let currentShard = {};
		const limit = typeof targetShardBytes === "number" ? targetShardBytes : 6000;
		for (const [word, data] of entries) {
			const trial = Object.assign({}, currentShard, { [word]: data });
			if (Object.keys(currentShard).length > 0 && estimateBytes(trial) > limit) {
				shards.push(currentShard);
				currentShard = { [word]: data };
			} else {
				currentShard[word] = data;
			}
		}
		if (Object.keys(currentShard).length > 0) shards.push(currentShard);
		return shards;
	}

	function normalizeSyncExampleEntry(entry, level) {
		if (typeof entry === "string") return entry;
		if (!entry || typeof entry !== "object") return null;
		const text = typeof entry.text === "string" ? entry.text : "";
		if (!text) return null;
		if (level >= 2) {
			return { text, pinned: !!entry.pinned };
		}
		const minimal = {
			text,
			pinned: !!entry.pinned,
			createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
			pinnedAt: typeof entry.pinnedAt === "number" ? entry.pinnedAt : 0,
		};
		if (level === 0) {
			minimal.translation = typeof entry.translation === "string" ? entry.translation : "";
			minimal.translatedAt = typeof entry.translatedAt === "number" ? entry.translatedAt : 0;
			minimal.sourceUrl = typeof entry.sourceUrl === "string" ? entry.sourceUrl : "";
			minimal.capturedAt = typeof entry.capturedAt === "number" ? entry.capturedAt : 0;
		}
		return minimal;
	}

	function compactWordsForSync(words, level) {
		if (level <= 0) return words;
		const result = {};
		for (const [word, dataRaw] of Object.entries(words || {})) {
			const data = dataRaw || {};
			const next = {
				meaning: data.meaning || "",
				learned: !!data.learned,
				createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
			};
			if (typeof data.lemma === "string" && data.lemma.trim()) next.lemma = data.lemma.trim();
			if (data.dictionary && typeof data.dictionary === "object") {
				const dict = {};
				if (typeof data.dictionary.pos === "string" && data.dictionary.pos) dict.pos = data.dictionary.pos;
				if (typeof data.dictionary.definitionOriginal === "string" && data.dictionary.definitionOriginal) dict.definitionOriginal = data.dictionary.definitionOriginal;
				if (typeof data.dictionary.definitionTranslated === "string" && data.dictionary.definitionTranslated) dict.definitionTranslated = data.dictionary.definitionTranslated;
				if (typeof data.dictionary.source === "string" && data.dictionary.source) dict.source = data.dictionary.source;
				if (typeof data.dictionary.lookupLemma === "string" && data.dictionary.lookupLemma) dict.lookupLemma = data.dictionary.lookupLemma;
				if (typeof data.dictionary.queryText === "string" && data.dictionary.queryText) dict.queryText = data.dictionary.queryText;
				if (data.dictionary.usedLemma) dict.usedLemma = true;
				if (Array.isArray(data.dictionary.entries)) dict.entries = data.dictionary.entries;
				if (typeof data.dictionary.selectedIndex === "number") dict.selectedIndex = data.dictionary.selectedIndex;
				if (typeof data.dictionary.updatedAt === "number") dict.updatedAt = data.dictionary.updatedAt;
				if (Object.keys(dict).length > 0) next.dictionary = dict;
			}
			if (typeof data.encounterCount === "number") next.encounterCount = data.encounterCount;
			if (typeof data.pageCount === "number") next.pageCount = data.pageCount;
			if (Array.isArray(data.encounterPageKeys)) {
				const cap = level >= 2 ? 30 : 120;
				next.encounterPageKeys = data.encounterPageKeys.filter((x) => typeof x === "string" && x).slice(-cap);
			}
			if (level < 3 && Array.isArray(data.examples)) {
				const cap = level >= 2 ? 8 : data.examples.length;
				next.examples = data.examples.slice(0, cap).map((item) => normalizeSyncExampleEntry(item, level)).filter(Boolean);
			}
			result[word] = next;
		}
		return result;
	}

	function normalizeExampleForMerge(entry) {
		if (typeof entry === "string") {
			const text = entry.trim();
			return text ? { text, pinned: false, createdAt: 0, pinnedAt: 0, translation: "", translatedAt: 0, sourceUrl: "", capturedAt: 0 } : null;
		}
		if (!entry || typeof entry !== "object") return null;
		const text = typeof entry.text === "string" ? entry.text.trim() : "";
		if (!text) return null;
		return {
			text,
			pinned: !!entry.pinned,
			createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
			pinnedAt: typeof entry.pinnedAt === "number" ? entry.pinnedAt : 0,
			translation: typeof entry.translation === "string" ? entry.translation : "",
			translatedAt: typeof entry.translatedAt === "number" ? entry.translatedAt : 0,
			sourceUrl: typeof entry.sourceUrl === "string" ? entry.sourceUrl : "",
			capturedAt: typeof entry.capturedAt === "number" ? entry.capturedAt : 0,
		};
	}

	function mergeExamples(localExamples, cloudExamples) {
		const merged = [];
		const indexMap = new Map();
		const pushOrMerge = (raw) => {
			const item = normalizeExampleForMerge(raw);
			if (!item) return;
			const key = item.text.toLowerCase();
			if (!indexMap.has(key)) {
				indexMap.set(key, merged.length);
				merged.push(item);
				return;
			}
			const base = merged[indexMap.get(key)];
			if (!base.sourceUrl && item.sourceUrl) base.sourceUrl = item.sourceUrl;
			if (!base.capturedAt && item.capturedAt) base.capturedAt = item.capturedAt;
			if (!base.createdAt && item.createdAt) base.createdAt = item.createdAt;
			if (!base.translation && item.translation) base.translation = item.translation;
			if (!base.translatedAt && item.translatedAt) base.translatedAt = item.translatedAt;
			base.pinned = base.pinned || item.pinned;
			base.pinnedAt = Math.max(base.pinnedAt || 0, item.pinnedAt || 0);
		};
		(Array.isArray(localExamples) ? localExamples : []).forEach(pushOrMerge);
		(Array.isArray(cloudExamples) ? cloudExamples : []).forEach(pushOrMerge);
		return merged;
	}

	function mergeWordRecord(localData, cloudData) {
		const local = localData && typeof localData === "object" ? localData : {};
		const cloud = cloudData && typeof cloudData === "object" ? cloudData : {};
		const localMeaning = typeof local.meaning === "string" ? local.meaning : "";
		const cloudMeaning = typeof cloud.meaning === "string" ? cloud.meaning : "";
		const mergedExamples = mergeExamples(local.examples, cloud.examples);
		const mergedPageKeys = Array.from(new Set([]
			.concat(Array.isArray(local.encounterPageKeys) ? local.encounterPageKeys : [])
			.concat(Array.isArray(cloud.encounterPageKeys) ? cloud.encounterPageKeys : [])
			.filter((x) => typeof x === "string" && x)));
		const mergedEncounter = Math.max(
			typeof local.encounterCount === "number" ? local.encounterCount : 0,
			typeof cloud.encounterCount === "number" ? cloud.encounterCount : 0,
			mergedExamples.length
		);
		const mergedPageCount = Math.max(
			typeof local.pageCount === "number" ? local.pageCount : 0,
			typeof cloud.pageCount === "number" ? cloud.pageCount : 0,
			mergedPageKeys.length
		);
		const localCreated = typeof local.createdAt === "number" && local.createdAt > 0 ? local.createdAt : Number.MAX_SAFE_INTEGER;
		const cloudCreated = typeof cloud.createdAt === "number" && cloud.createdAt > 0 ? cloud.createdAt : Number.MAX_SAFE_INTEGER;
		const earliest = Math.min(localCreated, cloudCreated);
		return {
			meaning: localMeaning || cloudMeaning,
			learned: !!local.learned || !!cloud.learned,
			createdAt: earliest === Number.MAX_SAFE_INTEGER ? 0 : earliest,
			lemma: (typeof local.lemma === "string" && local.lemma.trim())
				? local.lemma.trim()
				: ((typeof cloud.lemma === "string" && cloud.lemma.trim()) ? cloud.lemma.trim() : ""),
			dictionary: (function () {
				const localDict = local.dictionary && typeof local.dictionary === "object" ? local.dictionary : null;
				const cloudDict = cloud.dictionary && typeof cloud.dictionary === "object" ? cloud.dictionary : null;
				if (!localDict && !cloudDict) return null;
				return Object.assign({}, cloudDict || {}, localDict || {});
			}()),
			examples: mergedExamples,
			encounterCount: mergedEncounter,
			pageCount: mergedPageCount,
			encounterPageKeys: mergedPageKeys.slice(-300),
		};
	}

	global.StorageMergeUtils = {
		estimateBytes,
		splitWordsToShards,
		normalizeSyncExampleEntry,
		compactWordsForSync,
		normalizeExampleForMerge,
		mergeExamples,
		mergeWordRecord,
	};
})(globalThis);
