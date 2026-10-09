"""Optional real Chromium UI smoke test. All network responses are synthetic."""

import json
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SECURITY_HEADERS = {item["key"]: item["value"] for item in
                    json.loads((ROOT / "vercel.json").read_text())["headers"][0]["headers"]}
TOKEN = "synthetic-browser-smoke-token"
BARCODE = "&0000123456789&"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                      service_workers="block")
        state = {"mode": "good", "calls": 0}

        def respond(route):
            request = route.request
            pathname = urlsplit(request.url).path
            def fulfill(**kwargs):
                headers = dict(SECURITY_HEADERS)
                if pathname.startswith("/api/"):
                    headers["Cache-Control"] = "no-store"
                route.fulfill(headers=headers, **kwargs)
            if pathname == "/api/health":
                fulfill(json={"service": "my-barcode", "relay": True})
            elif pathname == "/api/barcode":
                state["calls"] += 1
                assert TOKEN not in request.url
                assert request.headers.get("authorization") == "Bearer " + TOKEN
                if state["mode"] == "auth":
                    fulfill(status=401, json={"error": "authentication_required"})
                elif state["mode"] == "outage":
                    fulfill(status=503, json={"error": "service_unavailable"})
                else:
                    fulfill(json={"schoolId": json.loads(request.post_data)["schoolId"], "barcode": BARCODE})
            else:
                file = PUBLIC / ("index.html" if pathname == "/" else pathname.lstrip("/"))
                if file.is_file() and file.resolve().is_relative_to(PUBLIC):
                    content_type = "text/javascript" if file.suffix == ".js" else mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                    fulfill(body=file.read_bytes(), content_type=content_type)
                else:
                    fulfill(status=404, body="Not found")

        context.route("https://my-barcode.test/**", respond)
        page = context.new_page()
        page.add_init_script("""window.policyViolations = [];
            document.addEventListener('securitypolicyviolation', event => {
                window.policyViolations.push(event.effectiveDirective);
            });""")
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto("https://my-barcode.test/")
        page.get_by_role("button", name="Connect your login").click()
        page.get_by_label("Completed SSO URL or Fusion token").fill(TOKEN)
        page.get_by_role("button", name="Save login", exact=True).click()
        expect(page.locator("#status-label")).to_have_text("Ready to scan")
        expect(page.locator("#barcode-slot svg")).to_be_visible()
        for width, height in [(320, 568), (360, 640), (390, 844), (430, 932)]:
            page.set_viewport_size({"width": width, "height": height})
            expect(page.locator("#barcode-slot svg")).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            assert page.evaluate("document.documentElement.scrollHeight <= window.innerHeight + 1")
            assert page.locator("#scan-button").bounding_box()["height"] >= 44
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("localStorage.getItem('my-barcode.token.v1.107')")
        (ROOT / "test-results").mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT / "test-results" / "mobile.png"), full_page=True)
        page.get_by_role("button", name="Scan view").click()
        expect(page.locator("#scan-dialog")).to_be_visible()
        page.get_by_role("button", name="Close scan view").click()
        page.get_by_role("button", name="Settings", exact=True).click()
        with page.expect_download() as download:
            page.get_by_role("button", name="Save barcode image").click()
        path = download.value.path()
        assert Path(path).read_bytes().startswith(b"\x89PNG")
        page.get_by_role("button", name="Close settings").click()
        page.reload()
        expect(page.locator("#status-label")).to_have_text("Ready to scan")
        assert state["calls"] == 2
        state["mode"] = "outage"
        page.get_by_role("button", name="Refresh barcode").click()
        expect(page.locator("#status-label")).to_have_text("Unavailable")
        expect(page.locator("#login-dialog")).not_to_be_visible()
        expect(page.locator("#barcode-slot")).not_to_be_visible()
        state["mode"] = "auth"
        page.get_by_role("button", name="Refresh barcode").click()
        expect(page.locator("#login-dialog")).to_be_visible()
        page.get_by_role("button", name="Close login").click()
        page.get_by_role("button", name="Settings", exact=True).click()
        page.get_by_label("Institution ID").fill("108")
        page.get_by_label("Institution name").fill("Another institution")
        page.get_by_role("button", name="Save settings").click()
        expect(page.locator("#institution-name")).to_have_text("Another institution")
        expect(page.locator("#barcode-slot")).not_to_be_visible()
        assert state["calls"] == 4
        assert not page_errors
        assert page.evaluate("window.policyViolations") == []
        browser.close()
        print("Browser smoke checks passed; synthetic preview: test-results/mobile.png")


if __name__ == "__main__":
    main()
