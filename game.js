// game.js - Core Logic

class Domino {
    constructor(val1, val2) {
        this.val1 = val1;
        this.val2 = val2;
    }

    get total() {
        return this.val1 + this.val2;
    }

    isDouble() {
        return this.val1 === this.val2;
    }

    // Helper to check if this tile has a specific value
    has(val) {
        return this.val1 === val || this.val2 === val;
    }
}

class Deck {
    constructor() {
        this.tiles = [];
        this.generate();
    }

    generate() {
        this.tiles = [];
        for (let i = 0; i <= 6; i++) {
            for (let j = i; j <= 6; j++) {
                this.tiles.push(new Domino(i, j));
            }
        }
    }

    shuffle() {
        for (let i = this.tiles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.tiles[i], this.tiles[j]] = [this.tiles[j], this.tiles[i]];
        }
    }

    draw() {
        return this.tiles.pop();
    }

    isEmpty() {
        return this.tiles.length === 0;
    }
}

class Board {
    constructor() {
        // List of placed tiles. Each element: { domino: Domino, flipped: boolean }
        // We will track the line conceptually.
        // For the UI, we need the sequence.
        // For logic, we mainly need the open ends.
        this.placedTiles = [];
        this.leftOpen = null;
        this.rightOpen = null;
    }

    // Place the first tile
    placeFirst(domino) {
        this.placedTiles.push({ domino, flipped: false }); // Flipped doesn't matter much for first, but let's say val1 is left, val2 is right originally.
        this.leftOpen = domino.val1;
        this.rightOpen = domino.val2;
        return this.calculateScore();
    }

    // Check if a move is valid
    // side: 'left' or 'right'
    isValidMove(domino, side) {
        if (this.placedTiles.length === 0) return true;

        if (side === 'left') {
            return domino.val1 === this.leftOpen || domino.val2 === this.leftOpen;
        } else if (side === 'right') {
            return domino.val1 === this.rightOpen || domino.val2 === this.rightOpen;
        }
        return false;
    }

    getValidMoves(hand) {
        const moves = [];
        if (this.placedTiles.length === 0) {
            // All tiles are valid
             hand.forEach((d, index) => {
                 moves.push({ index, domino: d, side: 'start' });
             });
             return moves;
        }

        hand.forEach((d, index) => {
            if (this.isValidMove(d, 'left')) moves.push({ index, domino: d, side: 'left' });
            // If it can be played on right, add it too. A tile might be playable on both ends.
            // Avoid duplicate entries if leftOpen == rightOpen? No, distinct moves.
            if (this.isValidMove(d, 'right')) moves.push({ index, domino: d, side: 'right' });
        });
        return moves;
    }

    // Place a tile
    // side: 'left' or 'right'
    // domino: the Domino object
    // Returns the score of the move
    place(domino, side) {
        let score = 0;
        let flipped = false;

        if (this.placedTiles.length === 0) {
            return this.placeFirst(domino);
        }

        if (side === 'left') {
            // We need to match this.leftOpen
            if (domino.val2 === this.leftOpen) {
                // Matches normally: [d.v1|d.v2] - [leftOpen|...]
                this.leftOpen = domino.val1;
                flipped = false;
            } else if (domino.val1 === this.leftOpen) {
                // Needs flip: [d.v2|d.v1] - [leftOpen|...]
                this.leftOpen = domino.val2;
                flipped = true;
            } else {
                throw new Error("Invalid move on left");
            }
            this.placedTiles.unshift({ domino, flipped });
        } else if (side === 'right') {
             // We need to match this.rightOpen
             if (domino.val1 === this.rightOpen) {
                 // Matches normally: [...|rightOpen] - [d.v1|d.v2]
                 this.rightOpen = domino.val2;
                 flipped = false;
             } else if (domino.val2 === this.rightOpen) {
                 // Needs flip: [...|rightOpen] - [d.v2|d.v1]
                 this.rightOpen = domino.val1;
                 flipped = true;
             } else {
                 throw new Error("Invalid move on right");
             }
             this.placedTiles.push({ domino, flipped });
        }

        return this.calculateScore();
    }

