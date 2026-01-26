// ui.js

const game = new Game();

// DOM Elements
const boardEl = document.getElementById('board');
const seriesTrackerEl = document.getElementById('series-tracker');
const messageAreaEl = document.getElementById('message-area');
const boneyardCountEl = document.getElementById('boneyard-count');
const startBtn = document.getElementById('start-btn');
const controlsEl = document.getElementById('controls');
const difficultySelect = document.getElementById('difficulty');
const playerCountSelect = document.getElementById('player-count');
const scorePopupEl = document.getElementById('score-popup');

// Score Elements (by position)
const scoreContainers = {
    bottom: document.getElementById('score-bottom'),
    top: document.getElementById('score-top'),
    left: document.getElementById('score-left'),
    right: document.getElementById('score-right')
};

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

// Constants
const TILE_W = 44;
const TILE_H = 88;
const GAP = 2; // Reduced gap for cleaner connection
const TURN_LIMIT_TILES = 5; // Turn after N tiles in a branch

// Audio
const audio = {
    thud: new Audio('assets/thud.mp3'),
    chime: new Audio('assets/chime.mp3')
};
// Preload
audio.thud.load();
audio.chime.load();

function playSound(type) {
    if (audio[type]) {
        audio[type].currentTime = 0;
        audio[type].play().catch(e => console.log("Audio play failed (user interaction needed):", e));
    }
}

// Init
startBtn.addEventListener('click', startGame);
window.addEventListener('resize', updateZoom);

function startGame() {
    // Reveal logo on start if hidden? Or maybe in HUD?
    const logo = document.getElementById('game-logo');
    if (logo) logo.style.display = 'inline-block';
    const count = parseInt(playerCountSelect.value);
    game.startNewGame(count);
    controlsEl.classList.add('hidden');
    render();
    nextTurn();
}

