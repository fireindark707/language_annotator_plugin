let uiLang = "zh-TW";
let allWords = [];
let deck = [];
let qIndex = 0;
let score = 0;
let correctCount = 0;
let streak = 0;
let bestStreak = 0;
let overtimeActive = false;
let answered = false;
let reviewedWordsThisRound = [];
let selectedLearnedWords = new Set();

const MAX_QUESTIONS = 10;
const CHOICE_COUNT = 4;

const titleEl = document.getElementById("title");
const subtitleEl = document.getElementById("subtitle");
const closeBtn = document.getElementById("closeBtn");
const helpBtn = document.getElementById("helpBtn");
const progressChip = document.getElementById("progressChip");
const scoreChip = document.getElementById("scoreChip");
const streakChip = document.getElementById("streakChip");
const challengeChip = document.getElementById("challengeChip");
const progressBar = document.getElementById("progressBar");
const promptEl = document.getElementById("prompt");
const stimulusEl = document.getElementById("stimulus");
const optionsEl = document.getElementById("options");
const feedbackEl = document.getElementById("feedback");
const clozeTranslateBtn = document.getElementById("clozeTranslateBtn");
const clozeTranslateTextEl = document.getElementById("clozeTranslateText");
const nextBtn = document.getElementById("nextBtn");
const markLearnedBtn = document.getElementById("markLearnedBtn");
const cardEl = document.getElementById("card");
const summaryEl = document.getElementById("summary");
const summaryTitleEl = document.getElementById("summaryTitle");
const summaryBadgeEl = document.getElementById("summaryBadge");
const summaryBigScoreEl = document.getElementById("summaryBigScore");
const summaryCommentEl = document.getElementById("summaryComment");
const summaryAccuracyLabelEl = document.getElementById("summaryAccuracyLabel");
const summaryCorrectLabelEl = document.getElementById("summaryCorrectLabel");
const summaryBestStreakLabelEl = document.getElementById("summaryBestStreakLabel");
const summaryAccuracyEl = document.getElementById("summaryAccuracy");
const summaryCorrectEl = document.getElementById("summaryCorrect");
const summaryBestStreakEl = document.getElementById("summaryBestStreak");
const summaryTextEl = document.getElementById("summaryText");
const summaryCelebrateEl = document.getElementById("summaryCelebrate");
const summaryReviewedEl = document.getElementById("summaryReviewed");
const summaryReviewedTitleEl = document.getElementById("summaryReviewedTitle");
const summaryReviewedDescEl = document.getElementById("summaryReviewedDesc");
const summaryReviewedListEl = document.getElementById("summaryReviewedList");
const applyLearnedWordsBtn = document.getElementById("applyLearnedWordsBtn");
const megaOverlayEl = document.getElementById("megaOverlay");
const megaTextEl = document.getElementById("megaText");
const answerFlashEl = document.getElementById("answerFlash");
const nextRoundBtn = document.getElementById("nextRoundBtn");
const celebrateEl = document.getElementById("celebrate");
let answerFlashTimer = null;
let practiceTourAttempted = false;
const PracticeUtilsRef = globalThis.PracticeUtils;
const TranslationUtilsRef = globalThis.TranslationUtils;

function t(key) {
	return UiI18n.t(uiLang, key);
}

function tf(key, vars) {
	let text = t(key);
	Object.keys(vars || {}).forEach((k) => {
		text = text.replaceAll(`{${k}}`, String(vars[k]));
	});
	return text;
}

function startPracticeTour(force) {
	if (!globalThis.UiTour) return;
	const run = force ? UiTour.start : UiTour.maybeStartOnce;
	run({
		storageKey: "practice_v1",
		lang: uiLang,
		steps: UiTour.getSteps(uiLang, "practice"),
	});
}

