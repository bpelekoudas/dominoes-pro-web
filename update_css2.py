import re

with open('css/style.css', 'r') as f:
    css = f.read()

# Make gap of vertical hands same as bottom player (10px)
# But vertical hands might use margin-bottom if they are stacked vertically.
# Let's check how .hand.vertical is styled.

# Currently:
# .hand.vertical {
#     width: 100px;
#     height: auto;
#     flex-direction: column;
# }
# Actually, the user says "Make the opponent dominoes the same distance apart as the player dominoes"
# The player hand uses `gap: 10px;` and `flex-direction: row` (implied by default or by `.hand`).
# For `.hand.vertical`, we can just use `gap: 10px;` as well, since flex-direction is column.
# Let's verify what's there and update it.

css = re.sub(
    r'\.hand\.vertical \{[\s\S]*?\}',
    '.hand.vertical {\n    width: 100px;\n    height: auto;\n    flex-direction: column;\n    gap: 10px;\n}',
    css
)

# And remove margin-bottom from media queries if they exist.
css = re.sub(r'    \.hand\.vertical \.domino \{\n        transform: scale\(0\.6\);\n        margin-bottom: 5px;\n    \}', '    .hand.vertical .domino {\n        /* using gap instead */\n    }', css)
css = re.sub(r'    \.hand\.vertical \.domino \{\n        margin-bottom: 2px;\n    \}', '    .hand.vertical .domino {\n        /* using gap */\n    }', css)

css = re.sub(r'    \.hand\.vertical \.domino:last-child \{\n        margin-bottom: 0;\n    \}', '', css)

# Make sure all opponent dominoes are the same size as player dominoes.
# Player domino is scale(1) by default. In mobile portrait, the instructions were to scale bottom hand?
# Let's look at the portrait media query.
css = re.sub(r'    /\* Top and bottom hands \*/\n    \.hand:not\(\.vertical\) \.domino \{\n        transform: scale\(0\.8\);\n        margin: 0 -5px;\n    \}', '    /* Top and bottom hands */\n    .hand:not(.vertical) .domino {\n        transform: scale(0.8);\n        margin: 0 -5px;\n    }\n    /* Match vertical hand size to top/bottom */\n    .hand.vertical .domino {\n        transform: scale(0.8);\n    }', css)


with open('css/style.css', 'w') as f:
    f.write(css)
