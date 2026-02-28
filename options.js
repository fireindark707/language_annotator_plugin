function getSelectedLabel(selectEl) {
	const option = selectEl.options[selectEl.selectedIndex];
	return option ? option.textContent : "-";
}

document.addEventListener("DOMContentLoaded", function () {
	const sourceLangSelect = document.getElementById("sourceLang");
	const uiLanguageSelect = document.getElementById("uiLanguage");
	const autoTranslateCheckbox = document.getElementById("autoTranslateOnSelect");
	const dictionaryLookupRow = document.getElementById("dictionaryLookupRow");
	const dictionaryLookupCheckbox = document.getElementById("dictionaryLookupEnabled");
	const currentLang = document.getElementById("currentLang");
	const saveBtn = document.getElementById("save");
	const saveStatus = document.getElementById("saveStatus");
	const exportBtn = document.getElementById("exportBtn");
	const importBtn = document.getElementById("importBtn");
	const importFile = document.getElementById("importFile");
	const excludedDomainInput = document.getElementById("excludedDomainInput");
	const addExcludedDomainBtn = document.getElementById("addExcludedDomainBtn");
	const excludedDomainList = document.getElementById("excludedDomainList");
	let excludedDomains = [];
	let saveTimer = null;

	function t(uiLang, key) {
		return UiI18n.t(uiLang, key);
	}

	function renderCurrentLabel() {
		currentLang.textContent = getSelectedLabel(sourceLangSelect);
	}

	function supportsDictionaryBySourceLang(sourceLang) {
		const normalized = (sourceLang || "").toLowerCase();
		if (!normalized || normalized === "auto") return false;
		const base = normalized.split("-")[0];
		const supported = new Set([
			"ar", "bn", "cs", "de", "el", "en", "es", "fa", "fil", "fr",
			"he", "hi", "hu", "id", "it", "ja", "jv", "km", "ko", "lo",
			"ms", "my", "nl", "pl", "pt", "ro", "ru", "su", "sv", "sw",
			"ta", "te", "th", "tl", "tr", "ur", "vi", "zh",
		]);
		return supported.has(base);
	}

	function renderDictionaryLookupVisibility() {
		const shouldShow = supportsDictionaryBySourceLang(sourceLangSelect.value);
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
		addExcludedDomainBtn.textContent = t(uiLang, "add");
		saveBtn.textContent = t(uiLang, "save");
		exportBtn.textContent = t(uiLang, "export");
		importBtn.textContent = t(uiLang, "import");
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
	}).catch(function (error) {
		console.error("Failed to load options:", error);
		uiLanguageSelect.value = "zh-TW";
		excludedDomains = [];
		applyUiLanguage("zh-TW");
		saveBtn.style.display = "none";
		renderCurrentLabel();
		renderDictionaryLookupVisibility();
		renderExcludedDomains();
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
});
