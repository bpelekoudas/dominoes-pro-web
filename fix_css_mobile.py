with open('css/style.css', 'r') as f:
    content = f.read()

import re
content = re.sub(r'#match-scores\s*\{[^}]*\}', '', content)

mobile_updates = """
    #top-banner {
        padding: 5px;
        font-size: 0.8rem;
    }
    #match-info {
        gap: 5px;
    }
    #game-container {
        padding-top: 40px !important;
    }
"""

content = content.replace('/* Compact layout for narrow screens */', '/* Compact layout for narrow screens */' + mobile_updates)

with open('css/style.css', 'w') as f:
    f.write(content)
