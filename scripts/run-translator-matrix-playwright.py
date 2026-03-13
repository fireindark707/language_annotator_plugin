#!/usr/bin/env python3
import argparse
import csv
import functools
import json
import os
import re
import socketserver
import tempfile
import textwrap
import threading
import time
from collections import deque
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT_DIR = Path(__file__).resolve().parent.parent
OPTIONS_HTML_PATH = ROOT_DIR / "options.html"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8783
DEFAULT_CHROME_BIN = "/usr/bin/google-chrome"
DEFAULT_PROFILE_DIR = ROOT_DIR / ".tmp-translator-matrix-profile"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "tmp" / "translator-matrix"
COMMON_BROWSER_TARGETS = [
    "en-US",
    "es-ES",
    "de-DE",
    "ja-JP",
    "fr-FR",
    "pt-BR",
    "ru-RU",
    "it-IT",
    "nl-NL",
    "pl-PL",
    "tr-TR",
    "zh-CN",
    "zh-TW",
    "id-ID",
    "vi-VN",
    "ko-KR",
    "ar-SA",
    "hi-IN",
]
PAIR_PAGE_HTML = textwrap.dedent(
    """
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>translator-matrix-pair</title>
    </head>
    <body>
      <button id="runBtn" type="button">Run Pair</button>
      <pre id="out">pending</pre>
      <script>
        function setOutput(value) {
          document.getElementById("out").textContent = JSON.stringify(value, null, 2);
        }

        async function runPair() {
          const params = new URLSearchParams(window.location.search);
          const sourceLanguage = params.get("source") || "";
          const targetLanguage = params.get("target") || "";
          const mode = params.get("mode") || "availability";
          const report = {
            sourceLanguage,
            targetLanguage,
            mode,
            availability: "",
            availabilityMs: 0,
            created: false,
            sawProgress: false,
            progress: 0,
            createMs: 0,
            error: "",
          };
          setOutput(report);

          if (!("Translator" in self) || typeof Translator.availability !== "function") {
            report.error = "Translator API is not available.";
            setOutput(report);
            return;
          }

          try {
            const availabilityStart = performance.now();
            report.availability = await Translator.availability({ sourceLanguage, targetLanguage });
            report.availabilityMs = performance.now() - availabilityStart;
            setOutput(report);
          } catch (error) {
            report.error = error && error.message ? error.message : String(error);
            setOutput(report);
            return;
          }

          if (mode !== "create") {
            return;
          }

          try {
            const createStart = performance.now();
            const translator = await Translator.create({
              sourceLanguage,
              targetLanguage,
              monitor(monitor) {
                monitor.addEventListener("downloadprogress", (event) => {
                  report.sawProgress = true;
                  if (typeof event.loaded === "number") {
                    report.progress = event.loaded;
                  }
                  report.createMs = performance.now() - createStart;
                  setOutput(report);
                });
              },
            });
            report.created = true;
            report.sawProgress = report.sawProgress || report.progress > 0;
            report.progress = report.progress || 1;
            report.createMs = performance.now() - createStart;
            setOutput(report);
            if (translator && typeof translator.destroy === "function") {
              try {
                translator.destroy();
              } catch (_) {}
            }
          } catch (error) {
            report.createMs = report.createMs || 0;
            report.error = error && error.message ? error.message : String(error);
            setOutput(report);
          }
        }

        document.getElementById("runBtn").addEventListener("click", () => {
          runPair().catch((error) => {
            setOutput({
              fatalError: error && error.message ? error.message : String(error),
            });
          });
        });
      </script>
    </body>
    </html>
    """
)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Run a Chrome built-in Translator API matrix against the extension's "
            "supported source languages and a common browser-language target set."
        )
    )
    parser.add_argument(
        "--mode",
        choices=["availability", "create", "both"],
        default="both",
        help="Which phases to run. Default: both.",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="Number of worker pages for create mode. Default: 4.",
    )
    parser.add_argument(
        "--pair-timeout-ms",
        type=int,
        default=8000,
        help="Per-pair timeout for create mode. Default: 8000.",
    )
    parser.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help=f"HTTP host to bind. Default: {DEFAULT_HOST}.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"HTTP port to bind. Default: {DEFAULT_PORT}.",
    )
    parser.add_argument(
        "--chrome-bin",
        default=os.environ.get("CHROME_BIN", DEFAULT_CHROME_BIN),
        help=f"Chrome binary. Default: {DEFAULT_CHROME_BIN}.",
    )
    parser.add_argument(
        "--profile-dir",
        default=os.environ.get("TRANSLATOR_MATRIX_PROFILE", str(DEFAULT_PROFILE_DIR)),
        help=f"Persistent Chrome profile dir. Default: {DEFAULT_PROFILE_DIR}.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help=f"Directory for JSON/CSV reports. Default: {DEFAULT_OUTPUT_DIR}.",
    )
    parser.add_argument(
        "--max-pairs",
        type=int,
        default=0,
        help="Limit pair count for smoke runs. Default: 0 (all pairs).",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=50,
        help="Write intermediate create reports every N completed pairs. Default: 50.",
    )
    return parser.parse_args()


