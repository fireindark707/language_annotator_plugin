// mobi-adapter.js — ES module loaded as <script type="module">
// Wraps foliate-js MOBI into the same interface as EpubParser.
import { MOBI, isMOBI } from '../packages/mobi.js';

// Use browser DecompressionStream for zlib (needed for KF8 embedded fonts).
// Gracefully degrades if unavailable — fonts simply won't load.
async function unzlib(data) {
    try {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const reader = stream.getReader();
        const chunks = [];
        let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.length;
        }
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return out.buffer;
    } catch (_) {
        return data instanceof ArrayBuffer ? data : data.buffer || data;
    }
}

// language may be an array (EXTH record 524 allows multiple); take first string value
function resolveLanguage(lang) {
    if (!lang) return 'en';
    if (Array.isArray(lang)) lang = lang[0] || 'en';
    return String(lang).trim() || 'en';
}

// Flatten nested TOC entries preserving order.
function flattenToc(entries) {
    const flat = [];
    function walk(items) {
        for (const entry of items || []) {
            flat.push(entry);
            walk(entry.subitems);
        }
    }
    walk(entries);
    return flat;
}

// Extract filepos number from a MOBI TOC href ("filepos:NNNN").
function tocHrefToFilepos(href) {
    const m = (href || '').match(/filepos:(\d+)/);
    return m ? Number(m[1]) : null;
}

// Build chapters from TOC entries when the TOC is richer than raw sections.
// Each TOC entry maps to a virtual chapter backed by a specific section + anchor.
function buildTocChapters(toc, instance, sections) {
    const flat = flattenToc(toc);
    if (!flat.length) return null;

    // Resolve each TOC entry → { sectionIdx, filepos, anchorId }
    const resolved = [];
    for (const entry of flat) {
        try {
            const [sectionIdx, anchorId] = instance.splitTOCHref(entry.href);
            const filepos = tocHrefToFilepos(entry.href);
            if (typeof sectionIdx === 'number' && sectionIdx >= 0 && sectionIdx < sections.length) {
                resolved.push({
                    label: (entry.label || '').trim() || null,
                    sectionIdx,
                    filepos,
                    anchorId: anchorId || null,
                });
            }
        } catch (_) {}
    }
    if (!resolved.length) return null;

    // If TOC is richer than sections, build virtual chapters from TOC.
    // Sort by (sectionIdx, filepos) to ensure correct order.
    resolved.sort(function (a, b) {
        if (a.sectionIdx !== b.sectionIdx) return a.sectionIdx - b.sectionIdx;
        return (a.filepos || 0) - (b.filepos || 0);
    });

    return resolved.map(function (r, i) {
        return {
            id: 'mobi-toc-' + i,
            title: r.label || ('Chapter ' + (i + 1)),
            href: 'mobi-toc-' + i,
            opfDir: '',
            _sectionIdx: r.sectionIdx,
            _anchorId: r.anchorId,
            _filepos: r.filepos || 0,  // for reverse lookup from in-content filepos: links
        };
    });
}

// Extract HTML content from a section starting at a given anchor element.
// Returns the full section HTML when anchorId is null (first chapter).
function sliceFromAnchor(html, anchorId) {
    if (!anchorId) return html;
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const anchor = doc.getElementById(anchorId);
        if (!anchor) return html;
        // Collect all following siblings (and the anchor's parent block) as a fragment
        // Simple approach: serialize body from the anchor's position
        const body = doc.body;
        // Find topmost ancestor of anchor that is a direct body child
        let node = anchor;
        while (node.parentElement && node.parentElement !== body) node = node.parentElement;
        // Collect node and all following siblings
        const parts = [];
        let cur = node;
        while (cur) {
            parts.push(cur.outerHTML || '');
            cur = cur.nextElementSibling;
        }
        return parts.join('\n');
    } catch (_) {
        return html;
    }
}

