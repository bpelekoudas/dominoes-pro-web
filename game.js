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
            // Top/Bottom open values are the spinner's value
            // But they are not "Active" ends for scoring until a tile is placed?
            // Actually, for matching logic, we match against spinner.val1.
            this.topOpen = domino.val1;
            this.bottomOpen = domino.val1;
        }

        return this.calculateScore();
    }

    isSpinnerEnclosed() {
        if (!this.spinner) return false;
        // Must be played on both left and right sides.
        // This means the spinner is not at the start (index 0) and not at the end (index length-1).
        // This requires at least 3 tiles on the board.
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
             // Spinner must be enclosed (played on both sides) before branching
             if (this.topBranch.length === 0 && !this.isSpinnerEnclosed()) return false;

             // If branch is empty, match spinner value. If not, match topOpen.
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
                flipped = false; // val1 touches target (inner), val2 is outer
            } else if (domino.val2 === target) {
                this.topOpen = domino.val1;
                flipped = true; // val2 touches target (inner), val1 is outer
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

        // Check for new Spinner (if played on main line and not yet set)
        if (!this.spinner && (side === 'left' || side === 'right') && domino.isDouble()) {
            this.spinner = domino;
            this.topOpen = domino.val1;
            this.bottomOpen = domino.val1;
        }

        return this.calculateScore();
    }

    calculatePotentialScore(domino, side) {
        if (this.placedTiles.length === 0) return domino.total;

        // This is complex because we need to know the state after placement.
        // Easiest to simulate by adding to a sum of current ends.

        // Current Ends Sum:
        let currentEndsSum = 0;

        // Left
        if (this.placedTiles.length === 1) {
            // Only 1 tile.
            // If side is left/right/top/bottom?
            // If we play on left, the original tile is now Right End.
        }

        // Let's reuse logic:
        // Identify which END is being modified.
        // Remove that end's contribution, add the new tile's contribution.

        // Base Contribution of an End:
        // If it's a double, total. Else open value.

        let score = 0;

        // Helper to get score of an end
        const getEndScore = (tiles, openVal, isSpinnerEnd) => {
             if (tiles.length === 0) return 0; // Branch empty
             const endTile = tiles[tiles.length - 1].domino; // For branches/Right. For Left it's index 0?
             // Wait, Left is index 0. Right is index len-1.
             // Branches: we push, so tip is len-1.

             if (endTile.isDouble()) return endTile.total;
             return openVal;
        };

        // Current contributions
        let leftScore = 0;
        let rightScore = 0;
        let topScore = 0;
        let bottomScore = 0;

        if (this.placedTiles.length === 1) {
             // Single tile. It is both Left and Right.
             // If double, it scores total.
             // If not double, scores total (val1+val2).
             leftScore = this.placedTiles[0].domino.total;
             // We treat single tile as one entity scoring its total.
             // We don't sum left+right separately.
        } else {
             leftScore = this.placedTiles[0].domino.isDouble() ? this.placedTiles[0].domino.total : this.leftOpen;
             rightScore = this.placedTiles[this.placedTiles.length-1].domino.isDouble() ? this.placedTiles[this.placedTiles.length-1].domino.total : this.rightOpen;
        }

        if (this.topBranch.length > 0) topScore = this.topBranch[this.topBranch.length-1].domino.isDouble() ? this.topBranch[this.topBranch.length-1].domino.total : this.topOpen;
        if (this.bottomBranch.length > 0) bottomScore = this.bottomBranch[this.bottomBranch.length-1].domino.isDouble() ? this.bottomBranch[this.bottomBranch.length-1].domino.total : this.bottomOpen;

        // Apply Move
        if (side === 'left') {
            // New Left End
            let newVal = 0;
            // logic: we match leftOpen.
            // if d.val2 == leftOpen, new is d.val1.
            let newOpen = (domino.val2 === this.leftOpen) ? domino.val1 : domino.val2;
            let contribution = domino.isDouble() ? domino.total : newOpen;

            // If board had 1 tile, that tile becomes Right End (and potentially Spinner).
            // So we take current total (single tile) -> becomes Right End Contribution + New Left Contribution.
            if (this.placedTiles.length === 1) {
                // Old tile becomes Right End.
                let oldTile = this.placedTiles[0].domino;
                // If old tile is double, it stays double score.
                // If not, it contributes rightOpen (which is its val2).
                // Wait, if 1 tile [3|4]. Left=3, Right=4.
                // Score = 7.
                // Play [2|3] on Left. Board: [2|3]-[3|4].
                // Ends: 2, 4. Score 6.
                // So: Remove "Single Tile Total", Add "Old Tile Right End Contribution", Add "New Tile Left Contribution".

                let oldRightContrib = oldTile.isDouble() ? oldTile.total : this.rightOpen;
                score = oldRightContrib + contribution + topScore + bottomScore;
            } else {
                // Normal
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
             // Branch
             let target = (this.topBranch.length === 0) ? this.spinner.val1 : this.topOpen;
             let newOpen = (domino.val1 === target) ? domino.val2 : domino.val1;
             let contribution = domino.isDouble() ? domino.total : newOpen;

             // We add this contribution. The old "Top" was 0 if empty, or existing if not.
             // If empty: we add contribution.
             // If not empty: we replace topScore.

             // Wait, if empty, does Spinner count?
             // No, Spinner is inside Main Line.
             // So simply replace topScore with new contribution.

             // Special case: Single Tile Board (Spinner).
             // Board: [5|5]. Score 10.
             // Play Top [5|2].
             // Ends: 5(Left), 5(Right), 2(Top).
             // Left=5, Right=5. (From Single Tile 5-5).
             // Wait, my logic above for Single Tile says "leftScore" covers the whole thing.
             // So if placedTiles.length === 1:
             // Base Score = 10.
             // If I play Top, base score splits into Left + Right?
             // Yes. 5-5 becomes Left End AND Right End.
             // 5(Left) + 5(Right) + 2(Top) = 12.
             // Is that correct?
             // 5-5 is 10.
             // If I play on top, do I count 5-5's ends?
             // "The spinner sums the total of all the ends."
             // If 5-5 is the only tile, ends are 5 and 5. Total 10.
             // If I add top branch, ends are 5, 5, and new end.
             // So yes.

             // So: if length=1, score is Left+Right (which is total) + new Top.
             if (this.placedTiles.length === 1) {
                  // LeftScore/RightScore logic above works if we define them correctly.
                  // For length=1, I set leftScore = total.
                  // I need to separate.
                  let t = this.placedTiles[0].domino;
                  let l = t.isDouble() ? t.total : this.leftOpen; // If double, 10. If not 5-4, left is 5.
                  // Wait. 5-4. Score 9.
                  // If I play top? Only doubles are spinners.
                  // So single tile MUST be double to play Top.
                  // So Left=Total(10). Right=Total(10)? No.
                  // If 5-5. Ends are 5 and 5.
                  // Left End is 5-5 (Double). Score 10.
                  // Right End is 5-5 (Double). Score 10.
                  // Total 20? No.
                  // Rule: "If a double is an end, it counts as total".
                  // If 5-5 is the *only* tile, it is *both* ends.
                  // Does it count twice?
                  // No. It counts once as the tile itself.

                  // So `calculateScore` handles length=1 separately.
                  // Here: if length=1, base is `t.total`.
                  // Add contribution.
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

        // Single tile case
        if (this.placedTiles.length === 1) {
            let score = this.placedTiles[0].domino.total;
            // Add branches if any (unlikely to have branches with only 1 main tile unless allowed, which it is for spinner)
            // If 5-5 is placed. Score 10.
            // If top branch added: Ends are 5, 5, top.
            // Does 5-5 count as 10 (total) + top?
            // "The spinner sums the total of all the ends."
            // If 5-5 is central, and Left/Right are "Open" from it.
            // Left Open is 5. Right Open is 5.
            // Since it's a double, Left End counts 10? Right End counts 10?
            // No.
            // If 5-5 is the only tile. Score is 10.
            // If I play 5-2 on Top.
            // Ends: 5 (Left), 5 (Right), 2 (Top).
            // Sum: 5 + 5 + 2 = 12.
            // My previous logic: "Left End: If double, total".
            // If 5-5 is left end, it counts 10.
            // If 5-5 is right end, it counts 10.
            // If it is both, we shouldn't count 20.

            // So: If length=1, Base = total.
            // Add branches.
            if (this.topBranch.length > 0) {
                 let tip = this.topBranch[this.topBranch.length-1].domino;
                 score += (tip.isDouble() ? tip.total : this.topOpen);
            }
            if (this.bottomBranch.length > 0) {
                 let tip = this.bottomBranch[this.bottomBranch.length-1].domino;
                 score += (tip.isDouble() ? tip.total : this.bottomOpen);
            }
            // But wait. If I play Top, the score is 12 (5+5+2).
            // My Base is 10.
            // 10 + 2 = 12. Correct.

            // What if I play Left? 5-2.
            // [2|5] - [5|5].
            // Ends: 2, 5 (Right), Top(0), Bottom(0).
            // Right is 5-5 (Double). Counts 10.
            // Left is 2.
            // Total 12.
            // My logic for length > 1:
            // Left End (2). Right End (Double -> 10).
            // 2 + 10 = 12. Correct.

            return score;
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

        // Branches
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
        this.players = [new Player("Player"), new Player("AI", true)];
        this.deck = new Deck();
        this.board = new Board();
        this.turnIndex = 0;
        this.targetScore = 150;
        this.gameWinner = null;
        this.isGameOver = false;
        this.isRoundOver = false;
        this.logs = [];
    }

    log(msg) {
        this.logs.push(msg);
        console.log(msg);
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
        let highestDouble = -1;
        let startingPlayerIndex = -1;
        let startingTileIndex = -1;

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

        if (startingPlayerIndex === -1) {
            let highestTotal = -1;
            for (let p = 0; p < 2; p++) {
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

        this.turnIndex = (this.turnIndex + 1) % 2;

        return { type: 'move', score: scorePoints };
    }

    ensurePlayable() {
        let player = this.players[this.turnIndex];
        let moves = this.board.getValidMoves(player.hand);

        while (moves.length === 0) {
            if (this.deck.isEmpty()) {
                this.log(`${player.name} is blocked and boneyard is empty. Passing.`);

                const otherPlayer = this.players[(this.turnIndex + 1) % 2];
                const otherMoves = this.board.getValidMoves(otherPlayer.hand);
                if (otherMoves.length === 0) {
                    this.handleBlockedGame();
                    return 'blocked_game';
                }

                this.turnIndex = (this.turnIndex + 1) % 2;
                player = this.players[this.turnIndex];
                moves = this.board.getValidMoves(player.hand);
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

        const remainder = points % 5;
        let pointsToAdd = points;
        if (remainder < 3) pointsToAdd -= remainder;
        else pointsToAdd += (5 - remainder);

        winner.addPoints(pointsToAdd);
        this.log(`${winner.name} wins the block and gets ${pointsToAdd} points.`);
        this.checkGameWin();
    }

    checkGameWin() {
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
        this.determineFirstPlayer();
    }
}

if (typeof module !== 'undefined') {
    module.exports = { Domino, Deck, Board, Player, Game };
}
