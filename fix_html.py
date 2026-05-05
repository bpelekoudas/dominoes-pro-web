with open('index.html', 'r') as f:
    content = f.read()

content = content.replace('</div>\n\n        <!-- Top Section: Top Hand and Score -->', '<div id="score-top" class="score-display hidden">AI 2: 0</div>\n        </div>\n\n        <!-- Top Section: Top Hand and Score -->')

with open('index.html', 'w') as f:
    f.write(content)
