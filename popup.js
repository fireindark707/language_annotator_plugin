let showAllWords = false; // 默认不显示所有单词

document.addEventListener("DOMContentLoaded", function () {
	const toggleViewBtn = document.getElementById("toggleViewBtn");
	const wordsList = document.getElementById("wordsList");

	toggleViewBtn.addEventListener("click", function () {
		showAllWords = !showAllWords; // 切换模式
		toggleViewBtn.textContent = showAllWords ? "Show Unlearned" : "Show All";
		updateWordsList(); // 更新单词列表
	});

	function updateWordsList() {
		wordsList.innerHTML = ""; // 清空当前列表

		chrome.storage.sync.get({ words: {} }, function (result) {
			const words = result.words;
			const wordsArray = Object.keys(words);

			wordsArray.forEach((word) => {
				// 如果不是显示所有单词，且单词已学会，则跳过
				if (!showAllWords && words[word].learned) {
					return;
				}

				const wordItem = document.createElement("div");
				wordItem.classList.add("word-item");

				const wordSpan = document.createElement("span");
				wordSpan.textContent = word + ": " + words[word].meaning;
				wordSpan.classList.add("word");
				if (words[word].learned) {
					wordSpan.classList.add("learned");
				}

				const audioButton = document.createElement("button");
				audioButton.textContent = "Audio";
				audioButton.addEventListener("click", function () {
					const utterance = new SpeechSynthesisUtterance(word);
					source_lang = chrome.storage.sync.get(["sourceLang"]).then((result) => {
						utterance.lang = result.sourceLang;
						let voices = window.speechSynthesis.getVoices();
						for (let i = 0; i < voices.length; i++) {
							if (voices[i].lang === utterance.lang) {
								utterance.voice = voices[i];
								break;
							}
						}
						console.log("utterance.lang", utterance.lang);
						console.log("utterance.voice", utterance.voice);
						speechSynthesis.speak(utterance);
					});
				});

				const deleteButton = document.createElement("button");
				deleteButton.textContent = "Delete";
				deleteButton.addEventListener("click", function () {
					deleteWord(word);
				});

				const toggleLearnedButton = document.createElement("button");
				toggleLearnedButton.textContent = words[word].learned
					? "Unmark"
					: "Mark";
				toggleLearnedButton.addEventListener("click", function () {
					toggleLearned(word);
				});

				wordItem.appendChild(wordSpan);
				wordItem.appendChild(audioButton);
				wordItem.appendChild(deleteButton);
				wordItem.appendChild(toggleLearnedButton);
				wordsList.appendChild(wordItem);
			});

			// 如果没有单词被添加到列表中，显示一个提示信息
			if (!wordsList.hasChildNodes()) {
				const noWordsMessage = document.createElement("p");
				noWordsMessage.textContent = "No words added yet.";
				wordsList.appendChild(noWordsMessage);
			}
		});
	}

	updateWordsList(); // 初始更新单词列表
});

// 删除单词
function deleteWord(word) {
	chrome.storage.sync.get({ words: {} }, function (result) {
		const words = result.words;
		delete words[word];
		chrome.storage.sync.set({ words: words }, function () {
			window.location.reload(); // 刷新页面以更新列表
		});
	});
}

// 标记单词为已学会
function toggleLearned(word) {
	chrome.storage.sync.get({ words: {} }, function (result) {
		const words = result.words;
		words[word].learned = !words[word].learned;
		chrome.storage.sync.set({ words: words }, function () {
			window.location.reload(); // 刷新页面以更新列表
		});
	});
}

const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");

// 导出单词
exportBtn.addEventListener("click", function () {
	chrome.storage.sync.get(null, function (items) {
		// 获取所有存储的数据
		if (chrome.runtime.lastError) {
			console.error("导出时发生错误:", chrome.runtime.lastError);
			return;
		}

		const dataStr =
			"data:text/json;charset=utf-8," +
			encodeURIComponent(JSON.stringify(items));
		const downloadAnchorNode = document.createElement("a");
		downloadAnchorNode.setAttribute("href", dataStr);
		downloadAnchorNode.setAttribute("download", "wordlist.json");
		document.body.appendChild(downloadAnchorNode); // required for firefox
		downloadAnchorNode.click();
		downloadAnchorNode.remove();
	});
});

// 导入单词
importBtn.addEventListener("click", function () {
	const fileInput = document.getElementById("importFile");
	fileInput.click(); // 触发文件选择
});

// 读取文件内容
const fileInput = document.getElementById("importFile");
fileInput.addEventListener("change", function (event) {
	const file = event.target.files[0];
	if (file && file.type === "application/json") {
		const reader = new FileReader();
		reader.onload = function (e) {
			try {
				const items = JSON.parse(e.target.result);
				chrome.storage.sync.set(items, function () {
					if (chrome.runtime.lastError) {
						console.error("导入时发生错误:", chrome.runtime.lastError);
					} else {
						console.log("单词库导入成功！");
					}
				});
			} catch (e) {
				console.error("解析导入的文件时发生错误:", e);
			}
		};
		reader.readAsText(file);
	} else {
		console.error("请选择一个有效的JSON文件进行导入。");
	}
});