    calculatePotentialScore(domino, side) {
        if (this.placedTiles.length === 0) return domino.total;

        let predictedLeftOpen = this.leftOpen;
        let predictedRightOpen = this.rightOpen;
        let predictedLeftTile = this.placedTiles[0].domino;
        let predictedRightTile = this.placedTiles[this.placedTiles.length - 1].domino;

        if (side === 'left') {
            predictedLeftTile = domino;
            if (domino.val2 === this.leftOpen) predictedLeftOpen = domino.val1;
            else predictedLeftOpen = domino.val2;
        } else {
            predictedRightTile = domino;
            if (domino.val1 === this.rightOpen) predictedRightOpen = domino.val2;
            else predictedRightOpen = domino.val1;
        }

        let score = 0;
        // Left
        if (predictedLeftTile.isDouble()) score += predictedLeftTile.total;
        else score += predictedLeftOpen;

        // Right
        // Be careful if resulting board has only 1 tile?
        // But we are adding 1 to existing (>0), so length >= 2.
        if (predictedRightTile.isDouble()) score += predictedRightTile.total;
        else score += predictedRightOpen;

        return score;
    }

    calculateScore() {
        if (this.placedTiles.length === 0) return 0;

        if (this.placedTiles.length === 1) {
            return this.placedTiles[0].domino.total;
        }

        let score = 0;

        // Left End
        const leftTileObj = this.placedTiles[0];
        if (leftTileObj.domino.isDouble()) {
            score += leftTileObj.domino.total;
        } else {
            score += this.leftOpen;
        }

        // Right End
        const rightTileObj = this.placedTiles[this.placedTiles.length - 1];
        if (rightTileObj.domino.isDouble()) {
            score += rightTileObj.domino.total;
        } else {
            score += this.rightOpen;
        }

        return score;
    }
}

class Player {
    constructor(name, isAI = false) {
        this.name = name;
        this.isAI = isAI;
        this.hand = [];
        this.score = 0;
        this.wins = 0; // Series wins
    }

    resetHand() {
        this.hand = [];
    }

    addPoints(points) {
        this.score += points;
    }

    hasDomino(val1, val2) {
        return this.hand.some(d => (d.val1 === val1 && d.val2 === val2) || (d.val1 === val2 && d.val2 === val1));
    }

    removeDomino(index) {
        return this.hand.splice(index, 1)[0];
    }

    getHandTotal() {
        return this.hand.reduce((sum, d) => sum + d.total, 0);
    }
}

class Game {
    constructor() {
        this.players = [new Player("Player"), new Player("AI", true)];
        this.deck = new Deck();
        this.board = new Board();
        this.turnIndex = 0;
        this.targetScore = 150;
        this.gameWinner = null;
        this.isGameOver = false;
        this.isRoundOver = false;

        this.logs = []; // To store game events
    }

    log(msg) {
        this.logs.push(msg);
        console.log(msg); // For debug
    }

    startNewGame() {
        this.deck = new Deck();
        this.deck.shuffle();
        this.board = new Board();
        this.isGameOver = false;
        this.isRoundOver = false;
        this.gameWinner = null;
        this.players.forEach(p => {
            p.resetHand();
            // Score persists? No, "Best of 5" means whoever wins 3 games.
            // Usually score resets per game.
            // "Track match wins in a 'Best of 5' series."
            // So score resets.
            p.score = 0;
        });

        this.deal();
        this.determineFirstPlayer();
    }

    deal() {
        for (let i = 0; i < 7; i++) {
            this.players[0].hand.push(this.deck.draw());
            this.players[1].hand.push(this.deck.draw());
        }
    }

