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
let draggedTileIndex = null;

// Init
startBtn.addEventListener('click', startGame);
window.addEventListener('resize', updateZoom);

function startGame() {
    game.startNewGame();
    render();

    // If AI starts, trigger AI turn
    if (game.turnIndex === 1) { // 1 is AI
        setTimeout(playAITurn, 1000);
    } else {
        checkPlayerStatus();
    }
}

function render() {
    renderBoard();
    renderHands();
    renderHUD();
    // Delay slightly to ensure DOM is updated and layout is calculated?
    // Actually renderBoard() updates DOM synchronously. Layout happens on read.
    requestAnimationFrame(updateZoom);
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
        const tileEl = createTileElement(tile); // Default style, modified by valid check?
        // Actually createTileElement adds .horizontal/.vertical based on double logic, which assumes main line.
        // We can just rely on basic style and override if needed, but for hand it's usually vertical.
        // Current CSS: .domino is vertical. .horizontal overrides.
        // Let's force hand tiles to be vertical for consistency.
        tileEl.classList.remove('horizontal');
        tileEl.classList.add('vertical'); // Doubles are vertical by default too?
        // My CSS: .domino is 44x88 (Vertical). .horizontal is 88x44.
        // Hand should probably be vertical.

        tileEl.dataset.index = index;
        tileEl.draggable = true;
        tileEl.addEventListener('dragstart', (e) => handleDragStart(e, index));
        tileEl.addEventListener('click', () => onPlayerTileClick(index));

        // Highlight valid moves
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
    const pipMap = {
        0: [],
        1: [5],
        2: [1, 9],
        3: [1, 5, 9],
        4: [1, 3, 7, 9],
        5: [1, 3, 5, 7, 9],
        6: [1, 3, 4, 6, 7, 9]
    };

    const positions = pipMap[val];
    positions.forEach(pos => {
        const pip = document.createElement('div');
        pip.className = 'pip';
        pip.dataset.pos = pos;
        container.appendChild(pip);
    });
}

function renderBoard() {
    boardEl.innerHTML = '';

    if (game.board.placedTiles.length === 0) {
        const zone = createDropZone('start');
        boardEl.appendChild(zone);
    } else {
        const leftZone = createDropZone('left');
        boardEl.appendChild(leftZone);
    }

    // Main Line
    game.board.placedTiles.forEach(item => {
        const tile = item.domino;
        const el = createTileElement(tile);

        // Main Line Orientation
        if (tile.isDouble()) {
            el.classList.add('vertical');
        } else {
            el.classList.add('horizontal');
        }

        // Flipped
        if (item.flipped) {
            el.style.transform = 'rotate(180deg)';
        }

        // Check if Spinner
        if (game.board.spinner && tile === game.board.spinner) {
            // Append Branches
            renderBranches(el);
        }

        boardEl.appendChild(el);
    });

    if (game.board.placedTiles.length > 0) {
        const rightZone = createDropZone('right');
        boardEl.appendChild(rightZone);
    }
}

function createDropZone(side) {
    const el = document.createElement('div');
    el.className = 'drop-zone';
    el.dataset.side = side;
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('drop', handleDrop);
    return el;
}

function renderBranches(spinnerEl) {
    // Top Branch
    const topContainer = document.createElement('div');
    topContainer.className = 'branch-container top-branch';

    game.board.topBranch.forEach(item => {
        const tile = item.domino;
        const el = createTileElement(tile);

        if (tile.isDouble()) {
            el.classList.add('horizontal');
        } else {
            el.classList.add('vertical'); // Default, but explicit
        }

        if (item.flipped) {
            el.style.transform = 'rotate(180deg)';
        }
        topContainer.appendChild(el);
    });

    const topZone = createDropZone('top');
    topContainer.appendChild(topZone);
    spinnerEl.appendChild(topContainer);

    // Bottom Branch
    const bottomContainer = document.createElement('div');
    bottomContainer.className = 'branch-container bottom-branch';

    game.board.bottomBranch.forEach(item => {
        const tile = item.domino;
        const el = createTileElement(tile);

        if (tile.isDouble()) {
            el.classList.add('horizontal');
        } else {
            el.classList.add('vertical');
        }

        if (item.flipped) {
            el.style.transform = 'rotate(180deg)';
        }
        bottomContainer.appendChild(el);
    });

    const bottomZone = createDropZone('bottom');
    bottomContainer.appendChild(bottomZone);
    spinnerEl.appendChild(bottomContainer);
}

