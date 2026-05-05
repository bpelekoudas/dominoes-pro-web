with open('css/style.css', 'r') as f:
    content = f.read()

# Remove old #match-scores styling
import re
content = re.sub(r'#match-scores \{.*?\}', '', content, flags=re.DOTALL)

# Add #top-banner styling
banner_css = """
/* Top Banner */
#top-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(0, 0, 0, 0.5);
    padding: 10px 20px;
    color: white;
    font-weight: bold;
    z-index: 10;
    width: 100%;
    box-sizing: border-box;
    position: absolute;
    top: 0;
    left: 0;
}

#match-info {
    display: flex;
    gap: 10px;
    align-items: center;
}

#top-banner .score-display {
    margin: 0;
    background: rgba(0, 0, 0, 0.7);
}

/* Adjust game container to account for banner */
#game-container {
    padding-top: 60px; /* Space for the banner */
}
"""

content = banner_css + "\n" + content

with open('css/style.css', 'w') as f:
    f.write(content)
