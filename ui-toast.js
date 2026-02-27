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
				background: #2a1014;
				color: #ffffff;
				border-radius: 10px;
				padding: 10px 12px;
				font-size: 12px;
				font-weight: 700;
				box-shadow: 0 10px 26px rgba(33, 16, 18, 0.28);
				animation: laToastIn 150ms ease-out;
				max-width: min(320px, 82vw);
			}
			.la-toast.success { background: #1d7f47; }
			.la-toast.error { background: #9b1c31; }
			@keyframes laToastIn {
				from { opacity: 0; transform: translateY(6px); }
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