function handleDragStart(e, index) {
    if (game.turnIndex !== 0) {
        e.preventDefault();
        return;
    }
    draggedTileIndex = index;

    // Highlight drop zones
    const moves = game.board.getValidMoves(game.players[0].hand);
    const tileMoves = moves.filter(m => m.index === index);

    const zones = document.querySelectorAll('.drop-zone');
    zones.forEach(zone => {
        const side = zone.dataset.side;
        const isValid = tileMoves.some(m => m.side === side);
        if (isValid) {
            zone.classList.add('highlight');
        }
    });
}

function handleDragOver(e) {
    e.preventDefault(); // Allow drop
    if (e.currentTarget.classList.contains('highlight')) {
        e.currentTarget.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    const side = e.currentTarget.dataset.side;

    // Validate again just in case (client-side safety)
    if (!e.currentTarget.classList.contains('highlight')) {
        cleanupDrag();
        return;
    }

    const moveInfo = { index: draggedTileIndex, side: side };
    executeMove(moveInfo);
    cleanupDrag();
}

function cleanupDrag() {
    draggedTileIndex = null;
    const zones = document.querySelectorAll('.drop-zone');
    zones.forEach(zone => {
        zone.classList.remove('highlight');
        zone.classList.remove('drag-over');
    });
}

function onPlayerTileClick(index) {
    if (game.turnIndex !== 0) return;
    if (game.isGameOver) return;

    const tile = game.players[0].hand[index];
    const moves = game.board.getValidMoves(game.players[0].hand);
    const tileMoves = moves.filter(m => m.index === index);

    if (tileMoves.length === 0) {
        showMessage("Invalid tile!");
        return;
    }

    if (tileMoves.length === 1) {
        executeMove(tileMoves[0]);
    } else {
        // Ambiguous
        // Construct prompt
        const sides = tileMoves.map(m => m.side);
        // Map to simpler keys
        const sideMap = {
            'left': 'L', 'right': 'R', 'top': 'T', 'bottom': 'B'
        };
        const options = sides.map(s => `${sideMap[s]}: ${s}`).join(', ');

        let choice = prompt(`Play where? (${options})`).toUpperCase();

        // Map input back to side
        const keyMap = { 'L': 'left', 'R': 'right', 'T': 'top', 'B': 'bottom' };
        // Also allow full names
        let side = keyMap[choice] || choice.toLowerCase();

        const move = tileMoves.find(m => m.side === side);
        if (move) {
            executeMove(move);
        } else {
            showMessage("Invalid choice.");
        }
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

    if (result.type === 'game_over') {
         return;
    }

    setTimeout(playAITurn, 1000);
}

function playAITurn() {
    if (game.isGameOver) return;
    if (game.turnIndex !== 1) return;

    showMessage("AI Thinking...");

    const status = game.ensurePlayable();

    if (status === 'blocked_game') {
        handleRoundOver("Game Blocked!");
        return;
    }

    if (status === 'pass') {
        showMessage("AI Passed.");
        render();
        checkPlayerStatus();
        return;
    }

    render();

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
             checkPlayerStatus();
        }
    } else {
        console.error("AI has no move but ensurePlayable returned playable");
    }
}

function checkPlayerStatus() {
    const status = game.ensurePlayable();
    render();

    if (status === 'blocked_game') {
        handleRoundOver("Game Blocked!");
    } else if (status === 'pass') {
        showMessage("You are blocked. Passing to AI.");
        setTimeout(playAITurn, 1000);
    } else {
        showMessage("Your Turn");
    }
}

