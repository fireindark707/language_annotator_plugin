let uiLang = "zh-TW";
let allWords = [];
let deck = [];
let qIndex = 0;
let score = 0;
let answered = false;

const MAX_QUESTIONS = 15;
const CHOICE_COUNT = 4;

const titleEl = document.getElementById("title");
const subtitleEl = document.getElementById("subtitle");
const closeBtn = document.getElementById("closeBtn");
const progressChip = document.getElementById("progressChip");
const scoreChip = document.getElementById("scoreChip");
const modeChip = document.getElementById("modeChip");
const promptEl = document.getElementById("prompt");
const stimulusEl = document.getElementById("stimulus");
const optionsEl = document.getElementById("options");
const feedbackEl = document.getElementById("feedback");
const nextBtn = document.getElementById("nextBtn");
const cardEl = document.getElementById("card");
const summaryEl = document.getElementById("summary");
const summaryTitleEl = document.getElementById("summaryTitle");
const summaryTextEl = document.getElementById("summaryText");
const nextRoundBtn = document.getElementById("nextRoundBtn");
const celebrateEl = document.getElementById("celebrate");

function t(key) {
	return UiI18n.t(uiLang, key);
}

function shuffle(arr) {
	const list = arr.slice();
	for (let i = list.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		[list[i], list[j]] = [list[j], list[i]];
	}
	return list;
}

function chooseDistractors(base, field, answer, count) {
	const pool = shuffle(base.filter((x) => x[field] && x[field] !== answer));
	return pool.slice(0, count).map((x) => x[field]);
}

function updateChips(modeText) {
	progressChip.textContent = `${Math.min(qIndex + 1, deck.length)} / ${deck.length}`;
	scoreChip.textContent = `${t("practice_score")} ${score}`;
	modeChip.textContent = modeText;
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
		dot.style.background = ["#d91f26", "#ffd166", "#06d6a0", "#118ab2"][i % 4];
		celebrateEl.appendChild(dot);
	}
	setTimeout(() => {
		celebrateEl.innerHTML = "";
	}, 740);
}

function buildQuestion(item) {
	const askWord = Math.random() < 0.5;
	if (askWord) {
		const answer = item.meaning;
		const wrong = chooseDistractors(allWords, "meaning", answer, CHOICE_COUNT - 1);
		return {
			prompt: t("practice_prompt_word_to_meaning"),
			mode: "word2meaning",
			stimulus: item.word,
			answer,
			choices: shuffle([answer].concat(wrong)),
		};
	}
	const answer = item.word;
	const wrong = chooseDistractors(allWords, "word", answer, CHOICE_COUNT - 1);
	return {
		prompt: t("practice_prompt_meaning_to_word"),
		mode: "meaning2word",
		stimulus: item.meaning,
		answer,
		choices: shuffle([answer].concat(wrong)),
	};
}

function renderQuestion() {
	const q = deck[qIndex];
	if (!q) return finishRound();
	answered = false;
	cardEl.classList.remove("is-correct", "is-wrong");
	feedbackEl.textContent = "";
	feedbackEl.className = "feedback";
	nextBtn.style.display = "none";
	promptEl.textContent = q.prompt;
	stimulusEl.textContent = q.stimulus;
	optionsEl.innerHTML = "";
	updateChips(
		q.mode === "word2meaning"
			? t("practice_prompt_word_to_meaning")
			: t("practice_prompt_meaning_to_word")
	);

	q.choices.forEach((choice) => {
		const btn = document.createElement("button");
		btn.className = "option";
		btn.textContent = choice;
		btn.addEventListener("click", () => {
			if (answered) return;
			answered = true;
			const isOk = choice === q.answer;
			if (isOk) {
				score += 1;
				cardEl.classList.add("is-correct");
				feedbackEl.classList.add("ok");
				feedbackEl.textContent = t("practice_correct");
				btn.classList.add("is-correct");
				playTone(true);
				burst();
			} else {
				cardEl.classList.add("is-wrong");
				feedbackEl.classList.add("bad");
				feedbackEl.textContent = `${t("practice_wrong_prefix")} ${q.answer}`;
				btn.classList.add("is-wrong");
				playTone(false);
				const correctBtn = Array.from(optionsEl.children).find((x) => x.textContent === q.answer);
				if (correctBtn) correctBtn.classList.add("is-correct");
			}
			Array.from(optionsEl.children).forEach((x) => { x.disabled = true; });
			updateChips(
				q.mode === "word2meaning"
					? t("practice_prompt_word_to_meaning")
					: t("practice_prompt_meaning_to_word")
			);
			nextBtn.style.display = "";
		});
		optionsEl.appendChild(btn);
	});
}

function finishRound() {
	cardEl.style.display = "none";
	summaryEl.style.display = "block";
	summaryTitleEl.textContent = t("practice_summary_title");
	const pct = deck.length ? Math.round((score / deck.length) * 100) : 0;
	summaryTextEl.textContent = `${t("practice_summary_score")} ${score}/${deck.length} (${pct}%)`;
}

function startRound() {
	const picked = shuffle(allWords).slice(0, Math.min(MAX_QUESTIONS, allWords.length));
	deck = picked.map((item) => buildQuestion(item));
	qIndex = 0;
	score = 0;
	cardEl.style.display = "";
	summaryEl.style.display = "none";
	renderQuestion();
}

function init() {
	Promise.all([
		WordStorage.getUiLanguage().catch(() => "en"),
		WordStorage.getWords(),
	]).then(([lang, wordsObj]) => {
		uiLang = lang || "en";
		const words = Object.entries(wordsObj || {})
			.map(([word, data]) => ({
				word,
				meaning: (data && data.meaning) || "",
				learned: !!(data && data.learned),
			}))
			.filter((x) => x.word && x.meaning && !x.learned);

		allWords = words;
		titleEl.textContent = t("practice_mode");
		subtitleEl.textContent = t("practice_subtitle");
		closeBtn.textContent = t("close_tab");
		nextBtn.textContent = t("practice_next");
		nextRoundBtn.textContent = t("practice_next_round");
		summaryTitleEl.textContent = t("practice_summary_title");

		if (allWords.length < CHOICE_COUNT) {
			promptEl.textContent = "";
			stimulusEl.textContent = "";
			optionsEl.innerHTML = "";
			feedbackEl.className = "feedback bad";
			feedbackEl.textContent = t("practice_need_words");
			progressChip.textContent = "0 / 0";
			scoreChip.textContent = `${t("practice_score")} 0`;
			modeChip.textContent = "-";
			nextBtn.style.display = "none";
			return;
		}
		startRound();
	}).catch(() => {
		feedbackEl.className = "feedback bad";
		feedbackEl.textContent = t("practice_load_failed");
	});
}

nextBtn.addEventListener("click", () => {
	qIndex += 1;
	renderQuestion();
});
nextRoundBtn.addEventListener("click", () => {
	startRound();
});
closeBtn.addEventListener("click", () => window.close());

document.addEventListener("DOMContentLoaded", init);
