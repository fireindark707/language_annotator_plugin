(function (global) {
	"use strict";

	const DB_NAME = "epubShelf";
	const DB_VERSION = 1;
	const STORE_BOOKS = "books";

	function openDb() {
		return new Promise(function (resolve, reject) {
			const req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = function (e) {
				const db = e.target.result;
				if (!db.objectStoreNames.contains(STORE_BOOKS)) {
					const store = db.createObjectStore(STORE_BOOKS, { keyPath: "bookHash" });
					store.createIndex("dateAdded", "dateAdded", { unique: false });
				}
			};
			req.onsuccess = function (e) { resolve(e.target.result); };
			req.onerror = function (e) { reject(e.target.error); };
		});
	}

	function tx(db, mode, fn) {
		return new Promise(function (resolve, reject) {
			const t = db.transaction([STORE_BOOKS], mode);
			const store = t.objectStore(STORE_BOOKS);
			const req = fn(store);
			if (req && typeof req.onsuccess !== "undefined") {
				req.onsuccess = function (e) { resolve(e.target.result); };
				req.onerror = function (e) { reject(e.target.error); };
			} else {
				t.oncomplete = function () { resolve(); };
				t.onerror = function (e) { reject(e.target.error); };
			}
		});
	}

	// Save or update a book entry. buffer is the epub ArrayBuffer.
	async function saveBook(bookHash, meta, buffer) {
		const db = await openDb();
		const existing = await getBookMeta(bookHash).catch(function () { return null; });
		const entry = Object.assign({}, existing || {}, meta, {
			bookHash: bookHash,
			dateAdded: existing ? existing.dateAdded : Date.now(),
			dateRead: Date.now(),
			buffer: buffer,
		});
		await tx(db, "readwrite", function (store) { return store.put(entry); });
	}

	// Get all books, sorted by dateRead descending, without buffer (for listing)
	async function listBooks() {
		const db = await openDb();
		return new Promise(function (resolve, reject) {
			const t = db.transaction([STORE_BOOKS], "readonly");
			const store = t.objectStore(STORE_BOOKS);
			const req = store.getAll();
			req.onsuccess = function (e) {
				const books = (e.target.result || []).map(function (b) {
					const { buffer: _buf, ...meta } = b;
					return meta;
				});
				books.sort(function (a, b) { return (b.dateRead || 0) - (a.dateRead || 0); });
				resolve(books);
			};
			req.onerror = function (e) { reject(e.target.error); };
		});
	}

	// Get book metadata without buffer
	async function getBookMeta(bookHash) {
		const db = await openDb();
		return new Promise(function (resolve, reject) {
			const t = db.transaction([STORE_BOOKS], "readonly");
			const store = t.objectStore(STORE_BOOKS);
			const req = store.get(bookHash);
			req.onsuccess = function (e) {
				if (!e.target.result) { resolve(null); return; }
				const { buffer: _buf, ...meta } = e.target.result;
				resolve(meta);
			};
			req.onerror = function (e) { reject(e.target.error); };
		});
	}

	// Get the epub ArrayBuffer for a book
	async function getBookBuffer(bookHash) {
		const db = await openDb();
		return new Promise(function (resolve, reject) {
			const t = db.transaction([STORE_BOOKS], "readonly");
			const store = t.objectStore(STORE_BOOKS);
			const req = store.get(bookHash);
			req.onsuccess = function (e) {
				resolve(e.target.result ? e.target.result.buffer : null);
			};
			req.onerror = function (e) { reject(e.target.error); };
		});
	}

	async function removeBook(bookHash) {
		const db = await openDb();
		await tx(db, "readwrite", function (store) { return store.delete(bookHash); });
	}

	async function updateReadState(bookHash, chapterIndex, scrollTop) {
		const db = await openDb();
		return new Promise(function (resolve, reject) {
			const t = db.transaction([STORE_BOOKS], "readwrite");
			const store = t.objectStore(STORE_BOOKS);
			const req = store.get(bookHash);
			req.onsuccess = function (e) {
				const entry = e.target.result;
				if (!entry) { resolve(); return; }
				entry.lastChapter = chapterIndex;
				entry.lastScrollTop = scrollTop;
				entry.dateRead = Date.now();
				const putReq = store.put(entry);
				putReq.onsuccess = function () { resolve(); };
				putReq.onerror = function (ev) { reject(ev.target.error); };
			};
			req.onerror = function (e) { reject(e.target.error); };
		});
	}

	global.EpubShelf = { saveBook, listBooks, getBookMeta, getBookBuffer, removeBook, updateReadState };
})(globalThis);
