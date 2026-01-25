// ui.js

const game = new Game();

// DOM Elements
const boardEl = document.getElementById('board');
const playerHandEl = document.getElementById('player-hand');
const aiHandEl = document.getElementById('ai-hand');
const playerScoreEl = document.getElementById('player-score');
const aiScoreEl = document.getElementById('ai-score');
const seriesTrackerEl = document.getElementById('series-tracker');
const messageAreaEl = document.getElementById('message-area');
const boneyardCountEl = document.getElementById('boneyard-count');
const startBtn = document.getElementById('start-btn');
const difficultySelect = document.getElementById('difficulty');
const scorePopupEl = document.getElementById('score-popup');

// State
let selectedTileIndex = null;
let ambiguityMode = false; // When user needs to choose Left/Right

// Init
startBtn.addEventListener('click', startGame);

function startGame() {
    const diff = difficultySelect.value;
    // Set difficulty? Game class doesn't store it, we pass it to AI move.
    // We should store it in UI state.

    game.startNewGame();
    render();

    // If AI starts, trigger AI turn
    if (game.turnIndex === 1) { // 1 is AI
        setTimeout(playAITurn, 1000);
    } else {
        // Player starts (after first move was auto-played)
        checkPlayerStatus();
    }
}

function render() {
    renderBoard();
    renderHands();
    renderHUD();
}

function renderHUD() {
    playerScoreEl.textContent = `Player: ${game.players[0].score}`;
    aiScoreEl.textContent = `AI: ${game.players[1].score}`;
    boneyardCountEl.textContent = game.deck.tiles.length;
    seriesTrackerEl.textContent = `Series: Player ${game.players[0].wins} - ${game.players[1].wins} AI`;

    if (game.isGameOver) {
        messageAreaEl.textContent = `Game Over! Winner: ${game.gameWinner.name}`;
        startBtn.textContent = "Next Game";
    } else {
        const currentPlayer = game.players[game.turnIndex];
        messageAreaEl.textContent = `Turn: ${currentPlayer.name}`;
    }
}

function renderHands() {
    // Player Hand
    playerHandEl.innerHTML = '';
    game.players[0].hand.forEach((tile, index) => {
        const tileEl = createTileElement(tile);
        tileEl.dataset.index = index;
        tileEl.addEventListener('click', () => onPlayerTileClick(index));

        // Highlight valid moves?
        // Check if this tile has valid moves
        const validMoves = game.board.getValidMoves(game.players[0].hand);
        const isValid = validMoves.some(m => m.index === index);
        if (isValid) tileEl.classList.add('valid');

        playerHandEl.appendChild(tileEl);
    });

    // AI Hand (Hidden faces)
    aiHandEl.innerHTML = '';
    game.players[1].hand.forEach(() => {
        const tileEl = document.createElement('div');
        tileEl.className = 'domino';
        // Back texture handled by CSS
        aiHandEl.appendChild(tileEl);
    });
}

function createTileElement(tile) {
    const el = document.createElement('div');
    el.className = 'domino';

    // Top/Left half
    const top = document.createElement('div');
    top.className = 'half';
    createPips(tile.val1, top);

    // Line
    const line = document.createElement('div');
    line.className = 'line';

    // Bottom/Right half
    const bottom = document.createElement('div');
    bottom.className = 'half';
    createPips(tile.val2, bottom);

    el.appendChild(top);
    el.appendChild(line);
    el.appendChild(bottom);

    return el;
}

function createPips(val, container) {
    // Positions for pips (0-6)
    // We can use grid or absolute positioning.
    // 3x3 grid is easiest.
    // 1 2 3
    // 4 5 6
    // 7 8 9
    // Map val to visible pips.

    const pipMap = {
        0: [],
        1: [5],
        2: [1, 9],
        3: [1, 5, 9],
        4: [1, 3, 7, 9],
        5: [1, 3, 5, 7, 9],
        6: [1, 3, 4, 6, 7, 9] // Standard 6 is 2 rows of 3? Or 2 columns of 3. usually columns.
                             // 1(TL) 3(TR)
                             // 4(ML) 6(MR)
                             // 7(BL) 9(BR)
    };

    const positions = pipMap[val];
    positions.forEach(pos => {
        const pip = document.createElement('div');
        pip.className = 'pip';
        // CSS for positioning based on 'pos'
        // We'll add styles for data-pos
        pip.dataset.pos = pos;
        container.appendChild(pip);
    });
}

