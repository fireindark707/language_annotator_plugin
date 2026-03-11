function getSelectedLabel(selectEl) {
	const option = selectEl.options[selectEl.selectedIndex];
	return option ? option.textContent : "-";
}

const DictionaryUtilsRef = globalThis.DictionaryUtils;

document.addEventListener("DOMContentLoaded", function () {
	const sourceLangSelect = document.getElementById("sourceLang");
	const uiLanguageSelect = document.getElementById("uiLanguage");
	const autoTranslateCheckbox = document.getElementById("autoTranslateOnSelect");
	const dictionaryLookupRow = document.getElementById("dictionaryLookupRow");
	const dictionaryLookupCheckbox = document.getElementById("dictionaryLookupEnabled");
	const currentLang = document.getElementById("currentLang");
	const saveBtn = document.getElementById("save");
	const saveStatus = document.getElementById("saveStatus");
	const syncBtn = document.getElementById("syncBtn");
	const helpBtn = document.getElementById("helpBtn");
	const exportBtn = document.getElementById("exportBtn");
	const importBtn = document.getElementById("importBtn");
	const importFile = document.getElementById("importFile");
	const simpleImportInput = document.getElementById("simpleImportInput");
	const simpleImportBtn = document.getElementById("simpleImportBtn");
	const simpleImportFileBtn = document.getElementById("simpleImportFileBtn");
	const simpleImportFile = document.getElementById("simpleImportFile");
	const simpleImportStatus = document.getElementById("simpleImportStatus");
	const excludedDomainInput = document.getElementById("excludedDomainInput");
	const addExcludedDomainBtn = document.getElementById("addExcludedDomainBtn");
	const excludedDomainList = document.getElementById("excludedDomainList");
	let excludedDomains = [];
	let saveTimer = null;
	saveStatus.setAttribute("aria-live", "polite");

	function t(uiLang, key) {
		return UiI18n.t(uiLang, key);
	}

	function formatSyncNotice(uiLang, syncState) {
		if (!syncState || syncState.failed) return t(uiLang, "sync_failed");
		if (syncState.droppedWords > 0) {
			return t(uiLang, "sync_trimmed_notice").replace("{count}", String(syncState.droppedWords));
		}
		if (syncState.compactLevel > 0) {
			return t(uiLang, "sync_light_notice");
		}
		return t(uiLang, "synced");
	}

	function startOptionsTour(force) {
		if (!globalThis.UiTour) return;
		const run = force ? UiTour.start : UiTour.maybeStartOnce;
		run({
			storageKey: "options_v1",
			lang: uiLanguageSelect.value || "en",
			steps: UiTour.getSteps(uiLanguageSelect.value || "en", "options"),
		});
	}

	function renderCurrentLabel() {
		currentLang.textContent = getSelectedLabel(sourceLangSelect);
	}

	function renderDictionaryLookupVisibility() {
		const shouldShow = DictionaryUtilsRef.supportsDictionaryBySourceLang(sourceLangSelect.value);
		dictionaryLookupRow.style.display = shouldShow ? "" : "none";
	}

	function normalizeDomain(raw) {
		let value = (raw || "").trim().toLowerCase();
		value = value.replace(/^https?:\/\//, "");
		value = value.replace(/^www\./, "");
		value = value.replace(/\/.*$/, "");
		return value;
	}

	function renderExcludedDomains() {
		excludedDomainList.innerHTML = "";
		if (excludedDomains.length === 0) {
			const empty = document.createElement("span");
			empty.className = "switch-desc";
			empty.textContent = t(uiLanguageSelect.value || "en", "no_excluded_domains");
			excludedDomainList.appendChild(empty);
			return;
		}
		excludedDomains.forEach((domain) => {
			const chip = document.createElement("span");
			chip.className = "domain-chip";
			const text = document.createElement("span");
			text.textContent = domain;
			const del = document.createElement("button");
			del.type = "button";
			del.textContent = "×";
			del.addEventListener("click", function () {
				excludedDomains = excludedDomains.filter((d) => d !== domain);
				renderExcludedDomains();
				scheduleAutoSave();
			});
			chip.appendChild(text);
			chip.appendChild(del);
			excludedDomainList.appendChild(chip);
		});
	}

	function applyUiLanguage(uiLang) {
		document.documentElement.lang = UiI18n.langAttr(uiLang);
		document.documentElement.dir = UiI18n.dir(uiLang);
		document.title = t(uiLang, "options_title");
		document.getElementById("optionsTitle").textContent = t(uiLang, "options_title");
		document.getElementById("optionsDesc").textContent = t(uiLang, "options_desc");
		document.getElementById("generalSettingsTitle").textContent = t(uiLang, "general_settings");
		document.getElementById("currentLangLabel").textContent = t(uiLang, "current_lang");
		document.getElementById("sourceLangLabel").textContent = t(uiLang, "translation_source");
		document.getElementById("uiLangLabel").textContent = t(uiLang, "ui_language");
		document.getElementById("autoTranslateLabel").textContent = t(uiLang, "auto_translate");
		document.getElementById("autoTranslateDesc").textContent = t(uiLang, "auto_translate_desc");
		document.getElementById("dictionaryLookupLabel").textContent = t(uiLang, "dictionary_lookup");
		document.getElementById("dictionaryLookupDesc").textContent = t(uiLang, "dictionary_lookup_desc");
		document.getElementById("importExportLabel").textContent = t(uiLang, "import_export");
		document.getElementById("syncStorageHint").textContent = t(uiLang, "sync_storage_hint");
		document.getElementById("simpleImportLabel").textContent = t(uiLang, "simple_import");
		document.getElementById("simpleImportDesc").textContent = t(uiLang, "simple_import_desc");
		simpleImportInput.placeholder = t(uiLang, "simple_import_placeholder");
		simpleImportBtn.textContent = t(uiLang, "simple_import_action");
		simpleImportFileBtn.textContent = t(uiLang, "simple_import_file");
		document.getElementById("excludedDomainsLabel").textContent = t(uiLang, "excluded_domains");
		document.getElementById("excludedDomainsDesc").textContent = t(uiLang, "excluded_domains_desc");
		excludedDomainInput.placeholder = "example.com";
		addExcludedDomainBtn.textContent = t(uiLang, "add");
		saveBtn.textContent = t(uiLang, "save");
		syncBtn.textContent = t(uiLang, "sync_now");
		exportBtn.textContent = t(uiLang, "export");
		importBtn.textContent = t(uiLang, "import");
		if (helpBtn && globalThis.UiTour) {
			helpBtn.title = UiTour.getLabel(uiLang, "replay");
			helpBtn.setAttribute("aria-label", UiTour.getLabel(uiLang, "replay"));
		}
	}

	function persistSettings(showToast) {
		const sourceLang = sourceLangSelect.value;
		const autoTranslateOnSelect = autoTranslateCheckbox.checked;
		const dictionaryLookupEnabled = dictionaryLookupCheckbox.checked;
		const uiLanguage = uiLanguageSelect.value || "en";
		Promise.all([
			WordStorage.saveSourceLang(sourceLang),
			WordStorage.saveAutoTranslateOnSelect(autoTranslateOnSelect),
			WordStorage.saveDictionaryLookupEnabled(dictionaryLookupEnabled),
			WordStorage.saveUiLanguage(uiLanguage),
			WordStorage.saveExcludedDomains(excludedDomains),
		]).then(function () {
			renderCurrentLabel();
			saveStatus.textContent = t(uiLanguage, "saved");
			if (showToast) UiToast.show(t(uiLanguage, "saved"), "success");
		}).catch(function (error) {
			console.error("Failed to save settings:", error);
			saveStatus.textContent = t(uiLanguage, "save_failed");
			UiToast.show(t(uiLanguage, "save_failed"), "error");
		});
	}

	function scheduleAutoSave() {
		saveStatus.textContent = "";
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(function () {
			saveTimer = null;
			persistSettings(false);
		}, 180);
	}

	function setSimpleImportStatus(messageKey, replacements) {
		const uiLanguage = uiLanguageSelect.value || "en";
		let message = t(uiLanguage, messageKey);
		Object.keys(replacements || {}).forEach(function (key) {
			message = message.replace(`{${key}}`, String(replacements[key]));
		});
		simpleImportStatus.textContent = message;
	}

	function normalizeImportedWord(raw) {
		const value = (raw || "").trim().replace(/^\uFEFF/, "");
		if (!value) return "";
		const unquoted = value.replace(/^['"]+|['"]+$/g, "").trim();
		return unquoted;
	}

	function splitDelimitedColumns(line, delimiter) {
		const raw = String(line || "");
		const cells = [];
		let inQuotes = false;
		let cell = "";
		for (let i = 0; i < raw.length; i += 1) {
			const ch = raw[i];
			if (ch === '"') {
				if (inQuotes && raw[i + 1] === '"') {
					cell += '"';
					i += 1;
					continue;
				}
				inQuotes = !inQuotes;
				continue;
			}
			if (ch === delimiter && !inQuotes) {
				cells.push(cell);
				cell = "";
				continue;
			}
			cell += ch;
		}
		cells.push(cell);
		return cells;
	}

	function parseSimpleImportLine(line) {
		const raw = (line || "").trim();
		if (!raw) return null;
		if (!raw.includes(",")) {
			const wordOnly = normalizeImportedWord(raw);
			return wordOnly ? { word: wordOnly, meaning: "" } : null;
		}
		const columns = splitDelimitedColumns(raw, ",");
		const word = normalizeImportedWord(columns[0] || "");
		if (!word) return null;
		const meaning = columns.length > 1
			? normalizeImportedWord(columns[1] || "")
			: "";
		return { word, meaning };
	}

	function parseSimpleImportText(rawText) {
		const lines = String(rawText || "").split(/\r?\n/);
		const seen = new Set();
		const items = [];
		lines.forEach(function (line) {
			const parsed = parseSimpleImportLine(line);
			if (!parsed || !parsed.word) return;
			const key = parsed.word.toLocaleLowerCase();
			if (seen.has(key)) return;
			seen.add(key);
			items.push(parsed);
		});
		return items;
	}

	function createSimpleImportedEntry(existing, createdAt) {
		return {
			meaning: existing && typeof existing.meaning === "string" ? existing.meaning : "",
			learned: !!(existing && existing.learned),
			createdAt: existing && typeof existing.createdAt === "number" ? existing.createdAt : createdAt,
			examples: Array.isArray(existing && existing.examples) ? existing.examples : [],
			lemma: existing && typeof existing.lemma === "string" ? existing.lemma : "",
			familyForms: Array.isArray(existing && existing.familyForms) ? existing.familyForms : [],
			dictionary: existing && existing.dictionary && typeof existing.dictionary === "object" ? existing.dictionary : null,
			encounterCount: existing && typeof existing.encounterCount === "number" ? existing.encounterCount : 0,
			pageCount: existing && typeof existing.pageCount === "number" ? existing.pageCount : 0,
			encounterPageKeys: Array.isArray(existing && existing.encounterPageKeys) ? existing.encounterPageKeys : [],
		};
	}

	function requestRuntime(action, payload) {
		return new Promise(function (resolve) {
			chrome.runtime.sendMessage(Object.assign({ action: action }, payload || {}), function (response) {
				if (chrome.runtime.lastError) {
					resolve(null);
					return;
				}
				resolve(response || null);
			});
		});
	}

	function pickDictionarySummary(dictPayload) {
		if (!dictPayload || !dictPayload.found) return null;
		const sections = DictionaryUtilsRef.getEffectiveDictionarySections(dictPayload);
		const primary = sections.find(function (section) {
			return Array.isArray(section.entries) && section.entries.length > 0 && section.mode === "surface";
		}) || sections.find(function (section) {
			return Array.isArray(section.entries) && section.entries.length > 0;
		});
		if (!primary) return null;
		const first = primary.entries[0] || {};
		return {
			source: primary.source || dictPayload.source || "dictionary",
			queryText: primary.query || dictPayload.query || "",
			lookupLemma: dictPayload.lemma || "",
			usedLemma: !!dictPayload.usedLemma,
			pos: typeof first.pos === "string" ? first.pos : "",
			definitionOriginal: typeof first.definition === "string" ? first.definition : "",
			definitionTranslated: "",
			entries: [{
				pos: typeof first.pos === "string" ? first.pos : "",
				definitionOriginal: typeof first.definition === "string" ? first.definition : "",
				definitionTranslated: "",
			}],
			selectedIndex: 0,
			updatedAt: Date.now(),
		};
	}

	async function enrichImportedWords(importedItems) {
		if (!importedItems.length) return;
		const sourceLang = await WordStorage.getSourceLang();
		const dictionaryEnabled = await WordStorage.getDictionaryLookupEnabled().catch(function () {
			return true;
		});
		const canLookupDictionary = dictionaryEnabled && DictionaryUtilsRef.supportsDictionaryBySourceLang(sourceLang);
		const canLemma = globalThis.LemmaUtils && globalThis.LemmaUtils.supportsLemmaBySourceLang(sourceLang);

		let words = await WordStorage.getWords();
		for (let index = 0; index < importedItems.length; index += 1) {
			const item = importedItems[index];
			const word = item.word;
			const current = words[word];
			if (!current) continue;

			let next = Object.assign({}, current);
			if (canLemma) {
				const lemmaResult = await requestRuntime("getLemma", { text: word, sourceLang: sourceLang || "auto" });
				if (lemmaResult && lemmaResult.found && typeof lemmaResult.lemma === "string") {
					next.lemma = lemmaResult.lemma.trim();
					const variationsResult = await requestRuntime("getLemmaVariations", {
						text: word,
						lemma: next.lemma,
						sourceLang: sourceLang || "auto",
					});
					if (variationsResult && Array.isArray(variationsResult.familyForms)) {
						next.familyForms = variationsResult.familyForms.slice();
					}
				}
			}

			if (canLookupDictionary) {
				const dictPayload = await requestRuntime("lookupDictionary", {
					text: word,
					sourceLang: sourceLang || "auto",
				});
				const dictSummary = pickDictionarySummary(dictPayload);
				if (dictSummary) {
					if (dictSummary.definitionOriginal) {
						const translated = await requestRuntime("translate", {
							text: dictSummary.definitionOriginal,
							sourceLang: sourceLang || "auto",
						});
					if (translated && typeof translated.translation === "string") {
						dictSummary.definitionTranslated = translated.translation.trim();
						if (dictSummary.entries[0]) {
							dictSummary.entries[0].definitionTranslated = dictSummary.definitionTranslated;
						}
					}
					}
					next.dictionary = dictSummary;
					if (!next.meaning) {
						next.meaning = dictSummary.definitionTranslated || dictSummary.definitionOriginal || next.meaning;
					}
				}
			}

			if (!next.meaning) {
				const translatedWord = await requestRuntime("translate", {
					text: word,
					sourceLang: sourceLang || "auto",
				});
				if (translatedWord && typeof translatedWord.translation === "string") {
					next.meaning = translatedWord.translation.trim();
				}
			}

			words[word] = next;
			if ((index + 1) % 3 === 0 || index === importedItems.length - 1) {
				await WordStorage.saveWords(words, { syncMode: "deferred" });
				setSimpleImportStatus("simple_import_progress", {
					current: index + 1,
					total: importedItems.length,
				});
			}
		}

		setSimpleImportStatus("simple_import_enriched", { count: importedItems.length });
	}

	async function runSimpleImport(rawText) {
		const uiLanguage = uiLanguageSelect.value || "en";
		const importedItems = parseSimpleImportText(rawText);
		if (importedItems.length === 0) {
			UiToast.show(t(uiLanguage, "simple_import_empty"), "error");
			setSimpleImportStatus("simple_import_empty");
			return;
		}

		const words = await WordStorage.getWords();
		let addedCount = 0;
		const now = Date.now();
		importedItems.forEach(function (item, index) {
			const word = item.word;
			const existing = words[word];
			if (!existing) addedCount += 1;
			const next = createSimpleImportedEntry(existing, now + index);
			if (item.meaning && !next.meaning) {
				next.meaning = item.meaning;
			}
			words[word] = next;
		});
		await WordStorage.saveWords(words, { syncMode: "immediate" });

		UiToast.show(t(uiLanguage, "simple_import_done").replace("{count}", String(importedItems.length)), "success");
		setSimpleImportStatus("simple_import_queued", {
			count: importedItems.length,
			added: addedCount,
		});

		window.setTimeout(function () {
			enrichImportedWords(importedItems).catch(function (error) {
				console.error("Simple import enrichment failed:", error);
				setSimpleImportStatus("simple_import_partial");
			});
		}, 30);
	}

	Promise.all([
		WordStorage.getSourceLang(),
		WordStorage.getAutoTranslateOnSelect(),
		WordStorage.getDictionaryLookupEnabled(),
		WordStorage.getUiLanguage(),
		WordStorage.getExcludedDomains(),
	]).then(function ([savedLang, autoTranslate, dictionaryLookup, uiLang, excluded]) {
		sourceLangSelect.value = savedLang || "auto";
		autoTranslateCheckbox.checked = autoTranslate;
		dictionaryLookupCheckbox.checked = dictionaryLookup;
		uiLanguageSelect.value = uiLang || "zh-TW";
		excludedDomains = Array.isArray(excluded) ? excluded : [];
		applyUiLanguage(uiLanguageSelect.value);
		saveBtn.style.display = "none";
		renderCurrentLabel();
		renderDictionaryLookupVisibility();
		renderExcludedDomains();
		window.setTimeout(() => startOptionsTour(false), 200);
	}).catch(function (error) {
		console.error("Failed to load options:", error);
		uiLanguageSelect.value = "zh-TW";
		excludedDomains = [];
		applyUiLanguage("zh-TW");
		saveBtn.style.display = "none";
		renderCurrentLabel();
		renderDictionaryLookupVisibility();
		renderExcludedDomains();
		window.setTimeout(() => startOptionsTour(false), 200);
	});

	sourceLangSelect.addEventListener("change", function () {
		renderCurrentLabel();
		renderDictionaryLookupVisibility();
		scheduleAutoSave();
	});

	uiLanguageSelect.addEventListener("change", function () {
		applyUiLanguage(uiLanguageSelect.value);
		saveBtn.style.display = "none";
		renderExcludedDomains();
		scheduleAutoSave();
	});

	autoTranslateCheckbox.addEventListener("change", scheduleAutoSave);
	dictionaryLookupCheckbox.addEventListener("change", scheduleAutoSave);

	addExcludedDomainBtn.addEventListener("click", function () {
		const domain = normalizeDomain(excludedDomainInput.value);
		if (!domain) return;
		if (!excludedDomains.includes(domain)) {
			excludedDomains.push(domain);
			excludedDomains.sort();
			renderExcludedDomains();
			scheduleAutoSave();
		}
		excludedDomainInput.value = "";
	});

	saveBtn.addEventListener("click", function () {
		persistSettings(true);
	});

	syncBtn.addEventListener("click", function () {
		const uiLanguage = uiLanguageSelect.value || "en";
		syncBtn.disabled = true;
		syncBtn.textContent = t(uiLanguage, "syncing");
		WordStorage.syncFromCloud().then(function (result) {
			const syncState = result && (result.finalSyncState || result.initialSyncState);
			const notice = formatSyncNotice(uiLanguage, syncState);
			UiToast.show(notice, "success");
			saveStatus.textContent = notice;
			applyUiLanguage(uiLanguage);
		}).catch(function (error) {
			console.error("Manual sync failed:", error);
			UiToast.show(t(uiLanguage, "sync_failed"), "error");
			saveStatus.textContent = t(uiLanguage, "sync_failed");
			applyUiLanguage(uiLanguage);
		}).finally(function () {
			syncBtn.disabled = false;
		});
	});

	exportBtn.addEventListener("click", function () {
		const uiLanguage = uiLanguageSelect.value || "zh-TW";
		WordStorage.exportData().then(function (items) {
			const dataStr =
				"data:text/json;charset=utf-8," +
				encodeURIComponent(JSON.stringify(items));
			const a = document.createElement("a");
			a.setAttribute("href", dataStr);
			a.setAttribute("download", "wordlist.json");
			document.body.appendChild(a);
			a.click();
			a.remove();
			UiToast.show(t(uiLanguage, "exported"), "success");
		}).catch(function () {
			UiToast.show(t(uiLanguage, "save_failed"), "error");
		});
	});

	importBtn.addEventListener("click", function () {
		importFile.click();
	});

	simpleImportBtn.addEventListener("click", function () {
		runSimpleImport(simpleImportInput.value).catch(function (error) {
			console.error("Simple import failed:", error);
			UiToast.show(t(uiLanguageSelect.value || "en", "import_failed"), "error");
			setSimpleImportStatus("simple_import_partial");
		});
	});

	simpleImportFileBtn.addEventListener("click", function () {
		simpleImportFile.click();
	});

	importFile.addEventListener("change", function (event) {
		const file = event.target.files[0];
		const uiLanguage = uiLanguageSelect.value || "zh-TW";
		if (!(file && file.type === "application/json")) {
			UiToast.show(t(uiLanguage, "import_failed"), "error");
			return;
		}
		const reader = new FileReader();
		reader.onload = function (e) {
			try {
				const items = JSON.parse(e.target.result);
				WordStorage.importData(items).then(function () {
					UiToast.show(t(uiLanguage, "imported"), "success");
				}).catch(function () {
					UiToast.show(t(uiLanguage, "import_failed"), "error");
				});
			} catch (error) {
				UiToast.show(t(uiLanguage, "import_failed"), "error");
			}
		};
		reader.readAsText(file);
	});

	simpleImportFile.addEventListener("change", function (event) {
		const file = event.target.files[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = function (e) {
			runSimpleImport(e.target.result || "").catch(function (error) {
				console.error("Simple import file failed:", error);
				UiToast.show(t(uiLanguageSelect.value || "en", "import_failed"), "error");
				setSimpleImportStatus("simple_import_partial");
			});
		};
		reader.readAsText(file);
		event.target.value = "";
	});

	if (helpBtn) {
		helpBtn.addEventListener("click", function () {
			if (!globalThis.UiTour) return;
			UiTour.reset("options_v1").then(function () {
				window.setTimeout(function () {
					startOptionsTour(true);
				}, 40);
			});
		});
	}
});
