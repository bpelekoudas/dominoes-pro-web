
from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)

        # Emulate Mobile Landscape
        device = p.devices['iPhone 12 Pro Max']
        # Override viewport for landscape
        device['viewport'] = {'width': 926, 'height': 428}
        # is_mobile is already in device dict

        context = browser.new_context(**device)

        page = context.new_page()

        # Load the game
        cwd = os.getcwd()
        page.goto(f"file://{cwd}/index.html")

        print("Page loaded.")

        # Check initial text
        message_el = page.locator("#message-area")
        initial_text = message_el.inner_text()
        print(f"Initial Text: '{initial_text}'")

        # Capture console errors
        page.on("console", lambda msg: print(f"Console: {msg.text}"))
        page.on("pageerror", lambda err: print(f"Page Error: {err}"))

        # Click Start Button
        print("Clicking Start Game...")
        page.click("#start-btn")

        # Wait for text to change
        try:
            # We expect it to change to "Turn: Player" or similar
            page.wait_for_function("document.getElementById('message-area').textContent !== 'Starting Game...'", timeout=2000)
            new_text = message_el.inner_text()
            print(f"New Text: '{new_text}'")

            if "Turn:" in new_text or "Thinking" in new_text:
                print("SUCCESS: Game started.")
            else:
                print(f"FAILURE: Text changed to '{new_text}'")

        except Exception as e:
            print(f"FAILURE: Text did not change after clicking start. Error: {e}")

        browser.close()

if __name__ == "__main__":
    run()
