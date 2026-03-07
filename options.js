function getSelectedLabel(selectEl) {
	const option = selectEl.options[selectEl.selectedIndex];
	return option ? option.textContent : "-";
}

const DictionaryUtilsRef = globalThis.DictionaryUtils || {};

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
	const excludedDomainInput = document.getElementById("excludedDomainInput");
	const addExcludedDomainBtn = document.getElementById("addExcludedDomainBtn");
	const excludedDomainList = document.getElementById("excludedDomainList");
	let excludedDomains = [];
	let saveTimer = null;
	saveStatus.setAttribute("aria-live", "polite");

	function t(uiLang, key) {
		return UiI18n.t(uiLang, key);
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
		const shouldShow = typeof DictionaryUtilsRef.supportsDictionaryBySourceLang === "function"
			? DictionaryUtilsRef.supportsDictionaryBySourceLang(sourceLangSelect.value)
			: false;
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
		WordStorage.syncFromCloud().then(function () {
			UiToast.show(t(uiLanguage, "synced"), "success");
			saveStatus.textContent = t(uiLanguage, "synced");
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
