// background.js
if (typeof importScripts === "function") {
	importScripts("storage.js");
}

chrome.runtime.onInstalled.addListener(function () {
	chrome.contextMenus.create({
		id: "addWord",
		title: "Add Word to Annotator Vocabulary",
		contexts: ["selection"],
	});

	WordStorage.init();
});

chrome.runtime.onStartup.addListener(function () {
	WordStorage.init();
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
	if (info.menuItemId === "addWord" && info.selectionText) {
		const word = info.selectionText.trim();
		if (!tab || !tab.id) return;
		chrome.tabs.sendMessage(tab.id, { action: "openAddWordModal", word: word }, function () {
			if (chrome.runtime.lastError) {
				console.error("Failed to open add-word modal:", chrome.runtime.lastError);
			}
		});
	}
});

// 用于翻译文本的消息监听器
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
	if (request.action === "translate") {
		const sourceLang = request.sourceLang || "auto"; // 使用请求中的原始语言或默认为自动检测
		const targetLang = navigator.language || "en";
		const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&hl=en-US&dt=t&dt=bd&dj=1&source=input&q=${encodeURIComponent(request.text)}`;
		fetch(apiUrl)
			.then((response) => response.json())
			.then((data) => {
				if (data.sentences && data.sentences.length > 0) {
					sendResponse({
						translation: data.sentences.map((s) => s.trans).join(" "),
					});
				}
			})
			.catch((error) => console.error("Error translating text:", error));
		return true; // Indicates that the response is asynchronous
	}
});