function handleRoundOver(message) {
    if (game.isGameOver) {
        showMessage(`Game Over! Winner: ${game.gameWinner.name}`);
        render();
    } else {
        showMessage(`${message} Next hand in 3s...`);
        render();
        setTimeout(() => {
            game.startNextHand();
            render();
            if (game.turnIndex === 1) {
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

    scorePopupEl.style.left = isAI ? '20%' : '80%';
    scorePopupEl.style.top = isAI ? '20%' : '80%';

    setTimeout(() => {
        scorePopupEl.classList.remove('slide-up');
        scorePopupEl.classList.add('hidden');
    }, 1500);
}

function updateZoom() {
    const boardAreaEl = document.getElementById('board-area');
    if (!boardAreaEl) return;

    // Viewport Center
    const areaRect = boardAreaEl.getBoundingClientRect();
    const centerX = areaRect.left + areaRect.width / 2;
    const centerY = areaRect.top + areaRect.height / 2;

    // Board Content Bounds
    // Include all dominos and drop zones
    const elements = boardEl.querySelectorAll('.domino, .drop-zone');
    if (elements.length === 0) {
        boardEl.style.transform = 'scale(1)';
        return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        // Since getBoundingClientRect is affected by current transform, we need to be careful.
        // If we are currently scaled at 0.5, the rects will be small.
        // However, we want to know if they fit in areaRect.
        // We compare rect vs areaRect centers.
        // If we calculate distances based on CURRENT positions (scaled), we get current visual distance.
        // To find the NEW scale, we want to know the "Unscaled" distance?
        // Or we can iteratively adjust?
        // Or: If we use the current rects, we get the current extent.
        // If extent > area, we need to scale down.
        // If extent < area, we can scale up (max 1).

        // Better: Calculate relative to the boardEl's center, undoing the current scale.
        // But undoing scale is hard without knowing exact transform origin logic relative to elements.

        // Simple approach: unscale first.
        // But unscaling causes flash.
        // Math approach:
        // Current Scale = currentScale.
        // elementRect is scaled.
        // trueDist = (elementRect.coord - center) / currentScale.
        // We want scale_new * trueDist < limit.
        // scale_new < limit / trueDist.
        // scale_new < limit / ((elementRect.coord - center) / currentScale).
        // scale_new < (limit * currentScale) / (elementRect.coord - center).

        if (rect.left < minX) minX = rect.left;
        if (rect.top < minY) minY = rect.top;
        if (rect.right > maxX) maxX = rect.right;
        if (rect.bottom > maxY) maxY = rect.bottom;
    });

    // Current Scale
    const computedStyle = window.getComputedStyle(boardEl);
    const matrix = new DOMMatrix(computedStyle.transform);
    const currentScale = matrix.a; // Assume uniform scale

    // Max Distance from Center (Visual)
    const distLeft = centerX - minX;
    const distRight = maxX - centerX;
    const distTop = centerY - minY;
    const distBottom = maxY - centerY;

    const maxDistX = Math.max(distLeft, distRight);
    const maxDistY = Math.max(distTop, distBottom);

    // Available Space (Half dimensions)
    const padding = 20;
    const availX = (areaRect.width / 2) - padding;
    const availY = (areaRect.height / 2) - padding;

    // Calculate new scale factor
    // newScale * (UnscaledDist) = Avail
    // UnscaledDist = VisualDist / currentScale
    // newScale * (VisualDist / currentScale) = Avail
    // newScale = (Avail * currentScale) / VisualDist

    let scaleX = (availX * currentScale) / maxDistX;
    let scaleY = (availY * currentScale) / maxDistY;

    // Avoid division by zero
    if (maxDistX === 0) scaleX = 1;
    if (maxDistY === 0) scaleY = 1;

    let newScale = Math.min(scaleX, scaleY);
    if (newScale > 1) newScale = 1; // Cap at 1
    if (newScale < 0.1) newScale = 0.1; // Safety floor

    boardEl.style.transform = `scale(${newScale})`;
}

// Initial Render
render();
