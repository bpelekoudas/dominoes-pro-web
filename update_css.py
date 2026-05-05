import re

with open('css/style.css', 'r') as f:
    css = f.read()

# 1. Update left and right score positioning
css = re.sub(
    r'#left-section .score-display \{[\s\S]*?\}',
    '#left-section .score-display {\n    order: 1;\n    margin-top: 10px;\n}',
    css
)

css = re.sub(
    r'#right-section .score-display \{[\s\S]*?\}',
    '#right-section .score-display {\n    order: -1;\n    margin-bottom: 10px;\n}',
    css
)

with open('css/style.css', 'w') as f:
    f.write(css)
