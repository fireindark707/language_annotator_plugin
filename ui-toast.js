(function (global) {
	function ensureToastStyle() {
		if (document.getElementById("laToastStyle")) return;
		const style = document.createElement("style");
		style.id = "laToastStyle";
		style.textContent = `
			.la-toast-wrap {
				position: fixed;
				right: 16px;
				bottom: 16px;
				z-index: 2147483647;
				display: flex;
				flex-direction: column;
				gap: 8px;
				pointer-events: none;
			}
			.la-toast {
				background: #fffaf3;
				color: #3a2b24;
				border: 1px solid #dccabd;
				border-radius: 16px 14px 18px 13px;
				padding: 11px 13px;
				font-size: 12px;
				font-weight: 700;
				box-shadow: 0 10px 22px rgba(88, 63, 50, 0.14);
				animation: laToastIn 180ms ease-out;
				max-width: min(320px, 82vw);
			}
			.la-toast.success {
				background: #f2f7ea;
				border-color: #cfddbf;
				color: #5b7449;
			}
			.la-toast.error {
				background: #fbf1ee;
				border-color: #dfc9c0;
				color: #946456;
			}
			@keyframes laToastIn {
				from { opacity: 0; transform: translateY(8px) scale(0.985); }
				to { opacity: 1; transform: translateY(0); }
			}
		`;
		document.head.appendChild(style);
	}

	function getWrap() {
		let wrap = document.getElementById("laToastWrap");
		if (!wrap) {
			wrap = document.createElement("div");
			wrap.id = "laToastWrap";
			wrap.className = "la-toast-wrap";
			document.body.appendChild(wrap);
		}
		return wrap;
	}

	global.UiToast = {
		show(message, type, duration) {
			ensureToastStyle();
			const wrap = getWrap();
			const toast = document.createElement("div");
			toast.className = `la-toast ${type || ""}`.trim();
			toast.textContent = message;
			wrap.appendChild(toast);
			setTimeout(() => {
				toast.remove();
			}, duration || 1800);
		},
	};
})(globalThis);
