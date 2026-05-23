import init, { segment, get_sentence_boundaries } from "../packages/sentencex_wasm.js";
globalThis._sentencexWasmReady = init().then(() => {
	globalThis.SentencexWasm = { segment, get_sentence_boundaries };
	return globalThis.SentencexWasm;
}).catch(() => null);
