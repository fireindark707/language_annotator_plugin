// content.js

// 标记单词为已学会
function markLearned(word) {
	lowerCaseWord = word.toLowerCase();
	if (confirm(`Mark "${lowerCaseWord}" as learned?`)) {
		chrome.storage.sync.get({ words: {} }, function (result) {
			const words = result.words;
			if (words[lowerCaseWord]) {
				words[lowerCaseWord].learned = true;
				chrome.storage.sync.set({ words: words }, function () {
					// 可能需要刷新页面或以其他方式更新显示
					console.log(`Word: ${lowerCaseWord} marked as learned.`);
					// make all highlighted words with the same word has no style
					document
						.querySelectorAll(".plugin-highlight-word")
						.forEach((span) => {
							if (span.textContent.toLowerCase() === lowerCaseWord) {
								span.style.backgroundColor = "";
								span.style.cursor = "";
                                span.style.color = "";
								span.title = "";
							}
						});
				});
			}
		});
	}
}

// 创建高亮显示的span元素
function createHighlightSpan(word, meaning) {
	const span = document.createElement("span");
	span.className = "plugin-highlight-word";
	span.textContent = word;
	span.style.backgroundColor = "yellow";
	span.style.cursor = "pointer";
    span.style.color = "black";
	span.title = meaning;
	// span.addEventListener("click", () => markLearned(word));
	return span;
}

function highlightWords() {
	chrome.storage.sync.get({ words: {} }, function (result) {
		const storedWords = result.words;
        // sort storedWords by length from long to short
        const storedWordsArray = Object.keys(storedWords);
        storedWordsArray.sort((a, b) => b.length - a.length);
		const bodyTextNodes = findTextNodes(document.body);
		const replacements = [];

		// 收集需要替换的信息 old
		// bodyTextNodes.forEach((node) => {
		// 	const checked_words = [];
		// 	const words = node.nodeValue.split(/\s+/);
		// 	let newNodeValue = node.nodeValue;
		// 	words.forEach((word) => {
		// 		const lowerCaseWord = word.toLowerCase();
		// 		if (checked_words.includes(lowerCaseWord)) {
		// 			return;
		// 		}
		// 		if (
		// 			lowerCaseWord.length >= 3 &&
		// 			storedWords[lowerCaseWord] &&
		// 			!storedWords[lowerCaseWord].learned
		// 		) {
		// 			const regex = new RegExp(`\\b${word}\\b`, "gi");
		// 			const replacementHtml = createHighlightSpan(
		// 				word,
		// 				storedWords[lowerCaseWord].meaning
		// 			).outerHTML;
		// 			newNodeValue = newNodeValue.replace(regex, replacementHtml);
		// 		}
		// 		checked_words.push(lowerCaseWord);
		// 	});
		// 	if (newNodeValue !== node.nodeValue) {
		// 		replacements.push({ node, newNodeValue });
		// 	}
		// });

        // 收集需要替换的信息 new
        bodyTextNodes.forEach((node) => {
            let newNodeValue = node.nodeValue;
            storedWordsArray.forEach((word) => {
                if (!storedWords[word].learned && newNodeValue.toLowerCase().includes(word)) {
                    const regex = new RegExp(`${word}`, "gi");
                    const replacementHtml = createHighlightSpan(
                        word,
                        storedWords[word].meaning
                    ).outerHTML;
                    newNodeValue = newNodeValue.replace(regex, replacementHtml);
                }
            });
            if (newNodeValue !== node.nodeValue) {
                replacements.push({ node, newNodeValue });
            }
        });

		// 执行 DOM 更新
		replacements.forEach(({ node, newNodeValue }) => {
			const range = document.createRange();
			const frag = document.createDocumentFragment();
			const div = document.createElement("div");
			div.innerHTML = newNodeValue;
			while (div.firstChild) {
				frag.appendChild(div.firstChild);
			}
			range.selectNodeContents(node);
			range.deleteContents();
			range.insertNode(frag);
			range.detach(); // 释放 Range 对象，以便浏览器回收资源
		});
		addClickEventToHighlightedWords();
	});
}

// 查找文本节点
function findTextNodes(element) {
	let textNodes = [];
	if (element) {
		element.childNodes.forEach((node) => {
			if (
				node.nodeType === Node.TEXT_NODE &&
				node.nodeValue.trim().length >= 15
			) {
				textNodes.push(node);
			} else {
				textNodes = textNodes.concat(findTextNodes(node));
			}
		});
	}
	return textNodes;
}

// 为高亮单词添加点击事件监听器的函数
function addClickEventToHighlightedWords() {
	document.querySelectorAll(".plugin-highlight-word").forEach((span) => {
		span.addEventListener("click", () => markLearned(span.textContent));
	});
}

// 以下为事件监听和初始化代码

// 页面加载完成后执行
window.onload = highlightWords;
// 监听 URL 变化，以便在页面切换时重新高亮单词
let lastUrl = location.href; 
setInterval(() => {
    const currentUrl = location.href;
    if (lastUrl !== currentUrl) {
        console.log('URL变化了');
        lastUrl = currentUrl;
        highlightWords();
    }
}, 2000); // 每秒检查一次