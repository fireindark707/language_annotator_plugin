(function (global) {
	function requestRuntimeTranslation(options) {
		const chromeRuntime = options && options.chromeRuntime;
		const text = typeof (options && options.text) === "string" ? options.text : "";
		const sourceLang = (options && options.sourceLang) || "auto";
		const targetLang = options && options.targetLang;
		if (!chromeRuntime || typeof chromeRuntime.sendMessage !== "function" || !text.trim()) {
			return Promise.resolve("");
		}
		return new Promise((resolve) => {
			const payload = { action: "translate", text, sourceLang };
			if (targetLang) payload.targetLang = targetLang;
			chromeRuntime.sendMessage(payload, (response) => {
				if (chromeRuntime.lastError || !response || typeof response.translation !== "string") {
					resolve("");
					return;
				}
				resolve(response.translation || "");
			});
		});
	}

	function buildGoogleTranslateUrl(text, sourceLang, targetLang, defaultTargetLang) {
		const sl = sourceLang || "auto";
		const tl = targetLang || defaultTargetLang || "en";
		return `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&hl=en-US&dt=t&dt=bd&dj=1&source=input&q=${encodeURIComponent(text)}`;
	}

	function translateWithGoogle(text, sourceLang, targetLang, deps) {
		const fetchJsonSafe = deps && deps.fetchJsonSafe;
		const defaultTargetLang = deps && deps.defaultTargetLang;
		if (typeof fetchJsonSafe !== "function") {
			return Promise.resolve("");
		}
		const apiUrl = buildGoogleTranslateUrl(text, sourceLang, targetLang, defaultTargetLang);
		return fetchJsonSafe(apiUrl)
			.then((data) => {
				if (data && data.sentences && data.sentences.length > 0) {
					return data.sentences.map((s) => s.trans).join(" ");
				}
				return "";
			});
	}

	function createTaskQueue(limit) {
		let active = 0;
		const queue = [];

		function runNext() {
			while (active < limit && queue.length > 0) {
				const job = queue.shift();
				active += 1;
				Promise.resolve()
					.then(job)
					.catch(() => {})
					.finally(() => {
						active -= 1;
						runNext();
					});
			}
		}

		return function enqueue(job) {
			queue.push(job);
			runNext();
		};
	}

	global.TranslationUtils = {
		requestRuntimeTranslation,
		buildGoogleTranslateUrl,
		translateWithGoogle,
		createTaskQueue,
	};
})(globalThis);