function nextTurn() {
    if (game.isGameOver) return;
    if (game.isRoundOver) return;

    const player = game.players[game.turnIndex];
    messageAreaEl.textContent = `Turn: ${player.name}`;

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
        handleRoundOver("Game Blocked!");
    } else if (status === 'pass') {
        showMessage("You are blocked. Passing...");
        setTimeout(nextTurn, 1500);
    } else {
        showMessage("Your Turn");
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

    render();

    const diff = difficultySelect.value;
    const move = game.getAIMove(diff);

    if (move) {
        const result = game.playTurn(move);
        playSound('thud');
        render();
        if (result.score > 0) {
            playSound('chime');
            const prevIndex = (game.turnIndex - 1 + game.players.length) % game.players.length;
            showScorePopup(result.score, getHandContainerId(prevIndex));
        }

        if (result.type === 'win') {
            handleRoundOver(`${player.name} Wins Round!`);
        } else {
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
    Object.values(scoreContainers).forEach(el => el.classList.add('hidden'));

    game.players.forEach((p, i) => {
        const side = getHandContainerId(i);
        const el = scoreContainers[side];

        if (el) {
            el.textContent = `${p.name}: ${p.score}`;
            el.classList.remove('hidden');

            if (i === game.turnIndex) {
                el.style.color = '#0f0';
                el.style.textShadow = '0 0 5px #0f0';
            } else {
                el.style.color = 'white';
                el.style.textShadow = 'none';
            }
        }
    });

    boneyardCountEl.textContent = game.deck.tiles.length;

    const winsStr = game.players.map(p => `${p.name.substr(0,3)}:${p.wins}`).join(' ');
    seriesTrackerEl.textContent = `Series: ${winsStr}`;

    if (game.isGameOver) {
        messageAreaEl.textContent = `Game Over! Winner: ${game.gameWinner.name}`;
        startBtn.textContent = "Next Game";
        controlsEl.classList.remove('hidden');
    }
}

function updateActivePlayerDisplay() {
    // Handled in renderHUD
}

function getHandContainerId(playerIndex) {
    if (playerIndex === 0) return 'bottom';

    if (game.players.length === 2) {
        return 'top';
    } else if (game.players.length === 3) {
        if (playerIndex === 1) return 'left';
        if (playerIndex === 2) return 'right';
    } else {
        if (playerIndex === 1) return 'left';
        if (playerIndex === 2) return 'top';
        if (playerIndex === 3) return 'right';
    }
    return 'top';
}

function renderHands() {
    Object.values(handContainers).forEach(el => {
        el.innerHTML = '';
        el.classList.add('hidden');
    });

    game.players.forEach((p, i) => {
        const side = getHandContainerId(i);
        const container = handContainers[side];
        container.classList.remove('hidden');

        if (i === 0) {
            p.hand.forEach((tile, index) => {
                const tileEl = createTileElement(tile);
                tileEl.classList.remove('horizontal');
                tileEl.classList.add('vertical');
                tileEl.dataset.index = index;
                tileEl.draggable = true;
                tileEl.addEventListener('dragstart', (e) => handleDragStart(e, index));
                tileEl.addEventListener('click', () => onPlayerTileClick(index));

                if (game.turnIndex === 0 && !game.isGameOver) {
                    const validMoves = game.board.getValidMoves(p.hand);
                    const isValid = validMoves.some(m => m.index === index);
                    if (isValid) tileEl.classList.add('valid');
                }

                container.appendChild(tileEl);
            });
        } else {
            p.hand.forEach(() => {
                const tileEl = document.createElement('div');
                tileEl.className = 'domino';
                if (side === 'left' || side === 'right') {
                    tileEl.classList.add('horizontal');
                }
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

function createDropZone(side) {
    const el = document.createElement('div');
    el.className = 'drop-zone';
    el.dataset.side = side;
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('drop', handleDrop);
    el.addEventListener('click', handleZoneClick);
    return el;
}

// ---------------------------------------------------------
// Layout Engine for Turning Branches
// ---------------------------------------------------------

class LayoutWalker {
    constructor(startX, startY, direction) {
        this.x = startX;
        this.y = startY;
        this.dir = direction; // 'left', 'right', 'up', 'down'
        this.count = 0;
    }

    turn(newDir) {
        this.dir = newDir;
    }

    place(tileObj, nextEl) {
        // tileObj: {domino, flipped}
        const tile = tileObj.domino;
        const isDouble = tile.isDouble();

        let width = 0, height = 0;
        let rotation = 0;

        // Determine Tile Dimensions and Rotation based on Walker Direction
        if (this.dir === 'left' || this.dir === 'right') {
            // Horizontal movement
            if (isDouble) {
                // Double in Horizontal line -> Vertical placement
                width = TILE_W; // 44
                height = TILE_H; // 88
                rotation = 0; // Vertical
            } else {
                // Regular in Horizontal line -> Horizontal placement
                width = TILE_H; // 88
                height = TILE_W; // 44
                rotation = 270; // Horizontal (Corrected for Logic)
            }
        } else {
            // Vertical movement (Up/Down)
            if (isDouble) {
                // Double in Vertical line -> Horizontal placement
                width = TILE_H; // 88
                height = TILE_W; // 44
                rotation = 90; // Horizontal
            } else {
                // Regular in Vertical line -> Vertical placement
                width = TILE_W; // 44
                height = TILE_H; // 88
                rotation = 0; // Vertical
            }
        }

        // Flipped logic handled by rotation adjust?
        // Standard rotation 0 is Vertical. 90 is Horizontal (Top is Left).
        // If 90 (Horizontal): Top is Left.
        // If flipped, rotate 180.
        // BUT logic depends on connection.
        // Simple hack: apply visual rotation based on `flipped` flag.
        // The `flipped` flag from Board logic assumes a linear connection.
        // If we turn, `flipped` might need re-interpretation, but let's trust Board logic.
        // Just add 180 to rotation if flipped.
        if (tileObj.flipped) rotation += 180;

        // Calculate Center Position
        // Move half-dimension from current tip
        let dx = 0, dy = 0;

        if (this.dir === 'left') dx = -width/2 - GAP;
        if (this.dir === 'right') dx = width/2 + GAP;
        if (this.dir === 'up') dy = -height/2 - GAP;
        if (this.dir === 'down') dy = height/2 + GAP;

        this.x += dx;
        this.y += dy;

        // Apply styles
        nextEl.style.left = `${this.x}px`;
        nextEl.style.top = `${this.y}px`;
        // Centering
        nextEl.style.marginLeft = `-${TILE_W/2}px`; // Pivot is center of unrotated element
        nextEl.style.marginTop = `-${TILE_H/2}px`;
        nextEl.style.transform = `rotate(${rotation}deg)`;

        // Remove flex classes as we use absolute
        nextEl.classList.remove('horizontal', 'vertical');

        // Advance tip to other side of tile
        if (this.dir === 'left') this.x -= (width/2);
        if (this.dir === 'right') this.x += (width/2);
        if (this.dir === 'up') this.y -= (height/2);
        if (this.dir === 'down') this.y += (height/2);

        this.count++;
        return { x: this.x, y: this.y };
    }
}

function renderBoard() {
    boardEl.innerHTML = '';

    // --- Render Spinner ---
    // If no tiles, just start drop zone
    if (game.board.placedTiles.length === 0) {
        if (game.turnIndex === 0) {
            const dz = createDropZone('start');
            centerElement(dz, 0, 0);
            boardEl.appendChild(dz);
        }
        return;
    }

    // Find Spinner
    const spinner = game.board.spinner;
    let spinnerEl = null;

    // Helper to find spinner index in main array
    let spinnerIndex = -1;
    if (spinner) {
        spinnerIndex = game.board.placedTiles.findIndex(t => t.domino === spinner);
    } else {
        // No spinner yet (only line)
        // Treat index 0 as start? Or center logic?
        // We need a reference point.
        // If no spinner, let's treat the first tile placed as center (0,0).
        spinnerIndex = 0;
    }

    // 1. Render Center Tile (Spinner or First Tile)
    const centerTileObj = game.board.placedTiles[spinnerIndex];
    spinnerEl = createTileElement(centerTileObj.domino);

    // Center is usually Vertical (if double) or Horizontal (if not)?
    // Rules: First double is spinner.
    // If first play is not double, it's horizontal.
    // If first play IS double, it's vertical.
    let centerRotation = 0;
    let centerWidth = TILE_W, centerHeight = TILE_H;

    if (centerTileObj.domino.isDouble()) {
        centerRotation = 0; // Vertical
        centerWidth = TILE_W; centerHeight = TILE_H;
    } else {
        centerRotation = 270; // Horizontal
        centerWidth = TILE_H; centerHeight = TILE_W;
    }
    if (centerTileObj.flipped) centerRotation += 180;

    centerElement(spinnerEl, 0, 0, centerRotation);
    boardEl.appendChild(spinnerEl);

    // 2. Render Left Branch (Tiles BEFORE center, in reverse)
    const leftBranchTiles = game.board.placedTiles.slice(0, spinnerIndex).reverse();
    renderBranch(leftBranchTiles, 'left', -centerWidth/2, 0, 'up'); // Left -> Turns Up

    // 3. Render Right Branch (Tiles AFTER center)
    const rightBranchTiles = game.board.placedTiles.slice(spinnerIndex + 1);
    renderBranch(rightBranchTiles, 'right', centerWidth/2, 0, 'down'); // Right -> Turns Down

    // 4. Render Top Branch
    if (game.board.topBranch.length > 0 || (spinner && game.turnIndex === 0)) {
        renderBranch(game.board.topBranch, 'up', 0, -centerHeight/2, 'left'); // Up -> Turns Left
    }

    // 5. Render Bottom Branch
    if (game.board.bottomBranch.length > 0 || (spinner && game.turnIndex === 0)) {
        renderBranch(game.board.bottomBranch, 'down', 0, centerHeight/2, 'right'); // Down -> Turns Right
    }
}

function renderBranch(tiles, startDir, startX, startY, turnDir) {
    const walker = new LayoutWalker(startX, startY, startDir);

    tiles.forEach(tileObj => {
        // Check for Turn
        if (walker.count >= TURN_LIMIT_TILES) {
             walker.turn(turnDir);
        }

        const el = createTileElement(tileObj.domino);
        walker.place(tileObj, el);
        boardEl.appendChild(el);
    });

    // Render Drop Zone at tip
    if (game.turnIndex === 0) {
        // Determine side name based on startDir?
        // Wait, game logic uses 'left', 'right', 'top', 'bottom'.
        // We need to map `startDir` back to game logic side.
        let side = startDir; // 'left', 'right', 'up'->'top', 'down'->'bottom'
        if (startDir === 'up') side = 'top';
        if (startDir === 'down') side = 'bottom';

        // Wait, if tiles is empty, we still render drop zone if it's a spinner branch?
        // Logic in renderBoard handles empty array call.
        // But only if spinner exists.

        // Special Case: Main line ends (Left/Right) always have drop zones if not blocked.
        // But game.board.getValidMoves checks logic.
        // We just place DropZone at the end of the branch.

        // Is this DropZone valid?
        // We assume renderBranch is called for a valid logical branch.
        // Main line branches (left/right) exist.
        // Spinner branches (top/bottom) exist only if spinner exists.

        const dz = createDropZone(side);

        // Position Drop Zone
        // Drop Zone should look like a slot for the next tile.
        // If walker direction is horizontal, DropZone is Horizontal (88x44).
        // If vertical, Vertical (44x88).
        // BUT DropZone dimensions in CSS were fixed. We should adjust.

        let dzW = 0, dzH = 0;
        if (walker.dir === 'left' || walker.dir === 'right') {
            dz.style.width = '88px';
            dz.style.height = '44px';
            dzW = 88; dzH = 44;
        } else {
            dz.style.width = '44px';
            dz.style.height = '88px';
            dzW = 44; dzH = 88;
        }

        let dx = 0, dy = 0;
        if (walker.dir === 'left') dx = -dzW/2 - GAP;
        if (walker.dir === 'right') dx = dzW/2 + GAP;
        if (walker.dir === 'up') dy = -dzH/2 - GAP;
        if (walker.dir === 'down') dy = dzH/2 + GAP;

        const dzX = walker.x + dx;
        const dzY = walker.y + dy;

        dz.style.left = `${dzX}px`;
        dz.style.top = `${dzY}px`;
        dz.style.marginLeft = `-${dzW/2}px`;
        dz.style.marginTop = `-${dzH/2}px`;

        boardEl.appendChild(dz);
    }
}

function centerElement(el, x, y, rotation=0) {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.marginLeft = `-${TILE_W/2}px`;
    el.style.marginTop = `-${TILE_H/2}px`;
    if (rotation !== 0) el.style.transform = `rotate(${rotation}deg)`;
    el.classList.remove('horizontal', 'vertical'); // Ensure base 44x88
}


// --- Rest of Event Handlers ---

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

function handleZoneClick(e) {
    e.preventDefault();
    if (selectedTileIndex === null) return;

    const side = e.currentTarget.dataset.side;
    const moves = game.board.getValidMoves(game.players[0].hand);
    const validMove = moves.find(m => m.index === selectedTileIndex && m.side === side);

    if (validMove) {
        executeMove(validMove);
        cleanupSelection();
    }
}

function cleanupDrag() {
    draggedTileIndex = null;
    const zones = document.querySelectorAll('.drop-zone');
    zones.forEach(zone => {
        zone.classList.remove('highlight');
        zone.classList.remove('drag-over');
    });
}

function cleanupSelection() {
    selectedTileIndex = null;
    const zones = document.querySelectorAll('.drop-zone');
    zones.forEach(zone => zone.classList.remove('highlight'));
    const tiles = document.querySelectorAll('.domino');
    tiles.forEach(t => t.classList.remove('selected'));
}

function onPlayerTileClick(index) {
    if (game.turnIndex !== 0) return;
    if (game.isGameOver) return;

    if (selectedTileIndex === index) {
        cleanupSelection();
        return;
    }

    cleanupSelection();
    selectedTileIndex = index;

    const moves = game.board.getValidMoves(game.players[0].hand);
    const tileMoves = moves.filter(m => m.index === index);

    if (tileMoves.length === 0) {
        showMessage("Invalid tile!");
        selectedTileIndex = null;
        return;
    }

    const handContainer = handContainers['bottom'];
    const tileEl = handContainer.querySelector(`.domino[data-index="${index}"]`);
    if (tileEl) tileEl.classList.add('selected');

    if (tileMoves.length === 1) {
        executeMove(tileMoves[0]);
        cleanupSelection();
    } else {
        showMessage("Select a position.");
        const zones = document.querySelectorAll('.drop-zone');
        zones.forEach(zone => {
            const side = zone.dataset.side;
            const isValid = tileMoves.some(m => m.side === side);
            if (isValid) {
                zone.classList.add('highlight');
            }
        });
    }
}

function executeMove(moveInfo) {
    const result = game.playTurn(moveInfo);

    if (result.type === 'invalid') {
        showMessage("Error: Invalid move");
        return;
    }

    playSound('thud');
    render();

    if (result.score > 0) {
        playSound('chime');
        showScorePopup(result.score, 'bottom');
    }

    if (result.type === 'win') {
        handleRoundOver("Domino! You Win!");
        return;
    }

    if (result.type === 'game_over') {
         return;
    }

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

    // BoardEl is at center of boardArea (absolute position logic).
    // The elements are positioned relative to boardEl's (0,0).
    // We need the bounding box of the elements in boardEl's local space.

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    elements.forEach(el => {
        // We use offsetLeft/Top because they are positioned absolutely relative to boardEl
        // BUT transform might affect bounding rect if we used that.
        // Let's use computed style left/top values?
        // Actually, elements have 'left' and 'top' set explicitly.
        // We also need to account for width/height and transforms.

        // Simpler: Use getBoundingClientRect of elements and compare to boardEl's center.
        // BUT current transform of boardEl affects rects.
        // We want the unscaled bounds.

        // Since we know the layout logic (x,y), we could just track min/max X/Y in the walker.
        // But doing it via DOM is robust.

        // Strategy:
        // 1. Reset scale to 1.
        // 2. Measure.
        // 3. Apply new scale.
        // BUT this causes flickering.

        // Better Strategy:
        // Use the explicit Left/Top/Width/Height we set.
        // Left/Top are center points in my logic?
        // No, in my logic:
        // style.left = x
        // style.marginLeft = -w/2
        // So x is center.
        // Bounds are x - w/2, x + w/2.

        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top) || 0;
        // W/H depends on rotation.
        // I set w=44, h=88 base.
        // If rotated 90 or 270, w becomes 88.
        // But I use CSS transform rotate.
        // Bounding box of rotated element:
        // If 44x88 rotated 90deg, it occupies 88x44.

        let w = 44, h = 88;
        // Check transform
        const transform = el.style.transform;
        if (transform.includes('rotate(90deg)') || transform.includes('rotate(270deg)')) {
            w = 88; h = 44;
        }

        // Check my manual override for horizontal tiles in LayoutWalker
        // "nextEl.classList.remove('horizontal')"
        // "width = TILE_H; rotation=90"

        // Just use a safe box size of 88x88 for each tile to avoid clipping?
        // Or calculate accurately.

        if (x - w/2 < minX) minX = x - w/2;
        if (x + w/2 > maxX) maxX = x + w/2;
        if (y - h/2 < minY) minY = y - h/2;
        if (y + h/2 > maxY) maxY = y + h/2;
    });

    const width = maxX - minX;
    const height = maxY - minY;

    // Add padding
    const padding = 40;
    const reqW = width + padding * 2;
    const reqH = height + padding * 2;

    const availW = areaRect.width;
    const availH = areaRect.height;

    const scaleX = availW / reqW;
    const scaleY = availH / reqH;

    let newScale = Math.min(scaleX, scaleY);
    if (newScale > 1) newScale = 1; // Don't zoom in too much
    if (newScale < 0.2) newScale = 0.2; // Min zoom limit

    boardEl.style.transform = `scale(${newScale})`;

    // Center alignment?
    // boardEl is centered in area.
    // But the content (tiles) might be off-center relative to (0,0).
    // e.g. Left branch is long, Right is short.
    // (0,0) is at center of screen. Content is shifted Left.
    // Visually it looks unbalanced.
    // We should translate boardEl to center the content.

    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;

    // We want contentCenterX to be at screen center (0,0 of boardEl).
    // So shift boardEl by -contentCenterX.
    // But boardEl's transform origin is center.
    // We can add translate to the transform string.

    boardEl.style.transform = `scale(${newScale}) translate(${-contentCenterX}px, ${-contentCenterY}px)`;
}

// Initial
render();