function startPracticeNeedWordsTour(force) {
	if (!globalThis.UiTour) return;
	const run = force ? UiTour.start : UiTour.maybeStartOnce;
	run({
		storageKey: "practice_need_words_v1",
		lang: uiLang,
		steps: UiTour.getSteps(uiLang, "practiceNeedWords"),
	});
}

function isZhUi() {
	return (uiLang || "").toLowerCase().startsWith("zh");
}

function shuffle(arr) {
	return PracticeUtilsRef.shuffle(arr);
}

function chooseDistractors(base, field, answer, count) {
	return PracticeUtilsRef.chooseDistractors(base, field, answer, count);
}

function getMeaningByWord(word) {
	const item = allWords.find((x) => x.word === word);
	return item && item.meaning ? item.meaning : "";
}

function getReviewedWordsUnique() {
	return PracticeUtilsRef.getReviewedWordsUnique(reviewedWordsThisRound);
}

function updateApplyLearnedWordsBtn() {
	if (!applyLearnedWordsBtn) return;
	const hasSelection = selectedLearnedWords.size > 0;
	applyLearnedWordsBtn.disabled = !hasSelection;
	applyLearnedWordsBtn.textContent = hasSelection
		? tf("practice_apply_learned_count", { count: selectedLearnedWords.size })
		: t("practice_apply_learned");
}

function toggleSummaryLearnedWord(word) {
	if (!word) return;
	if (selectedLearnedWords.has(word)) {
		selectedLearnedWords.delete(word);
	} else {
		selectedLearnedWords.add(word);
	}
	renderSummaryReviewedWords();
}

function renderSummaryReviewedWords() {
	if (!summaryReviewedEl || !summaryReviewedListEl) return;
	const reviewed = getReviewedWordsUnique();
	if (!reviewed.length) {
		summaryReviewedEl.hidden = true;
		summaryReviewedListEl.innerHTML = "";
		selectedLearnedWords.clear();
		updateApplyLearnedWordsBtn();
		return;
	}
	summaryReviewedEl.hidden = false;
	summaryReviewedListEl.innerHTML = "";
	reviewed.forEach((word) => {
		const meaning = getMeaningByWord(word) || t("practice_no_meaning");
		const item = document.createElement("div");
		item.className = "reviewed-item";
		if (selectedLearnedWords.has(word)) item.classList.add("is-selected");

		const main = document.createElement("div");
		main.className = "reviewed-item-main";

		const wordEl = document.createElement("div");
		wordEl.className = "reviewed-item-word";
		wordEl.textContent = word;

		const meaningEl = document.createElement("div");
		meaningEl.className = "reviewed-item-meaning";
		meaningEl.textContent = meaning;

		main.appendChild(wordEl);
		main.appendChild(meaningEl);

		const toggleBtn = document.createElement("button");
		toggleBtn.type = "button";
		toggleBtn.className = "btn-soft reviewed-toggle";
		if (selectedLearnedWords.has(word)) {
			toggleBtn.classList.add("is-selected");
			toggleBtn.textContent = t("practice_selected");
		} else {
			toggleBtn.textContent = t("mark");
		}
		toggleBtn.addEventListener("click", () => toggleSummaryLearnedWord(word));

		item.appendChild(main);
		item.appendChild(toggleBtn);
		summaryReviewedListEl.appendChild(item);
	});
	updateApplyLearnedWordsBtn();
}

function collectReviewedWord(word) {
	if (!word) return;
	reviewedWordsThisRound.push(word);
}

function showAnswerFlash(word, meaning, isCorrect) {
	if (!answerFlashEl) return;
	const w = (word || "").trim();
	const m = (meaning || "").trim();
	const safeWord = w || "-";
	const safeMeaning = m || t("practice_no_meaning");
	const status = isCorrect ? t("practice_answer_status_correct") : t("practice_answer_status_answer");
	answerFlashEl.innerHTML = `<div class="answer-flash-card"><div class="status">${status}</div><span class="word">${safeWord}</span><span class="meaning">${safeMeaning}</span></div>`;
	answerFlashEl.classList.remove("show");
	void answerFlashEl.offsetWidth;
	answerFlashEl.classList.add("show");
	if (answerFlashTimer) clearTimeout(answerFlashTimer);
	answerFlashTimer = setTimeout(() => {
		answerFlashEl.classList.remove("show");
	}, 1650);
}

