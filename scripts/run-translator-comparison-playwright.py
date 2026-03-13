#!/usr/bin/env python3
import json
import os
import socketserver
import threading
from http.server import SimpleHTTPRequestHandler

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HOST = "127.0.0.1"
PORT = int(os.environ.get("TRANSLATOR_COMPARE_PORT", "8766"))
CHROME_BIN = os.environ.get("CHROME_BIN", "/usr/bin/google-chrome")
PROFILE_DIR = os.environ.get(
    "TRANSLATOR_COMPARE_PROFILE",
    os.path.join(ROOT_DIR, ".tmp-translator-compare-profile"),
)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def start_server():
    os.chdir(ROOT_DIR)
    httpd = ReusableTCPServer((HOST, PORT), QuietHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def read_report(page):
    raw = page.locator("#test-output").inner_text()
    try:
        return raw, json.loads(raw)
    except json.JSONDecodeError:
        return raw, None


def wait_for_status(page, status, timeout):
    page.wait_for_function(
        """
        (expectedStatus) => {
          const raw = document.getElementById("test-output").textContent;
          if (!raw || raw === "pending") return false;
          try {
            const data = JSON.parse(raw);
            return data.status === expectedStatus;
          } catch (error) {
            return false;
          }
        }
        """,
        arg=status,
        timeout=timeout,
    )


def wait_for_prepare_outcome(page, timeout):
    page.wait_for_function(
        """
        () => {
          const raw = document.getElementById("test-output").textContent;
          if (!raw || raw === "pending") return false;
          try {
            const data = JSON.parse(raw);
            if (data.status === "prepared-built-in" || data.status === "failed") {
              return true;
            }
            const pairs = Object.values(data.pairStatuses || {});
            if (pairs.length === 0) return false;
            const hasPrepared = pairs.some((pair) => pair.prepared);
            const allErrored = pairs.every((pair) => pair.prepareError);
            return hasPrepared || allErrored;
          } catch (error) {
            return false;
          }
        }
        """,
        timeout=timeout,
    )


def main():
    httpd = start_server()
    try:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                PROFILE_DIR,
                executable_path=CHROME_BIN,
                headless=True,
                args=["--disable-gpu"],
            )
            page = context.new_page()
            page.goto(f"http://{HOST}:{PORT}/tests/translator-comparison.html", wait_until="load")
            page.get_by_role("button", name="Analyze Languages").click()
            try:
                wait_for_status(page, "analyzed", timeout=30000)
            except PlaywrightTimeoutError:
                pass

            page.get_by_role("button", name="Prepare Built-in Translator").click()
            try:
                wait_for_prepare_outcome(page, timeout=180000)
            except PlaywrightTimeoutError:
                pass

            try:
                wait_for_status(page, "prepared-built-in", timeout=15000)
            except PlaywrightTimeoutError:
                pass

            raw, data = read_report(page)
            can_run = bool(data) and data.get("status") == "prepared-built-in"
            if not can_run:
                pair_statuses = list((data or {}).get("pairStatuses", {}).values())
                can_run = bool(pair_statuses) and (
                    any(pair.get("prepared") for pair in pair_statuses) or
                    all(pair.get("prepareError") for pair in pair_statuses)
                )

            if can_run:
                try:
                    page.get_by_role("button", name="Run Comparison").click(timeout=30000)
                except PlaywrightTimeoutError:
                    page.evaluate("window.runComparison()")
                try:
                    wait_for_status(page, "complete", timeout=120000)
                except PlaywrightTimeoutError:
                    pass

            raw, _ = read_report(page)
            print(raw)
            context.close()
    finally:
        httpd.shutdown()
        httpd.server_close()


if __name__ == "__main__":
    main()
