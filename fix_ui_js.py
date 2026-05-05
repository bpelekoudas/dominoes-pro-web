with open('js/ui.js', 'r') as f:
    content = f.read()

# Make sure AI 2 score is updated in the banner
import re

content = content.replace("scoreDisplay.innerText = `${player.name}: ${player.score}`;", "scoreDisplay.innerText = `${player.name}: ${player.score}`;")

with open('js/ui.js', 'w') as f:
    f.write(content)
