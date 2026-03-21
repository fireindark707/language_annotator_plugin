# Wordfreq-js Chrome 插件使用教程

`wordfreq-js` 被设计为高度兼容浏览器和 Chrome 插件环境。在扩展程序中，主要面临两个环境：**Service Worker** (后台脚本) 和 **Content Script** (注入到网页的脚本) / **Popup** (弹窗脚本)。

为了在这两种环境中使用它，你需要加载核心的构建包 (`wordfreq.bundle.js` 或 `wordfreq.iife.js`)，并允许插件加载存在本地的分析数据 (`.msgpack.gz`)。

---

## 步骤 1：准备文件层次结构

将 `wordfreq-js` 引入你的插件项目中。典型的目录结构如下：

```text
my-chrome-extension/
├── manifest.json
├── background.js              # 你的 Service Worker
├── content.js                 # 你的 Content Script
└── dist/
    ├── wordfreq.bundle.js     # ESM 格式构建包（用于 Service Worker）
    └── wordfreq.iife.js       # 全局变量格式构建包（用于 Content Script/Popup）
```

你可以直接从本项目把生成的 `dist/` 文件夹复制到你的插件目录下。**不需要**把几百兆的 `data/` 文件夹打包进插件中，我们将使用远程 CDN 直接按需加载数据。

---

## 步骤 2：配置 `manifest.json`

由于我们现在推荐直接通过 GitHub Raw URL 远程加载数据，我们不需要在 `web_accessible_resources` 中配置本地数据目录。Chrome 扩展中默认允许使用 `fetch` 访问 HTTPS 资源（如果遇到跨域或 CSP 问题，可以在 manifest 中声明 host permissions 或 CSP）。

```json
{
  "manifest_version": 3,
  "name": "My Wordfreq Extension",
  "version": "1.0",
  "background": {
    "service_worker": "background.js",
    "type": "module" 
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["dist/wordfreq.iife.js", "content.js"]
    }
  ]
}
```

*注意：`background.type: "module"` 是必须的，因为 `wordfreq.bundle.js` 是 ESM (ES Modules) 格式。对于 Content Script，你可以按顺序引入 `iife` 构建包文件，它会暴露 `WordfreqLib` 全局变量。*

---

## 步骤 3：在 Service Worker (`background.js`) 中使用

服务工作线程 (Service Worker) 支持 ESM 模块，因此你可以直接 `import`。我们将配置 `BrowserDataFetcher` 使用 GitHub Raw URL 作为数据源。

```javascript
// background.js
import { Wordfreq, BrowserDataFetcher } from './dist/wordfreq.bundle.js';

// 1. 使用远程 GitHub 原生文件的 URL 作为基地址
const dataBaseUrl = 'https://raw.githubusercontent.com/fireindark707/wordfreq_js/main/data';

// 2. 初始化抓取器
const fetcher = new BrowserDataFetcher(dataBaseUrl);

// 3. 初始化需要查询的语言实例
const wf = new Wordfreq('en', fetcher, 'small');

async function initialize() {
  await wf.init();
  console.log("English Wordfreq initialized in Background.");
  
  // 4. 查词
  const freq = wf.wordFrequency('hello');
  console.log('Frequency of "hello":', freq);
  
  const zipf = wf.zipfFrequency('hello');
  console.log('Zipf scale for "hello":', zipf);
}

initialize();
```

---

## 步骤 4：在 Content Script (`content.js`) 或 Popup 中使用

Content Script 和普通的 Web 页面、Popup 弹窗最适合使用全局变量构建版本 `wordfreq.iife.js`。

在你的 `manifest.json` 中，由于 `"js": ["dist/wordfreq.iife.js", "content.js"]` 的加载顺序，`WordfreqLib` 将在 `content.js` 执行前挂载到 `window` / 全局作用域下。

```javascript
// content.js
// WordfreqLib 由之前注入的 dist/wordfreq.iife.js 暴露

(async () => {
    try {
        const { Wordfreq, BrowserDataFetcher } = WordfreqLib;
        
        // 1. 使用远程 GitHub 原生文件的 URL 作为基地址
        const dataBaseUrl = 'https://raw.githubusercontent.com/fireindark707/wordfreq_js/main/data';
        const fetcher = new BrowserDataFetcher(dataBaseUrl);
        
        // 2. 初始化查询实例
        const wf = new Wordfreq('en', fetcher, 'small');
        await wf.init();
        
        console.log("Wordfreq initialized in Content Script.");

        // 测试一个页面上的词汇
        const wordToCheck = 'website';
        console.log(`Frequency for ${wordToCheck}:`, wf.wordFrequency(wordToCheck));
        
    } catch (e) {
        console.error("Failed to initialize Wordfreq: ", e);
    }
})();
```

## 优势：为什么要使用远程加载？

原先 `data/` 目录非常庞大，包含数十个上百兆的压缩包。若要发布扩展，把这种体量的数据打包进插件不仅会让下载体积变得臃肿，还会严重影响 Chrome Web Store 的审核进度。

改为使用 GitHub Raw URL (`https://raw.githubusercontent.com/fireindark707/wordfreq_js/main/data`) 进行远程加载有以下优势：
1. **插件即装即用**：打包体积瞬间缩小到只有几十 KB。
2. **按需加载**：只有在代码 `wf.init()` 时，才会下载对应语言的数据文件。
3. **无缝使用**：绕过了 CDN 可能存在的仓库体积限制，利用浏览器内置的 HTTP 缓存可以确保数据在首次下载后极速响应。
5 分鐘前

新增表情符號、貼圖或 GIF