function getQuestionPool() {
	return PracticeUtilsRef.getQuestionPool(allWords);
}

function pickQuestionItem() {
	const pool = getQuestionPool();
	if (!pool.length) return null;
	return pool[Math.floor(Math.random() * pool.length)];
}

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeExampleText(example) {
	return PracticeUtilsRef.normalizeExampleText(example);
}

function buildClozeStimulus(word, examples) {
	return PracticeUtilsRef.buildClozeStimulus(word, examples);
}

function getModePrompt(mode) {
	if (mode === "cloze") return t("practice_mode_prompt_cloze");
	if (mode === "word2meaning") return t("practice_mode_prompt_word2meaning");
	return t("practice_mode_prompt_meaning2word");
}

function getModeBadge(mode) {
	if (mode === "cloze") return t("practice_badge_cloze");
	if (mode === "word2meaning") return t("practice_badge_comprehension");
	return t("practice_badge_recall");
}

function getSummaryTone(pct) {
	if (pct >= 90) return { badge: t("practice_tone_badge_90"), comment: t("practice_tone_comment_90") };
	if (pct >= 75) return { badge: t("practice_tone_badge_75"), comment: t("practice_tone_comment_75") };
	if (pct >= 55) return { badge: t("practice_tone_badge_55"), comment: t("practice_tone_comment_55") };
	return { badge: t("practice_tone_badge_low"), comment: t("practice_tone_comment_low") };
}

function burstAtElement(el, count) {
	if (!el || !celebrateEl) return;
	const elRect = el.getBoundingClientRect();
	const layerRect = celebrateEl.getBoundingClientRect();
	const cx = elRect.left + elRect.width / 2 - layerRect.left;
	const cy = elRect.top + elRect.height / 2 - layerRect.top;
	for (let i = 0; i < count; i += 1) {
		const dot = document.createElement("div");
		dot.className = "spark";
		dot.style.left = `${cx}px`;
		dot.style.top = `${cy}px`;
		const angle = Math.random() * Math.PI * 2;
		const r = 36 + Math.random() * 74;
		dot.style.setProperty("--tx", `${Math.cos(angle) * r}px`);
		dot.style.setProperty("--ty", `${Math.sin(angle) * r}px`);
		dot.style.background = ["#ffdd7a", "#ffb347", "#d3495f", "#f06b83"][i % 4];
		celebrateEl.appendChild(dot);
	}
	setTimeout(() => {
		celebrateEl.innerHTML = "";
	}, 820);
}

function animateStreakFx(isCorrect) {
	streakChip.classList.remove("streak-pop", "streak-drop");
	if (isCorrect) {
		void streakChip.offsetWidth;
		streakChip.classList.add("streak-pop");
		if (streak >= 3) {
			streakChip.classList.add("streak-fire");
		}
		if (streak === 3 || streak === 5 || (streak > 5 && streak % 5 === 0)) {
			burstAtElement(streakChip, 18);
		}
		if (streak >= 10 && streak % 10 === 0) {
			megaStreakCelebration(streak);
		}
		return;
	}
	streakChip.classList.remove("streak-fire");
	void streakChip.offsetWidth;
	streakChip.classList.add("streak-drop");
}

