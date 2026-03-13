(function (global) {
	const WORDS_META_KEY = "words_meta_v2";
	const WORDS_SHARD_PREFIX = "words_shard_v2_";
	const LEGACY_WORDS_KEY = "words";
	const SOURCE_LANG_KEY = "sourceLang";
	const TRANSLATION_ENGINE_KEY = "translationEngine";
	const AUTO_TRANSLATE_KEY = "autoTranslateOnSelect";
	const UI_LANGUAGE_KEY = "uiLanguage";
	const DICTIONARY_LOOKUP_KEY = "dictionaryLookupEnabled";
	const EXCLUDED_DOMAINS_KEY = "excludedDomains";
	const DEFAULT_EXCLUDED_DOMAINS = ["google.com", "chat.openai.com"];
	const EXCLUDED_DOMAINS_MIGRATED_KEY = "excludedDomainsMigratedV1";
	const SUPPORTED_UI_LANGS = ["zh-TW", "zh-CN", "en", "fr", "pt", "ar", "hi", "ja", "ko", "id", "ru", "es"];
	const VERSION = 2;
	const TARGET_SHARD_BYTES = 6000;
	const DEFERRED_SYNC_DELAY_MS = 12000;
	const StorageMergeUtilsRef = global.StorageMergeUtils;
	let pendingWordsSync = null;
	let pendingWordsSyncTimer = null;
	let pendingWordsSyncPromise = null;
	let pendingWordsSyncResolve = null;
	let autoFlushInstalled = false;

	function isContextInvalidatedError(error) {
		return !!(error && typeof error.message === "string" && error.message.includes("Extension context invalidated"));
	}

	function estimateBytes(value) {
		return StorageMergeUtilsRef.estimateBytes(value);
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
		return StorageMergeUtilsRef.splitWordsToShards(words, TARGET_SHARD_BYTES);
	}

	function normalizeSyncExampleEntry(entry, level) {
		return StorageMergeUtilsRef.normalizeSyncExampleEntry(entry, level);
	}

	function compactWordsForSync(words, level) {
		return StorageMergeUtilsRef.compactWordsForSync(words, level);
	}

	function normalizeExampleForMerge(entry) {
		return StorageMergeUtilsRef.normalizeExampleForMerge(entry);
	}

	function mergeExamples(localExamples, cloudExamples) {
		return StorageMergeUtilsRef.mergeExamples(localExamples, cloudExamples);
	}

	function mergeWordRecord(localData, cloudData) {
		return StorageMergeUtilsRef.mergeWordRecord(localData, cloudData);
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
					console.info(`Word sync stored a lighter cloud copy (compact level ${level}) to fit sync space.`);
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
					console.info(`Word sync stored a lighter cloud copy and trimmed ${dropped} oldest cloud words to fit sync space.`);
					return { compactLevel: level, droppedWords: dropped };
				} catch (error) {
					lastError = error;
				}
			}
		}
		throw lastError || new Error("Unable to fit word data into sync storage.");
	}

	async function writeWordsToSyncSafe(words) {
		try {
			return await writeWordsToSync(words);
		} catch (error) {
			console.info("Cloud sync update was skipped for now; local data remains intact.", error);
			return { compactLevel: -1, droppedWords: 0, failed: true };
		}
	}

	function ensurePendingWordsSyncPromise() {
		if (pendingWordsSyncPromise) return pendingWordsSyncPromise;
		pendingWordsSyncPromise = new Promise((resolve) => {
			pendingWordsSyncResolve = resolve;
		});
		return pendingWordsSyncPromise;
	}

	async function flushPendingWordsSync() {
		if (!pendingWordsSync) {
			const idleResult = { compactLevel: 0, droppedWords: 0, skipped: true };
			if (pendingWordsSyncResolve) pendingWordsSyncResolve(idleResult);
			pendingWordsSyncPromise = null;
			pendingWordsSyncResolve = null;
			return idleResult;
		}
		if (pendingWordsSyncTimer) {
			clearTimeout(pendingWordsSyncTimer);
			pendingWordsSyncTimer = null;
		}
		const words = pendingWordsSync;
		pendingWordsSync = null;
		const result = await writeWordsToSyncSafe(words);
		if (pendingWordsSyncResolve) pendingWordsSyncResolve(result);
		pendingWordsSyncPromise = null;
		pendingWordsSyncResolve = null;
		return result;
	}

	function scheduleDeferredWordsSync(words) {
		pendingWordsSync = words;
		ensurePendingWordsSyncPromise();
		if (pendingWordsSyncTimer) clearTimeout(pendingWordsSyncTimer);
		pendingWordsSyncTimer = setTimeout(() => {
			flushPendingWordsSync().catch((error) => {
				console.info("Deferred cloud sync flush was skipped; local data remains intact.", error);
			});
		}, DEFERRED_SYNC_DELAY_MS);
		return { deferred: true };
	}

	function installDeferredSyncAutoFlush() {
		if (autoFlushInstalled) return;
		if (typeof document === "undefined" || typeof global.addEventListener !== "function") return;
		autoFlushInstalled = true;
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState !== "hidden") return;
			flushPendingWordsSync().catch((error) => {
				console.info("Visibility-triggered cloud sync flush was skipped; local data remains intact.", error);
			});
		});
		global.addEventListener("pagehide", () => {
			flushPendingWordsSync().catch((error) => {
				console.info("Pagehide-triggered cloud sync flush was skipped; local data remains intact.", error);
			});
		});
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

		async saveWords(words, options) {
			await setToArea(chrome.storage.local, { [LEGACY_WORDS_KEY]: words });
			const syncMode = options && options.syncMode ? options.syncMode : "deferred";
			if (syncMode === "immediate") {
				return await writeWordsToSyncSafe(words);
			}
			return scheduleDeferredWordsSync(words);
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
			const translationEngine = await this.getTranslationEngine();
			const autoTranslateOnSelect = await this.getAutoTranslateOnSelect();
			const dictionaryLookupEnabled = await this.getDictionaryLookupEnabled();
			const uiLanguage = await this.getUiLanguage();
			const excludedDomains = await this.getExcludedDomains();
			return {
				words: words,
				sourceLang: sourceLang,
				translationEngine: translationEngine,
				autoTranslateOnSelect: autoTranslateOnSelect,
				dictionaryLookupEnabled: dictionaryLookupEnabled,
				uiLanguage: uiLanguage,
				excludedDomains: excludedDomains,
			};
		},

		async importData(items) {
			const words = items.words || {};
			const sourceLang = items.sourceLang || "auto";
			const translationEngine = items.translationEngine === "browser" ? "browser" : "online";
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
			await this.saveWords(words, { syncMode: "immediate" });
			await this.saveSourceLang(sourceLang);
			await this.saveTranslationEngine(translationEngine);
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

		async getTranslationEngine() {
			await this.init();
			const localResult = await getFromArea(chrome.storage.local, {
				[TRANSLATION_ENGINE_KEY]: "online",
			});
			return localResult[TRANSLATION_ENGINE_KEY] === "browser" ? "browser" : "online";
		},

		async saveTranslationEngine(engine) {
			const next = engine === "browser" ? "browser" : "online";
			await setToArea(chrome.storage.local, { [TRANSLATION_ENGINE_KEY]: next });
			await setToArea(chrome.storage.sync, { [TRANSLATION_ENGINE_KEY]: next });
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
			await flushPendingWordsSync();
			const localWords = await this.getWords();
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
			await setToArea(chrome.storage.local, { [LEGACY_WORDS_KEY]: merged });
			const finalSyncState = await writeWordsToSyncSafe(merged);
			return {
				cloudWords: cloudEntries.length,
				processedWords: mergedWords,
				totalWords: Object.keys(merged).length,
				finalSyncState,
			};
		},
		async flushSync() {
			await this.init();
			return flushPendingWordsSync();
		},
	};

	global.WordStorage = WordStorage;
	installDeferredSyncAutoFlush();
	if (global && global.__LA_TEST_HOOKS__) {
		global.__LA_TEST_HOOKS__.storage = {
			estimateBytes,
			splitWordsToShards,
			normalizeSyncExampleEntry,
			compactWordsForSync,
			normalizeExampleForMerge,
			mergeExamples,
			mergeWordRecord,
			flushPendingWordsSync,
			scheduleDeferredWordsSync,
			installDeferredSyncAutoFlush,
			DEFERRED_SYNC_DELAY_MS,
			DEFAULT_EXCLUDED_DOMAINS: DEFAULT_EXCLUDED_DOMAINS.slice(),
			SUPPORTED_UI_LANGS: SUPPORTED_UI_LANGS.slice(),
		};
	}
})(globalThis);
