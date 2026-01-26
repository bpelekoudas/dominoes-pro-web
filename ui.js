// ui.js

const game = new Game();

// DOM Elements
const boardEl = document.getElementById('board');
const seriesTrackerEl = document.getElementById('series-tracker');
const messageAreaEl = document.getElementById('message-area');
const boneyardCountEl = document.getElementById('boneyard-count');
const startBtn = document.getElementById('start-btn');
const difficultySelect = document.getElementById('difficulty');
const playerCountSelect = document.getElementById('player-count');
const scorePopupEl = document.getElementById('score-popup');

// Score Elements
const scoreEls = [
    document.getElementById('score-0'),
    document.getElementById('score-1'),
    document.getElementById('score-2'),
    document.getElementById('score-3')
];

// Hand Containers
const handContainers = {
    bottom: document.getElementById('bottom-hand'),
    top: document.getElementById('top-hand'),
    left: document.getElementById('left-hand'),
    right: document.getElementById('right-hand')
};

// State
let selectedTileIndex = null;
let draggedTileIndex = null;

// Init
startBtn.addEventListener('click', startGame);
window.addEventListener('resize', updateZoom);

function startGame() {
    const count = parseInt(playerCountSelect.value);
    game.startNewGame(count);
    render();
    nextTurn();
}

function nextTurn() {
    if (game.isGameOver) return;
    if (game.isRoundOver) return; // Wait for round reset

    const player = game.players[game.turnIndex];
    messageAreaEl.textContent = `Turn: ${player.name}`;

    // Highlight active player in HUD?
    updateActivePlayerDisplay();

    if (player.isAI) {
        setTimeout(playAITurn, 1000);
    } else {
        checkHumanStatus();
    }
}

function checkHumanStatus() {
    const status = game.ensurePlayable();
    render();

    if (status === 'blocked_game') {
        // Handled by ensurePlayable? No, ensurePlayable calls handleBlockedGame internal logic but returns string.
        // We need to show UI.
        handleRoundOver("Game Blocked!");
    } else if (status === 'pass') {
        showMessage("You are blocked. Passing...");
        setTimeout(nextTurn, 1500);
    } else {
        showMessage("Your Turn");
        // Enable interaction (drag/click) handled by renderHands
    }
}

function playAITurn() {
    if (game.isGameOver || game.isRoundOver) return;

    const player = game.players[game.turnIndex];
    showMessage(`${player.name} Thinking...`);

    const status = game.ensurePlayable();

    if (status === 'blocked_game') {
        handleRoundOver("Game Blocked!");
        return;
    }

    if (status === 'pass') {
        showMessage(`${player.name} Passed.`);
        render();
        setTimeout(nextTurn, 1500);
        return;
    }

    render(); // Update hand if drew card

    const diff = difficultySelect.value;
    const move = game.getAIMove(diff);

    if (move) {
        const result = game.playTurn(move);
        render();
        if (result.score > 0) {
            showScorePopup(result.score, getHandContainerId(game.turnIndex)); // Use previous turn index? No, turnIndex updated in playTurn.
            // We need the index of the player who JUST played.
            // turnIndex is now next player.
            // So (turnIndex - 1 + N) % N
            const prevIndex = (game.turnIndex - 1 + game.players.length) % game.players.length;
            showScorePopup(result.score, getHandContainerId(prevIndex));
        }

        if (result.type === 'win') {
            handleRoundOver(`${player.name} Wins Round!`);
        } else {
            // Next turn
            setTimeout(nextTurn, 1000);
        }
    } else {
        console.error("AI has no move but ensurePlayable returned playable");
    }
}

function render() {
    renderBoard();
    renderHands();
    renderHUD();
    requestAnimationFrame(updateZoom);
}