def parse_source_languages():
    html = OPTIONS_HTML_PATH.read_text(encoding="utf-8")
    match = re.search(
        r'<select id="sourceLang">(.*?)</select>',
        html,
        flags=re.DOTALL,
    )
    if not match:
        raise RuntimeError(f"Could not find source language select in {OPTIONS_HTML_PATH}")
    options_block = match.group(1)
    options = re.findall(
        r'<option value="([^"]+)">([^<]+)</option>',
        options_block,
        flags=re.DOTALL,
    )
    languages = []
    for value, label in options:
        if value == "auto":
            continue
        languages.append({
            "locale": value.strip(),
            "base": normalize_locale(value.strip()),
            "label": " ".join(label.split()),
        })
    return languages


def normalize_locale(locale):
    return (locale or "").split("-")[0].lower()


def build_pairs(source_languages, target_languages):
    pairs = []
    for source in source_languages:
        for target_locale in target_languages:
            if source["locale"] == target_locale:
                continue
            pairs.append({
                "source_locale": source["locale"],
                "source_base": source["base"],
                "source_label": source["label"],
                "target_locale": target_locale,
                "target_base": normalize_locale(target_locale),
            })
    return pairs


def ensure_output_dir(output_dir):
    output_path = Path(output_dir).resolve()
    output_path.mkdir(parents=True, exist_ok=True)
    return output_path


def start_server(host, port):
    temp_dir = tempfile.TemporaryDirectory()
    page_path = Path(temp_dir.name) / "pair.html"
    page_path.write_text(PAIR_PAGE_HTML, encoding="utf-8")
    handler = functools.partial(QuietHandler, directory=temp_dir.name)
    httpd = ReusableTCPServer((host, port), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return temp_dir, httpd


def read_report(page):
    raw = page.locator("#out").inner_text()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"error": f"Unparseable output: {raw[:200]}"}


def wait_for_availability(page):
    page.wait_for_function(
        """
        () => {
          const raw = document.getElementById("out").textContent;
          if (!raw || raw === "pending") return false;
          try {
            const data = JSON.parse(raw);
            return !!data.availability || !!data.error || !!data.fatalError;
          } catch (error) {
            return false;
          }
        }
        """,
        timeout=30000,
    )


def wait_for_create_result(page, timeout_ms):
    page.wait_for_function(
        """
        () => {
          const raw = document.getElementById("out").textContent;
          if (!raw || raw === "pending") return false;
          try {
            const data = JSON.parse(raw);
            return data.created === true ||
              data.sawProgress === true ||
              !!data.error ||
              !!data.fatalError;
          } catch (error) {
            return false;
          }
        }
        """,
        timeout=timeout_ms,
    )


