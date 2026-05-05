with open('css/style.css', 'r') as f:
    content = f.read()

banner_css = """
/* Top Banner */
#top-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(0, 0, 0, 0.7);
    padding: 5px 10px;
    color: white;
    font-weight: bold;
    z-index: 100;
    width: 100%;
    box-sizing: border-box;
    position: absolute;
    top: 0;
    left: 0;
    font-size: 0.8rem;
}

#match-info {
    display: flex;
    gap: 5px;
    align-items: center;
    flex-wrap: wrap; /* Allows wrapping on small screens */
}

#top-banner .score-display {
    margin: 0;
    background: rgba(0, 0, 0, 0.5);
    padding: 5px;
    font-size: 0.9rem;
}

#top-section {
    margin-top: -65px; /* Adjust top section position slightly */
}
"""

import re
content = re.sub(r'/\* Top Banner \*/.*?#game-container \{\n    padding-top: 60px; /\* Space for the banner \*/\n\}', banner_css, content, flags=re.DOTALL)

with open('css/style.css', 'w') as f:
    f.write(content)