function megaStreakCelebration(combo) {
	if (!megaOverlayEl || !megaTextEl) return;
	const label = tf("practice_mega_combo", { combo: combo });
	megaTextEl.textContent = label;
	megaOverlayEl.classList.remove("active");
	void megaOverlayEl.offsetWidth;
	megaOverlayEl.classList.add("active");
	document.body.classList.add("mega-shake");
	burstAtElement(streakChip, 60);
	setTimeout(() => burstAtElement(streakChip, 40), 140);
	setTimeout(() => burstAtElement(streakChip, 34), 280);
	setTimeout(() => {
		megaOverlayEl.classList.remove("active");
		document.body.classList.remove("mega-shake");
	}, 980);
}

function updateChips(mode) {
	const current = qIndex + 1;
	const totalLabel = overtimeActive ? `${MAX_QUESTIONS}+` : MAX_QUESTIONS;
	progressChip.textContent = tf("practice_progress", { current: current, total: totalLabel });
	scoreChip.textContent = tf("practice_score_points", { score: score });
	streakChip.textContent = tf("practice_streak", { streak: streak });
	challengeChip.textContent = overtimeActive
		? t("practice_badge_overtime")
		: getModeBadge(mode);
	const done = Math.min(qIndex + (answered ? 1 : 0), MAX_QUESTIONS);
	const pct = overtimeActive ? 100 : (MAX_QUESTIONS ? (done / MAX_QUESTIONS) * 100 : 0);
	progressBar.style.width = `${pct}%`;
}

function playTone(ok) {
	try {
		const Ctx = window.AudioContext || window.webkitAudioContext;
		const ctx = new Ctx();
		const o1 = ctx.createOscillator();
		const g = ctx.createGain();
		o1.type = "sine";
		o1.frequency.value = ok ? 660 : 220;
		g.gain.value = 0.001;
		o1.connect(g);
		g.connect(ctx.destination);
		o1.start();
		g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.015);
		o1.frequency.exponentialRampToValueAtTime(ok ? 990 : 150, ctx.currentTime + 0.22);
		g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
		o1.stop(ctx.currentTime + 0.3);
	} catch (_) {}
}

function playWordPronunciation(word) {
	if (!word) return;
	try {
		const utterance = new SpeechSynthesisUtterance(word);
		WordStorage.getSourceLang().then((sourceLang) => {
			utterance.lang = sourceLang || "en";
			const voices = window.speechSynthesis.getVoices();
			for (let i = 0; i < voices.length; i += 1) {
				if (voices[i].lang === utterance.lang) {
					utterance.voice = voices[i];
					break;
				}
			}
			window.speechSynthesis.cancel();
			window.speechSynthesis.speak(utterance);
		}).catch(() => {
			window.speechSynthesis.cancel();
			window.speechSynthesis.speak(utterance);
		});
	} catch (_) {}
}

function translateText(text) {
	return WordStorage.getSourceLang().then((sourceLang) => (
		TranslationUtilsRef.requestRuntimeTranslation({
			chromeRuntime: chrome.runtime,
			text,
			sourceLang: sourceLang || "auto",
		})
	)).catch(() => "");
}

function burst() {
	celebrateEl.innerHTML = "";
	for (let i = 0; i < 16; i += 1) {
		const dot = document.createElement("div");
		dot.className = "spark";
		dot.style.left = "50%";
		dot.style.top = "40%";
		const angle = (Math.PI * 2 * i) / 16;
		const r = 70 + Math.random() * 120;
		dot.style.setProperty("--tx", `${Math.cos(angle) * r}px`);
		dot.style.setProperty("--ty", `${Math.sin(angle) * r}px`);
		dot.style.background = ["#7a1022", "#a81631", "#c12a46", "#d3495f"][i % 4];
		celebrateEl.appendChild(dot);
	}
	setTimeout(() => {
		celebrateEl.innerHTML = "";
	}, 740);
}