async function parse(fileOrBuffer) {
    let file;
    if (fileOrBuffer instanceof ArrayBuffer || ArrayBuffer.isView(fileOrBuffer)) {
        file = new Blob([fileOrBuffer]);
    } else {
        file = fileOrBuffer; // File or Blob
    }

    const mobi = new MOBI({ unzlib });
    const instance = await mobi.open(file);   // returns MOBI6 or KF8

    const sections = instance.sections || [];
    const meta = instance.metadata || {};
    const tocEntries = instance.toc || [];

    // Cache loaded section blob URLs to avoid re-fetching the same section for TOC-based chapters
    const sectionHtmlCache = new Map();
    async function getSectionHtml(idx) {
        if (sectionHtmlCache.has(idx)) return sectionHtmlCache.get(idx);
        const blobUrl = await sections[idx].load();
        const html = await fetch(blobUrl).then(function (r) { return r.text(); });
        sectionHtmlCache.set(idx, html);
        return html;
    }

    // Prefer TOC-based chapters when the TOC has more entries than sections,
    // or when there is only 1 section (single-blob MOBI6 book).
    let chapters;
    let chapterMeta = null; // extra per-chapter data for TOC-based chapters

    const tocChapters = buildTocChapters(tocEntries, instance, sections);
    if (tocChapters && (tocChapters.length > sections.length || sections.length <= 1)) {
        chapters = tocChapters;
        chapterMeta = tocChapters; // holds _sectionIdx, _anchorId
    } else {
        // Fallback: one chapter per section, titles from TOC mapping
        const titles = new Array(sections.length).fill(null);
        // First filepos for each section (for filepos: link resolution)
        const sectionFilepos = new Array(sections.length).fill(null);
        if (tocChapters) {
            for (const ch of tocChapters) {
                if (titles[ch._sectionIdx] === null) titles[ch._sectionIdx] = ch.title;
                if (sectionFilepos[ch._sectionIdx] === null && typeof ch._filepos === 'number') {
                    sectionFilepos[ch._sectionIdx] = ch._filepos;
                }
            }
        }
        chapters = sections.map(function (_, i) {
            return {
                id: 'mobi-ch-' + i,
                title: titles[i] || ('Chapter ' + (i + 1)),
                href: 'mobi-section-' + i,
                opfDir: '',
                _filepos: typeof sectionFilepos[i] === 'number' ? sectionFilepos[i] : i * 1000000,
            };
        });
    }

    return {
        title: (typeof meta.title === 'string' ? meta.title : String(meta.title || '')).trim() || 'Unknown',
        language: resolveLanguage(meta.language),
        chapters,

        getChapterContent: async function (href) {
            if (href.startsWith('mobi-toc-')) {
                const idx = parseInt(href.replace('mobi-toc-', ''), 10);
                const ch = chapterMeta && chapterMeta[idx];
                if (!ch) throw new Error('MOBI TOC chapter not found: ' + href);
                const html = await getSectionHtml(ch._sectionIdx);
                return sliceFromAnchor(html, ch._anchorId);
            }
            // Section-based href
            const idx = parseInt(href.replace('mobi-section-', ''), 10);
            if (isNaN(idx) || idx < 0 || idx >= sections.length) {
                throw new Error('MOBI section not found: ' + href);
            }
            return getSectionHtml(idx);
        },

        getFileAsBlob: function () {
            // MOBI images are resolved inline by getChapterContent; direct access not needed.
            return Promise.reject(new Error('getFileAsBlob not supported for MOBI'));
        },

        getCoverDataUrl: async function () {
            if (typeof instance.getCover !== 'function') return null;
            const blob = await instance.getCover().catch(function () { return null; });
            if (!blob) return null;
            return new Promise(function (resolve) {
                const reader = new FileReader();
                reader.onload = function () { resolve(reader.result); };
                reader.onerror = function () { resolve(null); };
                reader.readAsDataURL(blob);
            });
        },

        destroy: function () {
            sectionHtmlCache.clear();
            if (typeof instance.destroy === 'function') instance.destroy();
        },
    };
}

globalThis.MobiParser = { parse, isMOBI };
