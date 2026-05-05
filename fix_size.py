with open('css/style.css', 'r') as f:
    content = f.read()

# Current CSS handles size via `.hand:not(#bottom-hand) .domino`.
# Or we can add `transform: scale(0.75)` directly to that class.
import re

css_addition = """
.hand:not(#bottom-hand) .domino {
    transform: scale(0.75);
    /* Adjust margin to account for visual scale down if necessary, but transform handles visual shrinking. */
}
"""

content = re.sub(r'\.hand:not\(#bottom-hand\) \.domino \{', css_addition + r'\n.hand:not(#bottom-hand) .domino {', content)

with open('css/style.css', 'w') as f:
    f.write(content)