function burstSummary() {
	summaryCelebrateEl.innerHTML = "";
	for (let i = 0; i < 24; i += 1) {
		const dot = document.createElement("div");
		dot.className = "summary-spark";
		dot.style.left = `${20 + Math.random() * 60}%`;
		dot.style.top = `${15 + Math.random() * 55}%`;
		const angle = Math.random() * Math.PI * 2;
		const r = 50 + Math.random() * 110;
		dot.style.setProperty("--tx", `${Math.cos(angle) * r}px`);
		dot.style.setProperty("--ty", `${Math.sin(angle) * r}px`);
		dot.style.background = ["#7a1022", "#a81631", "#c12a46", "#d3495f"][i % 4];
		summaryCelebrateEl.appendChild(dot);
	}
	setTimeout(() => {
		summaryCelebrateEl.innerHTML = "";
	}, 820);
}

function buildQuestion(item) {
	const clozeStimulus = buildClozeStimulus(item.word, item.examples);
	const modes = clozeStimulus ? ["word2meaning", "meaning2word", "cloze"] : ["word2meaning", "meaning2word"];
	const pickedMode = modes[Math.floor(Math.random() * modes.length)];

	if (pickedMode === "cloze") {
		const answer = item.word;
		const wrong = chooseDistractors(allWords, "word", answer, CHOICE_COUNT - 1);
		return {
			mode: "cloze",
			word: item.word,
			stimulus: clozeStimulus,
			answer,
			choices: shuffle([answer].concat(wrong)),
		};
	}

	if (pickedMode === "word2meaning") {
		const answer = item.meaning;
		const wrong = chooseDistractors(allWords, "meaning", answer, CHOICE_COUNT - 1);
		return {
			mode: "word2meaning",
			word: item.word,
			stimulus: item.word,
			answer,
			choices: shuffle([answer].concat(wrong)),
		};
	}
	const answer = item.word;
	const wrong = chooseDistractors(allWords, "word", answer, CHOICE_COUNT - 1);
	return {
		mode: "meaning2word",
		word: item.word,
		stimulus: item.meaning,
		answer,
		choices: shuffle([answer].concat(wrong)),
	};
}

function renderQuestion() {
	if (qIndex >= deck.length) {
		if (overtimeActive && streak > 0) {
			const nextItem = pickQuestionItem();
			if (nextItem) {
				deck.push(buildQuestion(nextItem));
			} else {
				return finishRound();
			}
		} else {
			return finishRound();
		}
	}
	const q = deck[qIndex];
	if (!q) return finishRound();
	if (!practiceTourAttempted) {
		practiceTourAttempted = true;
		window.setTimeout(() => startPracticeTour(false), 220);
	}
	answered = false;
	cardEl.classList.remove("is-correct", "is-wrong");
	cardEl.classList.remove("is-entering");
	void cardEl.offsetWidth;
	cardEl.classList.add("is-entering");
	feedbackEl.textContent = "";
	feedbackEl.className = "feedback";
	nextBtn.style.display = "none";
	clozeTranslateBtn.style.display = "none";
	clozeTranslateBtn.disabled = false;
	clozeTranslateTextEl.style.display = "none";
	clozeTranslateTextEl.textContent = "";
	markLearnedBtn.style.display = "none";
	markLearnedBtn.disabled = false;
	markLearnedBtn.textContent = t("mark");
	promptEl.textContent = getModePrompt(q.mode);
	stimulusEl.textContent = q.stimulus;
	optionsEl.innerHTML = "";
	if (q.mode === "cloze") {
		clozeTranslateBtn.style.display = "";
	}
	updateChips(q.mode);

	q.choices.forEach((choice, idx) => {
		const btn = document.createElement("button");
		btn.className = "option";
		btn.dataset.idx = String(idx);
		const labelSpan = document.createElement("span");
		labelSpan.className = "option-label";
		labelSpan.textContent = `${String.fromCharCode(65 + idx)}.`;
		btn.appendChild(labelSpan);
		btn.appendChild(document.createTextNode(` ${choice}`));
		btn.addEventListener("click", () => {
			if (answered) return;
			answered = true;
			collectReviewedWord(q.word);
			const isOk = choice === q.answer;
			if (isOk) {
				score += 10;
				correctCount += 1;
				streak += 1;
				bestStreak = Math.max(bestStreak, streak);
				animateStreakFx(true);
				cardEl.classList.add("is-correct");
				feedbackEl.classList.add("ok");
				feedbackEl.textContent = t("practice_correct");
				btn.classList.add("is-correct");
				playTone(true);
				burst();
			} else {
				streak = 0;
				animateStreakFx(false);
				cardEl.classList.add("is-wrong");
				feedbackEl.classList.add("bad");
				feedbackEl.textContent = `${t("practice_wrong_prefix")} ${q.answer}`;
				btn.classList.add("is-wrong");
				playTone(false);
				const correctBtn = Array.from(optionsEl.children).find((x) => x.textContent.replace(/^[A-D]\.\s*/, "") === q.answer);
				if (correctBtn) correctBtn.classList.add("is-correct");
			}
			showAnswerFlash(q.word, getMeaningByWord(q.word), isOk);
			setTimeout(() => {
				playWordPronunciation(q.word);
			}, 320);
			Array.from(optionsEl.children).forEach((x) => { x.disabled = true; });
			if (!overtimeActive && (qIndex + 1) >= MAX_QUESTIONS && streak >= 5) {
				overtimeActive = true;
			}
			updateChips(q.mode);
			if (isOk) {
				markLearnedBtn.style.display = "";
			}
			nextBtn.style.display = "";
		});
		optionsEl.appendChild(btn);
	});
}

