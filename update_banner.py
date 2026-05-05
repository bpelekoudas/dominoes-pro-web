import re

with open('index.html', 'r') as f:
    content = f.read()

# Remove #match-scores
content = re.sub(r'<!-- Top Left Match Scores -->.*?</div>\s*<!-- Top Section: Top Hand and Score -->', '<!-- Top Section: Top Hand and Score -->', content, flags=re.DOTALL)

# Re-add banner inside #game-container, before #top-section
banner_html = """
        <!-- Top Banner for Scores -->
        <div id="top-banner">
            <div id="match-info">
                <img src="assets/logo.png" id="game-logo" alt="Dominoes Logo" style="max-height: 40px; vertical-align: middle; margin-right: 10px; display: none;">
                <span id="series-tracker">Series: P1:0 AI:0</span> |
                <span id="target-score">Target: 150</span> |
                <span id="boneyard-display">Boneyard: <span id="boneyard-count">0</span></span> |
                <span id="message-area">Press Start to Begin</span>
            </div>
            <div id="score-top" class="score-display hidden">AI 2: 0</div>
        </div>

"""

content = content.replace('<!-- Top Section: Top Hand and Score -->', banner_html + '        <!-- Top Section: Top Hand and Score -->')

# Remove old #score-top from #top-section
content = re.sub(r'<div id="score-top" class="score-display hidden">.*?</div>\s*', '', content)

with open('index.html', 'w') as f:
    f.write(content)
