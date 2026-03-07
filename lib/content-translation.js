(function (global) {
	let wordPreviewCard = null;
	let wordPreviewHideTimer = null;
	const PREVIEW_TRANSLATE_CONCURRENCY = 2;
	let previewSourceLangPromise = null;
	let previewTranslateActive = 0;
	const previewTranslateQueue = [];
	const previewTranslateInflight = new Set();
	const previewTranslateCache = new Map();

	function translatePreviewSentence(sentence, deps) {
		const WordStorage = deps && deps.WordStorage;
		const chromeRuntime = deps && deps.chromeRuntime;
		if (!previewSourceLangPromise) {
			previewSourceLangPromise = WordStorage.getSourceLang().catch(() => "auto");
		}
		return previewSourceLangPromise.then((sourceLang) => new Promise((resolve) => {
			chromeRuntime.sendMessage(
				{ action: "translate", text: sentence, sourceLang: sourceLang || "auto" },
				(response) => {
					if (chromeRuntime.lastError || !response || !response.translation) {
						resolve("");
						return;
					}
					resolve(response.translation);
				}
			);
		}));
	}

	function runPreviewTranslateQueue(deps) {
		while (
			previewTranslateActive < PREVIEW_TRANSLATE_CONCURRENCY &&
			previewTranslateQueue.length > 0
		) {
			const job = previewTranslateQueue.shift();
			previewTranslateActive += 1;
			Promise.resolve()
				.then(job)
				.catch(() => {})
				.finally(() => {
					previewTranslateActive -= 1;
					runPreviewTranslateQueue(deps);
				});
		}
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
		previewTranslateQueue.push(async () => {
			const translated = await translatePreviewSentence(sentence, deps);
			previewTranslateInflight.delete(sentence);
			if (!translated) return;
			previewTranslateCache.set(sentence, translated);
			if (targetEl.isConnected) {
				targetEl.textContent = translated;
			}
		});
		runPreviewTranslateQueue(deps);
	}

	function createPreviewHighlightedSentence(sentence, word, deps) {
		const doc = (deps && deps.document) || document;
		const isCjkText = deps && deps.isCjkText;
		const isBoundaryMatch = deps && deps.isBoundaryMatch;
		const wrapper = doc.createElement("div");
		const rawWord = (word || "").trim();
		if (!sentence || !rawWord) {
			wrapper.textContent = sentence || "";
			return wrapper;
		}
		const isCjkWord = isCjkText(rawWord);
		const lowerSentence = sentence.toLowerCase();
		const lowerWord = rawWord.toLowerCase();
		let cursor = 0;
		let matched = false;

		while (cursor < sentence.length) {
			const start = lowerSentence.indexOf(lowerWord, cursor);
			if (start === -1) break;
			const end = start + rawWord.length;
			if (!isBoundaryMatch(sentence, start, end, isCjkWord)) {
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
				background: #fffaf3;
				border: 1px solid #dccabd;
				border-radius: 16px 14px 18px 13px;
				box-shadow: 0 14px 28px rgba(88, 63, 50, 0.14);
				padding: 11px 13px;
				color: #34251f;
				font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
				pointer-events: auto;
				animation: laWordPreviewIn 160ms ease-out;
			}
			.la-word-preview-meaning {
				font-size: 13px;
				font-weight: 700;
				line-height: 1.45;
				color: #7f5a4d;
			}
			.la-word-preview-list {
				margin: 8px 0 0;
				padding-left: 18px;
				font-size: 12px;
				line-height: 1.45;
				color: #4e3e36;
			}
			.la-word-preview-list li {
				margin-bottom: 4px;
			}
			.la-word-preview-trans {
				margin-top: 2px;
				font-size: 11px;
				color: #7a685d;
				border-left: 2px solid #ddd0c2;
				padding-left: 6px;
			}
			@keyframes laWordPreviewIn {
				from { opacity: 0; transform: translateY(5px) scale(0.985); }
				to { opacity: 1; transform: translateY(0) scale(1); }
			}
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
			hideWordPreview(70);
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

	function showWordPreview(anchor, meaning, examples, deps) {
		const getExampleText = deps && deps.getExampleText;
		const doc = (deps && deps.document) || document;
		const card = ensureWordPreviewCard({ document: doc });
		if (wordPreviewHideTimer) clearTimeout(wordPreviewHideTimer);
		card.innerHTML = "";

		const meaningEl = doc.createElement("div");
		meaningEl.className = "la-word-preview-meaning";
		meaningEl.textContent = meaning || "";
		card.appendChild(meaningEl);

		const items = (examples || [])
			.map(getExampleText)
			.filter((text) => text.length > 0)
			.slice(0, 3);
		if (items.length > 0) {
			const list = doc.createElement("ol");
			list.className = "la-word-preview-list";
			items.forEach((sentence) => {
				const li = doc.createElement("li");
				const text = createPreviewHighlightedSentence(sentence, anchor.textContent || "", deps);
				const trans = doc.createElement("div");
				trans.className = "la-word-preview-trans";
				trans.textContent = "…";
				li.appendChild(text);
				li.appendChild(trans);
				queuePreviewTranslation(sentence, trans, deps);
				list.appendChild(li);
			});
			card.appendChild(list);
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
		ensureTranslationUiStyles(doc);
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
		translationBox.style.padding = "11px 34px 11px 12px";
		translationBox.style.setProperty("background", "#fffaf3", "important");
		translationBox.style.setProperty("color", "#34251f", "important");
		translationBox.style.setProperty("border", "1px solid #dccabd", "important");
		translationBox.style.setProperty("border-radius", "16px 14px 18px 13px", "important");
		translationBox.style.setProperty("box-shadow", "0 14px 28px rgba(88, 63, 50, 0.16)", "important");
		translationBox.style.setProperty("opacity", "1", "important");
		translationBox.style.setProperty("mix-blend-mode", "normal", "important");
		translationBox.style.setProperty("backdrop-filter", "blur(1px)", "important");
		translationBox.style.zIndex = "10000";
		translationBox.style.maxWidth = `${window.innerWidth / 3}px`;
		translationBox.style.overflow = "auto";
		translationBox.style.minWidth = "220px";
		translationBox.style.animation = "pluginTranslationIn 180ms ease-out";
		translationBox.style.willChange = "transform, opacity";
		translationBox.style.pointerEvents = "auto";

		const closeBtn = doc.createElement("button");
		closeBtn.textContent = "×";
		closeBtn.setAttribute("aria-label", "Close");
		closeBtn.style.position = "absolute";
		closeBtn.style.right = "8px";
		closeBtn.style.top = "6px";
		closeBtn.style.border = "0";
		closeBtn.style.background = "transparent";
		closeBtn.style.color = "#8f6f62";
		closeBtn.style.fontSize = "14px";
		closeBtn.style.cursor = "pointer";
		closeBtn.style.lineHeight = "1";
		closeBtn.style.padding = "0 2px";
		closeBtn.style.zIndex = "1";

		const body = doc.createElement("div");
		body.style.fontSize = "13px";
		body.style.lineHeight = "1.5";
		body.textContent = translation;

		const dictWrap = doc.createElement("div");
		dictWrap.id = "translationDictionary";
		dictWrap.style.marginTop = "8px";
		dictWrap.style.paddingTop = "8px";
		dictWrap.style.borderTop = "1px solid #e1d4c7";
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

		closeBtn.addEventListener("click", (event) => {
			event.stopPropagation();
			closeBox();
		});
		doc.addEventListener("mousedown", onMouseDown, true);
		doc.addEventListener("mousemove", onMouseMove, true);
		doc.addEventListener("mouseup", onMouseUp, true);

		translationBox.appendChild(closeBtn);
		translationBox.appendChild(body);
		translationBox.appendChild(dictWrap);
		doc.body.appendChild(translationBox);
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
		const startContentSelectionTour = deps && deps.startContentSelectionTour;
		const state = deps && deps.state;
		if (!dictWrap || !dictResponse) return;
		dictWrap.style.display = "block";
		const sections = typeof DictionaryUtilsRef.getEffectiveDictionarySections === "function"
			? DictionaryUtilsRef.getEffectiveDictionarySections(dictResponse)
			: [];
		const renderEntry = (item) => {
			const row = doc.createElement("div");
			row.style.marginTop = "5px";
			const pos = doc.createElement("div");
			pos.style.fontSize = "11px";
			pos.style.color = "#8b7368";
			pos.textContent = item.pos ? `[${item.pos}]` : "";
			const def = doc.createElement("div");
			def.textContent = "…";
			row.appendChild(pos);
			row.appendChild(def);
			chromeRuntime.sendMessage(
				{
					action: "translate",
					text: item.definition || "",
					sourceLang: sourceLang || "auto",
				},
				(transResp) => {
					if (chromeRuntime.lastError || !transResp) return;
					const translated = transResp.translation || "";
					def.textContent = translated || (item.definition || "");
				}
			);
			return row;
		};
		if (typeof DictionaryUtilsRef.renderPassiveDictionarySections === "function") {
			DictionaryUtilsRef.renderPassiveDictionarySections(dictWrap, sections, {
				document: doc,
				titleText: contentT("dictionary"),
				emptyText: contentT("no_dict_entries"),
				getSectionTitle: (section) => `${DictionaryUtilsRef.getDictionarySectionLabel(contentT, section.mode, section.query)} · ${DictionaryUtilsRef.getDictionarySourceLabel(section.source)}`,
				decorateTitle(titleNode) {
					titleNode.style.fontWeight = "700";
					titleNode.style.marginBottom = "6px";
					titleNode.style.color = "#856a5f";
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
		} else {
			dictWrap.innerHTML = "";
		}
		if (state && !state.contentSelectionTourAttempted && doc.getElementById("translationBox")) {
			state.contentSelectionTourAttempted = true;
			window.setTimeout(() => startContentSelectionTour(false), 220);
		}
	}

	global.ContentTranslation = {
		queuePreviewTranslation,
		createPreviewHighlightedSentence,
		hideWordPreview,
		showWordPreview,
		showTranslation,
		appendDictionaryToTranslationBox,
	};
})(globalThis);