function markCurrentQuestionLearned() {
	const q = deck[qIndex];
	if (!q || !q.word) return;
	markLearnedBtn.disabled = true;
	WordStorage.getWords().then((words) => {
		if (!words[q.word]) return false;
		words[q.word].learned = true;
		return WordStorage.saveWords(words).then(() => true);
	}).then((saved) => {
		if (!saved) {
			markLearnedBtn.disabled = false;
			return;
		}
		const idx = allWords.findIndex((item) => item.word === q.word);
		if (idx !== -1) allWords[idx].learned = true;
		markLearnedBtn.textContent = t("saved");
	}).catch(() => {
		markLearnedBtn.disabled = false;
	});
}

function applySummaryLearnedWords() {
	if (!selectedLearnedWords.size) return;
	const wordsToSave = Array.from(selectedLearnedWords);
	applyLearnedWordsBtn.disabled = true;
	WordStorage.getWords().then((words) => {
		let changed = false;
		wordsToSave.forEach((word) => {
			if (!words[word]) return;
			if (!words[word].learned) {
				words[word].learned = true;
				changed = true;
			}
		});
		if (!changed) return true;
		return WordStorage.saveWords(words).then(() => true);
	}).then((saved) => {
		if (!saved) {
			updateApplyLearnedWordsBtn();
			return;
		}
		allWords = allWords.map((item) => (
			selectedLearnedWords.has(item.word) ? { ...item, learned: true } : item
		));
		selectedLearnedWords.clear();
		renderSummaryReviewedWords();
		applyLearnedWordsBtn.textContent = t("saved");
		applyLearnedWordsBtn.disabled = true;
	}).catch(() => {
		updateApplyLearnedWordsBtn();
	});
}

function finishRound() {
	cardEl.style.display = "none";
	summaryEl.style.display = "block";
	summaryTitleEl.textContent = t("practice_summary_title");
	const pct = deck.length ? Math.round((correctCount / deck.length) * 100) : 0;
	const tone = getSummaryTone(pct);
	summaryBadgeEl.textContent = tone.badge;
	summaryBigScoreEl.textContent = `${score} / ${deck.length * 10}`;
	summaryCommentEl.textContent = tone.comment;
	summaryTextEl.textContent = `${t("practice_summary_score")} ${score}/${deck.length * 10} (${pct}%)`;
	summaryAccuracyEl.textContent = `${pct}%`;
	summaryCorrectEl.textContent = `${correctCount}/${deck.length}`;
	summaryBestStreakEl.textContent = `x${bestStreak}`;
	renderSummaryReviewedWords();
	progressBar.style.width = "100%";
	overtimeActive = false;
	burstSummary();
}

