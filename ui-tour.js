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
    },
    fr: {
      replay: "Revoir le guide",
      skip: "Passer",
      next: "Suivant",
      done: "Terminer",
      step: "Étape {current}/{total}",
      popup: [
        { target: "#settingsLink", title: "Ouvrez d'abord les paramètres", body: "Lors de la première utilisation, allez dans les paramètres pour vérifier la langue source, la langue de l'interface et la traduction automatique. Ces choix influencent la traduction, la prononciation et le dictionnaire.", placement: "bottom" },
        { target: "#practiceBtn", title: "Commencez par le mode entraînement", body: "C'est la manière la plus rapide de comprendre le produit. Vous pouvez réviser les mots, les sens et les exemples avec des cartes.", placement: "bottom" },
        { target: "#fullscreenBtn", title: "Ouvrez le gestionnaire plein écran", body: "Utilisez cette page lorsque vous voulez rechercher, trier et consulter les exemples ou le dictionnaire de manière complète.", placement: "bottom" },
        { target: "#sortMode", title: "Changez vite l'angle de tri", body: "Vous pouvez trier par ajout récent, ordre alphabétique ou fréquence pour vous concentrer sur ce que vous voulez revoir aujourd'hui.", placement: "bottom" },
        { target: ".word-item .word-toolbar", title: "Agissez directement sur chaque mot", body: "Ici, vous pouvez lancer la prononciation, ouvrir les exemples, marquer comme appris ou supprimer un mot depuis la liste compacte.", placement: "left" }
      ],
      options: [
        { target: "#sourceLang", title: "Réglez d'abord la langue source", body: "C'est le réglage le plus important. Il affecte la traduction, la prononciation et les recherches du dictionnaire. Si vous étudiez une seule langue, évitez de laisser Auto.", placement: "bottom" },
        { target: "#uiLanguage", title: "La langue de l'interface est indépendante", body: "Vous pouvez garder l'interface de l'extension dans la langue que vous lisez le plus vite, sans la lier à la langue étudiée.", placement: "bottom" },
        { target: "#autoTranslateOnSelect", title: "Contrôlez la traduction par sélection", body: "Quand cette option est activée, sélectionner du texte dans une page ouvre automatiquement la bulle de traduction. C'est l'une des fonctions les plus utilisées.", placement: "left" },
        { target: "#dictionaryLookupRow", title: "Activez le dictionnaire si la langue est prise en charge", body: "Ce commutateur apparaît quand la langue source prend en charge le dictionnaire. Une fois activé, les résultats de traduction et l'ajout de mots incluent aussi des données lexicales.", placement: "left" },
        { target: "#syncBtn", title: "Utilisez ici la synchronisation manuelle", body: "Si vous pensez que les nouveaux mots d'un autre appareil ne sont pas encore arrivés, utilisez ce bouton pour pousser et récupérer l'état le plus récent.", placement: "top" }
      ],
      practice: [
        { target: "#streakChip", title: "Regardez d'abord les indicateurs du haut", body: "Ces indicateurs affichent en continu le nombre de questions, le score, le combo et l'éventuelle prolongation. C'est le meilleur résumé du rythme du tour.", placement: "bottom" },
        { target: "#card", title: "La question principale est dans cette carte", body: "Le mode mélange mot, sens et phrases à trous. Lisez d'abord l'indication, puis choisissez une réponse parmi quatre options.", placement: "top" },
        { target: "#options", title: "Répondez depuis cette grille", body: "Chaque question propose quatre choix. Vous pouvez aussi utiliser le clavier avec 1-4 ou A-D pour aller plus vite.", placement: "top" },
        { target: "#cardActions", title: "Les actions du bas changent selon l'état", body: "Pour les questions à trous, cette zone peut afficher le bouton de traduction. Après une bonne réponse, elle affiche aussi Marquer appris et Suivant.", placement: "top" }
      ],
      practiceNeedWords: [
        { target: "#card", title: "Collectez d'abord au moins 4 mots", body: "Il n'y a pas encore assez de mots pour lancer l'entraînement. Ajoutez d'abord des mots depuis les pages web ou accumulez au moins 4 mots non appris avec une signification.", placement: "top" }
      ],
      words: [
        { target: "#practiceBtn", title: "Lancez l'entraînement depuis ici", body: "La page plein écran conserve aussi un accès direct à l'entraînement, pour passer de la révision à la pratique sans casser le rythme.", placement: "bottom" },
        { target: "#toggleViewBtn", title: "Basculez entre tout et non appris", body: "Ce bouton permet d'afficher toute la liste ou seulement les mots non appris. C'est la manière la plus rapide de réduire la page à ce qui reste à travailler.", placement: "bottom" },
        { target: "#searchInput", title: "Cherchez avant de parcourir", body: "La recherche fonctionne sur les mots, les sens et une partie du dictionnaire. Utilisez-la d'abord quand votre liste devient grande.", placement: "bottom" },
        { target: "#sortMode", title: "Triez selon l'angle utile", body: "Passez entre récent, alphabétique et fréquence pour faire apparaître des priorités d'apprentissage différentes.", placement: "bottom" },
        { target: "#wordsList .word-actions", title: "Chaque mot a une barre d'actions complète", body: "Depuis la même ligne, vous pouvez écouter la prononciation, marquer comme appris, ouvrir les exemples, consulter le dictionnaire et supprimer le mot.", placement: "left" }
      ],
      content: [
        { target: ".plugin-highlight-word", title: "Les mots surlignés sont vos repères", body: "Survolez pour prévisualiser le sens et les exemples. Cliquez pour marquer un mot comme appris. Pour ajouter un nouveau mot, sélectionnez-le dans la page puis utilisez le menu de l'extension avec le clic droit.", placement: "bottom" }
      ],
      contentSelection: [
        { target: "#translationBox", title: "Voici la bulle de traduction instantanée", body: "Quand vous sélectionnez du texte dans une page, l'extension affiche la traduction juste à côté, sans vous sortir de votre lecture.", placement: "bottom" },
        { target: "#translationDictionary", title: "Les données du dictionnaire apparaissent si disponibles", body: "Si le texte sélectionné correspond à un mot pris en charge par le dictionnaire, cette zone ajoute la catégorie grammaticale et les définitions. Pour l'enregistrer correctement, gardez la sélection puis utilisez le menu de l'extension avec le clic droit.", placement: "top" }
      ]
    },
    pt: {
      replay: "Rever tutorial",
      skip: "Pular",
      next: "Próximo",
      done: "Concluir",
      step: "Etapa {current}/{total}",
      popup: [
        { target: "#settingsLink", title: "Abra as configurações primeiro", body: "No primeiro uso, vá para as configurações e confirme o idioma de origem, o idioma da interface e a tradução automática. Essas escolhas afetam tradução, pronúncia e dicionário.", placement: "bottom" },
        { target: "#practiceBtn", title: "Comece pelo modo de prática", body: "Esta é a maneira mais rápida de entender o produto. Você pode revisar palavras, significados e exemplos com cartões.", placement: "bottom" },
        { target: "#fullscreenBtn", title: "Abra o gerenciador em tela cheia", body: "Use esta página quando quiser pesquisar, ordenar e consultar exemplos ou dicionário de forma completa.", placement: "bottom" },
        { target: "#sortMode", title: "Mude o foco da lista rapidamente", body: "Você pode ordenar por adição recente, ordem alfabética ou frequência para concentrar a revisão no que importa hoje.", placement: "bottom" },
        { target: ".word-item .word-toolbar", title: "Aja diretamente sobre cada palavra", body: "Aqui você pode ouvir a pronúncia, abrir exemplos, marcar como aprendida ou excluir uma palavra da lista compacta.", placement: "left" }
      ],
      options: [
        { target: "#sourceLang", title: "Defina primeiro o idioma de origem", body: "Esta é a configuração mais importante. Ela afeta tradução, pronúncia e buscas no dicionário. Se você estuda um idioma específico, não deixe em Auto.", placement: "bottom" },
        { target: "#uiLanguage", title: "O idioma da interface é independente", body: "Você pode manter a interface da extensão no idioma que lê com mais facilidade, sem vinculá-lo ao idioma que está estudando.", placement: "bottom" },
        { target: "#autoTranslateOnSelect", title: "Controle a tradução por seleção", body: "Quando ativado, selecionar texto em uma página abre automaticamente a caixa de tradução instantânea. É um dos recursos mais usados no dia a dia.", placement: "left" },
        { target: "#dictionaryLookupRow", title: "Ative o dicionário quando houver suporte", body: "Este interruptor aparece quando o idioma de origem oferece suporte ao dicionário. Ao ativá-lo, os resultados de tradução e o fluxo de adicionar palavra incluem dados lexicais.", placement: "left" },
        { target: "#syncBtn", title: "Use a sincronização manual aqui", body: "Se você suspeita que novas palavras de outro dispositivo ainda não chegaram, use este botão para enviar e buscar o estado mais recente.", placement: "top" }
      ],
      practice: [
        { target: "#streakChip", title: "Observe primeiro os indicadores do topo", body: "Esses indicadores mostram continuamente número de questões, pontuação, combo e se você entrou no tempo extra. É o melhor resumo do ritmo da rodada.", placement: "bottom" },
        { target: "#card", title: "A questão principal fica neste cartão", body: "O modo mistura palavra, significado e frases com lacuna. Leia a instrução primeiro e depois escolha entre quatro opções.", placement: "top" },
        { target: "#options", title: "Responda por esta grade de opções", body: "Cada pergunta tem quatro alternativas. Você também pode usar o teclado com 1-4 ou A-D para acelerar.", placement: "top" },
        { target: "#cardActions", title: "As ações inferiores mudam conforme o estado", body: "Em questões cloze, esta área pode mostrar o botão de tradução. Após uma resposta correta, ela também exibe Marcar como aprendida e Próxima.", placement: "top" }
      ],
      practiceNeedWords: [
        { target: "#card", title: "Colete pelo menos 4 palavras primeiro", body: "Ainda não há palavras suficientes para iniciar a prática. Primeiro adicione palavras das páginas web ou acumule pelo menos 4 palavras não aprendidas com significado.", placement: "top" }
      ],
      words: [
        { target: "#practiceBtn", title: "Inicie a prática por aqui", body: "A página em tela cheia também mantém um acesso direto à prática, para você passar da revisão ao treino sem perder ritmo.", placement: "bottom" },
        { target: "#toggleViewBtn", title: "Alterne entre tudo e não aprendidas", body: "Este botão permite alternar entre a lista completa e apenas as palavras não aprendidas. É a forma mais rápida de focar no que ainda falta.", placement: "bottom" },
        { target: "#searchInput", title: "Pesquise antes de percorrer", body: "A busca funciona sobre palavras, significados e parte do texto do dicionário. Use-a primeiro quando sua lista ficar grande.", placement: "bottom" },
        { target: "#sortMode", title: "Ordene pelo ângulo que precisar", body: "Alterne entre recente, alfabético e frequência para destacar prioridades de estudo diferentes.", placement: "bottom" },
        { target: "#wordsList .word-actions", title: "Cada palavra tem uma barra de ações completa", body: "Na mesma linha, você pode ouvir a pronúncia, marcar como aprendida, abrir exemplos, consultar o dicionário e excluir a palavra.", placement: "left" }
      ],
      content: [
        { target: ".plugin-highlight-word", title: "As palavras destacadas são seus pontos de apoio", body: "Passe o mouse para ver significado e exemplos. Clique para marcar uma palavra como aprendida. Para adicionar uma nova palavra, selecione-a na página e use o menu da extensão com o botão direito.", placement: "bottom" }
      ],
      contentSelection: [
        { target: "#translationBox", title: "Esta é a caixa de tradução instantânea", body: "Quando você seleciona texto em uma página, a extensão mostra a tradução ao lado do fluxo de leitura, sem tirar você da página.", placement: "bottom" },
        { target: "#translationDictionary", title: "Os dados do dicionário aparecem quando disponíveis", body: "Se o texto selecionado for uma palavra suportada pelo dicionário, esta área acrescenta classe gramatical e definições. Para salvá-la corretamente, mantenha a seleção e use o menu da extensão com o botão direito.", placement: "top" }
      ]
    },
    ar: {
      replay: "إعادة عرض الشرح",
      skip: "تخطي",
      next: "التالي",
      done: "إنهاء",
      step: "الخطوة {current}/{total}",
      popup: [
        { target: "#settingsLink", title: "افتح الإعدادات أولاً", body: "عند أول استخدام، اذهب إلى صفحة الإعدادات وتأكد من لغة المصدر، ولغة الواجهة، وخيار الترجمة التلقائية. هذه الخيارات تؤثر في الترجمة والنطق والقاموس.", placement: "bottom" },
        { target: "#practiceBtn", title: "ابدأ بوضع التدريب", body: "هذه أسرع طريقة لفهم الإضافة. يمكنك مراجعة الكلمات والمعاني والأمثلة عبر بطاقات التدريب.", placement: "bottom" },
        { target: "#fullscreenBtn", title: "افتح مدير الكلمات بملء الشاشة", body: "استخدم هذه الصفحة عندما تريد البحث والفرز ومراجعة الأمثلة أو القاموس بشكل كامل.", placement: "bottom" },
        { target: "#sortMode", title: "غيّر زاوية الفرز بسرعة", body: "يمكنك الفرز حسب الإضافة الحديثة أو الترتيب الأبجدي أو التكرار حتى تراجع ما تحتاجه اليوم.", placement: "bottom" },
        { target: ".word-item .word-toolbar", title: "تعامل مع كل كلمة مباشرة", body: "من هنا يمكنك تشغيل النطق، وفتح الأمثلة، ووضع علامة تم التعلم، أو حذف الكلمة من القائمة المختصرة.", placement: "left" }
      ],
      options: [
        { target: "#sourceLang", title: "اضبط لغة المصدر أولاً", body: "هذا هو الإعداد الأهم. فهو يؤثر في الترجمة والنطق والبحث في القاموس. إذا كنت تدرس لغة واحدة باستمرار، فلا تتركه على Auto.", placement: "bottom" },
        { target: "#uiLanguage", title: "لغة الواجهة مستقلة", body: "يمكنك إبقاء واجهة الإضافة باللغة التي تقرؤها بسهولة، من دون ربطها باللغة التي تتعلمها.", placement: "bottom" },
        { target: "#autoTranslateOnSelect", title: "تحكم في الترجمة عند التحديد", body: "عند تفعيل هذا الخيار، سيؤدي تحديد النص في الصفحة إلى فتح نافذة الترجمة الفورية تلقائياً. هذه من أكثر الميزات استخداماً يومياً.", placement: "left" },
        { target: "#dictionaryLookupRow", title: "فعّل القاموس عند توفر الدعم", body: "يظهر هذا المفتاح عندما تدعم لغة المصدر القاموس. عند تفعيله، تتضمن نتائج الترجمة وإضافة الكلمات بيانات معجمية أيضاً.", placement: "left" },
        { target: "#syncBtn", title: "استخدم المزامنة اليدوية هنا", body: "إذا كنت تشك أن الكلمات الجديدة من جهاز آخر لم تصل بعد، فاستخدم هذا الزر لدفع آخر حالة وسحبها.", placement: "top" }
      ],
      practice: [
        { target: "#streakChip", title: "انظر أولاً إلى مؤشرات التقدم العلوية", body: "تعرض هذه المؤشرات عدد الأسئلة، والنتيجة، وسلسلة الإجابات الصحيحة، وهل دخلت وقتاً إضافياً. إنها أفضل ملخص لسير الجولة.", placement: "bottom" },
        { target: "#card", title: "السؤال الرئيسي داخل هذه البطاقة", body: "يمزج هذا الوضع بين الكلمة والمعنى والجمل ذات الفراغ. اقرأ الإرشاد أولاً ثم اختر من بين أربع إجابات.", placement: "top" },
        { target: "#options", title: "أجب من شبكة الخيارات هذه", body: "كل سؤال له أربع خيارات. يمكنك أيضاً استخدام لوحة المفاتيح 1-4 أو A-D لتسريع الإيقاع.", placement: "top" },
        { target: "#cardActions", title: "أزرار الأسفل تتغير حسب الحالة", body: "في أسئلة الفراغات قد يظهر زر إظهار الترجمة هنا. وبعد الإجابة الصحيحة يظهر أيضاً زر تعليم الكلمة كمتعلَّمة والانتقال للسؤال التالي.", placement: "top" }
      ],
      practiceNeedWords: [
        { target: "#card", title: "اجمع 4 كلمات على الأقل أولاً", body: "لا توجد كلمات كافية لبدء التدريب بعد. أضف كلمات من صفحات الويب أولاً أو اجمع 4 كلمات غير متعلَّمة على الأقل ولها معانٍ.", placement: "top" }
      ],
      words: [
        { target: "#practiceBtn", title: "ابدأ التدريب من هنا", body: "تحتفظ صفحة ملء الشاشة أيضاً بمدخل مباشر إلى التدريب حتى تنتقل من المراجعة إلى التمرين من دون كسر الإيقاع.", placement: "bottom" },
        { target: "#toggleViewBtn", title: "بدّل بين الكل وغير المتعلَّم", body: "يسمح هذا الزر بالتبديل بين القائمة الكاملة وبين الكلمات غير المتعلَّمة فقط. إنها أسرع طريقة لتركيز الصفحة على ما ما زال يحتاج إلى عمل.", placement: "bottom" },
        { target: "#searchInput", title: "ابحث قبل التصفح", body: "يعمل البحث على الكلمات والمعاني وبعض نصوص القاموس. استخدمه أولاً عندما تكبر قائمتك.", placement: "bottom" },
        { target: "#sortMode", title: "افرز بالزاوية التي تحتاجها", body: "بدّل بين الحديث، والأبجدي، والتكرار لإظهار أولويات تعلم مختلفة.", placement: "bottom" },
        { target: "#wordsList .word-actions", title: "لكل كلمة شريط أدوات كامل", body: "من السطر نفسه يمكنك تشغيل النطق، ووضع علامة تم التعلم، وفتح الأمثلة، وقراءة القاموس، وحذف الكلمة.", placement: "left" }
      ],
      content: [
        { target: ".plugin-highlight-word", title: "الكلمات المميزة هي نقاط ارتكازك", body: "مرر المؤشر لرؤية المعنى والأمثلة. انقر لوضع علامة على الكلمة كمتعلَّمة. لإضافة كلمة جديدة، حددها في الصفحة ثم استخدم قائمة الإضافة عبر الزر الأيمن.", placement: "bottom" }
      ],
      contentSelection: [
        { target: "#translationBox", title: "هذه نافذة الترجمة الفورية", body: "عندما تحدد نصاً في الصفحة، تعرض الإضافة الترجمة بجانب مسار قراءتك بدلاً من نقلك إلى مكان آخر.", placement: "bottom" },
        { target: "#translationDictionary", title: "تظهر بيانات القاموس عند توفرها", body: "إذا كان النص المحدد كلمة مدعومة في القاموس، تضيف هذه المنطقة نوع الكلمة والتعريفات. لحفظها بشكل صحيح، أبقِ التحديد واستخدم قائمة الإضافة عبر الزر الأيمن.", placement: "top" }
      ]
    },
    hi: {
      replay: "ट्यूटोरियल फिर से देखें",
      skip: "छोड़ें",
      next: "अगला",
      done: "समाप्त",
      step: "चरण {current}/{total}",
      popup: [
        { target: "#settingsLink", title: "पहले सेटिंग्स खोलें", body: "पहली बार उपयोग करते समय स्रोत भाषा, UI भाषा और ऑटो-ट्रांसलेट विकल्प की पुष्टि करने के लिए सेटिंग्स पेज पर जाएँ। ये विकल्प अनुवाद, उच्चारण और शब्दकोश परिणामों को प्रभावित करते हैं।", placement: "bottom" },
        { target: "#practiceBtn", title: "प्रैक्टिस मोड से शुरू करें", body: "यह इस एक्सटेंशन को समझने का सबसे तेज़ तरीका है। आप कार्ड-आधारित अभ्यास से शब्द, अर्थ और उदाहरण दोहरा सकते हैं।", placement: "bottom" },
        { target: "#fullscreenBtn", title: "फुलस्क्रीन मैनेजर खोलें", body: "जब आप पूरी तरह खोज, क्रमबद्ध करना, उदाहरण या शब्दकोश देखना चाहते हैं, तब इस पेज का उपयोग करें।", placement: "bottom" },
        { target: "#sortMode", title: "सूची का फोकस जल्दी बदलें", body: "आप हाल में जोड़े गए, वर्णक्रमानुसार या आवृत्ति-आधारित क्रम में स्विच कर सकते हैं, ताकि आज की समीक्षा पर ध्यान दे सकें।", placement: "bottom" },
        { target: ".word-item .word-toolbar", title: "हर शब्द पर सीधे काम करें", body: "यहाँ से आप उच्चारण चला सकते हैं, उदाहरण खोल सकते हैं, सीखा हुआ चिह्नित कर सकते हैं या शब्द हटा सकते हैं।", placement: "left" }
      ],
      options: [
        { target: "#sourceLang", title: "पहले स्रोत भाषा सेट करें", body: "यह सबसे महत्वपूर्ण सेटिंग है। यह अनुवाद, उच्चारण और शब्दकोश खोज को प्रभावित करती है। यदि आप नियमित रूप से एक ही भाषा सीखते हैं, तो इसे Auto पर न छोड़ें।", placement: "bottom" },
        { target: "#uiLanguage", title: "इंटरफ़ेस भाषा अलग है", body: "आप एक्सटेंशन की इंटरफ़ेस भाषा उसी भाषा में रख सकते हैं जिसमें आप सबसे तेज़ पढ़ते हैं, बिना इसे सीखने वाली भाषा से बाँधे।", placement: "bottom" },
        { target: "#autoTranslateOnSelect", title: "चयन-आधारित अनुवाद नियंत्रित करें", body: "इसे चालू करने पर पेज में टेक्स्ट चुनते ही त्वरित अनुवाद बॉक्स खुल जाता है। यह रोज़मर्रा की सबसे अधिक उपयोग होने वाली सुविधाओं में से एक है।", placement: "left" },
        { target: "#dictionaryLookupRow", title: "समर्थन होने पर शब्दकोश चालू करें", body: "यह स्विच तभी दिखता है जब स्रोत भाषा शब्दकोश को सपोर्ट करती है। चालू करने पर अनुवाद परिणाम और Add Word प्रवाह में शब्दकोश डेटा भी जुड़ता है।", placement: "left" },
        { target: "#syncBtn", title: "मैनुअल सिंक यहाँ करें", body: "अगर आपको लगता है कि दूसरे डिवाइस के नए शब्द अभी तक नहीं आए हैं, तो इस बटन से नवीनतम क्लाउड स्थिति भेजें और खींचें।", placement: "top" }
      ],
      practice: [
        { target: "#streakChip", title: "ऊपर के प्रगति चिप्स पहले देखें", body: "ये चिप्स प्रश्न संख्या, स्कोर, स्ट्रीक और ओवरटाइम की स्थिति दिखाते हैं। राउंड की गति समझने के लिए यही सबसे अच्छा सारांश है।", placement: "bottom" },
        { target: "#card", title: "मुख्य प्रश्न इस कार्ड में है", body: "इस मोड में शब्द, अर्थ और क्लोज़ प्रश्न मिलते हैं। पहले संकेत पढ़ें, फिर चार विकल्पों में से चुनें।", placement: "top" },
        { target: "#options", title: "इस विकल्प ग्रिड से उत्तर दें", body: "हर प्रश्न चार विकल्पों वाला है। तेज़ी के लिए आप 1-4 या A-D कीबोर्ड शॉर्टकट भी इस्तेमाल कर सकते हैं।", placement: "top" },
        { target: "#cardActions", title: "नीचे की क्रियाएँ स्थिति के साथ बदलती हैं", body: "क्लोज़ प्रश्नों में यहाँ अनुवाद बटन दिख सकता है। सही उत्तर के बाद यही जगह Mark Learned और Next भी दिखाती है।", placement: "top" }
      ],
      practiceNeedWords: [
        { target: "#card", title: "पहले कम से कम 4 शब्द इकट्ठा करें", body: "अभी अभ्यास शुरू करने के लिए पर्याप्त शब्द नहीं हैं। पहले वेब पेजों से शब्द जोड़ें या अर्थ सहित कम से कम 4 अनसीखे शब्द जमा करें।", placement: "top" }
      ],
      words: [
        { target: "#practiceBtn", title: "यहीं से अभ्यास शुरू करें", body: "फुलस्क्रीन पेज अभ्यास के लिए सीधा प्रवेश भी रखता है, ताकि आप समीक्षा से ड्रिल में बिना रुकावट जा सकें।", placement: "bottom" },
        { target: "#toggleViewBtn", title: "सभी और अनसीखे के बीच बदलें", body: "यह बटन पूरी सूची और केवल अनसीखे शब्दों के बीच स्विच करता है। जो अभी बाकी है उस पर जल्दी फोकस करने का यह सबसे तेज़ तरीका है।", placement: "bottom" },
        { target: "#searchInput", title: "देखने से पहले खोजें", body: "खोज शब्दों, अर्थों और कुछ शब्दकोश पाठ पर काम करती है। सूची बड़ी होने पर पहले यही उपयोग करें।", placement: "bottom" },
        { target: "#sortMode", title: "ज़रूरत के हिसाब से क्रम बदलें", body: "हालिया, वर्णक्रम और आवृत्ति के बीच बदलें ताकि अलग-अलग सीखने की प्राथमिकताएँ सामने आएँ।", placement: "bottom" },
        { target: "#wordsList .word-actions", title: "हर शब्द के लिए पूरा एक्शन रेल है", body: "उसी पंक्ति से आप उच्चारण चला सकते हैं, सीखा हुआ चिह्नित कर सकते हैं, उदाहरण खोल सकते हैं, शब्दकोश देख सकते हैं और शब्द हटा सकते हैं।", placement: "left" }
      ],
      content: [
        { target: ".plugin-highlight-word", title: "हाइलाइट किए गए शब्द आपके सीखने के संकेत हैं", body: "अर्थ और उदाहरण देखने के लिए माउस ले जाएँ। किसी शब्द को सीखा हुआ चिह्नित करने के लिए क्लिक करें। नया शब्द जोड़ने के लिए पेज पर टेक्स्ट चुनें और राइट-क्लिक मेनू से एक्सटेंशन का उपयोग करें।", placement: "bottom" }
      ],
      contentSelection: [
        { target: "#translationBox", title: "यह त्वरित अनुवाद बॉक्स है", body: "जब आप पेज पर टेक्स्ट चुनते हैं, एक्सटेंशन आपकी पढ़ाई के प्रवाह के पास ही अनुवाद दिखाता है, आपको कहीं और भेजे बिना।", placement: "bottom" },
        { target: "#translationDictionary", title: "उपलब्ध होने पर शब्दकोश डेटा दिखता है", body: "अगर चुना गया टेक्स्ट शब्दकोश-सपोर्टेड शब्द है, तो यह क्षेत्र शब्द-भेद और परिभाषाएँ जोड़ता है। इसे सही तरह सहेजने के लिए चयन बनाए रखें और राइट-क्लिक मेनू से एक्सटेंशन का उपयोग करें।", placement: "top" }
      ]
    },
    ja: {
      replay: "ガイドを再表示",
      skip: "スキップ",
      next: "次へ",
      done: "完了",
      step: "ステップ {current}/{total}",
      popup: [
        { target: "#settingsLink", title: "まず設定を開いてください", body: "初回利用時は、設定ページで翻訳元言語、UI 言語、自動翻訳の設定を確認してください。これらは翻訳、発音、辞書結果に直接影響します。", placement: "bottom" },
        { target: "#practiceBtn", title: "まずは練習モードから", body: "この拡張機能を理解する一番早い方法です。カード形式で単語、意味、例文を復習できます。", placement: "bottom" },
        { target: "#fullscreenBtn", title: "全画面マネージャーを開く", body: "検索、並び替え、例文、辞書をまとめて確認したいときは、このページを使うのが最適です。", placement: "bottom" },
        { target: "#sortMode", title: "並び替えの視点をすぐ変更", body: "追加順、アルファベット順、頻度順を切り替えて、今日見たい単語にすぐ集中できます。", placement: "bottom" },
        { target: ".word-item .word-toolbar", title: "各単語をその場で操作", body: "ここから発音、例文の表示、学習済みの切り替え、削除を直接行えます。", placement: "left" }
      ],
      options: [
        { target: "#sourceLang", title: "最初に翻訳元言語を設定", body: "これは最も重要な設定です。翻訳、発音、辞書検索に影響します。継続して同じ言語を学ぶなら Auto のままにしない方がよいです。", placement: "bottom" },
        { target: "#uiLanguage", title: "UI 言語は独立しています", body: "学習言語とは別に、自分が一番読みやすい言語で拡張機能の UI を使えます。", placement: "bottom" },
        { target: "#autoTranslateOnSelect", title: "選択時の自動翻訳を制御", body: "これを有効にすると、ページ上で文字を選択した時に即時翻訳ボックスが自動で表示されます。日常的によく使う機能です。", placement: "left" },
        { target: "#dictionaryLookupRow", title: "対応言語では辞書を有効化", body: "翻訳元言語が辞書に対応している場合のみ、このスイッチが表示されます。有効にすると、翻訳結果や Add Word の流れに辞書データが追加されます。", placement: "left" },
        { target: "#syncBtn", title: "手動同期はここから", body: "別の端末で追加した新しい単語がまだ来ていないと感じたら、このボタンで最新状態を送受信してください。", placement: "top" }
      ],
      practice: [
        { target: "#streakChip", title: "まず上部の進捗チップを見る", body: "ここには問題数、スコア、連続正解、延長状態が表示されます。ラウンド全体の流れを把握するにはここが最も重要です。", placement: "bottom" },
        { target: "#card", title: "メインの問題はこのカード内", body: "このモードでは単語、意味、穴埋め問題が混ざって出題されます。まず指示を読んでから 4 択で答えてください。", placement: "top" },
        { target: "#options", title: "答えはこの選択肢グリッドから", body: "各問題は 4 択です。テンポを上げたい場合は 1-4 や A-D のキーボード操作も使えます。", placement: "top" },
        { target: "#cardActions", title: "下の操作は状況で変わります", body: "穴埋め問題ではここに翻訳ボタンが出ます。正解後には学習済みにするボタンや次へボタンもここに表示されます。", placement: "top" }
      ],
      practiceNeedWords: [
        { target: "#card", title: "まず 4 語以上集めてください", body: "まだ練習を始めるのに十分な単語がありません。まずはウェブページから単語を追加するか、意味付きの未学習単語を 4 語以上ためてください。", placement: "top" }
      ],
      words: [
        { target: "#practiceBtn", title: "ここから練習を開始", body: "全画面ページにも練習への直接入口があります。レビューからそのまま練習に移れます。", placement: "bottom" },
        { target: "#toggleViewBtn", title: "全件表示と未学習のみを切替", body: "このボタンで全単語表示と未学習のみ表示を切り替えられます。まだ重点的に見るべき単語に絞る最速の方法です。", placement: "bottom" },
        { target: "#searchInput", title: "一覧を見る前に検索", body: "検索は単語、意味、一部の辞書テキストにも対応しています。リストが大きくなったら先にここを使ってください。", placement: "bottom" },
        { target: "#sortMode", title: "必要な視点で並び替える", body: "新しい順、アルファベット順、頻度順を切り替えて、別の学習優先度を浮かび上がらせます。", placement: "bottom" },
        { target: "#wordsList .word-actions", title: "各単語に完全な操作列があります", body: "同じ行から発音、学習済み切替、例文表示、辞書確認、削除まで行えます。", placement: "left" }
      ],
      content: [
        { target: ".plugin-highlight-word", title: "ハイライト語は学習の目印です", body: "マウスオーバーで意味と例文を確認し、クリックで学習済みにできます。新しい単語を追加したい場合は、ページ上で文字を選択して右クリックメニューから拡張機能を使ってください。", placement: "bottom" }
      ],
      contentSelection: [
        { target: "#translationBox", title: "これは即時翻訳ボックスです", body: "ページ上で文字を選択すると、読書の流れを止めずに、その場で翻訳が表示されます。", placement: "bottom" },
        { target: "#translationDictionary", title: "利用可能なら辞書情報も表示されます", body: "選択した文字が辞書対応の単語なら、この領域に品詞や定義が追加されます。正しく保存したい場合は、選択状態を保ったまま右クリックメニューから拡張機能を使ってください。", placement: "top" }
      ]
    },
    ko: {
      replay: "튜토리얼 다시 보기",
      skip: "건너뛰기",
      next: "다음",
      done: "완료",
      step: "단계 {current}/{total}",
      popup: [
        { target: "#settingsLink", title: "먼저 설정을 여세요", body: "처음 사용할 때는 설정 페이지에서 번역 원문 언어, UI 언어, 자동 번역 옵션을 확인하세요. 이 설정들은 번역, 발음, 사전 결과에 직접 영향을 줍니다.", placement: "bottom" },
        { target: "#practiceBtn", title: "연습 모드부터 시작하세요", body: "이 확장 기능을 가장 빨리 이해하는 방법입니다. 카드 방식으로 단어, 뜻, 예문을 복습할 수 있습니다.", placement: "bottom" },
        { target: "#fullscreenBtn", title: "전체 화면 관리 페이지 열기", body: "검색, 정렬, 예문, 사전 정보를 한 번에 깊게 보고 싶다면 이 페이지를 사용하는 것이 가장 좋습니다.", placement: "bottom" },
        { target: "#sortMode", title: "정렬 관점을 빠르게 바꾸세요", body: "추가 순서, 알파벳 순서, 빈도 순서를 전환해 오늘 보고 싶은 단어에 바로 집중할 수 있습니다.", placement: "bottom" },
        { target: ".word-item .word-toolbar", title: "각 단어를 바로 조작하세요", body: "여기서 발음, 예문 보기, 학습 완료 표시, 삭제를 바로 처리할 수 있습니다.", placement: "left" }
      ],
      options: [
        { target: "#sourceLang", title: "먼저 원문 언어를 설정하세요", body: "가장 중요한 설정입니다. 번역, 발음, 사전 조회에 영향을 줍니다. 한 언어를 계속 공부한다면 Auto로 두지 않는 것이 좋습니다.", placement: "bottom" },
        { target: "#uiLanguage", title: "UI 언어는 별도로 바꿀 수 있습니다", body: "학습 언어와 별개로, 가장 읽기 편한 언어로 확장 기능 UI를 사용할 수 있습니다.", placement: "bottom" },
        { target: "#autoTranslateOnSelect", title: "선택 즉시 번역을 제어하세요", body: "이 옵션을 켜면 페이지에서 텍스트를 선택할 때 즉시 번역 상자가 자동으로 열립니다. 일상적으로 가장 많이 쓰는 기능 중 하나입니다.", placement: "left" },
        { target: "#dictionaryLookupRow", title: "지원 언어일 때 사전을 켜세요", body: "원문 언어가 사전을 지원할 때만 이 스위치가 나타납니다. 켜면 번역 결과와 Add Word 흐름에 사전 데이터가 함께 들어갑니다.", placement: "left" },
        { target: "#syncBtn", title: "수동 동기화는 여기서", body: "다른 기기에서 추가한 새 단어가 아직 들어오지 않았다고 느끼면, 이 버튼으로 최신 상태를 밀고 받아오세요.", placement: "top" }
      ],
      practice: [
        { target: "#streakChip", title: "먼저 위쪽 진행 칩을 보세요", body: "이 칩들에는 문제 수, 점수, 연속 정답, 연장 여부가 계속 표시됩니다. 한 라운드의 흐름을 파악하려면 여기가 가장 중요합니다.", placement: "bottom" },
        { target: "#card", title: "주요 문제는 이 카드 안에 있습니다", body: "이 모드는 단어, 뜻, 빈칸 문제를 섞어서 냅니다. 먼저 안내 문구를 읽고 4지선다로 답하세요.", placement: "top" },
        { target: "#options", title: "이 선택지 그리드에서 답하세요", body: "각 문제는 4지선다입니다. 속도를 높이고 싶다면 1-4 또는 A-D 키보드 입력도 사용할 수 있습니다.", placement: "top" },
        { target: "#cardActions", title: "아래 동작은 상태에 따라 바뀝니다", body: "빈칸 문제에서는 여기서 번역 버튼이 나타날 수 있습니다. 정답을 맞히면 학습 완료 표시와 다음 문제 버튼도 여기서 보입니다.", placement: "top" }
      ],
      practiceNeedWords: [
        { target: "#card", title: "먼저 최소 4개의 단어를 모으세요", body: "아직 연습을 시작할 만큼 단어가 충분하지 않습니다. 먼저 웹페이지에서 단어를 추가하거나, 뜻이 있는 미학습 단어를 4개 이상 모으세요.", placement: "top" }
      ],
      words: [
        { target: "#practiceBtn", title: "여기서 바로 연습을 시작하세요", body: "전체 화면 페이지에도 연습으로 가는 직접 진입점이 있어, 복습에서 문제 풀이로 끊김 없이 넘어갈 수 있습니다.", placement: "bottom" },
        { target: "#toggleViewBtn", title: "전체 보기와 미학습만 보기 전환", body: "이 버튼으로 전체 목록과 미학습 단어만 보기 사이를 전환할 수 있습니다. 아직 집중해서 봐야 할 항목만 빠르게 추리는 가장 좋은 방법입니다.", placement: "bottom" },
        { target: "#searchInput", title: "훑어보기 전에 먼저 검색하세요", body: "검색은 단어, 뜻, 일부 사전 텍스트까지 포함합니다. 목록이 커지면 먼저 여기서 범위를 줄이세요.", placement: "bottom" },
        { target: "#sortMode", title: "필요한 관점으로 정렬하세요", body: "최근 추가, 알파벳, 빈도 정렬을 전환해 서로 다른 학습 우선순위를 드러낼 수 있습니다.", placement: "bottom" },
        { target: "#wordsList .word-actions", title: "각 단어에는 완전한 작업 열이 있습니다", body: "같은 줄에서 발음, 학습 완료 표시, 예문 열기, 사전 확인, 삭제까지 모두 처리할 수 있습니다.", placement: "left" }
      ],
      content: [
        { target: ".plugin-highlight-word", title: "하이라이트된 단어는 학습의 기준점입니다", body: "마우스를 올리면 뜻과 예문을 미리 볼 수 있고, 클릭하면 학습 완료로 표시할 수 있습니다. 새 단어를 추가하려면 페이지에서 텍스트를 선택한 뒤 마우스 오른쪽 메뉴에서 확장 기능을 사용하세요.", placement: "bottom" }
      ],
      contentSelection: [
        { target: "#translationBox", title: "이것이 즉시 번역 상자입니다", body: "페이지에서 텍스트를 선택하면 읽는 흐름을 끊지 않고 바로 옆에 번역이 표시됩니다.", placement: "bottom" },
        { target: "#translationDictionary", title: "가능할 때 사전 정보도 함께 나옵니다", body: "선택한 텍스트가 사전 지원 단어라면, 이 영역에 품사와 정의가 추가됩니다. 제대로 저장하려면 선택 상태를 유지한 채 오른쪽 클릭 메뉴에서 확장 기능을 사용하세요.", placement: "top" }
      ]
    },
    id: {
      replay: "Lihat tutorial lagi",
      skip: "Lewati",
      next: "Berikutnya",
      done: "Selesai",
      step: "Langkah {current}/{total}",
      popup: [
        { target: "#settingsLink", title: "Buka pengaturan dulu", body: "Saat pertama kali memakai, buka halaman pengaturan dan pastikan bahasa sumber, bahasa UI, dan opsi terjemahan otomatis sudah benar. Pilihan ini memengaruhi terjemahan, pelafalan, dan hasil kamus.", placement: "bottom" },
        { target: "#practiceBtn", title: "Mulai dari mode latihan", body: "Ini cara tercepat untuk memahami ekstensi ini. Kamu bisa meninjau kata, arti, dan contoh lewat latihan berbasis kartu.", placement: "bottom" },
        { target: "#fullscreenBtn", title: "Buka pengelola layar penuh", body: "Gunakan halaman ini saat kamu ingin mencari, mengurutkan, dan memeriksa contoh atau kamus secara lebih lengkap.", placement: "bottom" },
        { target: "#sortMode", title: "Ganti fokus urutan dengan cepat", body: "Kamu bisa mengurutkan berdasarkan yang terbaru, alfabet, atau frekuensi agar fokus ke kata yang ingin kamu tinjau hari ini.", placement: "bottom" },
        { target: ".word-item .word-toolbar", title: "Kelola setiap kata secara langsung", body: "Di sini kamu bisa memutar pelafalan, membuka contoh, menandai sudah dipelajari, atau menghapus kata langsung dari daftar ringkas.", placement: "left" }
      ],
      options: [
        { target: "#sourceLang", title: "Atur dulu bahasa sumber", body: "Ini pengaturan yang paling penting. Ia memengaruhi terjemahan, pelafalan, dan pencarian kamus. Jika kamu belajar satu bahasa secara rutin, jangan biarkan tetap di Auto.", placement: "bottom" },
        { target: "#uiLanguage", title: "Bahasa UI berdiri sendiri", body: "Kamu bisa memakai antarmuka ekstensi dalam bahasa yang paling nyaman dibaca, tanpa harus sama dengan bahasa yang sedang dipelajari.", placement: "bottom" },
        { target: "#autoTranslateOnSelect", title: "Atur terjemahan saat memilih teks", body: "Saat opsi ini aktif, memilih teks di halaman akan langsung memunculkan kotak terjemahan instan. Ini salah satu fitur yang paling sering dipakai.", placement: "left" },
        { target: "#dictionaryLookupRow", title: "Aktifkan kamus bila didukung", body: "Sakelar ini hanya muncul jika bahasa sumber mendukung kamus. Saat diaktifkan, hasil terjemahan dan alur Add Word juga akan memuat data kamus.", placement: "left" },
        { target: "#syncBtn", title: "Gunakan sinkronisasi manual di sini", body: "Kalau kamu merasa kata baru dari perangkat lain belum masuk, pakai tombol ini untuk mendorong dan menarik status cloud terbaru.", placement: "top" }
      ],
      practice: [
        { target: "#streakChip", title: "Lihat dulu chip progres di atas", body: "Chip ini terus menampilkan jumlah soal, skor, streak, dan apakah kamu masuk overtime. Ini ringkasan terbaik untuk memahami ritme ronde.", placement: "bottom" },
        { target: "#card", title: "Soal utama ada di kartu ini", body: "Mode ini mencampur soal kata, arti, dan cloze. Baca petunjuknya dulu, lalu jawab lewat empat pilihan.", placement: "top" },
        { target: "#options", title: "Jawab dari grid pilihan ini", body: "Setiap soal berbentuk pilihan ganda empat opsi. Kamu juga bisa memakai keyboard 1-4 atau A-D agar ritmenya lebih cepat.", placement: "top" },
        { target: "#cardActions", title: "Aksi di bawah berubah sesuai keadaan", body: "Untuk soal cloze, area ini bisa menampilkan tombol terjemahan. Setelah jawaban benar, area yang sama juga akan menampilkan Tandai Sudah Dipelajari dan Berikutnya.", placement: "top" }
      ],
      practiceNeedWords: [
        { target: "#card", title: "Kumpulkan dulu minimal 4 kata", body: "Belum ada cukup kata untuk memulai latihan. Tambahkan kata dari halaman web dulu atau kumpulkan setidaknya 4 kata belum dipelajari yang punya arti.", placement: "top" }
      ],
      words: [
        { target: "#practiceBtn", title: "Mulai latihan dari sini", body: "Halaman layar penuh juga punya pintu masuk langsung ke latihan, jadi kamu bisa berpindah dari review ke drill tanpa memutus ritme.", placement: "bottom" },
        { target: "#toggleViewBtn", title: "Beralih antara semua dan belum dipelajari", body: "Tombol ini memungkinkan kamu beralih antara daftar penuh dan hanya kata yang belum dipelajari. Ini cara tercepat untuk memfokuskan halaman pada yang masih perlu dikerjakan.", placement: "bottom" },
        { target: "#searchInput", title: "Cari dulu sebelum menyisir", body: "Pencarian bekerja pada kata, arti, dan sebagian teks kamus. Gunakan ini lebih dulu saat daftar mulai besar.", placement: "bottom" },
        { target: "#sortMode", title: "Urutkan sesuai sudut yang dibutuhkan", body: "Beralihlah antara terbaru, alfabet, dan frekuensi untuk menampilkan prioritas belajar yang berbeda.", placement: "bottom" },
        { target: "#wordsList .word-actions", title: "Setiap kata punya rel aksi lengkap", body: "Dari baris yang sama kamu bisa memutar pelafalan, menandai sudah dipelajari, membuka contoh, melihat kamus, dan menghapus kata.", placement: "left" }
      ],
      content: [
        { target: ".plugin-highlight-word", title: "Kata yang disorot adalah jangkar belajar kamu", body: "Arahkan mouse untuk melihat arti dan contoh. Klik untuk menandai kata sebagai sudah dipelajari. Untuk menambah kata baru, pilih teks di halaman lalu gunakan ekstensi dari menu klik kanan.", placement: "bottom" }
      ],
      contentSelection: [
        { target: "#translationBox", title: "Ini adalah kotak terjemahan instan", body: "Saat kamu memilih teks di halaman, ekstensi menampilkan terjemahan tepat di samping alur membaca tanpa memindahkanmu ke tempat lain.", placement: "bottom" },
        { target: "#translationDictionary", title: "Data kamus muncul bila tersedia", body: "Jika teks yang dipilih adalah kata yang didukung kamus, area ini menambahkan kelas kata dan definisi. Untuk menyimpannya dengan benar, pertahankan seleksi lalu gunakan ekstensi dari menu klik kanan.", placement: "top" }
      ]
    },
    ru: {
      replay: "Показать обучение снова",
      skip: "Пропустить",
      next: "Далее",
      done: "Готово",
      step: "Шаг {current}/{total}",
      popup: [
        { target: "#settingsLink", title: "Сначала откройте настройки", body: "При первом использовании откройте страницу настроек и проверьте язык источника, язык интерфейса и автоперевод. Эти параметры влияют на перевод, произношение и словарь.", placement: "bottom" },
        { target: "#practiceBtn", title: "Начните с режима практики", body: "Это самый быстрый способ понять расширение. Вы можете повторять слова, значения и примеры в формате карточек.", placement: "bottom" },
        { target: "#fullscreenBtn", title: "Откройте полноэкранный менеджер", body: "Используйте эту страницу, когда хотите полноценно искать, сортировать и просматривать примеры или словарь.", placement: "bottom" },
        { target: "#sortMode", title: "Быстро меняйте ракурс сортировки", body: "Вы можете переключаться между недавним добавлением, алфавитом и частотой, чтобы сосредоточиться на нужных словах сегодня.", placement: "bottom" },
        { target: ".word-item .word-toolbar", title: "Работайте с каждым словом напрямую", body: "Здесь можно запустить произношение, открыть примеры, отметить как выученное или удалить слово из компактного списка.", placement: "left" }
      ],
      options: [
        { target: "#sourceLang", title: "Сначала задайте язык источника", body: "Это самый важный параметр. Он влияет на перевод, произношение и поиск по словарю. Если вы долго изучаете один язык, лучше не оставлять Auto.", placement: "bottom" },
        { target: "#uiLanguage", title: "Язык интерфейса настраивается отдельно", body: "Вы можете оставить интерфейс расширения на том языке, который вам удобнее всего читать, не привязывая его к изучаемому языку.", placement: "bottom" },
        { target: "#autoTranslateOnSelect", title: "Управляйте переводом по выделению", body: "Когда эта опция включена, выделение текста на странице автоматически открывает окно мгновенного перевода. Это одна из самых часто используемых функций.", placement: "left" },
        { target: "#dictionaryLookupRow", title: "Включайте словарь, если язык поддерживается", body: "Этот переключатель появляется только для поддерживаемых языков источника. При включении в результаты перевода и Add Word также добавляются словарные данные.", placement: "left" },
        { target: "#syncBtn", title: "Здесь доступна ручная синхронизация", body: "Если вы думаете, что новые слова с другого устройства ещё не пришли, используйте эту кнопку, чтобы отправить и получить актуальное облачное состояние.", placement: "top" }
      ],
      practice: [
        { target: "#streakChip", title: "Сначала смотрите на верхние индикаторы", body: "Они постоянно показывают количество вопросов, очки, серию и факт перехода в овертайм. Это лучший обзор текущего раунда.", placement: "bottom" },
        { target: "#card", title: "Основной вопрос находится в этой карточке", body: "Режим смешивает вопросы по слову, значению и предложениям с пропуском. Сначала прочитайте подсказку, затем выберите один из четырёх вариантов.", placement: "top" },
        { target: "#options", title: "Отвечайте через эту сетку вариантов", body: "Каждый вопрос имеет четыре варианта ответа. Для ускорения можно использовать клавиши 1-4 или A-D.", placement: "top" },
        { target: "#cardActions", title: "Нижние действия меняются по ситуации", body: "Для cloze-вопросов здесь может появиться кнопка перевода. После правильного ответа здесь же появляются Отметить как выученное и Далее.", placement: "top" }
      ],
      practiceNeedWords: [
        { target: "#card", title: "Сначала соберите хотя бы 4 слова", body: "Пока слов недостаточно для начала практики. Сначала добавьте слова с веб-страниц или накопите хотя бы 4 невыученных слова со значением.", placement: "top" }
      ],
      words: [
        { target: "#practiceBtn", title: "Запускайте практику отсюда", body: "Полноэкранная страница тоже даёт прямой вход в практику, чтобы вы могли перейти от обзора к тренировке без потери темпа.", placement: "bottom" },
        { target: "#toggleViewBtn", title: "Переключайте все / только невыученные", body: "Эта кнопка переключает полную выдачу и только невыученные слова. Это самый быстрый способ сфокусироваться на том, что ещё требует работы.", placement: "bottom" },
        { target: "#searchInput", title: "Сначала ищите, потом просматривайте", body: "Поиск работает по словам, значениям и части словарного текста. Пользуйтесь им первым, когда список становится большим.", placement: "bottom" },
        { target: "#sortMode", title: "Сортируйте под нужный угол обзора", body: "Переключайтесь между недавними, алфавитом и частотой, чтобы увидеть разные учебные приоритеты.", placement: "bottom" },
        { target: "#wordsList .word-actions", title: "У каждого слова есть полная панель действий", body: "Из одной строки можно запустить произношение, отметить слово как выученное, открыть примеры, посмотреть словарь и удалить слово.", placement: "left" }
      ],
      content: [
        { target: ".plugin-highlight-word", title: "Подсвеченные слова — ваши учебные якоря", body: "Наведите курсор, чтобы увидеть значение и примеры. Нажмите, чтобы отметить слово как выученное. Чтобы добавить новое слово, выделите текст на странице и используйте расширение через контекстное меню.", placement: "bottom" }
      ],
      contentSelection: [
        { target: "#translationBox", title: "Это окно мгновенного перевода", body: "Когда вы выделяете текст на странице, расширение показывает перевод прямо рядом с чтением, не уводя вас в другое место.", placement: "bottom" },
        { target: "#translationDictionary", title: "Данные словаря появляются, если доступны", body: "Если выделенный текст — слово, поддерживаемое словарём, эта область добавит часть речи и определения. Чтобы сохранить его правильно, удерживайте выделение и используйте расширение через контекстное меню.", placement: "top" }
      ]
    },
    es: {
      replay: "Ver tutorial otra vez",
      skip: "Omitir",
      next: "Siguiente",
      done: "Finalizar",
      step: "Paso {current}/{total}",
      popup: [
        { target: "#settingsLink", title: "Abre primero la configuración", body: "En el primer uso, entra en la página de configuración y confirma el idioma de origen, el idioma de la interfaz y la traducción automática. Estas opciones afectan la traducción, la pronunciación y el diccionario.", placement: "bottom" },
        { target: "#practiceBtn", title: "Empieza con el modo de práctica", body: "Es la forma más rápida de entender la extensión. Puedes repasar palabras, significados y ejemplos con tarjetas.", placement: "bottom" },
        { target: "#fullscreenBtn", title: "Abre el gestor en pantalla completa", body: "Usa esta página cuando quieras buscar, ordenar y revisar ejemplos o diccionario de forma completa.", placement: "bottom" },
        { target: "#sortMode", title: "Cambia rápido el enfoque de orden", body: "Puedes alternar entre recientes, alfabético y frecuencia para centrarte en lo que quieres repasar hoy.", placement: "bottom" },
        { target: ".word-item .word-toolbar", title: "Actúa directamente sobre cada palabra", body: "Desde aquí puedes reproducir la pronunciación, abrir ejemplos, marcar como aprendida o eliminar una palabra de la lista compacta.", placement: "left" }
      ],
      options: [
        { target: "#sourceLang", title: "Primero define el idioma de origen", body: "Es la configuración más importante. Afecta la traducción, la pronunciación y las búsquedas del diccionario. Si estudias un idioma de forma constante, no lo dejes en Auto.", placement: "bottom" },
        { target: "#uiLanguage", title: "El idioma de la interfaz es independiente", body: "Puedes mantener la interfaz de la extensión en el idioma que lees con más facilidad, sin ligarlo al idioma que estás estudiando.", placement: "bottom" },
        { target: "#autoTranslateOnSelect", title: "Controla la traducción al seleccionar", body: "Cuando esta opción está activada, al seleccionar texto en una página se abre automáticamente la caja de traducción instantánea. Es una de las funciones más usadas a diario.", placement: "left" },
        { target: "#dictionaryLookupRow", title: "Activa el diccionario cuando haya soporte", body: "Este interruptor aparece cuando el idioma de origen admite diccionario. Al activarlo, los resultados de traducción y el flujo de Add Word también incluyen datos léxicos.", placement: "left" },
        { target: "#syncBtn", title: "Usa aquí la sincronización manual", body: "Si sospechas que las palabras nuevas de otro dispositivo todavía no han llegado, usa este botón para enviar y recuperar el estado más reciente de la nube.", placement: "top" }
      ],
      practice: [
        { target: "#streakChip", title: "Mira primero los indicadores superiores", body: "Estos indicadores muestran el número de preguntas, la puntuación, la racha y si has entrado en tiempo extra. Es el mejor resumen del ritmo de la ronda.", placement: "bottom" },
        { target: "#card", title: "La pregunta principal está en esta tarjeta", body: "Este modo mezcla preguntas de palabra, significado y cloze. Lee primero la pista y luego responde entre cuatro opciones.", placement: "top" },
        { target: "#options", title: "Responde desde esta cuadrícula", body: "Cada pregunta tiene cuatro opciones. También puedes usar el teclado con 1-4 o A-D para mantener un ritmo más rápido.", placement: "top" },
        { target: "#cardActions", title: "Las acciones inferiores cambian según el estado", body: "En las preguntas cloze, aquí puede aparecer el botón de traducción. Después de una respuesta correcta, aquí también aparecen Marcar como aprendida y Siguiente.", placement: "top" }
      ],
      practiceNeedWords: [
        { target: "#card", title: "Primero reúne al menos 4 palabras", body: "Todavía no hay suficientes palabras para empezar la práctica. Primero añade palabras desde páginas web o acumula al menos 4 palabras no aprendidas con significado.", placement: "top" }
      ],
      words: [
        { target: "#practiceBtn", title: "Lanza la práctica desde aquí", body: "La página de pantalla completa también mantiene una entrada directa a la práctica, para que puedas pasar de la revisión al ejercicio sin romper el ritmo.", placement: "bottom" },
        { target: "#toggleViewBtn", title: "Alterna entre todo y no aprendido", body: "Este botón te permite cambiar entre la lista completa y solo las palabras no aprendidas. Es la forma más rápida de centrar la página en lo que aún requiere trabajo.", placement: "bottom" },
        { target: "#searchInput", title: "Busca antes de recorrer", body: "La búsqueda funciona sobre palabras, significados y parte del texto del diccionario. Úsala primero cuando tu lista se vuelva grande.", placement: "bottom" },
        { target: "#sortMode", title: "Ordena según el ángulo que necesites", body: "Alterna entre reciente, alfabético y frecuencia para sacar a la superficie prioridades de aprendizaje distintas.", placement: "bottom" },
        { target: "#wordsList .word-actions", title: "Cada palabra tiene una barra de acciones completa", body: "Desde la misma fila puedes reproducir la pronunciación, marcar como aprendida, abrir ejemplos, consultar el diccionario y eliminar la palabra.", placement: "left" }
      ],
      content: [
        { target: ".plugin-highlight-word", title: "Las palabras resaltadas son tus anclas de aprendizaje", body: "Pasa el cursor para ver significado y ejemplos. Haz clic para marcar una palabra como aprendida. Para añadir una palabra nueva, selecciona el texto en la página y usa la extensión desde el menú del clic derecho.", placement: "bottom" }
      ],
      contentSelection: [
        { target: "#translationBox", title: "Esta es la caja de traducción instantánea", body: "Cuando seleccionas texto en una página, la extensión muestra la traducción justo al lado de tu flujo de lectura, sin sacarte de la página.", placement: "bottom" },
        { target: "#translationDictionary", title: "Los datos del diccionario aparecen cuando están disponibles", body: "Si el texto seleccionado es una palabra compatible con el diccionario, esta zona añade categoría gramatical y definiciones. Para guardarla correctamente, mantén la selección y usa la extensión desde el menú del clic derecho.", placement: "top" }
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
