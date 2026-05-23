(function (global) {
	"use strict";

	function findFile(zip, path) {
		if (!path) return null;
		const norm = path.replace(/^\//, "");
		if (zip.files[norm]) return zip.files[norm];
		const lower = norm.toLowerCase();
		const keys = Object.keys(zip.files);
		for (let i = 0; i < keys.length; i++) {
			if (keys[i].toLowerCase() === lower) return zip.files[keys[i]];
		}
		return null;
	}

	function resolveHref(baseDir, rel) {
		if (!rel) return rel;
		if (/^https?:\/\//i.test(rel)) return rel;
		if (/^[^/]/.test(rel) && baseDir) {
			const parts = (baseDir + rel).split("/");
			const out = [];
			for (let i = 0; i < parts.length; i++) {
				if (parts[i] === "..") { out.pop(); }
				else if (parts[i] !== ".") { out.push(parts[i]); }
			}
			return out.join("/");
		}
		return rel.replace(/^\//, "");
	}

	function parseXml(str) {
		return new DOMParser().parseFromString(str, "application/xml");
	}

	async function readText(zip, path) {
		const f = findFile(zip, path);
		if (!f) throw new Error("epub-parser: file not found: " + path);
		return f.async("string");
	}

	async function parse(zip) {
		// 1. container.xml → OPF path
		const containerXml = await readText(zip, "META-INF/container.xml");
		const containerDoc = parseXml(containerXml);
		const rootfileEl = containerDoc.querySelector("rootfile");
		if (!rootfileEl) throw new Error("epub-parser: no rootfile in container.xml");
		const opfPath = rootfileEl.getAttribute("full-path");
		if (!opfPath) throw new Error("epub-parser: rootfile has no full-path");

		const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

		// 2. Parse OPF
		const opfXml = await readText(zip, opfPath);
		const opfDoc = parseXml(opfXml);

		const titleEl = opfDoc.querySelector("title");
		const title = titleEl ? titleEl.textContent.trim() : "";
		const langEl = opfDoc.querySelector("language");
		const language = langEl ? langEl.textContent.trim().split("-")[0] : "en";

		// 3. Build manifest map id → href (relative to opfDir)
		const manifestMap = {};
		opfDoc.querySelectorAll("manifest item").forEach(function (item) {
			const id = item.getAttribute("id");
			const href = item.getAttribute("href");
			const mediaType = item.getAttribute("media-type") || "";
			if (id && href) manifestMap[id] = { href: href, mediaType: mediaType };
		});

		// 4. Spine → chapter list
		const spineItems = opfDoc.querySelectorAll("spine itemref");
		const chapters = [];
		spineItems.forEach(function (itemref) {
			const idref = itemref.getAttribute("idref");
			if (!idref || !manifestMap[idref]) return;
			chapters.push({ id: idref, href: manifestMap[idref].href, opfDir: opfDir, title: "" });
		});

		// 5. Try to get chapter titles from NCX (ePub2) or nav (ePub3)
		let tocFound = false;
		try {
			tocFound = await enrichChapterTitles(zip, opfDoc, opfDir, manifestMap, chapters);
		} catch (e) {
			// fallback: titles remain empty → will use index
		}

		// Fill missing titles: try HTML <title> (skip if same as book title), then prettified filename
		const missingTitle = chapters.filter(function (ch) { return !ch.title; });
		if (missingTitle.length > 0) {
			await Promise.all(missingTitle.map(async function (ch) {
				try {
					const html = await readText(zip, resolveHref(ch.opfDir, ch.href));
					const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
					const htmlTitle = m ? m[1].trim() : "";
					if (htmlTitle && htmlTitle !== title) { ch.title = htmlTitle; return; }
				} catch (e) { /* ignore */ }
				// Fallback: filename without extension, replace _ with space
				const filename = ch.href.replace(/^.*\//, "").replace(/\.[^.]+$/, "").replace(/_/g, " ");
				ch.title = filename || ("Chapter " + (chapters.indexOf(ch) + 1));
			}));
		}

		function getChapterContent(href, dir) {
			const fullPath = resolveHref(dir || opfDir, href);
			return readText(zip, fullPath);
		}

		function getFileAsBlob(href, dir) {
			const fullPath = resolveHref(dir || opfDir, href);
			const f = findFile(zip, fullPath);
			if (!f) return Promise.reject(new Error("epub-parser: blob not found: " + fullPath));
			return f.async("blob");
		}

		// Extract cover image as data URL (for bookshelf thumbnail)
		async function getCoverDataUrl() {
			try {
				// Look for cover in manifest: id="cover-image" or properties="cover-image"
				let coverHref = null;
				opfDoc.querySelectorAll("manifest item").forEach(function (item) {
					if (coverHref) return;
					const props = item.getAttribute("properties") || "";
					const id = item.getAttribute("id") || "";
					const mt = item.getAttribute("media-type") || "";
					if (
						(props.split(/\s+/).indexOf("cover-image") !== -1 ||
						id.toLowerCase().includes("cover")) &&
						mt.startsWith("image/")
					) {
						coverHref = item.getAttribute("href");
					}
				});
				// Fallback: look for <meta name="cover"> pointing to a manifest item
				if (!coverHref) {
					const metaCover = opfDoc.querySelector('meta[name="cover"]');
					const coverId = metaCover && metaCover.getAttribute("content");
					if (coverId && manifestMap[coverId]) coverHref = manifestMap[coverId].href;
				}
				if (!coverHref) return null;
				const blob = await getFileAsBlob(coverHref, opfDir);
				return new Promise(function (resolve) {
					const reader = new FileReader();
					reader.onload = function () { resolve(reader.result); };
					reader.onerror = function () { resolve(null); };
					reader.readAsDataURL(blob);
				});
			} catch (_) { return null; }
		}

		return { title: title, language: language, chapters: chapters, getChapterContent: getChapterContent, getFileAsBlob: getFileAsBlob, getCoverDataUrl: getCoverDataUrl };
	}

	async function enrichChapterTitles(zip, opfDoc, opfDir, manifestMap, chapters) {
		// Build href → chapter index map
		const hrefIndex = {};
		chapters.forEach(function (ch, i) { hrefIndex[ch.href] = i; });

		// Try ePub3 nav document first
		let navItem = null;
		opfDoc.querySelectorAll("manifest item").forEach(function (item) {
			if ((item.getAttribute("properties") || "").split(/\s+/).indexOf("nav") !== -1) {
				navItem = item;
			}
		});

		if (navItem) {
			const navHref = navItem.getAttribute("href");
			const navPath = resolveHref(opfDir, navHref);
			const navXml = await readText(zip, navPath);
			const navDoc = new DOMParser().parseFromString(navXml, "text/html");
			const tocNav = navDoc.querySelector('nav[epub\\:type="toc"], nav[id="toc"]') || navDoc.querySelector("nav");
			if (tocNav) {
				tocNav.querySelectorAll("a").forEach(function (a) {
					const href = (a.getAttribute("href") || "").split("#")[0];
					const resolved = resolveHref(opfDir, resolveHref(navHref.includes("/") ? navHref.slice(0, navHref.lastIndexOf("/") + 1) : "", href));
					// normalise to opfDir-relative
					const rel = resolved.startsWith(opfDir) ? resolved.slice(opfDir.length) : resolved;
					if (rel in hrefIndex) {
						chapters[hrefIndex[rel]].title = a.textContent.trim() || chapters[hrefIndex[rel]].title;
					}
				});
				return true;
			}
		}

		// Try NCX (ePub2)
		let ncxItem = null;
		opfDoc.querySelectorAll("manifest item").forEach(function (item) {
			if ((item.getAttribute("media-type") || "") === "application/x-dtbncx+xml") {
				ncxItem = item;
			}
		});
		// Also check spine toc attribute
		const spineEl = opfDoc.querySelector("spine");
		const spineToc = spineEl ? spineEl.getAttribute("toc") : null;
		if (!ncxItem && spineToc && manifestMap[spineToc]) {
			ncxItem = { getAttribute: function (k) { return k === "href" ? manifestMap[spineToc].href : null; } };
		}

		if (ncxItem) {
			const ncxHref = ncxItem.getAttribute("href");
			const ncxPath = resolveHref(opfDir, ncxHref);
			const ncxXml = await readText(zip, ncxPath);
			const ncxDoc = parseXml(ncxXml);
			ncxDoc.querySelectorAll("navPoint").forEach(function (np) {
				const contentEl = np.querySelector("content");
				const labelEl = np.querySelector("navLabel text");
				if (!contentEl || !labelEl) return;
				const src = (contentEl.getAttribute("src") || "").split("#")[0];
				const resolved = resolveHref(opfDir, resolveHref(ncxHref.includes("/") ? ncxHref.slice(0, ncxHref.lastIndexOf("/") + 1) : "", src));
				const rel = resolved.startsWith(opfDir) ? resolved.slice(opfDir.length) : resolved;
				if (rel in hrefIndex) {
					chapters[hrefIndex[rel]].title = labelEl.textContent.trim() || chapters[hrefIndex[rel]].title;
				}
			});
			return true;
		}
		return false;
	}

	global.EpubParser = { parse: parse, findFile: findFile, resolveHref: resolveHref };
})(globalThis);