    determineFirstPlayer() {
        // Highest double rule
        // Find highest double in hands.
        let highestDouble = -1;
        let startingPlayerIndex = -1;
        let startingTileIndex = -1;

        // Check for doubles
        for (let p = 0; p < 2; p++) {
            for (let i = 0; i < this.players[p].hand.length; i++) {
                let d = this.players[p].hand[i];
                if (d.isDouble() && d.val1 > highestDouble) {
                    highestDouble = d.val1;
                    startingPlayerIndex = p;
                    startingTileIndex = i;
                }
            }
        }

        // If no doubles, highest tile (total pips)
        if (startingPlayerIndex === -1) {
            let highestTotal = -1;
            for (let p = 0; p < 2; p++) {
                for (let i = 0; i < this.players[p].hand.length; i++) {
                    let d = this.players[p].hand[i];
                    if (d.total > highestTotal) {
                        highestTotal = d.total;
                        startingPlayerIndex = p;
                        startingTileIndex = i;
                    } else if (d.total === highestTotal) {
                         // Tie breaker? Usually highest pip?
                         // e.g. 6-5 (11) vs 6-5... duplicate not possible.
                         // 5-6 vs ...
                    }
                }
            }
        }

        this.turnIndex = startingPlayerIndex;
        // The first player MUST play the highest double (or highest tile) as per standard rules?
        // "Use the standard Highest Double rule for the first move"
        // Usually this means the player WITH the highest double starts AND plays it.

        // I will automate the first move to simplify, or force the UI to only allow that move?
        // Prompt says "Use the standard Highest Double rule for the first move".
        // I'll make the Game state indicate who starts, and if it's the very first turn, restrict moves?
        // Actually, often the game just auto-plays the first tile to start.
        // Let's Auto-play the first tile to strictly enforce the rule and speed up start.

        const player = this.players[startingPlayerIndex];
        const tile = player.removeDomino(startingTileIndex);

        this.log(`${player.name} starts with ${tile.val1}-${tile.val2}`);

        const score = this.board.placeFirst(tile);
        if (score % 5 === 0) {
            player.addPoints(score);
            this.log(`${player.name} scores ${score} (First Move)`);
        }

        // Next turn
        this.turnIndex = (this.turnIndex + 1) % 2;
    }

    getAIMove(difficulty) {
        const player = this.players[this.turnIndex];
        if (!player.isAI) return null;

        const moves = this.board.getValidMoves(player.hand);
        if (moves.length === 0) return null;

        if (difficulty === 'easy') {
            const randomIndex = Math.floor(Math.random() * moves.length);
            return moves[randomIndex];
        } else {
            // Hard: Maximize score
            // We need to simulate the move to check the score.
            // Since Board.place modifies the board, we need a way to peek score or clone board.
            // Cloning board is safer but more expensive. Peeking score?
            // Board.place modifies placedTiles.
            // We can implement `simulateScore(domino, side)` in Board.

            // Or simpler: clone the board logic temporarily?
            // Let's add `calculatePotentialScore(domino, side)` to Board.

            // For now, I'll assume we add `calculatePotentialScore` to Board.
            // If not, I can create a temporary board.

            // Let's map moves to scores.
            const scoredMoves = moves.map(move => {
                const potentialScore = this.board.calculatePotentialScore(move.domino, move.side);
                const points = (potentialScore % 5 === 0) ? potentialScore : 0;
                // Secondary criteria: Weight of tile (get rid of heavy ones)
                const weight = move.domino.total;
                return { move, points, weight };
            });

            // Sort: Points Desc, then Weight Desc
            scoredMoves.sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                return b.weight - a.weight;
            });

