(function (global) {
	let wordPreviewCard = null;
	let wordPreviewHideTimer = null;
	const PREVIEW_TRANSLATE_CONCURRENCY = 2;
	let previewSourceLangPromise = null;
	const previewTranslateInflight = new Set();
	const previewTranslateCache = new Map();
	const previewTranslateQueue = global.TranslationUtils.createTaskQueue(PREVIEW_TRANSLATE_CONCURRENCY);

	function translatePreviewSentence(sentence, deps) {
		const WordStorage = deps && deps.WordStorage;
		const chromeRuntime = deps && deps.chromeRuntime;
		const TranslationUtilsRef = deps && deps.TranslationUtilsRef;
		if (!previewSourceLangPromise) {
			previewSourceLangPromise = WordStorage.getSourceLang().catch(() => "auto");
		}
		return previewSourceLangPromise.then((sourceLang) => (
			TranslationUtilsRef.requestPreferredTranslation({
				chromeRuntime,
				chromeI18n: chrome.i18n,
				wordStorage: WordStorage,
				text: sentence,
				sourceLang: sourceLang || "auto",
			})
		));
	}

	function queuePreviewTranslation(sentence, targetEl, deps) {
		if (!sentence || !targetEl) return;
		const cached = previewTranslateCache.get(sentence);
		if (cached) {
			targetEl.textContent = cached;
			return;
		}
		if (previewTranslateInflight.has(sentence)) return;
		previewTranslateInflight.add(sentence);
		targetEl.textContent = "…";
		previewTranslateQueue(async () => {
			const translated = await translatePreviewSentence(sentence, deps);
			previewTranslateInflight.delete(sentence);
			if (!translated) return;
			previewTranslateCache.set(sentence, translated);
			if (targetEl.isConnected) {
				targetEl.textContent = translated;
			}
		});
	}

	function createPreviewHighlightedSentence(sentence, word, deps) {
		const doc = (deps && deps.document) || document;
		const isCjkText = deps && deps.isCjkText;
		const isBoundaryMatch = deps && deps.isBoundaryMatch;
		const findWholeWordMatch = deps && deps.findWholeWordMatch;
		const languageHint = deps && deps.languageHint;
		const wrapper = doc.createElement("div");
		const rawWord = (word || "").trim();
		if (!sentence || !rawWord) {
			wrapper.textContent = sentence || "";
			return wrapper;
		}
		let cursor = 0;
		let matched = false;

		while (cursor < sentence.length) {
			const match = typeof findWholeWordMatch === "function"
				? findWholeWordMatch(sentence, rawWord, languageHint, cursor)
				: null;
			const isCjkWord = isCjkText(rawWord);
			const lowerSentence = sentence.toLowerCase();
			const lowerWord = rawWord.toLowerCase();
			const start = match ? match.index : lowerSentence.indexOf(lowerWord, cursor);
			if (start === -1) break;
			const end = start + (match ? match.length : rawWord.length);
			if (!match && !isBoundaryMatch(sentence, start, end, isCjkWord)) {
				cursor = start + 1;
				continue;
			}
			if (start > cursor) {
				wrapper.appendChild(doc.createTextNode(sentence.slice(cursor, start)));
			}
			const mark = doc.createElement("span");
			mark.style.background = "#efe0a8";
			mark.style.color = "#4b392c";
			mark.style.borderRadius = "6px 5px 7px 5px";
			mark.style.padding = "0 3px";
			mark.style.boxShadow = "inset 0 -1px 0 rgba(120, 98, 67, 0.12)";
			mark.textContent = sentence.slice(start, end);
			wrapper.appendChild(mark);
			cursor = end;
			matched = true;
		}

		if (!matched) {
			wrapper.textContent = sentence;
			return wrapper;
		}
		if (cursor < sentence.length) {
			wrapper.appendChild(doc.createTextNode(sentence.slice(cursor)));
		}
		return wrapper;
	}

	function ensureWordPreviewStyle(doc) {
		if (doc.getElementById("laWordPreviewStyle")) return;
		const style = doc.createElement("style");
		style.id = "laWordPreviewStyle";
			style.textContent = `
				.la-word-preview {
					position: absolute;
					z-index: 2147483645;
					min-width: 260px;
					max-width: 420px;
					background:
						linear-gradient(180deg, rgba(255, 246, 236, 0.95) 0%, rgba(255, 251, 245, 0.98) 30%, #fffaf3 100%);
					border: 1px solid #decec1;
					border-radius: 18px 15px 21px 15px;
					box-shadow:
						0 16px 30px rgba(88, 63, 50, 0.13),
						inset 0 1px 0 rgba(255, 255, 255, 0.72);
					padding: 13px 15px 14px;
					color: #34251f;
					font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
					pointer-events: auto;
					animation: laWordPreviewIn 160ms ease-out;
				}
					.la-word-preview-meaning {
					font-size: 14px;
					font-weight: 600;
					line-height: 1.55;
					color: #7f5a4d;
				}
				.la-word-preview-family-current {
					padding: 2px 0 0;
					border-radius: 0;
					background: transparent;
					border: 0;
					box-shadow: none;
				}
				.la-word-preview-family-current .la-word-preview-meaning {
					color: #6f4b1d;
				}
				.la-word-preview-primary {
					padding: 2px 0 0;
					border-radius: 0;
					background: transparent;
					border: 0;
					box-shadow: none;
				}
				.la-word-preview-primary-label {
					font-size: 21px;
					font-weight: 700;
					letter-spacing: 0.01em;
					line-height: 1.12;
					color: #6f4a3d;
					font-family: "Noto Serif TC", "Hiragino Mincho ProN", "Yu Mincho", serif;
				}
				.la-word-preview-family-current-label {
					font-size: 21px;
					font-weight: 700;
					letter-spacing: 0.01em;
					line-height: 1.12;
					color: #7a5520;
					font-family: "Noto Serif TC", "Hiragino Mincho ProN", "Yu Mincho", serif;
				}
				.la-word-preview-note-label,
				.la-word-preview-example-label {
					font-size: 11px;
					font-weight: 700;
					letter-spacing: 0.01em;
					font-family: "Noto Serif TC", "Hiragino Mincho ProN", "Yu Mincho", serif;
				}
				.la-word-preview-head {
					display: flex;
					align-items: flex-start;
					justify-content: space-between;
					gap: 10px;
					margin-bottom: 7px;
				}
				.la-word-preview-audio {
					flex: 0 0 auto;
					width: 30px;
					height: 30px;
					border-radius: 999px;
					border: 1px solid #d9c6b7;
					background: linear-gradient(180deg, rgba(255, 252, 247, 0.98), rgba(247, 237, 227, 0.98));
					color: #7b5b4d;
					font-size: 13px;
					line-height: 1;
					display: inline-flex;
					align-items: center;
					justify-content: center;
					cursor: pointer;
					box-shadow:
						0 2px 6px rgba(120, 98, 67, 0.08),
						inset 0 1px 0 rgba(255, 255, 255, 0.8);
					transition: transform 120ms ease, background-color 120ms ease, border-color 120ms ease;
				}
				.la-word-preview-audio:hover {
					background: linear-gradient(180deg, #fff8ed, #f4e6d6);
					border-color: #cfb29c;
					transform: translateY(-1px);
				}
				.la-word-preview-example-block {
					margin-top: 12px;
					padding-top: 10px;
					border-top: 1px dashed #ddcfc2;
				}
				.la-word-preview-example-label {
					color: #8a695a;
					margin-bottom: 7px;
				}
				.la-word-preview-list {
					margin: 0;
					display: flex;
					flex-direction: column;
					gap: 0;
				}
				.la-word-preview-example-item {
					padding: 8px 2px 9px;
					border-bottom: 1px dashed #e5d7cb;
				}
				.la-word-preview-example-item:last-child {
					padding-bottom: 2px;
					border-bottom: 0;
				}
				.la-word-preview-example-text {
					font-size: 13px;
					line-height: 1.58;
					color: #4e3e36;
				}
				.la-word-preview-trans {
					margin-top: 7px;
					font-size: 11px;
					line-height: 1.55;
					color: #8a7769;
					padding-left: 10px;
					position: relative;
				}
				.la-word-preview-trans::before {
					content: "";
					position: absolute;
					left: 0;
					top: 4px;
					bottom: 4px;
					width: 2px;
					border-radius: 999px;
					background: linear-gradient(180deg, rgba(205, 176, 148, 0.75), rgba(205, 176, 148, 0.2));
				}
				.la-word-preview-dict {
					margin-top: 12px;
					padding-top: 10px;
					border-top: 1px dashed #ddd0c2;
					font-size: 11px;
					line-height: 1.5;
					color: #6e5a50;
				}
				.la-word-preview-note {
					margin-top: 12px;
					padding: 8px 0 0 11px;
					border-radius: 0;
					background: transparent;
					border: 0;
					border-left: 2px solid #ddc7b7;
					font-size: 11px;
					line-height: 1.55;
					color: #694f44;
				}
				.la-word-preview-note-label {
					margin-bottom: 4px;
					color: #8a6657;
				}
			@keyframes laWordPreviewIn {
				from { opacity: 0; transform: translateY(5px) scale(0.985); }
				to { opacity: 1; transform: translateY(0) scale(1); }
			}
			.la-zipf-badge {
				display: inline-block;
				font-size: 9px;
				font-weight: 800;
				padding: 1px 4px;
				border-radius: 3px;
				line-height: 1.4;
				letter-spacing: 0.02em;
				flex-shrink: 0;
				vertical-align: middle;
				margin-left: 5px;
			}
			.la-zipf-badge--A1 { background: #FFFFFF; color: #888; border: 1px solid #ddd; }
			.la-zipf-badge--A2 { background: #44AA44; color: #fff; }
			.la-zipf-badge--B1 { background: #0088FF; color: #fff; }
			.la-zipf-badge--B2 { background: #AA00FF; color: #fff; }
			.la-zipf-badge--C1 { background: #FFD700; color: #333; }
			.la-zipf-badge--C2 { background: #FF0000; color: #fff; }
		`;
		doc.head.appendChild(style);
	}

	function ensureWordPreviewCard(deps) {
		const doc = (deps && deps.document) || document;
		ensureWordPreviewStyle(doc);
		if (wordPreviewCard && wordPreviewCard.isConnected) return wordPreviewCard;
		wordPreviewCard = doc.createElement("div");
		wordPreviewCard.className = "la-word-preview";
		wordPreviewCard.style.display = "none";
		wordPreviewCard.addEventListener("mouseenter", () => {
			if (wordPreviewHideTimer) clearTimeout(wordPreviewHideTimer);
		});
		wordPreviewCard.addEventListener("mouseleave", () => {
			hideWordPreview(120);
		});
		doc.body.appendChild(wordPreviewCard);
		return wordPreviewCard;
	}

	function hideWordPreview(delay) {
		if (!wordPreviewCard) return;
		if (wordPreviewHideTimer) clearTimeout(wordPreviewHideTimer);
		wordPreviewHideTimer = setTimeout(() => {
			if (wordPreviewCard) wordPreviewCard.style.display = "none";
		}, typeof delay === "number" ? delay : 0);
	}

	function getContentLabel(deps, key) {
		if (deps && typeof deps.contentT === "function") {
			return deps.contentT(key);
		}
		const fallback = {
			dict_selected_form: "Selected form",
			dictionary: "Dictionary",
			no_dict_entries: "No dictionary entries yet",
			local_saved_words: "Saved word",
			examples: "Examples",
		};
		return fallback[key] || key;
	}

	function pronounceText(text, deps) {
		const raw = (text || "").trim();
		if (!raw || typeof global.SpeechSynthesisUtterance !== "function" || !global.speechSynthesis) return;
		const WordStorage = deps && deps.WordStorage;
		const speak = (lang) => {
			try {
				const utterance = new global.SpeechSynthesisUtterance(raw);
				if (lang) utterance.lang = lang;
				const voices = typeof global.speechSynthesis.getVoices === "function"
					? global.speechSynthesis.getVoices()
					: [];
				if (utterance.lang && Array.isArray(voices)) {
					for (let i = 0; i < voices.length; i += 1) {
						if (voices[i] && voices[i].lang === utterance.lang) {
							utterance.voice = voices[i];
							break;
						}
					}
				}
				if (typeof global.speechSynthesis.cancel === "function") {
					global.speechSynthesis.cancel();
				}
				global.speechSynthesis.speak(utterance);
			} catch (_error) {
				// Ignore speech runtime failures in preview UI.
			}
		};
		if (!WordStorage || typeof WordStorage.getSourceLang !== "function") {
			speak("");
			return;
		}
		Promise.resolve(WordStorage.getSourceLang()).then((sourceLang) => {
			speak(sourceLang || "");
		}).catch(() => speak(""));
	}

	function buildPreviewHead(doc, labelClassName, labelText, pronounceTarget, deps) {
		const head = doc.createElement("div");
		head.className = "la-word-preview-head";
		const label = doc.createElement("div");
		label.className = labelClassName;
		label.textContent = labelText || "";
		const WordfreqUtils = deps && deps.WordfreqUtils;
		const _getZipf = function(w, l) { return WordfreqUtils ? WordfreqUtils.getZipf(w, l) : null; };
		if (WordfreqUtils && deps && deps.WordStorage) {
			const badge = doc.createElement("span");
			badge.className = "la-zipf-badge";
			label.appendChild(badge);
			Promise.resolve(deps.WordStorage.getSourceLang()).then(function (sourceLang) {
				return WordfreqUtils.initForLang(sourceLang).then(function () { return sourceLang; });
			}).then(function (sourceLang) {
				if (!badge.isConnected) return;
				const word = (labelText || "").toLowerCase();
				const zipf = _getZipf(word, sourceLang);
				const tier = WordfreqUtils.getDifficultyTier(zipf, sourceLang);
				if (tier) {
					badge.className = "la-zipf-badge la-zipf-badge--" + tier;
					badge.textContent = tier;
					badge.title = "Zipf: " + zipf.toFixed(1);
					if ((tier === "C1" || tier === "C2") && deps.chromeRuntime) {
						deps.chromeRuntime.sendMessage({ action: "getLemma", text: word, sourceLang }, function (result) {
							if (deps.chromeRuntime.lastError || !badge.isConnected) return;
							if (!result || !result.found || !result.lemma) return;
							const lowerLemma = result.lemma.toLowerCase();
							if (lowerLemma === word) return;
							const lemmaZipf = _getZipf(lowerLemma, sourceLang);
							if (!lemmaZipf) return;
							const effective = zipf ? Math.max(zipf, lemmaZipf) : lemmaZipf;
							if (effective <= (zipf || 0)) return;
							const newTier = WordfreqUtils.getDifficultyTier(effective, sourceLang);
							if (!newTier || newTier === tier) return;
							badge.className = "la-zipf-badge la-zipf-badge--" + newTier;
							badge.textContent = newTier;
							badge.title = "Zipf: " + effective.toFixed(1);
						});
					}
				}
			}).catch(function () {});
		}
		const audioButton = doc.createElement("button");
		audioButton.type = "button";
		audioButton.className = "la-word-preview-audio";
		audioButton.textContent = "🔊";
		audioButton.title = getContentLabel(deps, "pronounce");
		audioButton.setAttribute("aria-label", getContentLabel(deps, "pronounce"));
		audioButton.addEventListener("click", (event) => {
			event.stopPropagation();
			event.preventDefault();
			pronounceText(pronounceTarget || labelText || "", deps);
		});
		head.appendChild(label);
		head.appendChild(audioButton);
		return head;
	}

	function renderLookupDictionarySections(container, sections, sourceLang, deps) {
		const doc = (deps && deps.document) || document;
		const DictionaryUtilsRef = deps && deps.DictionaryUtilsRef;
		const chromeRuntime = deps && deps.chromeRuntime;
		const TranslationUtilsRef = deps && deps.TranslationUtilsRef;
		const renderEntry = (item) => {
			const row = doc.createElement("div");
			row.style.marginTop = "5px";
			const pos = doc.createElement("div");
			pos.style.fontSize = "11px";
			pos.style.color = "#8b7368";
			pos.textContent = item.pos ? `[${item.pos}]` : "";
			const def = doc.createElement("div");
			def.textContent = item.definitionTranslated || "…";
			if (!item.definitionTranslated && item.definition) {
				Promise.resolve(
					TranslationUtilsRef.requestPreferredTranslation({
						chromeRuntime,
						chromeI18n: chrome.i18n,
						wordStorage: deps && deps.WordStorage,
						text: item.definition || "",
						sourceLang: sourceLang || "auto",
					})
				).then((translated) => {
					if (def.isConnected) {
						def.textContent = translated || (item.definition || "");
					}
				});
			}
			row.appendChild(pos);
			row.appendChild(def);
			return row;
		};
		DictionaryUtilsRef.renderPassiveDictionarySections(container, sections, {
			document: doc,
			titleText: getContentLabel(deps, "dictionary"),
			emptyText: getContentLabel(deps, "no_dict_entries"),
			getSectionTitle: (section) => `${DictionaryUtilsRef.getDictionarySectionLabel((key) => getContentLabel(deps, key), section.mode, section.query)} · ${DictionaryUtilsRef.getDictionarySourceLabel(section.source)}`,
				decorateTitle(titleNode) {
					titleNode.style.fontWeight = "700";
					titleNode.style.marginBottom = "6px";
					titleNode.style.color = "#856a5f";
					titleNode.style.fontFamily = '"Noto Serif TC", "Hiragino Mincho ProN", "Yu Mincho", serif';
					titleNode.style.fontSize = "12px";
				},
			decorateSection(sectionWrap, section, sectionIndex) {
				sectionWrap.style.marginTop = sectionIndex === 0 ? "0" : "8px";
				if (sectionIndex > 0) {
					sectionWrap.style.paddingTop = "8px";
					sectionWrap.style.borderTop = "1px dashed #e1d4c7";
				}
			},
			renderEntry,
		});
	}

	function showWordPreview(anchor, previewData, maybeExamples, maybeDeps) {
		const deps = maybeDeps || maybeExamples;
		const legacyExamples = maybeDeps ? maybeExamples : null;
		const getExampleText = deps && deps.getExampleText;
		const doc = (deps && deps.document) || document;
		const chromeRuntime = deps && deps.chromeRuntime;
		const TranslationUtilsRef = deps && deps.TranslationUtilsRef;
		const DictionaryUtilsRef = deps && deps.DictionaryUtilsRef;
		const WordStorage = deps && deps.WordStorage;
		const normalizeDictionaryQuery = deps && deps.normalizeDictionaryQuery;
		const shouldLookupDictionaryQuery = deps && deps.shouldLookupDictionaryQuery;
		const supportsDictionaryBySourceLang = deps && deps.supportsDictionaryBySourceLang;
		const renderMeaningMode = !previewData || typeof previewData === "string" || Array.isArray(previewData);
		const meaning = renderMeaningMode ? (previewData || "") : (previewData.meaning || "");
		const examples = renderMeaningMode
			? (Array.isArray(legacyExamples) ? legacyExamples : [])
			: (Array.isArray(previewData.examples) ? previewData.examples : []);
		const card = ensureWordPreviewCard({ document: doc });
		if (wordPreviewHideTimer) clearTimeout(wordPreviewHideTimer);
		card.innerHTML = "";

		if (!renderMeaningMode && previewData && previewData.mode === "family") {
			const currentWrap = doc.createElement("div");
			currentWrap.className = "la-word-preview-family-current";
			currentWrap.appendChild(buildPreviewHead(
				doc,
				"la-word-preview-family-current-label",
				anchor.textContent || previewData.currentForm || "",
				previewData.currentForm || anchor.textContent || "",
				deps
			));
			const meaningEl = doc.createElement("div");
			meaningEl.className = "la-word-preview-meaning";
			meaningEl.textContent = "…";
			currentWrap.appendChild(meaningEl);
			card.appendChild(currentWrap);

			WordStorage.getSourceLang().then((sourceLang) => {
				TranslationUtilsRef.requestPreferredTranslation({
					chromeRuntime,
					chromeI18n: chrome.i18n,
					wordStorage: WordStorage,
					text: previewData.currentForm || anchor.textContent || "",
					sourceLang: sourceLang || "auto",
				}).then((translated) => {
					if (meaningEl.isConnected) {
						meaningEl.textContent = translated || (previewData.currentForm || anchor.textContent || "");
					}
				});

				const query = normalizeDictionaryQuery(previewData.currentForm || anchor.textContent || "");
				if (!(query && supportsDictionaryBySourceLang(sourceLang) && shouldLookupDictionaryQuery(query))) {
					return;
				}
				const dictWrap = doc.createElement("div");
				dictWrap.className = "la-word-preview-dict";
				dictWrap.textContent = "…";
				card.appendChild(dictWrap);
				chromeRuntime.sendMessage(
					{ action: "lookupDictionary", text: query, sourceLang: sourceLang || "auto" },
					(response) => {
						if (!dictWrap.isConnected) return;
							if (!response || !response.found) {
								dictWrap.textContent = getContentLabel(deps, "no_dict_entries");
								return;
							}
						const rawSections = DictionaryUtilsRef
							.getEffectiveDictionarySections(response)
							.filter((section) => section.mode !== "lemma")
							.filter((section) => Array.isArray(section.entries) && section.entries.length > 0);
							if (rawSections.length === 0) {
								dictWrap.textContent = getContentLabel(deps, "no_dict_entries");
								return;
							}
						DictionaryUtilsRef.mapDictionarySections(response, sourceLang || "auto", {
							translateEntry(definition, effectiveSourceLang) {
								return TranslationUtilsRef.requestPreferredTranslation({
									chromeRuntime,
									chromeI18n: chrome.i18n,
									wordStorage: WordStorage,
									text: definition,
									sourceLang: effectiveSourceLang || "auto",
								});
							},
						}).then((sections) => {
							if (!dictWrap.isConnected) return;
							const visibleSections = Array.isArray(sections)
								? sections.filter((section) => section.mode !== "lemma")
								: [];
								if (visibleSections.length === 0) {
									dictWrap.textContent = getContentLabel(deps, "no_dict_entries");
									return;
								}
							dictWrap.innerHTML = "";
							renderLookupDictionarySections(dictWrap, visibleSections, sourceLang, {
									document: doc,
									DictionaryUtilsRef,
									contentT: (key) => getContentLabel(deps, key),
									chromeRuntime,
									WordStorage,
									TranslationUtilsRef,
								});
						}).catch(() => {
							if (!dictWrap.isConnected) return;
							dictWrap.innerHTML = "";
							renderLookupDictionarySections(dictWrap, rawSections, sourceLang, {
									document: doc,
									DictionaryUtilsRef,
									contentT: (key) => getContentLabel(deps, key),
									chromeRuntime,
									WordStorage,
									TranslationUtilsRef,
								});
						});
					}
				);
			}).catch(() => {
				meaningEl.textContent = previewData.currentForm || anchor.textContent || "";
			});

			const note = doc.createElement("div");
			note.className = "la-word-preview-note";
			const noteLabel = doc.createElement("div");
			noteLabel.className = "la-word-preview-note-label";
			noteLabel.textContent = getContentLabel(deps, "local_saved_words");
			const noteBody = doc.createElement("div");
			const savedWord = previewData.rootWord || "";
			const savedMeaning = previewData.rootMeaning || "";
			noteBody.textContent = savedWord && savedMeaning
				? `${savedWord} · ${savedMeaning}`
				: (savedWord || savedMeaning);
			note.appendChild(noteLabel);
			note.appendChild(noteBody);
			card.appendChild(note);
			} else {
				const primaryWrap = doc.createElement("div");
				primaryWrap.className = "la-word-preview-primary";
				const meaningEl = doc.createElement("div");
				meaningEl.className = "la-word-preview-meaning";
				meaningEl.textContent = meaning || "";
				primaryWrap.appendChild(buildPreviewHead(
					doc,
					"la-word-preview-primary-label",
					anchor.textContent || "",
					anchor.textContent || "",
					deps
				));
				primaryWrap.appendChild(meaningEl);
				card.appendChild(primaryWrap);

				const items = (examples || [])
					.map(getExampleText)
					.filter((text) => text.length > 0)
					.slice(0, 3);
				if (items.length > 0) {
					const exampleWrap = doc.createElement("div");
					exampleWrap.className = "la-word-preview-example-block";
					const exampleLabel = doc.createElement("div");
					exampleLabel.className = "la-word-preview-example-label";
					exampleLabel.textContent = getContentLabel(deps, "examples");
					const list = doc.createElement("div");
					list.className = "la-word-preview-list";
					items.forEach((sentence) => {
						const li = doc.createElement("div");
						li.className = "la-word-preview-example-item";
						const text = createPreviewHighlightedSentence(sentence, anchor.textContent || "", deps);
						text.classList.add("la-word-preview-example-text");
						const trans = doc.createElement("div");
						trans.className = "la-word-preview-trans";
						trans.textContent = "…";
					li.appendChild(text);
					li.appendChild(trans);
						queuePreviewTranslation(sentence, trans, deps);
						list.appendChild(li);
					});
					exampleWrap.appendChild(exampleLabel);
					exampleWrap.appendChild(list);
					card.appendChild(exampleWrap);
				}
			}

		card.style.display = "block";
		const rect = anchor.getBoundingClientRect();
		const cardRect = card.getBoundingClientRect();
		let left = rect.left + window.scrollX;
		let top = rect.bottom + window.scrollY + 8;
		const maxLeft = window.scrollX + window.innerWidth - cardRect.width - 10;
		if (left > maxLeft) left = Math.max(window.scrollX + 10, maxLeft);
		const maxTop = window.scrollY + window.innerHeight - cardRect.height - 10;
		if (top > maxTop) top = rect.top + window.scrollY - cardRect.height - 8;
		card.style.left = `${Math.max(window.scrollX + 8, left)}px`;
		card.style.top = `${Math.max(window.scrollY + 8, top)}px`;
	}

	function ensureTranslationUiStyles(doc) {
		if (doc.getElementById("pluginTranslationStyle")) return;
		const style = doc.createElement("style");
		style.id = "pluginTranslationStyle";
		style.textContent = `
			@keyframes pluginTranslationIn {
				from { opacity: 0; transform: translateY(7px) scale(0.985); }
				to { opacity: 1; transform: translateY(0) scale(1); }
			}
		`;
		doc.head.appendChild(style);
	}

	function showTranslation(translation, deps) {
		const doc = (deps && deps.document) || document;
		const startContentSelectionTour = deps && deps.startContentSelectionTour;
		const state = deps && deps.state;
		const WordfreqUtils = deps && deps.WordfreqUtils;
		const _getZipf = function(w, l) { return WordfreqUtils ? WordfreqUtils.getZipf(w, l) : null; };
		const sourceWord = deps && deps.sourceWord;
		const sourceLang = deps && deps.sourceLang;
		ensureTranslationUiStyles(doc);
		if (WordfreqUtils && sourceWord) ensureWordPreviewStyle(doc);
		const existingBox = doc.getElementById("translationBox");
		if (existingBox) existingBox.remove();
		const selection = window.getSelection();
		if (!selection.rangeCount) return null;
		const range = selection.getRangeAt(0);
		const rect = range.getBoundingClientRect();
		const translationBox = doc.createElement("div");
		translationBox.id = "translationBox";
		translationBox.style.position = "absolute";
		translationBox.style.left = `${rect.left + window.scrollX}px`;
		translationBox.style.top = `${rect.bottom + window.scrollY + 10}px`;
			translationBox.style.padding = "12px 13px";
			translationBox.style.setProperty("background", "linear-gradient(180deg, rgba(255, 250, 243, 0.98), rgba(250, 242, 232, 0.92))", "important");
		translationBox.style.setProperty("color", "#34251f", "important");
		translationBox.style.setProperty("border", "1px solid #dccabd", "important");
		translationBox.style.setProperty("border-radius", "16px 14px 18px 13px", "important");
		translationBox.style.setProperty("box-shadow", "0 14px 28px rgba(88, 63, 50, 0.16)", "important");
		translationBox.style.setProperty("opacity", "1", "important");
		translationBox.style.setProperty("mix-blend-mode", "normal", "important");
			translationBox.style.zIndex = "10000";
		translationBox.style.maxWidth = `${window.innerWidth / 3}px`;
		translationBox.style.overflow = "auto";
		translationBox.style.minWidth = "220px";
		translationBox.style.animation = "pluginTranslationIn 180ms ease-out";
		translationBox.style.willChange = "transform, opacity";
		translationBox.style.pointerEvents = "auto";

		const body = doc.createElement("div");
		body.style.fontSize = "13px";
			body.style.lineHeight = "1.58";
		body.textContent = translation;
		if (WordfreqUtils && sourceWord && WordfreqUtils.isSupported(sourceLang)) {
			const badge = doc.createElement("span");
			badge.className = "la-zipf-badge";
			badge.style.marginLeft = "6px";
			badge.style.verticalAlign = "middle";
			body.appendChild(badge);
			WordfreqUtils.initForLang(sourceLang).then(function () {
				if (!badge.isConnected) return;
				const word = sourceWord.toLowerCase();
				const zipf = _getZipf(word, sourceLang);
				const tier = WordfreqUtils.getDifficultyTier(zipf, sourceLang);
				if (!tier) return;
				badge.className = "la-zipf-badge la-zipf-badge--" + tier;
				badge.textContent = tier;
				badge.title = sourceWord + "  Zipf: " + zipf.toFixed(1);
				if ((tier === "C1" || tier === "C2") && deps.chromeRuntime) {
					deps.chromeRuntime.sendMessage({ action: "getLemma", text: word, sourceLang }, function (result) {
						if (deps.chromeRuntime.lastError || !badge.isConnected) return;
						if (!result || !result.found || !result.lemma) return;
						const lowerLemma = result.lemma.toLowerCase();
						if (lowerLemma === word) return;
						const lemmaZipf = _getZipf(lowerLemma, sourceLang);
						if (!lemmaZipf) return;
						const effective = zipf ? Math.max(zipf, lemmaZipf) : lemmaZipf;
						if (effective <= (zipf || 0)) return;
						const newTier = WordfreqUtils.getDifficultyTier(effective, sourceLang);
						if (!newTier || newTier === tier) return;
						badge.className = "la-zipf-badge la-zipf-badge--" + newTier;
						badge.textContent = newTier;
						badge.title = sourceWord + "  Zipf: " + effective.toFixed(1);
					});
				}
			}).catch(function () {});
		}

		const dictWrap = doc.createElement("div");
		dictWrap.id = "translationDictionary";
		dictWrap.style.marginTop = "8px";
		dictWrap.style.paddingTop = "8px";
			dictWrap.style.borderTop = "1px dashed #e1d4c7";
		dictWrap.style.fontSize = "12px";
		dictWrap.style.lineHeight = "1.45";
		dictWrap.style.color = "#6a5a52";
		dictWrap.style.display = "none";

		let pointerDownInside = false;
		let startX = 0;
		let startY = 0;
		let moved = false;

		function hasSelectedTextInsideBox() {
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
			for (let i = 0; i < sel.rangeCount; i += 1) {
				const innerRange = sel.getRangeAt(i);
				const node = innerRange.commonAncestorContainer;
				const target = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
				if (target && translationBox.contains(target)) return true;
			}
			return false;
		}

		function cleanup() {
			doc.removeEventListener("mousedown", onMouseDown, true);
			doc.removeEventListener("mousemove", onMouseMove, true);
			doc.removeEventListener("mouseup", onMouseUp, true);
		}

		function closeBox() {
			cleanup();
			translationBox.remove();
		}

		function onMouseDown(event) {
			pointerDownInside = translationBox.contains(event.target);
			startX = event.clientX;
			startY = event.clientY;
			moved = false;
		}

		function onMouseMove(event) {
			if (!pointerDownInside) return;
			if (Math.abs(event.clientX - startX) > 3 || Math.abs(event.clientY - startY) > 3) {
				moved = true;
			}
		}

		function onMouseUp() {
			if (hasSelectedTextInsideBox()) return;
			if (pointerDownInside && moved) return;
			closeBox();
		}

		doc.addEventListener("mousedown", onMouseDown, true);
		doc.addEventListener("mousemove", onMouseMove, true);
		doc.addEventListener("mouseup", onMouseUp, true);

		translationBox.appendChild(body);
		translationBox.appendChild(dictWrap);
		doc.body.appendChild(translationBox);
		if (state && !state.contentSelectionTourAttempted && !state.contentSelectionTourPending) {
			state.contentSelectionTourPending = true;
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					if (!translationBox.isConnected) {
						state.contentSelectionTourPending = false;
						return;
					}
					Promise.resolve(startContentSelectionTour(false))
						.then((started) => {
							if (started || !translationBox.isConnected) {
								state.contentSelectionTourAttempted = true;
							}
						})
						.finally(() => {
							state.contentSelectionTourPending = false;
						});
				});
			});
		}
		setTimeout(() => {
			closeBox();
		}, 10000);
		return translationBox;
	}

	function appendDictionaryToTranslationBox(dictResponse, sourceLang, deps) {
		const doc = (deps && deps.document) || document;
		const dictWrap = doc.getElementById("translationDictionary");
		const DictionaryUtilsRef = deps && deps.DictionaryUtilsRef;
		const contentT = deps && deps.contentT;
		const chromeRuntime = deps && deps.chromeRuntime;
		const TranslationUtilsRef = deps && deps.TranslationUtilsRef;
		if (!dictWrap || !dictResponse) return;
		dictWrap.style.display = "block";
		const sections = DictionaryUtilsRef.getEffectiveDictionarySections(dictResponse);
		renderLookupDictionarySections(dictWrap, sections, sourceLang, {
			document: doc,
			DictionaryUtilsRef,
			contentT,
			chromeRuntime,
			WordStorage: deps && deps.WordStorage,
			TranslationUtilsRef,
		});
	}

	global.ContentLookupUi = {
		queuePreviewTranslation,
		createPreviewHighlightedSentence,
		hideWordPreview,
		renderLookupDictionarySections,
		showWordPreview,
		showTranslation,
		appendDictionaryToTranslationBox,
	};
})(globalThis);