function renderHUD() {
    scoreEls.forEach((el, i) => {
        if (i < game.players.length) {
            el.textContent = `${game.players[i].name}: ${game.players[i].score}`;
            el.classList.remove('hidden');
            if (i === game.turnIndex) {
                el.style.color = '#0f0'; // Highlight active
                el.style.textShadow = '0 0 5px #0f0';
            } else {
                el.style.color = 'white';
                el.style.textShadow = 'none';
            }
        } else {
            el.classList.add('hidden');
        }
    });

    boneyardCountEl.textContent = game.deck.tiles.length;

    // Series Tracker - just track P1 wins vs CPU wins (aggregate) for now?
    // Or just "Match Wins".
    // Let's list all wins? "Series: P1(0) AI1(0)..."
    // Might be too long.
    // "Wins: " + list
    const winsStr = game.players.map(p => `${p.name.substr(0,3)}:${p.wins}`).join(' ');
    seriesTrackerEl.textContent = `Series: ${winsStr}`;

    if (game.isGameOver) {
        messageAreaEl.textContent = `Game Over! Winner: ${game.gameWinner.name}`;
        startBtn.textContent = "Next Game";
    }
}

function updateActivePlayerDisplay() {
    // Handled in renderHUD
}

function getHandContainerId(playerIndex) {
    if (playerIndex === 0) return 'bottom';

    if (game.players.length === 2) {
        return 'top';
    } else {
        // 4 Players: 0(Bottom), 1(Left), 2(Top), 3(Right)
        if (playerIndex === 1) return 'left';
        if (playerIndex === 2) return 'top';
        if (playerIndex === 3) return 'right';
    }
    return 'top'; // Fallback
}

function renderHands() {
    // Clear all
    Object.values(handContainers).forEach(el => {
        el.innerHTML = '';
        el.classList.add('hidden');
    });

    game.players.forEach((p, i) => {
        const side = getHandContainerId(i);
        const container = handContainers[side];
        container.classList.remove('hidden');

        // P0 (Human) logic
        if (i === 0) {
            p.hand.forEach((tile, index) => {
                const tileEl = createTileElement(tile);
                tileEl.classList.remove('horizontal');
                tileEl.classList.add('vertical');
                tileEl.dataset.index = index;
                tileEl.draggable = true;
                tileEl.addEventListener('dragstart', (e) => handleDragStart(e, index));
                tileEl.addEventListener('click', () => onPlayerTileClick(index));

                // Highlight valid moves only if it's player's turn
                if (game.turnIndex === 0 && !game.isGameOver) {
                    const validMoves = game.board.getValidMoves(p.hand);
                    const isValid = validMoves.some(m => m.index === index);
                    if (isValid) tileEl.classList.add('valid');
                }

                container.appendChild(tileEl);
            });
        } else {
            // AI Hands (Face Down)
            p.hand.forEach(() => {
                const tileEl = document.createElement('div');
                tileEl.className = 'domino';
                container.appendChild(tileEl);
            });
        }
    });
}

function createTileElement(tile) {
    const el = document.createElement('div');
    el.className = 'domino';

    const top = document.createElement('div');
    top.className = 'half';
    createPips(tile.val1, top);

    const line = document.createElement('div');
    line.className = 'line';

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
        0: [], 1: [5], 2: [1, 9], 3: [1, 5, 9],
        4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9]
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
        if (game.turnIndex === 0) boardEl.appendChild(createDropZone('start'));
    } else {
        if (game.turnIndex === 0) boardEl.appendChild(createDropZone('left'));
    }

    // Main Line
    game.board.placedTiles.forEach(item => {
        const tile = item.domino;
        const el = createTileElement(tile);

        if (tile.isDouble()) el.classList.add('vertical');
        else el.classList.add('horizontal');

        if (item.flipped) el.style.transform = 'rotate(180deg)';

        if (game.board.spinner && tile === game.board.spinner) {
            renderBranches(el);
        }

        boardEl.appendChild(el);
    });

    if (game.board.placedTiles.length > 0 && game.turnIndex === 0) {
        boardEl.appendChild(createDropZone('right'));
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
    const topContainer = document.createElement('div');
    topContainer.className = 'branch-container top-branch';

    game.board.topBranch.forEach(item => {
        const tile = item.domino;
        const el = createTileElement(tile);
        if (tile.isDouble()) el.classList.add('horizontal');
        else el.classList.add('vertical');
        if (item.flipped) el.style.transform = 'rotate(180deg)';
        topContainer.appendChild(el);
    });

    if (game.turnIndex === 0) topContainer.appendChild(createDropZone('top'));
    spinnerEl.appendChild(topContainer);

    const bottomContainer = document.createElement('div');
    bottomContainer.className = 'branch-container bottom-branch';

    game.board.bottomBranch.forEach(item => {
        const tile = item.domino;
        const el = createTileElement(tile);
        if (tile.isDouble()) el.classList.add('horizontal');
        else el.classList.add('vertical');
        if (item.flipped) el.style.transform = 'rotate(180deg)';
        bottomContainer.appendChild(el);
    });

    if (game.turnIndex === 0) bottomContainer.appendChild(createDropZone('bottom'));
    spinnerEl.appendChild(bottomContainer);
}

