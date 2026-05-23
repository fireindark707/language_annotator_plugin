// pdf-adapter.js — ES module loaded as <script type="module">
// Wraps pdf.js into the same interface as EpubParser / MobiParser.
import * as pdfjsLib from '../packages/pdfjs/pdf.min.mjs';

(function () {
    let workerSrc;
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        workerSrc = chrome.runtime.getURL('packages/pdfjs/pdf.worker.min.mjs');
    } else {
        // Resolve absolute URL relative to this module's location
        workerSrc = new URL('../packages/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
})();

async function isPDF(blobOrFile) {
    try {
        const buf = await blobOrFile.slice(0, 5).arrayBuffer();
        const b = new Uint8Array(buf);
        // PDF magic: %PDF
        return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
    } catch (_) { return false; }
}

async function parse(fileOrBuffer) {
    let data;
    if (fileOrBuffer instanceof ArrayBuffer || ArrayBuffer.isView(fileOrBuffer)) {
        const ab = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : fileOrBuffer.buffer;
        // Always copy: pdf.js may transfer the ArrayBuffer to a Worker (detaching it),
        // which would make the original buffer unusable for IndexedDB storage.
        data = ab.slice(0);
    } else {
        data = await fileOrBuffer.arrayBuffer();
    }

    const loadingTask = pdfjsLib.getDocument({ data });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    // Metadata
    let title = '', language = 'en';
    try {
        const meta = await pdfDoc.getMetadata();
        title = (meta.info && meta.info.Title) || '';
        language = (meta.info && meta.info.Language) || 'en';
    } catch (_) {}

    // Chapters = pages
    const chapters = [];
    for (let i = 1; i <= numPages; i++) {
        chapters.push({ id: 'pdf-p' + i, title: 'Page ' + i, href: 'pdf-p' + i, opfDir: '' });
    }

    // Render page 1 as cover thumbnail (async, returns null on error)
    async function getCoverDataUrl() {
        try {
            const page = await pdfDoc.getPage(1);
            const vp = page.getViewport({ scale: 0.4 });
            const canvas = document.createElement('canvas');
            canvas.width = vp.width; canvas.height = vp.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            return canvas.toDataURL('image/jpeg', 0.6);
        } catch (_) { return null; }
    }

    return {
        title: title.trim() || 'Unknown',
        language: Array.isArray(language) ? (language[0] || 'en') : (String(language).trim() || 'en'),
        chapters,
        _isPdf: true,
        _pdfDoc: pdfDoc,
        _pdfjsLib: pdfjsLib,

        getChapterContent: async function () { return ''; },
        getFileAsBlob: function () { return Promise.reject(new Error('not supported for PDF')); },
        getCoverDataUrl,
        destroy: function () { pdfDoc.destroy(); },
    };
}

globalThis.PdfParser = { parse, isPDF };
