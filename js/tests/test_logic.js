const { Domino, Deck, Board, Game } = require('../game.js');

function assert(condition, message) {
    if (!condition) {
        console.error(`FAIL: ${message}`);
        process.exit(1);
    } else {
        console.log(`PASS: ${message}`);
    }
}

function testDeck() {
    console.log("Testing Deck...");
    const deck = new Deck();
    assert(deck.tiles.length === 28, "Deck should have 28 tiles");
    // Check specific tile
    const d66 = deck.tiles.find(d => d.val1 === 6 && d.val2 === 6);
    assert(d66 !== undefined, "Deck should contain 6-6");
    deck.shuffle();
    assert(deck.tiles.length === 28, "Deck should still have 28 tiles after shuffle");
}

function testBoardScoring() {
    console.log("Testing Board Scoring...");
    const board = new Board();

    // 1. Place 5-5
    const d55 = new Domino(5, 5);
    let score = board.placeFirst(d55);
    // Ends: 5 and 5. Sum 10.
    assert(score === 10, `5-5 First Move should score 10. Got ${score}`);
    assert(board.leftOpen === 5, "Left open should be 5");
    assert(board.rightOpen === 5, "Right open should be 5");

    // 2. Place 5-0 on Right
    const d50 = new Domino(5, 0); // or 0-5
    score = board.place(d50, 'right');
    // Board: [5|5] - [5|0]. Ends: 5 (double) and 0. Sum 10 + 0 = 10.
    assert(score === 10, `Playing 5-0 on 5-5 should score 10. Got ${score}`);
    assert(board.rightOpen === 0, "Right open should be 0");

    // 3. Place 0-3 on Right
    const d03 = new Domino(0, 3);
    score = board.place(d03, 'right');
    // Board: [5|5] - [5|0] - [0|3]. Ends: 5 (double) and 3. Sum 13. Not multiple of 5.
    assert(score === 13, `Playing 0-3 should return raw sum 13 (not score, but logic returns sum or only score? Logic returns raw score logic)`);
    // Wait, my calculateScore returns the raw sum. The Game class checks % 5.
    // The previous assertions checked for 10, which is valid.

    // 4. Place 3-3 on Right
    const d33 = new Domino(3, 3);
    score = board.place(d33, 'right');
    // Board: ... [0|3] - [3|3]. Ends: 5(double) + 3(double). 10 + 6 = 16.
    assert(score === 16, `Playing 3-3 on right should sum to 16. Got ${score}`);

    // 5. Place 4-5 on Left
    const d45 = new Domino(4, 5);
    score = board.place(d45, 'left');
    // Board: [4|5] - [5|5] ... [3|3].
    // Ends: 4 + 3(double)=6. Sum 10.
    assert(score === 10, `Playing 4-5 on left should score 10. Got ${score}`);
    assert(board.leftOpen === 4, "Left open should be 4");
}

function testGameFlow() {
    console.log("Testing Game Flow...");
    const game = new Game();
    game.startNewGame();

    // Check hands
    assert(game.players[0].hand.length === 7 || game.players[0].hand.length === 6, "Player should have 7 tiles (or 6 if they started)");

    // Check board not empty (since we auto-played first move)
    assert(game.board.placedTiles.length === 1, "Board should have 1 tile after start");

    console.log(`First move played. Board: ${game.board.placedTiles[0].domino.val1}-${game.board.placedTiles[0].domino.val2}`);

    // Check turn index
    // If P1 started, turn is P2 (1). If P2 started, turn is P1 (0).
    // Can't strictly assert value without knowing who had highest double, but logic should be consistent.
}

testDeck();
testBoardScoring();
testGameFlow();

console.log("All Tests Passed!");
