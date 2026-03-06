(function (global) {
	const WORDS_META_KEY = "words_meta_v2";
	const WORDS_SHARD_PREFIX = "words_shard_v2_";
	const LEGACY_WORDS_KEY = "words";
	const SOURCE_LANG_KEY = "sourceLang";
	const AUTO_TRANSLATE_KEY = "autoTranslateOnSelect";
	const UI_LANGUAGE_KEY = "uiLanguage";
	const DICTIONARY_LOOKUP_KEY = "dictionaryLookupEnabled";
	const EXCLUDED_DOMAINS_KEY = "excludedDomains";
	const DEFAULT_EXCLUDED_DOMAINS = ["google.com", "chat.openai.com"];
	const EXCLUDED_DOMAINS_MIGRATED_KEY = "excludedDomainsMigratedV1";
	const SUPPORTED_UI_LANGS = ["zh-TW", "zh-CN", "en", "fr", "pt", "ar", "hi", "ja", "ko", "id", "ru", "es"];
	const VERSION = 2;
	const TARGET_SHARD_BYTES = 6000;

	function isContextInvalidatedError(error) {
		return !!(error && typeof error.message === "string" && error.message.includes("Extension context invalidated"));
	}

	function estimateBytes(value) {
		return new TextEncoder().encode(JSON.stringify(value)).length;
	}

	function getFromArea(area, keys) {
		return new Promise((resolve, reject) => {
			area.get(keys, (result) => {
				if (chrome.runtime.lastError) {
					reject(chrome.runtime.lastError);
					return;
				}
				resolve(result);
			});
		});
	}

	function setToArea(area, data) {
		return new Promise((resolve, reject) => {
			area.set(data, () => {
				if (chrome.runtime.lastError) {
					reject(chrome.runtime.lastError);
					return;
				}
				resolve();
			});
		});
	}

	function removeFromArea(area, keys) {
		return new Promise((resolve, reject) => {
			area.remove(keys, () => {
				if (chrome.runtime.lastError) {
					reject(chrome.runtime.lastError);
					return;
				}
				resolve();
			});
		});
	}

	function splitWordsToShards(words) {
		const entries = Object.entries(words);
		const shards = [];
		let currentShard = {};

		for (const [word, data] of entries) {
			const trial = Object.assign({}, currentShard, { [word]: data });
			if (
				Object.keys(currentShard).length > 0 &&
				estimateBytes(trial) > TARGET_SHARD_BYTES
			) {
				shards.push(currentShard);
				currentShard = { [word]: data };
			} else {
				currentShard[word] = data;
			}
		}

		if (Object.keys(currentShard).length > 0) {
			shards.push(currentShard);
		}
		return shards;
	}

	function normalizeSyncExampleEntry(entry, level) {
		if (typeof entry === "string") return entry;
		if (!entry || typeof entry !== "object") return null;
		const text = typeof entry.text === "string" ? entry.text : "";
		if (!text) return null;
		if (level >= 2) {
			return {
				text: text,
				pinned: !!entry.pinned,
			};
		}
		const minimal = {
			text: text,
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
		const entries = Object.entries(words || {});
		for (let i = 0; i < entries.length; i += 1) {
			const word = entries[i][0];
			const data = entries[i][1] || {};
			const next = {
				meaning: data.meaning || "",
				learned: !!data.learned,
				createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
			};
			if (typeof data.encounterCount === "number") {
				next.encounterCount = data.encounterCount;
			}
			if (typeof data.pageCount === "number") {
				next.pageCount = data.pageCount;
			}
			if (Array.isArray(data.encounterPageKeys)) {
				const cap = level >= 2 ? 30 : 120;
				next.encounterPageKeys = data.encounterPageKeys
					.filter((x) => typeof x === "string" && x)
					.slice(-cap);
			}
			if (level < 3 && Array.isArray(data.examples)) {
				const cap = level >= 2 ? 8 : data.examples.length;
				next.examples = data.examples
					.slice(0, cap)
					.map((item) => normalizeSyncExampleEntry(item, level))
					.filter((item) => !!item);
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
			text: text,
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
			const idx = indexMap.get(key);
			const base = merged[idx];
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
		const mergedPageKeys = Array.from(new Set(
			[]
				.concat(Array.isArray(local.encounterPageKeys) ? local.encounterPageKeys : [])
				.concat(Array.isArray(cloud.encounterPageKeys) ? cloud.encounterPageKeys : [])
				.filter((x) => typeof x === "string" && x)
		));
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
		return {
			meaning: localMeaning || cloudMeaning,
			learned: !!local.learned || !!cloud.learned,
			createdAt: Math.min(
				typeof local.createdAt === "number" && local.createdAt > 0 ? local.createdAt : Number.MAX_SAFE_INTEGER,
				typeof cloud.createdAt === "number" && cloud.createdAt > 0 ? cloud.createdAt : Number.MAX_SAFE_INTEGER
			) === Number.MAX_SAFE_INTEGER
				? 0
				: Math.min(
					typeof local.createdAt === "number" && local.createdAt > 0 ? local.createdAt : Number.MAX_SAFE_INTEGER,
					typeof cloud.createdAt === "number" && cloud.createdAt > 0 ? cloud.createdAt : Number.MAX_SAFE_INTEGER
				),
			dictionary: local.dictionary || cloud.dictionary || null,
			examples: mergedExamples,
			encounterCount: mergedEncounter,
			pageCount: mergedPageCount,
			encounterPageKeys: mergedPageKeys.slice(-300),
		};
	}

	function detectBrowserUiLanguage() {
		const rawLang =
			(typeof navigator !== "undefined" && navigator.language
				? navigator.language
				: "en").toLowerCase();
		if (rawLang.startsWith("zh-cn") || rawLang.startsWith("zh-sg")) return "zh-CN";
		if (rawLang.startsWith("zh")) return "zh-TW";
		if (rawLang.startsWith("fr")) return "fr";
		if (rawLang.startsWith("pt")) return "pt";
		if (rawLang.startsWith("ar")) return "ar";
		if (rawLang.startsWith("hi")) return "hi";
		if (rawLang.startsWith("ja")) return "ja";
		if (rawLang.startsWith("ko")) return "ko";
		if (rawLang.startsWith("id") || rawLang.startsWith("in")) return "id";
		if (rawLang.startsWith("ru")) return "ru";
		if (rawLang.startsWith("es")) return "es";
		return "en";
	}

	async function readWordsFromSync() {
		const metaResult = await getFromArea(chrome.storage.sync, {
			[WORDS_META_KEY]: null,
			[LEGACY_WORDS_KEY]: null,
		});
		const meta = metaResult[WORDS_META_KEY];
		if (meta && Array.isArray(meta.shards)) {
			const shardKeys = meta.shards.map((i) => `${WORDS_SHARD_PREFIX}${i}`);
			if (shardKeys.length === 0) return {};
			const shardResult = await getFromArea(chrome.storage.sync, shardKeys);
			const merged = {};
			shardKeys.forEach((key) => {
				const shard = shardResult[key] || {};
				Object.assign(merged, shard);
			});
			return merged;
		}
		return metaResult[LEGACY_WORDS_KEY] || {};
	}

	async function writeWordsToSync(words) {
		const oldMetaResult = await getFromArea(chrome.storage.sync, {
			[WORDS_META_KEY]: null,
		});
		const oldMeta = oldMetaResult[WORDS_META_KEY];
		const oldShardIds =
			oldMeta && Array.isArray(oldMeta.shards) ? oldMeta.shards : [];

		let lastError = null;
		for (let level = 0; level <= 1; level += 1) {
			try {
				const compacted = compactWordsForSync(words, level);
				const shards = splitWordsToShards(compacted);
				const payload = {};
				const ids = [];
				for (let i = 0; i < shards.length; i += 1) {
					ids.push(i);
					payload[`${WORDS_SHARD_PREFIX}${i}`] = shards[i];
				}
				payload[WORDS_META_KEY] = {
					version: VERSION,
					shards: ids,
					updatedAt: Date.now(),
					sync_compact_level: level,
				};

				const staleKeys = oldShardIds
					.filter((id) => !ids.includes(id))
					.map((id) => `${WORDS_SHARD_PREFIX}${id}`);

				await setToArea(chrome.storage.sync, payload);
				await removeFromArea(chrome.storage.sync, [LEGACY_WORDS_KEY].concat(staleKeys));
				if (level > 0) {
					console.warn(`Word sync used compact level ${level} due to sync quota.`);
				}
				return { compactLevel: level, droppedWords: 0 };
			} catch (error) {
				lastError = error;
			}
		}

		// If sync quota is still exceeded, drop oldest words in sync payload only.
		const entries = Object.entries(words || {});
		entries.sort((a, b) => {
			const at = a[1] && typeof a[1].createdAt === "number" ? a[1].createdAt : 0;
			const bt = b[1] && typeof b[1].createdAt === "number" ? b[1].createdAt : 0;
			return at - bt;
		});
		let dropped = 0;
		for (let keepFrom = 1; keepFrom < entries.length; keepFrom += 1) {
			const trimmed = {};
			for (let i = keepFrom; i < entries.length; i += 1) {
				trimmed[entries[i][0]] = entries[i][1];
			}
			for (let level = 0; level <= 1; level += 1) {
				try {
					const compacted = compactWordsForSync(trimmed, level);
					const shards = splitWordsToShards(compacted);
					const payload = {};
					const ids = [];
					for (let i = 0; i < shards.length; i += 1) {
						ids.push(i);
						payload[`${WORDS_SHARD_PREFIX}${i}`] = shards[i];
					}
					payload[WORDS_META_KEY] = {
						version: VERSION,
						shards: ids,
						updatedAt: Date.now(),
						sync_compact_level: level,
					};
					const staleKeys = oldShardIds
						.filter((id) => !ids.includes(id))
						.map((id) => `${WORDS_SHARD_PREFIX}${id}`);
					await setToArea(chrome.storage.sync, payload);
					await removeFromArea(chrome.storage.sync, [LEGACY_WORDS_KEY].concat(staleKeys));
					dropped = keepFrom;
					console.warn(`Word sync dropped ${dropped} oldest words to fit sync quota.`);
					return { compactLevel: level, droppedWords: dropped };
				} catch (error) {
					lastError = error;
				}
			}
		}
		throw lastError || new Error("Failed to write words to sync.");
	}

	async function writeWordsToSyncSafe(words) {
		try {
			return await writeWordsToSync(words);
		} catch (error) {
			console.error("Sync write failed after compaction and trimming:", error);
			return { compactLevel: -1, droppedWords: 0, failed: true };
		}
	}

	async function hydrateLocalFromSyncIfNeeded() {
		const localWordsResult = await getFromArea(chrome.storage.local, {
			[LEGACY_WORDS_KEY]: {},
		});
		const localWords = localWordsResult[LEGACY_WORDS_KEY] || {};
		if (Object.keys(localWords).length === 0) {
			const syncWords = await readWordsFromSync();
			if (Object.keys(syncWords).length > 0) {
				await setToArea(chrome.storage.local, { [LEGACY_WORDS_KEY]: syncWords });
			}
		}

		const localLangResult = await getFromArea(chrome.storage.local, {
			[SOURCE_LANG_KEY]: null,
		});
		if (!localLangResult[SOURCE_LANG_KEY]) {
			const syncLangResult = await getFromArea(chrome.storage.sync, {
				[SOURCE_LANG_KEY]: null,
			});
			if (syncLangResult[SOURCE_LANG_KEY]) {
				await setToArea(chrome.storage.local, {
					[SOURCE_LANG_KEY]: syncLangResult[SOURCE_LANG_KEY],
				});
			}
		}

		const localAutoResult = await getFromArea(chrome.storage.local, {
			[AUTO_TRANSLATE_KEY]: null,
		});
		if (localAutoResult[AUTO_TRANSLATE_KEY] === null) {
			const syncAutoResult = await getFromArea(chrome.storage.sync, {
				[AUTO_TRANSLATE_KEY]: null,
			});
			if (syncAutoResult[AUTO_TRANSLATE_KEY] !== null) {
				await setToArea(chrome.storage.local, {
					[AUTO_TRANSLATE_KEY]: !!syncAutoResult[AUTO_TRANSLATE_KEY],
				});
			}
		}

		const localUiLangResult = await getFromArea(chrome.storage.local, {
			[UI_LANGUAGE_KEY]: null,
		});
		if (localUiLangResult[UI_LANGUAGE_KEY] === null) {
			const syncUiLangResult = await getFromArea(chrome.storage.sync, {
				[UI_LANGUAGE_KEY]: null,
			});
			if (syncUiLangResult[UI_LANGUAGE_KEY] !== null) {
				await setToArea(chrome.storage.local, {
					[UI_LANGUAGE_KEY]: syncUiLangResult[UI_LANGUAGE_KEY],
				});
			} else {
				const detectedUiLang = detectBrowserUiLanguage();
				await setToArea(chrome.storage.local, {
					[UI_LANGUAGE_KEY]: detectedUiLang,
				});
				await setToArea(chrome.storage.sync, {
					[UI_LANGUAGE_KEY]: detectedUiLang,
				});
			}
		}

		const localExcludedResult = await getFromArea(chrome.storage.local, {
			[EXCLUDED_DOMAINS_KEY]: null,
			[EXCLUDED_DOMAINS_MIGRATED_KEY]: false,
		});
		if (localExcludedResult[EXCLUDED_DOMAINS_KEY] === null) {
			const syncExcludedResult = await getFromArea(chrome.storage.sync, {
				[EXCLUDED_DOMAINS_KEY]: null,
			});
			const domains = Array.isArray(syncExcludedResult[EXCLUDED_DOMAINS_KEY])
				? syncExcludedResult[EXCLUDED_DOMAINS_KEY]
				: DEFAULT_EXCLUDED_DOMAINS;
			await setToArea(chrome.storage.local, {
				[EXCLUDED_DOMAINS_KEY]: domains,
			});
			if (syncExcludedResult[EXCLUDED_DOMAINS_KEY] === null) {
				await setToArea(chrome.storage.sync, {
					[EXCLUDED_DOMAINS_KEY]: domains,
				});
			}
			await setToArea(chrome.storage.local, {
				[EXCLUDED_DOMAINS_MIGRATED_KEY]: true,
			});
		} else if (!localExcludedResult[EXCLUDED_DOMAINS_MIGRATED_KEY]) {
			const localDomains = Array.isArray(localExcludedResult[EXCLUDED_DOMAINS_KEY])
				? localExcludedResult[EXCLUDED_DOMAINS_KEY]
				: [];
			const syncExcludedResult = await getFromArea(chrome.storage.sync, {
				[EXCLUDED_DOMAINS_KEY]: null,
			});
			const syncDomains = Array.isArray(syncExcludedResult[EXCLUDED_DOMAINS_KEY])
				? syncExcludedResult[EXCLUDED_DOMAINS_KEY]
				: [];
			if (localDomains.length === 0 && syncDomains.length === 0) {
				await setToArea(chrome.storage.local, {
					[EXCLUDED_DOMAINS_KEY]: DEFAULT_EXCLUDED_DOMAINS,
				});
				await setToArea(chrome.storage.sync, {
					[EXCLUDED_DOMAINS_KEY]: DEFAULT_EXCLUDED_DOMAINS,
				});
			}
			await setToArea(chrome.storage.local, {
				[EXCLUDED_DOMAINS_MIGRATED_KEY]: true,
			});
		}

		const localDictionaryResult = await getFromArea(chrome.storage.local, {
			[DICTIONARY_LOOKUP_KEY]: null,
		});
		if (localDictionaryResult[DICTIONARY_LOOKUP_KEY] === null) {
			const syncDictionaryResult = await getFromArea(chrome.storage.sync, {
				[DICTIONARY_LOOKUP_KEY]: null,
			});
			const enabled = syncDictionaryResult[DICTIONARY_LOOKUP_KEY] !== false;
			await setToArea(chrome.storage.local, {
				[DICTIONARY_LOOKUP_KEY]: enabled,
			});
			if (syncDictionaryResult[DICTIONARY_LOOKUP_KEY] === null) {
				await setToArea(chrome.storage.sync, {
					[DICTIONARY_LOOKUP_KEY]: enabled,
				});
			}
		}
	}

		const WordStorage = {
			async init() {
				try {
					await hydrateLocalFromSyncIfNeeded();
				} catch (error) {
					if (!isContextInvalidatedError(error)) {
						console.error("WordStorage init failed:", error);
					}
				}
			},

		async getWords() {
			await this.init();
			const localResult = await getFromArea(chrome.storage.local, {
				[LEGACY_WORDS_KEY]: {},
			});
			return localResult[LEGACY_WORDS_KEY] || {};
		},

		async saveWords(words) {
			await setToArea(chrome.storage.local, { [LEGACY_WORDS_KEY]: words });
			await writeWordsToSyncSafe(words);
		},

		async getSourceLang() {
			await this.init();
			const localResult = await getFromArea(chrome.storage.local, {
				[SOURCE_LANG_KEY]: "auto",
			});
			return localResult[SOURCE_LANG_KEY] || "auto";
		},

		async saveSourceLang(sourceLang) {
			await setToArea(chrome.storage.local, { [SOURCE_LANG_KEY]: sourceLang });
			await setToArea(chrome.storage.sync, { [SOURCE_LANG_KEY]: sourceLang });
		},

		async exportData() {
			const words = await this.getWords();
			const sourceLang = await this.getSourceLang();
			const autoTranslateOnSelect = await this.getAutoTranslateOnSelect();
			const dictionaryLookupEnabled = await this.getDictionaryLookupEnabled();
			const uiLanguage = await this.getUiLanguage();
			const excludedDomains = await this.getExcludedDomains();
			return {
				words: words,
				sourceLang: sourceLang,
				autoTranslateOnSelect: autoTranslateOnSelect,
				dictionaryLookupEnabled: dictionaryLookupEnabled,
				uiLanguage: uiLanguage,
				excludedDomains: excludedDomains,
			};
		},

		async importData(items) {
			const words = items.words || {};
			const sourceLang = items.sourceLang || "auto";
			const autoTranslateOnSelect =
				typeof items.autoTranslateOnSelect === "boolean"
					? items.autoTranslateOnSelect
					: true;
			const dictionaryLookupEnabled =
				typeof items.dictionaryLookupEnabled === "boolean"
					? items.dictionaryLookupEnabled
					: true;
			const uiLanguage = items.uiLanguage || "zh-TW";
			const excludedDomains = Array.isArray(items.excludedDomains)
				? items.excludedDomains
				: DEFAULT_EXCLUDED_DOMAINS;
			await this.saveWords(words);
			await this.saveSourceLang(sourceLang);
			await this.saveAutoTranslateOnSelect(autoTranslateOnSelect);
			await this.saveDictionaryLookupEnabled(dictionaryLookupEnabled);
			await this.saveUiLanguage(uiLanguage);
			await this.saveExcludedDomains(excludedDomains);
		},

		async getAutoTranslateOnSelect() {
			await this.init();
			const localResult = await getFromArea(chrome.storage.local, {
				[AUTO_TRANSLATE_KEY]: true,
			});
			return localResult[AUTO_TRANSLATE_KEY] !== false;
		},

		async saveAutoTranslateOnSelect(enabled) {
			await setToArea(chrome.storage.local, { [AUTO_TRANSLATE_KEY]: !!enabled });
			await setToArea(chrome.storage.sync, { [AUTO_TRANSLATE_KEY]: !!enabled });
		},

		async getDictionaryLookupEnabled() {
			await this.init();
			const localResult = await getFromArea(chrome.storage.local, {
				[DICTIONARY_LOOKUP_KEY]: true,
			});
			return localResult[DICTIONARY_LOOKUP_KEY] !== false;
		},

		async saveDictionaryLookupEnabled(enabled) {
			await setToArea(chrome.storage.local, { [DICTIONARY_LOOKUP_KEY]: !!enabled });
			await setToArea(chrome.storage.sync, { [DICTIONARY_LOOKUP_KEY]: !!enabled });
		},

		async getUiLanguage() {
			await this.init();
			const localResult = await getFromArea(chrome.storage.local, {
				[UI_LANGUAGE_KEY]: detectBrowserUiLanguage(),
			});
			const lang = localResult[UI_LANGUAGE_KEY] || detectBrowserUiLanguage();
			return SUPPORTED_UI_LANGS.includes(lang) ? lang : "en";
		},

		async saveUiLanguage(language) {
			await setToArea(chrome.storage.local, { [UI_LANGUAGE_KEY]: language });
			await setToArea(chrome.storage.sync, { [UI_LANGUAGE_KEY]: language });
		},

		async getExcludedDomains() {
			await this.init();
			const localResult = await getFromArea(chrome.storage.local, {
				[EXCLUDED_DOMAINS_KEY]: [],
			});
			const domains = Array.isArray(localResult[EXCLUDED_DOMAINS_KEY])
				? localResult[EXCLUDED_DOMAINS_KEY]
				: [];
			return domains
				.map((d) => (typeof d === "string" ? d.trim().toLowerCase() : ""))
				.filter((d) => d.length > 0);
		},

		async saveExcludedDomains(domains) {
			const safeDomains = (Array.isArray(domains) ? domains : [])
				.map((d) => (typeof d === "string" ? d.trim().toLowerCase() : ""))
				.filter((d) => d.length > 0);
			await setToArea(chrome.storage.local, { [EXCLUDED_DOMAINS_KEY]: safeDomains });
			await setToArea(chrome.storage.sync, { [EXCLUDED_DOMAINS_KEY]: safeDomains });
		},

		async syncFromCloud() {
			await this.init();
			const localWords = await this.getWords();
			// Push first, then pull and merge.
			await writeWordsToSyncSafe(localWords);
			const cloudWords = await readWordsFromSync();
			const merged = Object.assign({}, localWords);
			let mergedWords = 0;
			const cloudEntries = Object.entries(cloudWords || {});
			for (let i = 0; i < cloudEntries.length; i += 1) {
				const word = cloudEntries[i][0];
				const cloudData = cloudEntries[i][1];
				const localData = merged[word];
				if (!localData) {
					merged[word] = cloudData;
					mergedWords += 1;
					continue;
				}
				const next = mergeWordRecord(localData, cloudData);
				merged[word] = next;
				mergedWords += 1;
			}
			await this.saveWords(merged);
			return {
				cloudWords: cloudEntries.length,
				processedWords: mergedWords,
				totalWords: Object.keys(merged).length,
			};
		},
	};

	global.WordStorage = WordStorage;
})(globalThis);