def run_availability_scan(context, host, port, pairs):
    page = context.new_page()
    results = []
    for pair in pairs:
        url = (
            f"http://{host}:{port}/pair.html"
            f"?mode=availability"
            f"&source={quote(pair['source_locale'])}"
            f"&target={quote(pair['target_locale'])}"
        )
        started_at = time.perf_counter()
        page.goto(url, wait_until="load")
        page.get_by_role("button", name="Run Pair").click()
        try:
            wait_for_availability(page)
        except PlaywrightTimeoutError:
            pass
        data = read_report(page)
        results.append(build_result_row(pair, data, "availability", time.perf_counter() - started_at))
    page.close()
    return results


def run_create_scan(context, host, port, pairs, timeout_ms, concurrency, progress_callback=None):
    pages = [context.new_page() for _ in range(max(1, concurrency))]
    try:
        results = []
        pending_pairs = deque(pairs)
        workers = [{"page": page, "pair": None, "started_at": 0.0} for page in pages]

        def start_pair(worker, pair):
            worker["pair"] = pair
            worker["started_at"] = time.perf_counter()
            url = (
                f"http://{host}:{port}/pair.html"
                f"?mode=create"
                f"&source={quote(pair['source_locale'])}"
                f"&target={quote(pair['target_locale'])}"
            )
            worker["page"].goto(url, wait_until="load")
            worker["page"].get_by_role("button", name="Run Pair").click()

        for worker in workers:
            if pending_pairs:
                start_pair(worker, pending_pairs.popleft())

        while any(worker["pair"] is not None for worker in workers):
            for worker in workers:
                pair = worker["pair"]
                if pair is None:
                    continue

                elapsed_seconds = time.perf_counter() - worker["started_at"]
                data = read_report(worker["page"])
                done = bool(
                    data.get("created") or
                    data.get("sawProgress") or
                    data.get("progress", 0) > 0 or
                    data.get("error") or
                    data.get("fatalError")
                )
                timed_out = elapsed_seconds * 1000 >= timeout_ms
                if not done and not timed_out:
                    continue

                if timed_out and not done:
                    data["error"] = f"Timeout after {timeout_ms}ms"

                results.append(build_result_row(pair, data, "create", elapsed_seconds))
                if progress_callback:
                    progress_callback(results)
                worker["pair"] = None
                if pending_pairs:
                    start_pair(worker, pending_pairs.popleft())

            time.sleep(0.2)

        return results
    finally:
        for page in pages:
            page.close()


def build_result_row(pair, data, phase, elapsed_seconds):
    availability = data.get("availability", "")
    progress = data.get("progress", 0) or 0
    error = data.get("error") or data.get("fatalError") or ""
    created = bool(data.get("created"))
    saw_progress = bool(data.get("sawProgress")) or progress > 0
    runnable = created or saw_progress
    row = {
        "phase": phase,
        "source_locale": pair["source_locale"],
        "source_base": pair["source_base"],
        "source_label": pair["source_label"],
        "target_locale": pair["target_locale"],
        "target_base": pair["target_base"],
        "availability": availability,
        "availability_ms": round(float(data.get("availabilityMs", 0) or 0), 2),
        "created": created,
        "saw_progress": saw_progress,
        "progress": round(float(progress), 6),
        "runnable": runnable,
        "create_ms": round(float(data.get("createMs", 0) or 0), 2),
        "elapsed_ms": round(elapsed_seconds * 1000, 2),
        "error": error,
        "status": classify_status(availability, created, saw_progress, error),
    }
    return row


def classify_status(availability, created, saw_progress, error):
    if created:
        return "created"
    if saw_progress:
        return "progress"
    if error:
        return "error"
    if availability == "unavailable":
        return "unavailable"
    if availability:
        return "availability_only"
    return "unknown"


