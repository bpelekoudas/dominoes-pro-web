from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.goto("http://localhost:8000/test_layout.html")
    page.wait_for_timeout(1000)
    page.screenshot(path="layout_before.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            run_cuj(page)
        finally:
            browser.close()