function startRound() {
	const pool = getQuestionPool();
	reviewedWordsThisRound = [];
	selectedLearnedWords = new Set();
	if (pool.length < CHOICE_COUNT) {
		cardEl.style.display = "";
		summaryEl.style.display = "none";
		if (summaryReviewedEl) summaryReviewedEl.hidden = true;
		promptEl.textContent = "";
		stimulusEl.textContent = "";
		optionsEl.innerHTML = "";
		feedbackEl.className = "feedback bad";
		feedbackEl.textContent = t("practice_need_words");
		nextBtn.style.display = "none";
		markLearnedBtn.style.display = "none";
		clozeTranslateBtn.style.display = "none";
		clozeTranslateTextEl.style.display = "none";
		progressChip.textContent = tf("practice_progress", { current: 0, total: 0 });
		scoreChip.textContent = tf("practice_score_points", { score: 0 });
		streakChip.textContent = tf("practice_streak", { streak: 0 });
		challengeChip.textContent = t("practice_badge_overtime");
		progressBar.style.width = "0%";
		if (!practiceTourAttempted) {
			practiceTourAttempted = true;
			window.setTimeout(() => startPracticeNeedWordsTour(false), 220);
		}
		return;
	}
	const picked = shuffle(pool).slice(0, Math.min(MAX_QUESTIONS, pool.length));
	deck = picked.map((item) => buildQuestion(item));
	qIndex = 0;
	score = 0;
	correctCount = 0;
	streak = 0;
	bestStreak = 0;
	overtimeActive = false;
	cardEl.style.display = "";
	summaryEl.style.display = "none";
	if (summaryReviewedEl) summaryReviewedEl.hidden = true;
	renderQuestion();
}

function init() {
	return Promise.all([
		WordStorage.getUiLanguage().catch(() => "en"),
		WordStorage.getWords(),
	]).then(([lang, wordsObj]) => {
		uiLang = lang || "en";
		document.documentElement.lang = UiI18n.langAttr(uiLang);
		document.documentElement.dir = UiI18n.dir(uiLang);
		document.title = t("practice_mode");
		if (helpBtn && globalThis.UiTour) {
			helpBtn.title = UiTour.getLabel(uiLang, "replay");
			helpBtn.setAttribute("aria-label", UiTour.getLabel(uiLang, "replay"));
		}
		const words = Object.entries(wordsObj || {})
			.map(([word, data]) => ({
				word,
				meaning: (data && data.meaning) || "",
				examples: Array.isArray(data && data.examples) ? data.examples : [],
				learned: !!(data && data.learned),
			}))
			.filter((x) => x.word && x.meaning && !x.learned);

		allWords = words;
		titleEl.textContent = t("practice_mode");
		subtitleEl.textContent = tf("practice_subtitle_challenge", { questions: MAX_QUESTIONS, points: 10 });
		closeBtn.textContent = t("close_tab");
		nextBtn.textContent = t("practice_next");
		markLearnedBtn.textContent = t("mark");
		clozeTranslateBtn.textContent = t("practice_show_translation");
		nextRoundBtn.textContent = t("practice_next_round");
		summaryTitleEl.textContent = t("practice_summary_title");
		summaryBadgeEl.textContent = t("practice_round_complete");
		summaryAccuracyLabelEl.textContent = t("practice_metric_accuracy");
		summaryCorrectLabelEl.textContent = t("practice_metric_correct");
		summaryBestStreakLabelEl.textContent = t("practice_metric_best_streak");
		if (summaryReviewedTitleEl) summaryReviewedTitleEl.textContent = t("practice_reviewed_words");
		if (summaryReviewedDescEl) summaryReviewedDescEl.textContent = t("practice_reviewed_words_desc");
		updateApplyLearnedWordsBtn();

		if (allWords.length < CHOICE_COUNT) {
			promptEl.textContent = "";
			stimulusEl.textContent = "";
			optionsEl.innerHTML = "";
			feedbackEl.className = "feedback bad";
			feedbackEl.textContent = t("practice_need_words");
			progressChip.textContent = tf("practice_progress", { current: 0, total: 0 });
			scoreChip.textContent = tf("practice_score_points", { score: 0 });
			streakChip.textContent = tf("practice_streak", { streak: 0 });
			challengeChip.textContent = t("practice_badge_overtime");
			progressBar.style.width = "0%";
			nextBtn.style.display = "none";
			markLearnedBtn.style.display = "none";
			if (!practiceTourAttempted) {
				practiceTourAttempted = true;
				window.setTimeout(() => startPracticeNeedWordsTour(false), 220);
			}
			return;
		}

		startRound();
	}).catch(() => {
		document.documentElement.lang = UiI18n.langAttr(uiLang);
		document.documentElement.dir = UiI18n.dir(uiLang);
		document.title = t("practice_mode");
		feedbackEl.className = "feedback bad";
		feedbackEl.textContent = t("practice_load_failed");
	});
}

