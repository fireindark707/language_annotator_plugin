// background.js
chrome.runtime.onInstalled.addListener(function () {
	chrome.contextMenus.create({
		id: "addWord",
		title: "Add Word to Annotator Vocabulary",
		contexts: ["selection"],
	});
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
	if (info.menuItemId === "addWord" && info.selectionText) {
		const word = info.selectionText.trim();
		// 使用chrome.scripting.executeScript
		chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: promptWord,
			args: [word],
		});
	}
});

// 将被注入的函数定义在这里，以确保它只是一个函数而不引用外部变量
function promptWord(word) {
	const meaning = prompt(`Enter meaning for: ${word}`);
	if (meaning && meaning.trim().length > 0) {
		// 保存单词和意思到chrome.storage.sync
		chrome.storage.sync.get({ words: {} }, function (result) {
			const words = result.words;
			words[word.toLowerCase()] = { meaning: meaning.trim(), learned: false };
			chrome.storage.sync.set({ words: words }, function () {
				console.log(`Word: ${word}, Meaning: ${meaning.trim()} saved.`);
			});
		});
	}
}

// 用于翻译文本的消息监听器
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
	if (request.action === "translate") {
		const userLanguage = navigator.language; // 获取语言代码
		console.log("sourceLang", request.sourceLang)
		console.log("userLanguage", userLanguage);
		const targetLang = userLanguage || "zh-tw"; // 如果无法获取用户语言，则默认为繁体中文
		const sourceLang = request.sourceLang || "auto"; // 使用请求中的原始语言或默认为自动检测

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
