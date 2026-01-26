
from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the index.html directly from file system
        # Assuming we are in repo root.
        cwd = os.getcwd()
        page.goto(f"file://{cwd}/index.html")

        # Select 4 players
        page.select_option("#player-count", "4")

        # Start Game
        page.click("#start-btn")

        # Wait a bit for layout to settle and initial tiles to render
        page.wait_for_timeout(1000)

        # Take screenshot
        page.screenshot(path="verification_layout.png")

        browser.close()

if __name__ == "__main__":
    run()
