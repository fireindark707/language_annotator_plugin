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
        // 保存单词和意思到chrome.storage.local
        chrome.storage.local.get({ words: {} }, function (result) {
            const words = result.words;
            words[word.toLowerCase()] = { meaning: meaning.trim(), learned: false };
            chrome.storage.local.set({ words: words }, function () {
                console.log(`Word: ${word}, Meaning: ${meaning.trim()} saved.`);
            });
        });
	}
}
