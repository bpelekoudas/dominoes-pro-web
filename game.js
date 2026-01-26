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
        this.placedTiles = [];
        this.leftOpen = null;
        this.rightOpen = null;

        // Spinner Logic
        this.spinner = null; // The Domino object that is the spinner
        this.topBranch = []; // Array of {domino, flipped}
        this.bottomBranch = [];
        this.topOpen = null;
        this.bottomOpen = null;
    }

    // Place the first tile
    placeFirst(domino) {
        this.placedTiles.push({ domino, flipped: false });
        this.leftOpen = domino.val1;
        this.rightOpen = domino.val2;

        if (domino.isDouble()) {
            this.spinner = domino;
            this.topOpen = domino.val1;
            this.bottomOpen = domino.val1;
        }

        return this.calculateScore();
    }

    isSpinnerEnclosed() {
        if (!this.spinner) return false;
        if (this.placedTiles.length < 3) return false;

        const first = this.placedTiles[0].domino;
        const last = this.placedTiles[this.placedTiles.length - 1].domino;

        return first !== this.spinner && last !== this.spinner;
    }

    // Check if a move is valid
    isValidMove(domino, side) {
        if (this.placedTiles.length === 0) return true;

        if (side === 'left') {
            return domino.val1 === this.leftOpen || domino.val2 === this.leftOpen;
        } else if (side === 'right') {
            return domino.val1 === this.rightOpen || domino.val2 === this.rightOpen;
        } else if (side === 'top' && this.spinner) {
             if (this.topBranch.length === 0 && !this.isSpinnerEnclosed()) return false;
             const target = (this.topBranch.length === 0) ? this.spinner.val1 : this.topOpen;
             return domino.val1 === target || domino.val2 === target;
        } else if (side === 'bottom' && this.spinner) {
             if (this.bottomBranch.length === 0 && !this.isSpinnerEnclosed()) return false;
             const target = (this.bottomBranch.length === 0) ? this.spinner.val1 : this.bottomOpen;
             return domino.val1 === target || domino.val2 === target;
        }
        return false;
    }

    getValidMoves(hand) {
        const moves = [];
        if (this.placedTiles.length === 0) {
             hand.forEach((d, index) => {
                 moves.push({ index, domino: d, side: 'start' });
             });
             return moves;
        }

        hand.forEach((d, index) => {
            if (this.isValidMove(d, 'left')) moves.push({ index, domino: d, side: 'left' });
            if (this.isValidMove(d, 'right')) moves.push({ index, domino: d, side: 'right' });
            if (this.spinner) {
                if (this.isValidMove(d, 'top')) moves.push({ index, domino: d, side: 'top' });
                if (this.isValidMove(d, 'bottom')) moves.push({ index, domino: d, side: 'bottom' });
            }
        });
        return moves;
    }

    // Place a tile
    place(domino, side) {
        let flipped = false;

        if (this.placedTiles.length === 0) {
            return this.placeFirst(domino);
        }

        if (side === 'left') {
            if (domino.val2 === this.leftOpen) {
                this.leftOpen = domino.val1;
                flipped = false;
            } else if (domino.val1 === this.leftOpen) {
                this.leftOpen = domino.val2;
                flipped = true;
            } else {
                throw new Error("Invalid move on left");
            }
            this.placedTiles.unshift({ domino, flipped });
        } else if (side === 'right') {
             if (domino.val1 === this.rightOpen) {
                 this.rightOpen = domino.val2;
                 flipped = false;
             } else if (domino.val2 === this.rightOpen) {
                 this.rightOpen = domino.val1;
                 flipped = true;
             } else {
                 throw new Error("Invalid move on right");
             }
             this.placedTiles.push({ domino, flipped });
        } else if (side === 'top') {
            if (!this.spinner) throw new Error("No spinner");
            const target = (this.topBranch.length === 0) ? this.spinner.val1 : this.topOpen;

            if (domino.val1 === target) {
                this.topOpen = domino.val2;
                flipped = true;
            } else if (domino.val2 === target) {
                this.topOpen = domino.val1;
                flipped = false;
            } else {
                throw new Error("Invalid move on top");
            }
            this.topBranch.push({ domino, flipped });
        } else if (side === 'bottom') {
            if (!this.spinner) throw new Error("No spinner");
            const target = (this.bottomBranch.length === 0) ? this.spinner.val1 : this.bottomOpen;

            if (domino.val1 === target) {
                this.bottomOpen = domino.val2;
                flipped = false;
            } else if (domino.val2 === target) {
                this.bottomOpen = domino.val1;
                flipped = true;
            } else {
                throw new Error("Invalid move on bottom");
            }
            this.bottomBranch.push({ domino, flipped });
        }

        if (!this.spinner && (side === 'left' || side === 'right') && domino.isDouble()) {
            this.spinner = domino;
            this.topOpen = domino.val1;
            this.bottomOpen = domino.val1;
        }

        return this.calculateScore();
    }

    calculatePotentialScore(domino, side) {
        if (this.placedTiles.length === 0) return domino.total;

        let score = 0;
        let leftScore = 0;
        let rightScore = 0;
        let topScore = 0;
        let bottomScore = 0;

        if (this.placedTiles.length === 1) {
             leftScore = this.placedTiles[0].domino.total;
        } else {
             leftScore = this.placedTiles[0].domino.isDouble() ? this.placedTiles[0].domino.total : this.leftOpen;
             rightScore = this.placedTiles[this.placedTiles.length-1].domino.isDouble() ? this.placedTiles[this.placedTiles.length-1].domino.total : this.rightOpen;
        }

        if (this.topBranch.length > 0) topScore = this.topBranch[this.topBranch.length-1].domino.isDouble() ? this.topBranch[this.topBranch.length-1].domino.total : this.topOpen;
        if (this.bottomBranch.length > 0) bottomScore = this.bottomBranch[this.bottomBranch.length-1].domino.isDouble() ? this.bottomBranch[this.bottomBranch.length-1].domino.total : this.bottomOpen;

        if (side === 'left') {
            let newOpen = (domino.val2 === this.leftOpen) ? domino.val1 : domino.val2;
            let contribution = domino.isDouble() ? domino.total : newOpen;

            if (this.placedTiles.length === 1) {
                let oldTile = this.placedTiles[0].domino;
                let oldRightContrib = oldTile.isDouble() ? oldTile.total : this.rightOpen;
                score = oldRightContrib + contribution + topScore + bottomScore;
            } else {
                score = contribution + rightScore + topScore + bottomScore;
            }
        } else if (side === 'right') {
            let newOpen = (domino.val1 === this.rightOpen) ? domino.val2 : domino.val1;
            let contribution = domino.isDouble() ? domino.total : newOpen;

            if (this.placedTiles.length === 1) {
                let oldTile = this.placedTiles[0].domino;
                let oldLeftContrib = oldTile.isDouble() ? oldTile.total : this.leftOpen;
                score = oldLeftContrib + contribution + topScore + bottomScore;
            } else {
                score = leftScore + contribution + topScore + bottomScore;
            }
        } else if (side === 'top') {
             let target = (this.topBranch.length === 0) ? this.spinner.val1 : this.topOpen;
             let newOpen = (domino.val1 === target) ? domino.val2 : domino.val1;
             let contribution = domino.isDouble() ? domino.total : newOpen;

             if (this.placedTiles.length === 1) {
                  score = this.placedTiles[0].domino.total + contribution + bottomScore;
             } else {
                  score = leftScore + rightScore + contribution + bottomScore;
             }
        } else if (side === 'bottom') {
             let target = (this.bottomBranch.length === 0) ? this.spinner.val1 : this.bottomOpen;
             let newOpen = (domino.val1 === target) ? domino.val2 : domino.val1;
             let contribution = domino.isDouble() ? domino.total : newOpen;

             if (this.placedTiles.length === 1) {
                  score = this.placedTiles[0].domino.total + topScore + contribution;
             } else {
                  score = leftScore + rightScore + topScore + contribution;
             }
        }

        return score;
    }

    calculateScore() {
        if (this.placedTiles.length === 0) return 0;

        if (this.placedTiles.length === 1) {
            let score = this.placedTiles[0].domino.total;
            if (this.topBranch.length > 0) {
                 let tip = this.topBranch[this.topBranch.length-1].domino;
                 score += (tip.isDouble() ? tip.total : this.topOpen);
            }
            if (this.bottomBranch.length > 0) {
                 let tip = this.bottomBranch[this.bottomBranch.length-1].domino;
                 score += (tip.isDouble() ? tip.total : this.bottomOpen);
            }
            return score;
        }

        let score = 0;

        const leftTileObj = this.placedTiles[0];
        if (leftTileObj.domino.isDouble()) {
            score += leftTileObj.domino.total;
        } else {
            score += this.leftOpen;
        }

        const rightTileObj = this.placedTiles[this.placedTiles.length - 1];
        if (rightTileObj.domino.isDouble()) {
            score += rightTileObj.domino.total;
        } else {
            score += this.rightOpen;
        }

        if (this.topBranch.length > 0) {
             let tip = this.topBranch[this.topBranch.length-1].domino;
             score += (tip.isDouble() ? tip.total : this.topOpen);
        }
        if (this.bottomBranch.length > 0) {
             let tip = this.bottomBranch[this.bottomBranch.length-1].domino;
             score += (tip.isDouble() ? tip.total : this.bottomOpen);
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
        this.wins = 0;
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
        this.players = [];
        this.deck = new Deck();
        this.board = new Board();
        this.turnIndex = 0;
        this.targetScore = 150;
        this.gameWinner = null;
        this.isGameOver = false;
        this.isRoundOver = false;
        this.logs = [];
        this.passCount = 0; // Track consecutive passes
    }

    log(msg) {
        this.logs.push(msg);
        console.log(msg);
    }

    startNewGame(playerCount = 2) {
        this.deck = new Deck();
        this.deck.shuffle();
        this.board = new Board();
        this.isGameOver = false;
        this.isRoundOver = false;
        this.gameWinner = null;
        this.passCount = 0;

        // Preserve series wins if re-starting with same players
        if (this.players.length === playerCount) {
            // Reuse players, just reset hand and score
            this.players.forEach(p => {
                p.resetHand();
                p.score = 0;
            });
        } else {
            // New set of players
            this.players = [];
            this.players.push(new Player("Player")); // P0 Human
            for (let i = 1; i < playerCount; i++) {
                this.players.push(new Player(`AI ${i}`, true));
            }
        }

        this.deal();
        this.determineFirstPlayer();
    }

    deal() {
        const tilesPerPlayer = 7;
        this.players.forEach(p => {
            for (let i = 0; i < tilesPerPlayer; i++) {
                p.hand.push(this.deck.draw());
            }
        });
    }

    determineFirstPlayer() {
        let highestDouble = -1;
        let startingPlayerIndex = -1;
        let startingTileIndex = -1;

        for (let p = 0; p < this.players.length; p++) {
            for (let i = 0; i < this.players[p].hand.length; i++) {
                let d = this.players[p].hand[i];
                if (d.isDouble() && d.val1 > highestDouble) {
                    highestDouble = d.val1;
                    startingPlayerIndex = p;
                    startingTileIndex = i;
                }
            }
        }

        // If no doubles, highest total
        if (startingPlayerIndex === -1) {
            let highestTotal = -1;
            for (let p = 0; p < this.players.length; p++) {
                for (let i = 0; i < this.players[p].hand.length; i++) {
                    let d = this.players[p].hand[i];
                    if (d.total > highestTotal) {
                        highestTotal = d.total;
                        startingPlayerIndex = p;
                        startingTileIndex = i;
                    }
                }
            }
        }

        this.turnIndex = startingPlayerIndex;

        const player = this.players[startingPlayerIndex];
        const tile = player.removeDomino(startingTileIndex);

        this.log(`${player.name} starts with ${tile.val1}-${tile.val2}`);

        const score = this.board.placeFirst(tile);
        if (score % 5 === 0) {
            player.addPoints(score);
            this.log(`${player.name} scores ${score} (First Move)`);
        }

        this.turnIndex = (this.turnIndex + 1) % this.players.length;
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
            const scoredMoves = moves.map(move => {
                const potentialScore = this.board.calculatePotentialScore(move.domino, move.side);
                const points = (potentialScore % 5 === 0) ? potentialScore : 0;
                const weight = move.domino.total;
                return { move, points, weight };
            });

            scoredMoves.sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                return b.weight - a.weight;
            });

            return scoredMoves[0].move;
        }
    }

    playTurn(moveInfo) {
        if (this.isGameOver) return { type: 'game_over' };

        const player = this.players[this.turnIndex];

        const tile = player.hand[moveInfo.index];
        if (!this.board.isValidMove(tile, moveInfo.side)) {
            return { type: 'invalid' };
        }

        player.removeDomino(moveInfo.index);
        this.passCount = 0; // Reset pass count on successful move

        const rawScore = this.board.place(tile, moveInfo.side);

        let scorePoints = 0;
        if (rawScore % 5 === 0 && rawScore > 0) {
            player.addPoints(rawScore);
            scorePoints = rawScore;
            this.log(`${player.name} plays ${tile.val1}-${tile.val2} on ${moveInfo.side} and scores ${rawScore}`);
        } else {
            this.log(`${player.name} plays ${tile.val1}-${tile.val2} on ${moveInfo.side}`);
        }

        if (player.hand.length === 0) {
            this.handleRoundEnd(player, "Domino!");
            return { type: 'win', score: scorePoints, reason: 'domino' };
        }

        this.turnIndex = (this.turnIndex + 1) % this.players.length;

        return { type: 'move', score: scorePoints };
    }

    ensurePlayable() {
        let player = this.players[this.turnIndex];
        let moves = this.board.getValidMoves(player.hand);

        while (moves.length === 0) {
            if (this.deck.isEmpty()) {
                this.log(`${player.name} is blocked and boneyard is empty. Passing.`);

                this.passCount++;
                if (this.passCount >= this.players.length) {
                    this.handleBlockedGame();
                    return 'blocked_game';
                }

                this.turnIndex = (this.turnIndex + 1) % this.players.length;
                player = this.players[this.turnIndex];
                moves = this.board.getValidMoves(player.hand);
                return 'pass';
            } else {
                const drawn = this.deck.draw();
                player.hand.push(drawn);
                this.log(`${player.name} draws a tile.`);
                moves = this.board.getValidMoves(player.hand);
                // If they draw and can play, they break the pass chain?
                // Yes, because they will play in playTurn.
                // But wait, ensurePlayable just gets them to a state where they CAN play.
                // It doesn't play for them.
            }
        }
        // If we found a move (either initially or after draw), reset passCount if it was > 0?
        // No, passCount tracks CONSECUTIVE passes.
        // If Player A passes, count=1. Player B plays. Count should reset to 0.
        // Where do I reset it? In playTurn.
        return 'playable';
    }

    handleRoundEnd(winner, reason) {
        this.log(`Round End: ${reason} - Winner: ${winner.name}`);

        // Winner gets sum of all other hands
        let pointsToAdd = 0;
        this.players.forEach(p => {
            if (p !== winner) {
                pointsToAdd += p.getHandTotal();
            }
        });

        const remainder = pointsToAdd % 5;
        let finalPoints = pointsToAdd;
        if (remainder < 3) finalPoints -= remainder;
        else finalPoints += (5 - remainder);

        winner.addPoints(finalPoints);
        this.log(`${winner.name} gets ${finalPoints} points from opponents.`);

        this.checkGameWin();
    }

    handleBlockedGame() {
        this.log("Game Blocked!");

        // Find player with lowest total
        let winner = null;
        let lowestTotal = Infinity;
        let totals = [];

        this.players.forEach(p => {
            const total = p.getHandTotal();
            totals.push({ player: p, total });
            if (total < lowestTotal) {
                lowestTotal = total;
                winner = p;
            } else if (total === lowestTotal) {
                // Tie?
                // Standard rules: If tie for lowest, no one wins? Or strictly lowest?
                // Or maybe the one who played last?
                // Let's assume strict winner. If tie, maybe first one found (P1 advantage).
            }
        });

        // Calculate points: Sum of ALL hands (including winner's) ? Or sum of OTHERS minus WINNER?
        // Common All Fives Blocked Rule: "The player with the lowest hand wins the points from all other hands."
        // So Sum(Others).
        // Let's stick to that.

        let pointsToAdd = 0;
        this.players.forEach(p => {
            if (p !== winner) {
                pointsToAdd += p.getHandTotal();
            }
        });

        // Round to nearest 5
        const remainder = pointsToAdd % 5;
        let finalPoints = pointsToAdd;
        if (remainder < 3) finalPoints -= remainder;
        else finalPoints += (5 - remainder);

        winner.addPoints(finalPoints);
        this.log(`${winner.name} wins the block and gets ${finalPoints} points.`);
        this.checkGameWin();
    }

    checkGameWin() {
        // Check if any player reached target
        let winner = null;
        this.players.forEach(p => {
            if (p.score >= this.targetScore) {
                if (!winner || p.score > winner.score) {
                    winner = p;
                }
            }
        });

        if (winner) {
            this.isGameOver = true;
            this.gameWinner = winner;
            winner.wins++;
            this.log(`Game Over! Winner: ${this.gameWinner.name}`);
        } else {
             this.isRoundOver = true;
        }
    }

    startNextHand() {
        this.log("Starting next hand...");
        this.isRoundOver = false;
        this.passCount = 0;

        // Preserve scores
        const currentScores = this.players.map(p => p.score);
        const currentWins = this.players.map(p => p.wins);
        const names = this.players.map(p => p.name);

        this.deck = new Deck();
        this.deck.shuffle();
        this.board = new Board();

        // Re-use player objects or reset them?
        // Better to reset state on existing objects
        this.players.forEach(p => p.resetHand());

        this.deal();
        this.determineFirstPlayer();
    }
}

if (typeof module !== 'undefined') {
    module.exports = { Domino, Deck, Board, Player, Game };
}
