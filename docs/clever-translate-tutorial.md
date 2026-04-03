### ES Module（推薦）

```js
import { ContextualTranslator } from './dist/clever-translate.esm.js';

const translator = new ContextualTranslator({ targetLang: 'zh-TW' });

const { translation, method } = await translator.extractWordTranslation(
  'We sat on the river bank.',
  'bank'
);

console.log(translation); // "河岸"
console.log(method);      // "Marker: HTML_u"
```

## API

### `new ContextualTranslator(options?)`

建立翻譯器實例。

| 參數 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| `sourceLang` | `string` | `'auto'` | 來源語言代碼（`'en'`, `'ja'`, `'zh-CN'` 等） |
| `targetLang` | `string` | `'zh-TW'` | 目標語言代碼 |
| `translator` | `BaseTranslator` | `GoogleTranslator` | 自訂翻譯服務（可選） |
| `markers` | `Array` | 內建最佳化標記 | 自訂標記配置（可選） |

### `translator.extractWordTranslation(sentence, targetWord, options?)`

提取目標詞在句子語境下的翻譯。

**參數：**

| 參數 | 類型 | 說明 |
|------|------|------|
| `sentence` | `string` | 完整句子 |
| `targetWord` | `string` | 要翻譯的目標詞語 |
| `options.wordPos` | `number` | 目標詞在句子中的字元偏移量（可選，用於處理重複詞或子字串） |

**返回：** `Promise<{ translation: string | null, method: string }>`

- `translation`：語境化翻譯結果
- `method`：使用的策略名稱（如 `"Dictionary Intersection"`, `"Marker: HTML_u"` 等）

### `wordPos` 參數用法

當句子中同一個詞出現多次且含義不同時，使用 `wordPos` 指定要翻譯的是哪一個。
此時算法會自動將 Dictionary Intersection 滯後，優先使用 Marker Chain 進行位置感知的精確提取。

```js
const sentence = "He walked along the river bank and then went to the bank to withdraw cash.";
//                                        ^ pos=26                     ^ pos=52

// 翻譯 pos=26 的 "bank"（河岸）
const r1 = await translator.extractWordTranslation(sentence, 'bank', { wordPos: 26 });
console.log(r1.translation); // "岸"

// 翻譯 pos=52 的 "bank"（銀行）
const r2 = await translator.extractWordTranslation(sentence, 'bank', { wordPos: 52 });
console.log(r2.translation); // "銀行"
```

`wordPos` 也能防止子字串誤匹配（例如 `"bat"` 不會匹配到 `"batted"` 中的 bat）。

## Chrome Extension 使用指南

### 1. 目錄結構

```
my-extension/
├── manifest.json
├── background.js          ← 翻譯邏輯在這裡執行
├── content.js             ← 網頁互動腳本
├── popup.html
├── popup.js
└── lib/
    └── clever-translate.esm.js   ← 複製 dist 檔案到這裡
```

### 2. manifest.json

```json
{
  "manifest_version": 3,
  "name": "My Translator Extension",
  "version": "1.0",
  "permissions": [],
  "host_permissions": [
    "https://translate.googleapis.com/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"]
    }
  ],
  "action": {
    "default_popup": "popup.html"
  }
}
```

> **重要：** `host_permissions` 必須包含 `https://translate.googleapis.com/*`，否則 API 請求會被 CORS 阻擋。

### 3. background.js（Service Worker）

```js
import { ContextualTranslator } from './lib/clever-translate.esm.js';

// 為每個語言對快取翻譯器實例
const translators = new Map();

function getTranslator(sourceLang, targetLang) {
  const key = `${sourceLang}:${targetLang}`;
  if (!translators.has(key)) {
    translators.set(key, new ContextualTranslator({ sourceLang, targetLang }));
  }
  return translators.get(key);
}

// 監聽來自 content script 或 popup 的翻譯請求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    const { sentence, word, sourceLang, targetLang, wordPos } = request;
    const translator = getTranslator(sourceLang || 'auto', targetLang || 'zh-TW');

    translator.extractWordTranslation(sentence, word, { wordPos })
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ translation: null, method: `Error: ${err.message}` }));

    return true; // 保持 sendResponse 通道開啟（非同步回應）
  }
});
```

### 4. content.js（Content Script）

```js
// 從 content script 發送翻譯請求到 background
async function translateWord(sentence, word, targetLang = 'zh-TW') {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        action: 'translate',
        sentence,
        word,
        targetLang,
      },
      (response) => resolve(response)
    );
  });
}

// 使用範例：使用者選取文字時觸發翻譯
document.addEventListener('mouseup', async () => {
  const selection = window.getSelection();
  const word = selection.toString().trim();

  if (!word) return;

  // 取得選取詞語所在的完整句子
  const range = selection.getRangeAt(0);
  const container = range.startContainer.parentElement;
  const sentence = container.textContent;

  if (sentence && word) {
    const { translation, method } = await translateWord(sentence, word);
    console.log(`${word} → ${translation} (${method})`);
    // 在這裡顯示翻譯結果（tooltip、popup 等）
  }
});
```

### 5. popup.js（Popup 介面）

```js
document.getElementById('translateBtn').addEventListener('click', async () => {
  const sentence = document.getElementById('sentence').value;
  const word = document.getElementById('word').value;
  const targetLang = document.getElementById('targetLang').value;

  const result = await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'translate', sentence, word, targetLang },
      resolve
    );
  });

  document.getElementById('result').textContent =
    result.translation
      ? `${result.translation}（策略：${result.method}）`
      : '翻譯失敗';
});
```