            return scoredMoves[0].move;
        }
    }

    // Returns object with result: 'move', 'draw', 'pass', 'win', 'block'
    playTurn(moveInfo) {
        // moveInfo: { index, side } (for human) or just calculated for AI
        // This function executes a move.

        if (this.isGameOver) return { type: 'game_over' };

        const player = this.players[this.turnIndex];

        // Validate move
        const tile = player.hand[moveInfo.index];
        if (!this.board.isValidMove(tile, moveInfo.side)) {
            return { type: 'invalid' };
        }

        // Execute move
        player.removeDomino(moveInfo.index);
        const rawScore = this.board.place(tile, moveInfo.side);

        let scorePoints = 0;
        if (rawScore % 5 === 0 && rawScore > 0) {
            player.addPoints(rawScore);
            scorePoints = rawScore;
            this.log(`${player.name} plays ${tile.val1}-${tile.val2} and scores ${rawScore}`);
        } else {
            this.log(`${player.name} plays ${tile.val1}-${tile.val2}`);
        }

        // Check for Win (Domino!)
        if (player.hand.length === 0) {
            this.handleRoundEnd(player, "Domino!");
            return { type: 'win', score: scorePoints, reason: 'domino' };
        }

        // Next Turn
        this.turnIndex = (this.turnIndex + 1) % 2;

        // Check if next player is blocked
        // Logic should probably be in the loop controller, but let's handle "Draw" logic here or expose it.
        // Prompt: "automate drawing from the boneyard if no moves are available"
        // So we should check the new current player's state.

        return { type: 'move', score: scorePoints };
    }

    // Checks if current player can move, if not draws.
    // Returns true if player can now move (or passed if deck empty).
    ensurePlayable() {
        let player = this.players[this.turnIndex];
        let moves = this.board.getValidMoves(player.hand);

        while (moves.length === 0) {
            if (this.deck.isEmpty()) {
                this.log(`${player.name} is blocked and boneyard is empty. Passing.`);
                // Pass
                // Check if BOTH are blocked?
                const otherPlayer = this.players[(this.turnIndex + 1) % 2];
                const otherMoves = this.board.getValidMoves(otherPlayer.hand);
                if (otherMoves.length === 0) {
                    // Game Blocked
                    this.handleBlockedGame();
                    return 'blocked_game';
                }

                this.turnIndex = (this.turnIndex + 1) % 2;
                player = this.players[this.turnIndex]; // Switch to other player
                moves = this.board.getValidMoves(player.hand); // Check his moves

                // If we switched, we need to return status so UI knows turn changed?
                // For now, loop continues if THIS player is also blocked (which leads to blocked game above)
                // If swapped player has moves, we break and let them play.
                return 'pass';
            } else {
                const drawn = this.deck.draw();
                player.hand.push(drawn);
                this.log(`${player.name} draws a tile.`);
                moves = this.board.getValidMoves(player.hand);
            }
        }
        return 'playable';
    }

    handleRoundEnd(winner, reason) {
        this.log(`Round End: ${reason} - Winner: ${winner.name}`);
        const loser = this.players.find(p => p !== winner);
        const penalty = loser.getHandTotal();

        // Winner gets loser's points
        // Round to nearest 5? Standard All Fives usually does.
        // Let's implement rounding to nearest 5.
        // 1,2 -> 0. 3,4,6,7 -> 5. 8,9 -> 10.
        const remainder = penalty % 5;
        let pointsToAdd = penalty;
        if (remainder < 3) pointsToAdd -= remainder;
        else pointsToAdd += (5 - remainder);

        winner.addPoints(pointsToAdd);
        this.log(`${winner.name} gets ${pointsToAdd} points from opponent's hand (${penalty}).`);

        this.checkGameWin();
    }

    handleBlockedGame() {
        this.log("Game Blocked!");
        const p1Total = this.players[0].getHandTotal();
        const p2Total = this.players[1].getHandTotal();

        let winner;
        let points = 0;

        if (p1Total < p2Total) {
            winner = this.players[0];
            points = p2Total - p1Total;
        } else if (p2Total < p1Total) {
            winner = this.players[1];
            points = p1Total - p2Total;
        } else {
            this.log("Draw! No points awarded.");
            this.checkGameWin();
            return;
        }

        // Round points?
        const remainder = points % 5;
        let pointsToAdd = points;
        if (remainder < 3) pointsToAdd -= remainder;
        else pointsToAdd += (5 - remainder);

        winner.addPoints(pointsToAdd);
        this.log(`${winner.name} wins the block and gets ${pointsToAdd} points.`);
        this.checkGameWin();
    }

    checkGameWin() {
        // Check if anyone reached 150
        const p1 = this.players[0];
        const p2 = this.players[1];

        if (p1.score >= this.targetScore || p2.score >= this.targetScore) {
            this.isGameOver = true;
            if (p1.score > p2.score) {
                this.gameWinner = p1;
                p1.wins++;
            } else {
                this.gameWinner = p2;
                p2.wins++;
            }
            this.log(`Game Over! Winner: ${this.gameWinner.name}`);
        } else {
             // Round ends, but game continues?
             // Domino games usually consist of multiple hands to reach 150.
             // So "Round End" just means reshuffle and continue adding scores.

             // I need to reset board and hands, but KEEP scores.
             // Set flag so UI knows to pause.
             this.isRoundOver = true;
        }
    }

    startNextHand() {
        this.log("Starting next hand...");
        this.isRoundOver = false;
        this.deck = new Deck();
        this.deck.shuffle();
        this.board = new Board();
        this.players.forEach(p => p.resetHand());
        this.deal();
        // Who starts next hand?
        // Rules vary. "Winner of last hand" or "Rotate".
        // Let's say winner starts.
        // Or if blocked, the one who would have played?
        // I will use "Highest Double" again for simplicity unless specified.
        // Prompt says "Best of 5 series".
        // "Use the standard Highest Double rule for the first move".
        // This implies for the start of the GAME. Subsequent hands usually winner plays.
        // I'll re-run determineFirstPlayer logic for simplicity and fairness (Highest Double logic for every hand).
        this.determineFirstPlayer();
    }
}

if (typeof module !== 'undefined') {
    module.exports = { Domino, Deck, Board, Player, Game };
}