function handleDragStart(e, index) {
    if (game.turnIndex !== 0) {
        e.preventDefault();
        return;
    }
    draggedTileIndex = index;

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
    e.preventDefault();
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

    const moves = game.board.getValidMoves(game.players[0].hand);
    const tileMoves = moves.filter(m => m.index === index);

    if (tileMoves.length === 0) {
        showMessage("Invalid tile!");
        return;
    }

    if (tileMoves.length === 1) {
        executeMove(tileMoves[0]);
    } else {
        const sides = tileMoves.map(m => m.side);
        const sideMap = { 'left': 'L', 'right': 'R', 'top': 'T', 'bottom': 'B' };
        const options = sides.map(s => `${sideMap[s]}: ${s}`).join(', ');

        let choice = prompt(`Play where? (${options})`).toUpperCase();
        const keyMap = { 'L': 'left', 'R': 'right', 'T': 'top', 'B': 'bottom' };
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
        showScorePopup(result.score, 'bottom');
    }

    if (result.type === 'win') {
        handleRoundOver("Domino! You Win!");
        return;
    }

    if (result.type === 'game_over') {
         return;
    }

    // Trigger next turn
    nextTurn();
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
            nextTurn();
        }, 3000);
    }
}

function showMessage(msg) {
    messageAreaEl.textContent = msg;
}

function showScorePopup(points, side) {
    // Positioning based on side
    let top = '50%', left = '50%';
    if (side === 'bottom') { top = '80%'; left = '50%'; }
    if (side === 'top') { top = '20%'; left = '50%'; }
    if (side === 'left') { top = '50%'; left = '20%'; }
    if (side === 'right') { top = '50%'; left = '80%'; }

    scorePopupEl.textContent = `+${points}`;
    scorePopupEl.classList.remove('hidden');
    scorePopupEl.classList.add('slide-up');

    scorePopupEl.style.left = left;
    scorePopupEl.style.top = top;

    setTimeout(() => {
        scorePopupEl.classList.remove('slide-up');
        scorePopupEl.classList.add('hidden');
    }, 1500);
}

function updateZoom() {
    const boardAreaEl = document.getElementById('board-area');
    if (!boardAreaEl) return;

    const areaRect = boardAreaEl.getBoundingClientRect();
    const centerX = areaRect.left + areaRect.width / 2;
    const centerY = areaRect.top + areaRect.height / 2;

    const elements = boardEl.querySelectorAll('.domino, .drop-zone');
    if (elements.length === 0) {
        boardEl.style.transform = 'scale(1)';
        return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.left < minX) minX = rect.left;
        if (rect.top < minY) minY = rect.top;
        if (rect.right > maxX) maxX = rect.right;
        if (rect.bottom > maxY) maxY = rect.bottom;
    });

    const computedStyle = window.getComputedStyle(boardEl);
    const matrix = new DOMMatrix(computedStyle.transform);
    const currentScale = matrix.a;

    const distLeft = centerX - minX;
    const distRight = maxX - centerX;
    const distTop = centerY - minY;
    const distBottom = maxY - centerY;

    const maxDistX = Math.max(distLeft, distRight);
    const maxDistY = Math.max(distTop, distBottom);

    const padding = 20;
    const availX = (areaRect.width / 2) - padding;
    const availY = (areaRect.height / 2) - padding;

    let scaleX = (availX * currentScale) / maxDistX;
    let scaleY = (availY * currentScale) / maxDistY;

    if (maxDistX === 0) scaleX = 1;
    if (maxDistY === 0) scaleY = 1;

    let newScale = Math.min(scaleX, scaleY);
    if (newScale > 1) newScale = 1;
    if (newScale < 0.1) newScale = 0.1;

    boardEl.style.transform = `scale(${newScale})`;
}

// Initial
render();