nextBtn.addEventListener("click", () => {
	qIndex += 1;
	renderQuestion();
});
clozeTranslateBtn.addEventListener("click", () => {
	const q = deck[qIndex];
	if (!q || q.mode !== "cloze" || !q.stimulus) return;
	clozeTranslateBtn.style.display = "none";
	clozeTranslateTextEl.style.display = "";
	clozeTranslateTextEl.className = "feedback";
	clozeTranslateTextEl.textContent = t("loading_translation");
	translateText(q.stimulus).then((translated) => {
		clozeTranslateTextEl.className = translated ? "feedback ok" : "feedback bad";
		clozeTranslateTextEl.textContent = translated || t("dict_search_failed");
	}).catch(() => {
		clozeTranslateTextEl.className = "feedback bad";
		clozeTranslateTextEl.textContent = t("dict_search_failed");
	});
});
markLearnedBtn.addEventListener("click", markCurrentQuestionLearned);
nextRoundBtn.addEventListener("click", () => {
	startRound();
});
if (applyLearnedWordsBtn) {
	applyLearnedWordsBtn.addEventListener("click", applySummaryLearnedWords);
}
document.addEventListener("keydown", (event) => {
	if (summaryEl.style.display !== "none") {
		if (event.key === "Enter") {
			startRound();
		}
		return;
	}
	if (nextBtn.style.display !== "none" && event.key === "Enter") {
		qIndex += 1;
		renderQuestion();
		return;
	}
	if (answered) return;
	const raw = (event.key || "").toLowerCase();
	const indexByNumber = ["1", "2", "3", "4"].indexOf(raw);
	const indexByAlpha = ["a", "b", "c", "d"].indexOf(raw);
	const idx = indexByNumber !== -1 ? indexByNumber : indexByAlpha;
	if (idx === -1) return;
	const target = optionsEl.querySelector(`.option[data-idx="${idx}"]`);
	if (target) target.click();
});
closeBtn.addEventListener("click", () => window.close());
if (helpBtn) {
	helpBtn.addEventListener("click", () => {
		if (!globalThis.UiTour) return;
		const hasEnoughWords = Array.isArray(allWords) && allWords.length >= CHOICE_COUNT;
		const storageKey = hasEnoughWords ? "practice_v1" : "practice_need_words_v1";
		UiTour.reset(storageKey).then(() => {
			window.setTimeout(() => {
				if (hasEnoughWords) {
					startPracticeTour(true);
					return;
				}
				startPracticeNeedWordsTour(true);
			}, 40);
		});
	});
}

document.addEventListener("DOMContentLoaded", init);
