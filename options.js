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
			"cs", "de", "el", "en", "es", "fr", "id", "it", "ja", "ko",
			"ku", "ms", "nl", "pl", "pt", "ru", "simple", "th", "tr", "vi", "zh",
			"tl", "fil",
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
			empty.textContent = "目前無排除網域";
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
				saveStatus.textContent = "";
			});
			chip.appendChild(text);
			chip.appendChild(del);
			excludedDomainList.appendChild(chip);
		});
	}

	function applyUiLanguage(uiLang) {
		document.getElementById("optionsTitle").textContent = t(uiLang, "options_title");
		document.getElementById("optionsDesc").textContent = t(uiLang, "options_desc");
		document.getElementById("currentLangLabel").textContent = t(uiLang, "current_lang");
		document.getElementById("sourceLangLabel").textContent = t(uiLang, "translation_source");
		document.getElementById("uiLangLabel").textContent = t(uiLang, "ui_language");
		document.getElementById("autoTranslateLabel").textContent = t(uiLang, "auto_translate");
		document.getElementById("autoTranslateDesc").textContent = t(uiLang, "auto_translate_desc");
		document.getElementById("dictionaryLookupLabel").textContent = "啟用詞典查詢";
		document.getElementById("dictionaryLookupDesc").textContent = "可用語言時顯示詞典結果。";
		document.getElementById("importExportLabel").textContent = t(uiLang, "import_export");
		document.getElementById("excludedDomainsLabel").textContent = "排除網域";
		document.getElementById("excludedDomainsDesc").textContent = "這些網域不啟用高亮與例句功能。";
		addExcludedDomainBtn.textContent = "加入";
		saveBtn.textContent = t(uiLang, "save");
		exportBtn.textContent = t(uiLang, "export");
		importBtn.textContent = t(uiLang, "import");
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
		renderCurrentLabel();
		renderDictionaryLookupVisibility();
		renderExcludedDomains();
	}).catch(function (error) {
		console.error("Failed to load options:", error);
		uiLanguageSelect.value = "zh-TW";
		excludedDomains = [];
		applyUiLanguage("zh-TW");
		renderCurrentLabel();
		renderDictionaryLookupVisibility();
		renderExcludedDomains();
	});

	sourceLangSelect.addEventListener("change", function () {
		renderCurrentLabel();
		renderDictionaryLookupVisibility();
		saveStatus.textContent = "";
	});

	uiLanguageSelect.addEventListener("change", function () {
		applyUiLanguage(uiLanguageSelect.value);
		saveStatus.textContent = "";
	});

	addExcludedDomainBtn.addEventListener("click", function () {
		const domain = normalizeDomain(excludedDomainInput.value);
		if (!domain) return;
		if (!excludedDomains.includes(domain)) {
			excludedDomains.push(domain);
			excludedDomains.sort();
			renderExcludedDomains();
		}
		excludedDomainInput.value = "";
		saveStatus.textContent = "";
	});

	saveBtn.addEventListener("click", function () {
		const sourceLang = sourceLangSelect.value;
		const autoTranslateOnSelect = autoTranslateCheckbox.checked;
		const dictionaryLookupEnabled = dictionaryLookupCheckbox.checked;
		const uiLanguage = uiLanguageSelect.value;
		Promise.all([
			WordStorage.saveSourceLang(sourceLang),
			WordStorage.saveAutoTranslateOnSelect(autoTranslateOnSelect),
			WordStorage.saveDictionaryLookupEnabled(dictionaryLookupEnabled),
			WordStorage.saveUiLanguage(uiLanguage),
			WordStorage.saveExcludedDomains(excludedDomains),
		]).then(function () {
			renderCurrentLabel();
			saveStatus.textContent = t(uiLanguage, "saved");
			UiToast.show(t(uiLanguage, "saved"), "success");
		}).catch(function (error) {
			console.error("Failed to save settings:", error);
			saveStatus.textContent = t(uiLanguage, "save_failed");
			UiToast.show(t(uiLanguage, "save_failed"), "error");
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
});
