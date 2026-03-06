(function (global) {
  const STORAGE_PREFIX = "tourSeen:";
  let activeCleanup = null;

  const COPY = {
    "zh-TW": {
      replay: "重新查看教學",
      skip: "略過",
      next: "下一步",
      done: "完成",
      step: "步驟 {current}/{total}",
      popup: [
        { target: "#settingsLink", title: "先到設定把語言設對", body: "第一次使用時，請先進設定頁確認來源語言、介面語言與自動翻譯選項。這會直接影響翻譯、發音與詞典結果。", placement: "bottom" },
        { target: "#practiceBtn", title: "從練習模式開始", body: "這裡是最值得先打開的功能。你可以用抽卡方式複習單詞、意思與例句。", placement: "bottom" },
        { target: "#fullscreenBtn", title: "全屏管理單詞", body: "如果想完整搜尋、排序與查看詞典/例句，從這裡進入全屏頁最合適。", placement: "bottom" },
        { target: "#sortMode", title: "快速改變排序", body: "你可以依加入時間、字母順序或詞頻排序，快速切換今天想看的單詞。", placement: "bottom" },
        { target: ".word-item .word-toolbar", title: "在單詞列上直接操作", body: "這裡可以直接發音、查看例句、標記已學會或刪除，適合快速處理未學會單詞。", placement: "left" }
      ],
      options: [
        { target: "#sourceLang", title: "先設定來源語言", body: "這是最重要的選項。來源語言會影響翻譯、發音與詞典查詢；如果長期學同一語言，建議不要停在 Auto。", placement: "bottom" },
        { target: "#uiLanguage", title: "介面語言可獨立切換", body: "你可以把整個外掛介面切到自己最熟悉的語言，不必跟來源語言綁在一起。", placement: "bottom" },
        { target: "#autoTranslateOnSelect", title: "控制選字即時翻譯", body: "打開後，選取頁面文字就會自動出現翻譯浮框。這是日常使用最常碰到的功能。", placement: "left" },
        { target: "#dictionaryLookupRow", title: "有支援時再開詞典", body: "當來源語言支援詞典時，這裡會出現開關。打開後，翻譯結果與加單詞流程會多出詞典資料。", placement: "left" },
        { target: "#syncBtn", title: "這裡可以手動同步", body: "如果你懷疑其他裝置的新資料還沒進來，可以用這顆按鈕主動推送並拉回最新內容。", placement: "top" }
      ],
      practice: [
        { target: "#streakChip", title: "先看這排進度晶片", body: "這裡會持續顯示題數、得分、連擊與是否進入加時。想快速掌握這輪節奏，先看這裡。", placement: "bottom" },
        { target: "#card", title: "題目都在這張主卡裡", body: "題型會混合單詞、意思與 cloze 例句。先看提示，再做四選一判斷。", placement: "top" },
        { target: "#options", title: "答案都從這裡選", body: "每題都是四選一。你也可以直接按鍵盤 1-4 或 A-D 來作答，加快節奏。", placement: "top" },
        { target: "#cardActions", title: "下方按鈕會依題目狀態變化", body: "遇到 cloze 題時，這裡會出現顯示翻譯；答對後，也會在這裡出現標記已學會與下一題。", placement: "top" }
      ],
      practiceNeedWords: [
        { target: "#card", title: "先收集至少 4 個單詞", body: "目前詞量不足，還不能開始抽卡練習。先去網頁上選字加入單詞，或到單字管理頁累積至少 4 個有詞義的未學會單詞。", placement: "top" }
      ],
      words: [
        { target: "#practiceBtn", title: "先從練習進入複習", body: "全屏頁也保留了練習入口，適合在整理完單詞後直接進入答題。", placement: "bottom" },
        { target: "#toggleViewBtn", title: "切換全部與未學會", body: "這顆按鈕可以切換成只看未學會或顯示全部單詞。整理詞庫時，先用它縮小範圍通常更有效。", placement: "bottom" },
        { target: "#searchInput", title: "先用搜尋縮小範圍", body: "可以搜尋單詞、意思與部分詞典內容。想快速找資料，先從這裡開始。", placement: "bottom" },
        { target: "#sortMode", title: "再依排序切換視角", body: "你可以用排序把高頻、最新或字母順序的單詞集中起來看。", placement: "bottom" },
        { target: "#wordsList .word-actions", title: "每個詞都有完整工具列", body: "這裡能發音、標記學會、展開例句、查看詞典與刪除，比 popup 更適合深度整理。", placement: "left" }
      ],
      content: [
        { target: ".plugin-highlight-word", title: "高亮詞就是你的學習錨點", body: "把滑鼠移上去可看翻譯與例句，點一下可標記已學會。若想新增單詞，請直接在頁面上選字後按右鍵使用外掛選單。", placement: "bottom" }
      ],
      contentSelection: [
        { target: "#translationBox", title: "這裡是即時翻譯結果", body: "當你選取頁面文字時，外掛會直接在原頁面旁邊顯示翻譯，不必跳出目前閱讀流程。", placement: "bottom" },
        { target: "#translationDictionary", title: "單詞被查到時也會帶出詞典", body: "如果這次選取的是可查詞典的單詞，這裡會補上詞性與解釋。若你想把它正式加入字庫，請保持選字後按右鍵使用外掛選單。", placement: "top" }
      ]
    },
    "zh-CN": {
      replay: "重新查看教程",
      skip: "跳过",
      next: "下一步",
      done: "完成",
      step: "步骤 {current}/{total}",
      popup: [
        { target: "#settingsLink", title: "先去设置把语言设对", body: "第一次使用时，请先到设置页确认来源语言、界面语言与自动翻译选项。这会直接影响翻译、发音与词典结果。", placement: "bottom" },
        { target: "#practiceBtn", title: "先从练习模式开始", body: "这里是最值得先打开的功能。你可以用抽卡方式复习单词、意思与例句。", placement: "bottom" },
        { target: "#fullscreenBtn", title: "全屏管理单词", body: "如果想完整搜索、排序与查看词典/例句，从这里进入全屏页最合适。", placement: "bottom" },
        { target: "#sortMode", title: "快速切换排序", body: "你可以按加入时间、字母顺序或词频排序，快速切换今天想看的单词。", placement: "bottom" },
        { target: ".word-item .word-toolbar", title: "直接在单词列上操作", body: "这里可以直接发音、查看例句、标记已学会或删除，适合快速处理未学会单词。", placement: "left" }
      ],
      options: [
        { target: "#sourceLang", title: "先设来源语言", body: "这是最重要的选项。来源语言会影响翻译、发音与词典查询；如果长期学同一种语言，建议不要停在 Auto。", placement: "bottom" },
        { target: "#uiLanguage", title: "界面语言可单独切换", body: "你可以把整个扩展界面切到自己最熟悉的语言，不必跟来源语言绑在一起。", placement: "bottom" },
        { target: "#autoTranslateOnSelect", title: "控制选字即时翻译", body: "打开后，选取网页文字就会自动出现翻译浮框。这是日常使用最常碰到的功能。", placement: "left" },
        { target: "#dictionaryLookupRow", title: "有支持时再开词典", body: "当来源语言支持词典时，这里会出现开关。打开后，翻译结果与加单词流程会多出词典资料。", placement: "left" },
        { target: "#syncBtn", title: "这里可以手动同步", body: "如果你怀疑其他设备的新资料还没进来，可以用这颗按钮主动推送并拉回最新内容。", placement: "top" }
      ],
      practice: [
        { target: "#streakChip", title: "先看这排进度芯片", body: "这里会持续显示题数、得分、连击与是否进入加时。想快速掌握这一轮节奏，先看这里。", placement: "bottom" },
        { target: "#card", title: "题目都在这张主卡里", body: "题型会混合单词、意思与 cloze 例句。先看提示，再做四选一判断。", placement: "top" },
        { target: "#options", title: "答案都从这里选", body: "每题都是四选一。你也可以直接按键盘 1-4 或 A-D 来作答，加快节奏。", placement: "top" },
        { target: "#cardActions", title: "下方按钮会随状态变化", body: "遇到 cloze 题时，这里会出现显示翻译；答对后，这里也会出现标记已学会与下一题。", placement: "top" }
      ],
      practiceNeedWords: [
        { target: "#card", title: "先收集至少 4 个单词", body: "目前词量不足，还不能开始抽卡练习。先去网页上选字加入单词，或到单词管理页累积至少 4 个有释义的未学会单词。", placement: "top" }
      ],
      words: [
        { target: "#practiceBtn", title: "先从练习进入复习", body: "全屏页也保留了练习入口，适合在整理完单词后直接进入答题。", placement: "bottom" },
        { target: "#toggleViewBtn", title: "切换全部与未学会", body: "这颗按钮可以切换成只看未学会或显示全部单词。整理词库时，先用它缩小范围通常更有效。", placement: "bottom" },
        { target: "#searchInput", title: "先用搜索缩小范围", body: "可以搜索单词、意思与部分词典内容。想快速找资料，先从这里开始。", placement: "bottom" },
        { target: "#sortMode", title: "再用排序切换视角", body: "你可以用排序把高频、最新或字母顺序的单词集中起来看。", placement: "bottom" },
        { target: "#wordsList .word-actions", title: "每个词都有完整工具栏", body: "这里能发音、标记已学会、展开例句、查看词典与删除，比 popup 更适合深度整理。", placement: "left" }
      ],
      content: [
        { target: ".plugin-highlight-word", title: "高亮词就是你的学习锚点", body: "鼠标悬停可看翻译与例句，点击可标记已学会。若想新增单词，请直接在页面上选字后右键使用扩展菜单。", placement: "bottom" }
      ],
      contentSelection: [
        { target: "#translationBox", title: "这里是即时翻译结果", body: "当你选取页面文字时，扩展会直接在原页面旁边显示翻译，不必跳出当前阅读流程。", placement: "bottom" },
        { target: "#translationDictionary", title: "查得到时也会补上词典", body: "如果这次选取的是可查词典的单词，这里会补上词性与解释。若你想把它正式加入词库，请保持选字后右键使用扩展菜单。", placement: "top" }
      ]
    },
    en: {
      replay: "Replay tutorial",
      skip: "Skip",
      next: "Next",
      done: "Done",
      step: "Step {current}/{total}",
      popup: [
        { target: "#settingsLink", title: "Open Settings first", body: "On first use, go to Settings and confirm the source language, UI language, and auto-translate behavior. Those choices affect translation, pronunciation, and dictionary results.", placement: "bottom" },
        { target: "#practiceBtn", title: "Start with Practice Mode", body: "This is the fastest way to feel the product. Review words, meanings, and examples through card-based drills.", placement: "bottom" },
        { target: "#fullscreenBtn", title: "Open the fullscreen manager", body: "Use this page when you want full search, sorting, examples, dictionary entries, and deeper review.", placement: "bottom" },
        { target: "#sortMode", title: "Change the list focus quickly", body: "Switch between recent, alphabetical, and frequency-based sorting depending on what you want to review today.", placement: "bottom" },
        { target: ".word-item .word-toolbar", title: "Act directly on each word", body: "Pronounce, inspect examples, mark as learned, or delete a word directly from the compact list.", placement: "left" }
      ],
      options: [
        { target: "#sourceLang", title: "Set the source language first", body: "This is the highest-impact setting. It affects translation, pronunciation, and dictionary lookups; if you study one language regularly, do not leave it on Auto.", placement: "bottom" },
        { target: "#uiLanguage", title: "UI language is independent", body: "You can keep the extension interface in the language you read fastest, without tying it to the source language you are learning.", placement: "bottom" },
        { target: "#autoTranslateOnSelect", title: "Control selection-based translation", body: "When enabled, selecting text on a page opens the instant translation overlay automatically. This is one of the most-used daily features.", placement: "left" },
        { target: "#dictionaryLookupRow", title: "Enable dictionary lookup when supported", body: "This switch appears for supported source languages. When enabled, translation results and Add Word flows include dictionary data.", placement: "left" },
        { target: "#syncBtn", title: "Use manual sync here", body: "If you suspect new words from another device have not arrived yet, use this button to push and pull the latest cloud state.", placement: "top" }
      ],
      practice: [
        { target: "#streakChip", title: "Watch the top progress chips", body: "These chips keep the round state visible: question count, score, streak, and whether you have entered overtime.", placement: "bottom" },
        { target: "#card", title: "The main question lives in this card", body: "The mode mixes word, meaning, and cloze questions. Read the prompt first, then answer through four choices.", placement: "top" },
        { target: "#options", title: "Answer from this option grid", body: "Each question is four-choice. You can also use the keyboard with 1-4 or A-D to keep the pace fast.", placement: "top" },
        { target: "#cardActions", title: "The lower actions change with the state", body: "For cloze questions this area reveals the translation button. After a correct answer, it also exposes Mark Learned and Next.", placement: "top" }
      ],
      practiceNeedWords: [
        { target: "#card", title: "Collect at least 4 words first", body: "There are not enough words to start practice yet. First add words from webpages or build up at least 4 unlearned words with meanings in the word manager.", placement: "top" }
      ],
      words: [
        { target: "#practiceBtn", title: "Launch practice from here", body: "The fullscreen page keeps a direct practice entry so you can move from review to drills without losing momentum.", placement: "bottom" },
        { target: "#toggleViewBtn", title: "Switch between all and unlearned", body: "Use this button to flip between the full list and only unlearned words. It is the fastest way to narrow the page to what still needs work.", placement: "bottom" },
        { target: "#searchInput", title: "Search before you scan", body: "Search works across words, meanings, and some dictionary text. Use it first when your list becomes large.", placement: "bottom" },
        { target: "#sortMode", title: "Sort by the angle you need", body: "Switch the list between recent, alphabetical, and frequency-based views to surface different learning priorities.", placement: "bottom" },
        { target: "#wordsList .word-actions", title: "Each word has a full action rail", body: "Pronounce, mark learned, open examples, inspect dictionary entries, and delete words from the same row.", placement: "left" }
      ],
      content: [
        { target: ".plugin-highlight-word", title: "Highlighted words are your learning anchors", body: "Hover to preview meaning and examples. Click to mark a word as learned. To add a new word, select text on the page and use the extension from the right-click menu.", placement: "bottom" }
      ],
      contentSelection: [
        { target: "#translationBox", title: "This is the instant translation box", body: "When you select text on a page, the extension shows the translation right beside your reading flow instead of moving you elsewhere.", placement: "bottom" },
        { target: "#translationDictionary", title: "Dictionary data appears when available", body: "If the selected text is a dictionary-supported word, this area adds part of speech and definitions. To save it properly, keep the selection and use the extension from the right-click menu.", placement: "top" }
      ]
    }
  };

  function getLocale(lang) {
    return COPY[lang] || COPY.en;
  }

  function getLabel(lang, key) {
    return getLocale(lang)[key] || COPY.en[key] || key;
  }

  function getSteps(lang, scope) {
    const locale = getLocale(lang);
    return Array.isArray(locale[scope]) ? locale[scope] : (COPY.en[scope] || []);
  }

  function format(template, vars) {
    return String(template || "").replace(/\{(\w+)\}/g, (_, key) => String(vars && vars[key] != null ? vars[key] : ""));
  }

  function ensureStyle() {
    if (document.getElementById("laTourStyle")) return;
    const style = document.createElement("style");
    style.id = "laTourStyle";
    style.textContent = `
      .la-tour-root { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
      .la-tour-shade { position: absolute; inset: 0; background: rgba(72, 54, 45, 0.18); }
      .la-tour-focus {
        position: absolute;
        border: 2px solid #b16d57;
        border-radius: 18px 15px 20px 16px;
        box-shadow: 0 0 0 9999px rgba(72, 54, 45, 0.18), 0 0 0 6px rgba(255, 250, 243, 0.5);
        background: transparent;
        transition: all 180ms ease;
      }
      .la-tour-card {
        position: absolute;
        width: min(320px, calc(100vw - 24px));
        background: #fffaf3;
        border: 1px solid #dccabd;
        border-radius: 18px 15px 20px 16px;
        box-shadow: 0 16px 28px rgba(88, 63, 50, 0.16);
        padding: 14px 14px 12px;
        color: #34251f;
        font-family: "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", sans-serif;
        pointer-events: auto;
      }
      .la-tour-step { font-size: 11px; font-weight: 700; color: #90786d; margin-bottom: 6px; }
      .la-tour-title { font-size: 16px; font-weight: 800; line-height: 1.3; margin: 0; font-family: "Noto Serif TC", "Hiragino Mincho ProN", "Yu Mincho", serif; }
      .la-tour-body { margin-top: 8px; font-size: 13px; line-height: 1.55; color: #6e5950; }
      .la-tour-actions { margin-top: 12px; display: flex; justify-content: space-between; gap: 8px; }
      .la-tour-btn {
        border: 1px solid #d8c7b8;
        border-radius: 12px 10px 14px 10px;
        min-height: 36px;
        padding: 8px 12px;
        background: #f4eadf;
        color: #7a6155;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      .la-tour-btn-primary { background: #a55143; color: #fffaf3; border-color: #9a5b49; }
      .la-tour-btn:hover { transform: translateY(-1px); }
      .la-tour-help-btn {
        width: 28px;
        min-width: 28px;
        height: 28px;
        min-height: 28px;
        padding: 0;
        border-radius: 999px;
        border: 1px solid #dccabd;
        background: #fffaf5;
        color: #7d5547;
        font-size: 13px;
        font-weight: 800;
        line-height: 1;
      }
    `;
    document.head.appendChild(style);
  }

  function getStorage(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ [STORAGE_PREFIX + key]: false }, (result) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve(!!result[STORAGE_PREFIX + key]);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  function setStorage(key, value) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [STORAGE_PREFIX + key]: !!value }, () => resolve());
      } catch (_) {
        resolve();
      }
    });
  }

  function resolveTarget(step) {
    if (!step) return null;
    if (typeof step.target === "function") return step.target() || null;
    if (typeof step.target === "string") return document.querySelector(step.target);
    return step.target || null;
  }

  function buildResolvedSteps(steps) {
    return (Array.isArray(steps) ? steps : []).map((step) => {
      const target = resolveTarget(step);
      if (!target) return null;
      return Object.assign({}, step, { targetEl: target });
    }).filter(Boolean);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function positionCard(card, focusRect, placement) {
    const margin = 12;
    const cardRect = card.getBoundingClientRect();
    let top = focusRect.bottom + margin;
    let left = focusRect.left;

    if (placement === "left") {
      left = focusRect.left - cardRect.width - margin;
      top = focusRect.top;
      if (left < 12) {
        left = focusRect.right + margin;
      }
    } else if (placement === "top") {
      top = focusRect.top - cardRect.height - margin;
    }

    if (top + cardRect.height > window.innerHeight - 12) {
      top = focusRect.top - cardRect.height - margin;
    }
    if (top < 12) {
      top = clamp(focusRect.bottom + margin, 12, window.innerHeight - cardRect.height - 12);
    }
    left = clamp(left, 12, window.innerWidth - cardRect.width - 12);

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function teardown() {
    if (activeCleanup) {
      activeCleanup();
      activeCleanup = null;
    }
  }

  function start(options) {
    teardown();
    ensureStyle();

    const lang = options && options.lang ? options.lang : "en";
    const resolvedSteps = buildResolvedSteps(options && options.steps);
    if (!resolvedSteps.length) return false;

    const root = document.createElement("div");
    root.className = "la-tour-root";

    const shade = document.createElement("div");
    shade.className = "la-tour-shade";

    const focus = document.createElement("div");
    focus.className = "la-tour-focus";

    const card = document.createElement("div");
    card.className = "la-tour-card";

    const stepEl = document.createElement("div");
    stepEl.className = "la-tour-step";
    const titleEl = document.createElement("h3");
    titleEl.className = "la-tour-title";
    const bodyEl = document.createElement("div");
    bodyEl.className = "la-tour-body";
    const actions = document.createElement("div");
    actions.className = "la-tour-actions";
    const skipBtn = document.createElement("button");
    skipBtn.className = "la-tour-btn";
    skipBtn.textContent = getLabel(lang, "skip");
    const nextBtn = document.createElement("button");
    nextBtn.className = "la-tour-btn la-tour-btn-primary";
    actions.appendChild(skipBtn);
    actions.appendChild(nextBtn);
    card.appendChild(stepEl);
    card.appendChild(titleEl);
    card.appendChild(bodyEl);
    card.appendChild(actions);

    root.appendChild(shade);
    root.appendChild(focus);
    root.appendChild(card);
    document.body.appendChild(root);

    let index = 0;

    function renderStep() {
      const step = resolvedSteps[index];
      if (!step) return;
      const rect = step.targetEl.getBoundingClientRect();
      step.targetEl.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      focus.style.left = `${rect.left - 8}px`;
      focus.style.top = `${rect.top - 8}px`;
      focus.style.width = `${rect.width + 16}px`;
      focus.style.height = `${rect.height + 16}px`;
      stepEl.textContent = format(getLabel(lang, "step"), { current: index + 1, total: resolvedSteps.length });
      titleEl.textContent = step.title;
      bodyEl.textContent = step.body;
      nextBtn.textContent = index === resolvedSteps.length - 1 ? getLabel(lang, "done") : getLabel(lang, "next");
      requestAnimationFrame(() => positionCard(card, focus.getBoundingClientRect(), step.placement));
    }

    function finish(seen) {
      window.removeEventListener("resize", renderStep);
      window.removeEventListener("scroll", renderStep, true);
      document.removeEventListener("keydown", onKeyDown, true);
      root.remove();
      if (options && options.storageKey && seen) {
        setStorage(options.storageKey, true);
      }
      if (options && typeof options.onFinish === "function") {
        options.onFinish(seen);
      }
      activeCleanup = null;
    }

    function onKeyDown(event) {
      if (event.key === "Escape") finish(true);
      if (event.key === "Enter") advance();
    }

    function advance() {
      if (index >= resolvedSteps.length - 1) {
        finish(true);
        return;
      }
      index += 1;
      renderStep();
    }

    skipBtn.addEventListener("click", () => finish(true));
    nextBtn.addEventListener("click", advance);
    window.addEventListener("resize", renderStep);
    window.addEventListener("scroll", renderStep, true);
    document.addEventListener("keydown", onKeyDown, true);

    activeCleanup = () => {
      window.removeEventListener("resize", renderStep);
      window.removeEventListener("scroll", renderStep, true);
      document.removeEventListener("keydown", onKeyDown, true);
      root.remove();
    };

    renderStep();
    return true;
  }

  async function maybeStartOnce(options) {
    const key = options && options.storageKey;
    if (!key) return false;
    const seen = await getStorage(key);
    if (seen) return false;
    return start(options);
  }

  async function reset(key) {
    await setStorage(key, false);
  }

  global.UiTour = {
    getLabel,
    getSteps,
    start,
    maybeStartOnce,
    reset,
  };
})(globalThis);
