(function (global) {
	let confirmModal = null;

	function ensureAddWordModalStyle(doc) {
		const targetDocument = doc || document;
		if (targetDocument.getElementById("laAddWordStyle")) return;
		const style = targetDocument.createElement("style");
		style.id = "laAddWordStyle";
		style.textContent = `
			.la-addword-overlay {
				position: fixed;
				inset: 0;
				background: rgba(83, 61, 50, 0.24);
				z-index: 2147483646;
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 16px;
				animation: laFadeIn 140ms ease-out;
			}
			.la-addword-modal {
				width: min(520px, 96vw);
				background: #fffaf3;
				border: 1px solid #dccabd;
				border-radius: 18px 15px 20px 16px;
				box-shadow: 0 18px 30px rgba(88, 63, 50, 0.16);
				padding: 16px;
				color: #34251f;
				font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
				animation: laRiseIn 170ms ease-out;
			}
			.la-addword-title {
				margin: 0;
				font-size: 18px;
				font-weight: 800;
				font-family: "Noto Serif TC", "Hiragino Mincho ProN", "Yu Mincho", serif;
			}
			.la-addword-modal button,
			.la-addword-modal textarea,
			.la-confirm-modal button {
				all: unset;
				box-sizing: border-box;
				font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
				line-height: 1.4;
				letter-spacing: normal;
				text-transform: none;
				-webkit-appearance: none;
				appearance: none;
			}
			.la-addword-word {
				margin-top: 8px;
				font-size: 14px;
				font-weight: 700;
				color: #8f5143;
			}
			.la-addword-hint {
				margin-top: 10px;
				font-size: 12px;
				color: #7b655b;
			}
			.la-addword-lemma {
				margin-top: 8px;
				padding: 8px 10px;
				border: 1px dashed #dcc8b8;
				border-radius: 12px 10px 14px 10px;
				background: #fff8f1;
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
			}
			.la-addword-lemma-text {
				font-size: 12px;
				line-height: 1.45;
				color: #7a6258;
			}
			.la-addword-modal .la-addword-lemma-btn {
				display: inline-flex !important;
				align-items: center !important;
				justify-content: center !important;
				min-height: 32px !important;
				border: 1px solid #dcc8b8 !important;
				border-radius: 10px 9px 11px 8px !important;
				padding: 5px 9px !important;
				font-size: 11px !important;
				font-weight: 700 !important;
				cursor: pointer !important;
				background-color: #fffdf9 !important;
				color: #8a5f50 !important;
				flex: 0 0 auto !important;
				text-decoration: none !important;
			}
			.la-addword-input {
				display: block;
				width: 100%;
				margin-top: 8px;
				border: 1px solid #dccabd;
				border-radius: 14px 12px 16px 11px;
				padding: 10px;
				font-size: 14px;
				line-height: 1.4;
				resize: vertical;
				outline: none;
			}
			.la-addword-input:focus {
				border-color: #a55143;
				box-shadow: 0 0 0 3px rgba(165, 81, 67, 0.12);
			}
			.la-addword-footer {
				margin-top: 12px;
				display: flex;
				justify-content: flex-end;
				gap: 8px;
			}
			.la-addword-dict {
				margin-top: 10px;
				padding: 8px 10px;
				border: 1px solid #e2d3c6;
				border-radius: 14px 12px 16px 11px;
				background: #fffdf9;
			}
			.la-addword-dict-title {
				font-size: 11px;
				font-weight: 700;
				color: #8b6c53;
			}
			.la-addword-dict-list {
				display: grid;
				gap: 8px;
				margin-top: 6px;
			}
			.la-addword-dict-section {
				display: grid;
				gap: 8px;
			}
			.la-addword-dict-section.is-secondary {
				padding-top: 8px;
				border-top: 1px dashed #e2d3c6;
			}
			.la-addword-dict-section-title {
				font-size: 11px;
				font-weight: 800;
				color: #8b6c53;
			}
			.la-addword-dict-item {
				display: grid;
				grid-template-columns: minmax(0, 1fr) auto;
				align-items: end;
				column-gap: 10px;
				border: 1px solid #ded0c3;
				border-radius: 12px 10px 14px 10px;
				background: #fffaf5;
				padding: 6px 8px;
			}
			.la-addword-dict-item.is-selected {
				border-color: #a55143;
				box-shadow: 0 0 0 2px rgba(165, 81, 67, 0.12);
			}
			.la-addword-dict-body {
				min-width: 0;
			}
			.la-addword-dict-pos {
				font-size: 10px;
				color: #8c7567;
			}
			.la-addword-dict-original {
				margin-top: 2px;
				font-size: 12px;
				line-height: 1.45;
				color: #5a473d;
			}
			.la-addword-dict-translated {
				margin-top: 3px;
				font-size: 12px;
				line-height: 1.45;
				color: #6d5d56;
				border-left: 2px solid #ddd0c2;
				padding-left: 6px;
			}
			.la-addword-modal .la-addword-dict-apply {
				display: inline-flex !important;
				align-items: center !important;
				justify-content: center !important;
				align-self: end !important;
				margin-top: 0 !important;
				margin-bottom: 1px !important;
				min-height: 32px !important;
				min-width: 52px !important;
				border: 0 !important;
				border-radius: 10px 9px 11px 8px !important;
				padding: 4px 8px !important;
				font-size: 11px !important;
				font-weight: 700 !important;
				cursor: pointer !important;
				background-color: #b26b54 !important;
				color: #fffaf3 !important;
				text-decoration: none !important;
			}
			@media (max-width: 460px) {
				.la-addword-dict-item {
					grid-template-columns: 1fr;
					row-gap: 8px;
				}
				.la-addword-modal .la-addword-dict-apply {
					justify-self: start !important;
				}
			}
			.la-addword-modal .la-addword-btn {
				display: inline-flex !important;
				align-items: center !important;
				justify-content: center !important;
				min-height: 40px !important;
				border: 1px solid #d8c7b8 !important;
				border-radius: 12px 10px 14px 10px !important;
				padding: 8px 12px !important;
				font-size: 13px !important;
				font-weight: 700 !important;
				cursor: pointer !important;
				text-decoration: none !important;
			}
			.la-addword-modal .la-addword-cancel {
				background-color: #f4eadf !important;
				color: #7a6155 !important;
			}
			.la-addword-modal .la-addword-save {
				background-color: #a55143 !important;
				border-color: #9a5b49 !important;
				color: #fffaf3 !important;
			}
			.la-confirm-overlay {
				position: fixed;
				inset: 0;
				background: rgba(83, 61, 50, 0.24);
				z-index: 2147483646;
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 16px;
				animation: laFadeIn 140ms ease-out;
			}
			.la-confirm-modal {
				width: min(420px, 94vw);
				background: #fffaf3;
				border: 1px solid #dccabd;
				border-radius: 18px 15px 20px 16px;
				box-shadow: 0 18px 30px rgba(88, 63, 50, 0.16);
				padding: 16px;
				color: #34251f;
				font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
				animation: laRiseIn 170ms ease-out;
			}
			.la-confirm-title {
				margin: 0 0 8px 0;
				font-size: 16px;
				font-weight: 800;
				font-family: "Noto Serif TC", "Hiragino Mincho ProN", "Yu Mincho", serif;
			}
			.la-confirm-desc {
				margin: 0;
				font-size: 13px;
				color: #7b655b;
				line-height: 1.45;
			}
			.la-confirm-footer {
				margin-top: 14px;
				display: flex;
				justify-content: flex-end;
				gap: 8px;
			}
			.la-confirm-modal .la-confirm-btn {
				display: inline-flex !important;
				align-items: center !important;
				justify-content: center !important;
				min-height: 40px !important;
				border: 1px solid #d8c7b8 !important;
				border-radius: 12px 10px 14px 10px !important;
				padding: 8px 12px !important;
				font-size: 13px !important;
				font-weight: 700 !important;
				cursor: pointer !important;
				text-decoration: none !important;
			}
			.la-confirm-modal .la-confirm-cancel {
				background-color: #f4eadf !important;
				color: #7a6155 !important;
			}
			.la-confirm-modal .la-confirm-ok {
				background-color: #a55143 !important;
				border-color: #9a5b49 !important;
				color: #fffaf3 !important;
			}
			@keyframes laFadeIn {
				from { opacity: 0; }
				to { opacity: 1; }
			}
			@keyframes laRiseIn {
				from { opacity: 0; transform: translateY(8px) scale(0.985); }
				to { opacity: 1; transform: translateY(0) scale(1); }
			}
		`;
		targetDocument.head.appendChild(style);
	}

	function applyModalControlBaseStyle(element) {
		element.style.setProperty("box-sizing", "border-box", "important");
		element.style.setProperty("font-family", '"Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif', "important");
		element.style.setProperty("line-height", "1.4", "important");
		element.style.setProperty("letter-spacing", "normal", "important");
		element.style.setProperty("text-transform", "none", "important");
		element.style.setProperty("text-decoration", "none", "important");
		element.style.setProperty("appearance", "none", "important");
		element.style.setProperty("-webkit-appearance", "none", "important");
		element.style.setProperty("background-image", "none", "important");
		element.style.setProperty("box-shadow", "none", "important");
		element.style.setProperty("outline", "none", "important");
	}

	function applyModalButtonStyle(button, variant) {
		applyModalControlBaseStyle(button);
		button.type = button.type || "button";
		button.style.setProperty("display", "inline-flex", "important");
		button.style.setProperty("align-items", "center", "important");
		button.style.setProperty("justify-content", "center", "important");
		button.style.setProperty("vertical-align", "middle", "important");
		button.style.setProperty("cursor", "pointer", "important");
		button.style.setProperty("user-select", "none", "important");
		button.style.setProperty("white-space", "nowrap", "important");
		button.style.setProperty("font-weight", "700", "important");
		button.style.setProperty("margin", "0", "important");

		const presetMap = {
			lemma: {
				minHeight: "32px",
				padding: "5px 9px",
				fontSize: "11px",
				border: "1px solid #dcc8b8",
				borderRadius: "10px 9px 11px 8px",
				backgroundColor: "#fffdf9",
				color: "#8a5f50"
			},
			apply: {
				minHeight: "32px",
				padding: "4px 8px",
				fontSize: "11px",
				border: "0 solid transparent",
				borderRadius: "10px 9px 11px 8px",
				backgroundColor: "#b26b54",
				color: "#fffaf3",
				marginTop: "6px"
			},
			cancel: {
				minHeight: "40px",
				padding: "8px 12px",
				fontSize: "13px",
				border: "1px solid #d8c7b8",
				borderRadius: "12px 10px 14px 10px",
				backgroundColor: "#f4eadf",
				color: "#7a6155"
			},
			save: {
				minHeight: "40px",
				padding: "8px 12px",
				fontSize: "13px",
				border: "1px solid #9a5b49",
				borderRadius: "12px 10px 14px 10px",
				backgroundColor: "#a55143",
				color: "#fffaf3"
			},
			confirmCancel: {
				minHeight: "40px",
				padding: "8px 12px",
				fontSize: "13px",
				border: "1px solid #d8c7b8",
				borderRadius: "12px 10px 14px 10px",
				backgroundColor: "#f4eadf",
				color: "#7a6155"
			},
			confirmOk: {
				minHeight: "40px",
				padding: "8px 12px",
				fontSize: "13px",
				border: "1px solid #9a5b49",
				borderRadius: "12px 10px 14px 10px",
				backgroundColor: "#a55143",
				color: "#fffaf3"
			}
		};

		const preset = presetMap[variant];
		if (!preset) return;
		for (const [key, value] of Object.entries(preset)) {
			const cssProperty = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
			button.style.setProperty(cssProperty, value, "important");
		}
	}

	function applyModalTextareaStyle(textarea) {
		applyModalControlBaseStyle(textarea);
		textarea.style.setProperty("display", "block", "important");
		textarea.style.setProperty("width", "100%", "important");
		textarea.style.setProperty("margin-top", "8px", "important");
		textarea.style.setProperty("border", "1px solid #dccabd", "important");
		textarea.style.setProperty("border-radius", "14px 12px 16px 11px", "important");
		textarea.style.setProperty("padding", "10px", "important");
		textarea.style.setProperty("font-size", "14px", "important");
		textarea.style.setProperty("background-color", "#fffdf9", "important");
		textarea.style.setProperty("color", "#34251f", "important");
		textarea.style.setProperty("resize", "vertical", "important");
		textarea.style.setProperty("white-space", "pre-wrap", "important");
		textarea.style.setProperty("min-height", "92px", "important");
	}

	function showConfirmModal(options) {
		const doc = (options && options.document) || document;
		const t = options && typeof options.t === "function" ? options.t : ((key) => key);
		const message = String((options && options.message) || "");

		ensureAddWordModalStyle(doc);
		if (confirmModal) confirmModal.remove();

		return new Promise((resolve) => {
			const overlay = doc.createElement("div");
			overlay.className = "la-confirm-overlay";

			const modal = doc.createElement("div");
			modal.className = "la-confirm-modal";

			const title = doc.createElement("h3");
			title.className = "la-confirm-title";
			title.textContent = t("confirm_action");

			const desc = doc.createElement("p");
			desc.className = "la-confirm-desc";
			desc.textContent = message;

			const footer = doc.createElement("div");
			footer.className = "la-confirm-footer";

			const cancelBtn = doc.createElement("button");
			cancelBtn.className = "la-confirm-btn la-confirm-cancel";
			cancelBtn.textContent = t("cancel");
			applyModalButtonStyle(cancelBtn, "confirmCancel");

			const okBtn = doc.createElement("button");
			okBtn.className = "la-confirm-btn la-confirm-ok";
			okBtn.textContent = t("confirm");
			applyModalButtonStyle(okBtn, "confirmOk");

			footer.appendChild(cancelBtn);
			footer.appendChild(okBtn);
			modal.appendChild(title);
			modal.appendChild(desc);
			modal.appendChild(footer);
			overlay.appendChild(modal);
			doc.body.appendChild(overlay);
			confirmModal = overlay;

			function close(value) {
				overlay.remove();
				if (confirmModal === overlay) confirmModal = null;
				doc.removeEventListener("keydown", onKeyDown, true);
				resolve(value);
			}

			function onKeyDown(event) {
				if (event.key === "Escape") close(false);
				if (event.key === "Enter") close(true);
			}

			cancelBtn.addEventListener("click", () => close(false));
			okBtn.addEventListener("click", () => close(true));
			overlay.addEventListener("click", (event) => {
				if (event.target === overlay) close(false);
			});
			doc.addEventListener("keydown", onKeyDown, true);
			okBtn.focus();
		});
	}

	global.ContentUi = {
		ensureAddWordModalStyle,
		applyModalButtonStyle,
		applyModalTextareaStyle,
		showConfirmModal,
	};
})(globalThis);
