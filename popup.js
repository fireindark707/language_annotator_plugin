let showAllWords = false; // 默认不显示所有单词

document.addEventListener('DOMContentLoaded', function() {
    const toggleViewBtn = document.getElementById('toggleViewBtn');
    const wordsList = document.getElementById('wordsList');

    toggleViewBtn.addEventListener('click', function() {
        showAllWords = !showAllWords; // 切换模式
        toggleViewBtn.textContent = showAllWords ? "Show Unlearned Words Only" : "Show All Words";
        updateWordsList(); // 更新单词列表
    });

    function updateWordsList() {
        wordsList.innerHTML = ''; // 清空当前列表

        chrome.storage.sync.get({words: {}}, function(result) {
            const words = result.words;
            Object.keys(words).forEach(word => {
                // 如果不是显示所有单词，且单词已学会，则跳过
                if (!showAllWords && words[word].learned) {
                    return;
                }

                const wordItem = document.createElement('div');
                wordItem.classList.add('word-item');
                
                const wordSpan = document.createElement('span');
                wordSpan.textContent = word + ": " + words[word].meaning;
                wordSpan.classList.add('word');
                if (words[word].learned) {
                    wordSpan.classList.add('learned');
                }
                
                const deleteButton = document.createElement('button');
                deleteButton.textContent = 'Delete';
                deleteButton.addEventListener('click', function() {
                    deleteWord(word);
                });
                
                const toggleLearnedButton = document.createElement('button');
                toggleLearnedButton.textContent = words[word].learned ? 'Unmark' : 'Mark as Learned';
                toggleLearnedButton.addEventListener('click', function() {
                    toggleLearned(word);
                });

                wordItem.appendChild(wordSpan);
                wordItem.appendChild(deleteButton);
                wordItem.appendChild(toggleLearnedButton);
                wordsList.appendChild(wordItem);
            });

            // 如果没有单词被添加到列表中，显示一个提示信息
            if (!wordsList.hasChildNodes()) {
                const noWordsMessage = document.createElement('p');
                noWordsMessage.textContent = "No words added yet.";
                wordsList.appendChild(noWordsMessage);
            }
        });
    }

    updateWordsList(); // 初始更新单词列表
});

// 删除单词
function deleteWord(word) {
    chrome.storage.sync.get({words: {}}, function(result) {
        const words = result.words;
        delete words[word];
        chrome.storage.sync.set({words: words}, function() {
            window.location.reload(); // 刷新页面以更新列表
        });
    });
}

// 标记单词为已学会
function toggleLearned(word) {
    chrome.storage.sync.get({words: {}}, function(result) {
        const words = result.words;
        words[word].learned = !words[word].learned;
        chrome.storage.sync.set({words: words}, function() {
            window.location.reload(); // 刷新页面以更新列表
        });
    });
}
