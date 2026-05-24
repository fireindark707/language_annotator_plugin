(function (global) {
	"use strict";

	// Heroicons v2 outline paths (24×24 viewBox, stroke-width 1.5 unless noted)
	const PATHS = {
		"speaker-wave":        { d: "M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" },
		"x-mark":              { d: "M6 18L18 6M6 6l12 12" },
		"check":               { d: "M4.5 12.75l6 6 9-13.5" },
		"trash":               { d: "M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" },
		"book-open":           { d: "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" },
		"rectangle-stack":     { d: "M6 6.878V6a2.25 2.25 0 012.25-2.25h7.5A2.25 2.25 0 0118 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 004.5 9v.878m13.5-3A2.25 2.25 0 0119.5 9v.878m0 0a2.246 2.246 0 00-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0121 12v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6c0-.98.626-1.813 1.5-2.122" },
		"arrow-left":          { d: "M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" },
		"chevron-left":        { d: "M15.75 19.5L8.25 12l7.5-7.5" },
		"chevron-right":       { d: "M8.25 4.5l7.5 7.5-7.5 7.5" },
		"bars-3":              { d: "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" },
		"plus":                { d: "M12 4.5v15m7.5-7.5h-15" },
		"plus-circle":         { d: "M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" },
		"bookmark":            { d: "M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" },
		"bookmark-solid":      { d: "M6.32 2.577a49.255 49.255 0 0111.36 0c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V4.762c0-1.108.806-2.057 1.907-2.185z", fill: true },
		"question-mark-circle":{ d: "M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" },
		"squares-2x2":         { d: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" },
		"list-bullet":         { d: "M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" },
		"photo":               { d: "M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" },
		"adjustments":         { d: "M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" },
		"ellipsis-vertical":   { d: "M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" },
		"academic-cap":        { d: "M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" },
		"chevron-down":         { d: "M19.5 8.25l-7.5 7.5-7.5-7.5" },
		"view-columns":         { d: "M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" },
	};

	// Create an <svg> element for the given icon name.
	// opts: { size=20, strokeWidth=1.5, className, style, doc }
	function icon(name, opts) {
		const o = opts || {};
		const size = o.size || 20;
		const sw = o.strokeWidth !== undefined ? o.strokeWidth : 1.5;
		const doc = o.doc || (typeof document !== "undefined" ? document : null);
		if (!doc) return null;
		const def = PATHS[name];
		if (!def) {
			const placeholder = doc.createElement("span");
			placeholder.textContent = "?";
			return placeholder;
		}
		const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("width", String(size));
		svg.setAttribute("height", String(size));
		svg.setAttribute("aria-hidden", "true");
		svg.style.display = "inline-block";
		svg.style.verticalAlign = "middle";
		svg.style.flexShrink = "0";
		if (o.className) svg.setAttribute("class", o.className);
		if (o.style) svg.setAttribute("style", o.style);

		if (def.fill) {
			svg.setAttribute("fill", "currentColor");
			svg.setAttribute("stroke", "none");
		} else {
			svg.setAttribute("fill", "none");
			svg.setAttribute("stroke", "currentColor");
			svg.setAttribute("stroke-width", String(sw));
			svg.setAttribute("stroke-linecap", "round");
			svg.setAttribute("stroke-linejoin", "round");
		}

		const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", def.d);
		if (def.fill) {
			path.setAttribute("fill-rule", "evenodd");
			path.setAttribute("clip-rule", "evenodd");
		}
		svg.appendChild(path);
		return svg;
	}

	// Convenience: return the SVG as an HTML string (for innerHTML assignments)
	function iconHtml(name, opts) {
		const el = icon(name, opts);
		if (!el) return "";
		const tmp = typeof document !== "undefined" ? document.createElement("div") : null;
		if (!tmp) return "";
		tmp.appendChild(el);
		return tmp.innerHTML;
	}

	global.UiIcons = { icon, iconHtml };
})(globalThis);