function renderBoard() {
    boardEl.innerHTML = '';

    // game.board.placedTiles is array of {domino, flipped}
    // Render them in order.

    game.board.placedTiles.forEach(item => {
        const tile = item.domino;
        // Logic stores 'flipped'.
        // Logic assumes:
        // Not flipped: val1 is Left, val2 is Right.
        // Flipped: val2 is Left, val1 is Right.

        // Visuals:
        // We render left-to-right.
        // If not flipped: Render val1 then val2.
        // If flipped: Render val2 then val1.

        // Wait. Board Logic:
        // place('left'): unshift.
        // if matches val2==leftOpen (normal): flipped=false. val1 becomes new leftOpen.
        // So visually: [val1 | val2] - [oldLeft...]
        // So val1 is Leftmost.

        // So 'flipped' false means [val1 | val2].
        // 'flipped' true means [val2 | val1].

        const el = createTileElement(tile);

        // Orientation
        if (tile.isDouble()) {
            el.classList.add('vertical'); // Doubles are crosswise (vertical in a horizontal line)
            // Actually, usually line is horizontal, doubles are vertical.
            // My CSS `.domino` is vertical by default. `.horizontal` is horizontal.
            // So Doubles should be Default (Vertical).
            // Singles should be Horizontal.
        } else {
            el.classList.add('horizontal');
        }

        // Rotation/Flipping
        // Construct visual based on flipped state.
        // My createTileElement creates val1 then val2 (Top/Bottom or Left/Right).
        // If horizontal: Top is Left, Bottom is Right.

        // If flipped (true): We want val2 on Left.
        // So we need to reverse the order of children OR rotate the element 180deg.
        // Rotation is easier.
        if (item.flipped) {
            el.style.transform = 'rotate(180deg)';
        }

        boardEl.appendChild(el);
    });
}

function onPlayerTileClick(index) {
    if (game.turnIndex !== 0) return; // Not player turn
    if (game.isGameOver) return;

    const tile = game.players[0].hand[index];
    const moves = game.board.getValidMoves(game.players[0].hand);
    const tileMoves = moves.filter(m => m.index === index);

    if (tileMoves.length === 0) {
        // Invalid
        showMessage("Invalid tile!");
        return;
    }

    if (tileMoves.length === 1) {
        // Execute
        executeMove(tileMoves[0]);
    } else {
        // Ambiguous (Left or Right)
        // Show selection UI
        // We can use a simple confirm or custom buttons.
        // Let's use a quick prompt for now or better, highlight ends.
        const choice = confirm("Play on Left? (Cancel for Right)");
        const side = choice ? 'left' : 'right';
        const move = tileMoves.find(m => m.side === side);
        executeMove(move);
    }
}

function executeMove(moveInfo) {
    const result = game.playTurn(moveInfo);

    if (result.type === 'invalid') {
        showMessage("Error: Invalid move");
        return;
    }

    render();

    if (result.score > 0) {
        showScorePopup(result.score);
    }

    if (result.type === 'win') {
        handleRoundOver("Domino! You Win!");
        return;
    }

    // Check if game blocked
    if (result.type === 'game_over') {
         // Should have been handled? No, playTurn returns game_over if called when over.
         return;
    }

    // AI Turn
    setTimeout(playAITurn, 1000);
}

function playAITurn() {
    if (game.isGameOver) return;
    if (game.turnIndex !== 1) return; // Not AI turn

    showMessage("AI Thinking...");

    // Check if AI can play or needs to draw
    const status = game.ensurePlayable(); // Helper in Game?

    if (status === 'blocked_game') {
        handleRoundOver("Game Blocked!");
        return;
    }

    if (status === 'pass') {
        showMessage("AI Passed.");
        // Turn passed to Player
        render();
        checkPlayerStatus(); // Check if Player can play
        return;
    }

    // AI has moves (or drew until it has one)
    render(); // Update hand size if drew

    const diff = difficultySelect.value;
    const move = game.getAIMove(diff);

    if (move) {
        const result = game.playTurn(move);
        render();
        if (result.score > 0) {
            showScorePopup(result.score, true);
        }

        if (result.type === 'win') {
            handleRoundOver("AI Wins Round!");
        } else {
             // Player turn
             checkPlayerStatus();
        }
    } else {
        console.error("AI has no move but ensurePlayable returned playable");
    }
}

function checkPlayerStatus() {
    // Check if player can play. If not, Auto-draw?

    const status = game.ensurePlayable();
    render();

    if (status === 'blocked_game') {
        handleRoundOver("Game Blocked!");
    } else if (status === 'pass') {
        showMessage("You are blocked. Passing to AI.");
        setTimeout(playAITurn, 1000);
    } else {
        // Player can play
        showMessage("Your Turn");
    }
}

function handleRoundOver(message) {
    if (game.isGameOver) {
        showMessage(`Game Over! Winner: ${game.gameWinner.name}`);
        render(); // Update scores
    } else {
        showMessage(`${message} Next hand in 3s...`);
        render(); // Update scores
        setTimeout(() => {
            game.startNextHand();
            render();
            if (game.turnIndex === 1) { // AI
                setTimeout(playAITurn, 1000);
            } else {
                checkPlayerStatus();
            }
        }, 3000);
    }
}

function showMessage(msg) {
    messageAreaEl.textContent = msg;
}

function showScorePopup(points, isAI = false) {
    scorePopupEl.textContent = `+${points}`;
    scorePopupEl.classList.remove('hidden');
    scorePopupEl.classList.add('slide-up');

    // Position? Center for now.
    // Ideally relative to HUD score.

    scorePopupEl.style.left = isAI ? '20%' : '80%';
    scorePopupEl.style.top = isAI ? '20%' : '80%';

    setTimeout(() => {
        scorePopupEl.classList.remove('slide-up');
        scorePopupEl.classList.add('hidden');
    }, 1500);
}

// Initial Render
render();