def summarize_rows(rows):
    summary = {
        "total_pairs": len(rows),
        "availability_counts": {},
        "status_counts": {},
        "runnable_pairs": 0,
    }
    for row in rows:
        availability = row.get("availability") or "missing"
        status = row.get("status") or "unknown"
        summary["availability_counts"][availability] = summary["availability_counts"].get(availability, 0) + 1
        summary["status_counts"][status] = summary["status_counts"].get(status, 0) + 1
        if row.get("runnable"):
            summary["runnable_pairs"] += 1
    return summary


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_csv(path, rows):
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def save_report(output_dir, stem, payload, rows):
    json_path = output_dir / f"{stem}.json"
    csv_path = output_dir / f"{stem}.csv"
    write_json(json_path, payload)
    write_csv(csv_path, rows)
    return json_path, csv_path


def build_payload(phase, rows, source_languages, target_languages, **extra):
    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "phase": phase,
        "sourceLanguages": source_languages,
        "targetLanguages": target_languages,
        "summary": summarize_rows(rows),
        "rows": rows,
    }
    payload.update(extra)
    return payload


def print_summary(title, summary, json_path, csv_path):
    print(title)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")


def main():
    args = parse_args()
    source_languages = parse_source_languages()
    pairs = build_pairs(source_languages, COMMON_BROWSER_TARGETS)
    if args.max_pairs > 0:
        pairs = pairs[:args.max_pairs]

    output_dir = ensure_output_dir(args.output_dir)
    temp_dir, httpd = start_server(args.host, args.port)
    try:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                str(args.profile_dir),
                executable_path=args.chrome_bin,
                headless=True,
                args=["--disable-gpu"],
            )
            try:
                if args.mode in ("availability", "both"):
                    availability_rows = run_availability_scan(context, args.host, args.port, pairs)
                    availability_payload = build_payload(
                        "availability",
                        availability_rows,
                        source_languages,
                        COMMON_BROWSER_TARGETS,
                    )
                    json_path, csv_path = save_report(
                        output_dir,
                        "translator-availability-matrix",
                        availability_payload,
                        availability_rows,
                    )
                    print_summary("Availability Summary", availability_payload["summary"], json_path, csv_path)

                if args.mode in ("create", "both"):
                    checkpoint_every = max(1, args.checkpoint_every)

                    def checkpoint(results):
                        completed = len(results)
                        if completed % checkpoint_every != 0 and completed != len(pairs):
                            return
                        payload = build_payload(
                            "create",
                            results,
                            source_languages,
                            COMMON_BROWSER_TARGETS,
                            pairTimeoutMs=args.pair_timeout_ms,
                            concurrency=args.concurrency,
                            completedPairs=completed,
                            totalPairs=len(pairs),
                        )
                        json_path, csv_path = save_report(
                            output_dir,
                            "translator-create-matrix",
                            payload,
                            results,
                        )
                        print(
                            f"[create checkpoint] {completed}/{len(pairs)} "
                            f"runnable={payload['summary']['runnable_pairs']} "
                            f"statuses={payload['summary']['status_counts']}"
                        )
                        print(f"JSON: {json_path}")
                        print(f"CSV: {csv_path}")

                    create_rows = run_create_scan(
                        context,
                        args.host,
                        args.port,
                        pairs,
                        args.pair_timeout_ms,
                        args.concurrency,
                        progress_callback=checkpoint,
                    )
                    create_payload = build_payload(
                        "create",
                        create_rows,
                        source_languages,
                        COMMON_BROWSER_TARGETS,
                        pairTimeoutMs=args.pair_timeout_ms,
                        concurrency=args.concurrency,
                        completedPairs=len(create_rows),
                        totalPairs=len(pairs),
                    )
                    json_path, csv_path = save_report(
                        output_dir,
                        "translator-create-matrix",
                        create_payload,
                        create_rows,
                    )
                    print_summary("Create Summary", create_payload["summary"], json_path, csv_path)
            finally:
                context.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
        temp_dir.cleanup()


if __name__ == "__main__":
    main()
