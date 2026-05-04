const { Game, Domino } = require('../game.js');

function assert(condition, message) {
    if (!condition) {
        console.error(`FAIL: ${message}`);
        process.exit(1);
    } else {
        console.log(`PASS: ${message}`);
    }
}

function testSpinnerRules() {
    console.log("Testing Spinner Placement Rules...");
    const game = new Game();
    game.startNewGame();

    // Scenario 1: Start with Double 5 (Spinner)
    const d55 = new Domino(5, 5);
    game.board.placeFirst(d55);
    console.log("Board: [5|5]");

    const d52 = new Domino(5, 2); // To play on Main
    const d53 = new Domino(5, 3); // To play on Main
    const d56 = new Domino(5, 6); // To play on Branch

    // Check if we can play d56 on Top immediately
    let validMoves = game.board.getValidMoves([d56]);
    let canPlayTop = validMoves.some(m => m.side === 'top');

    assert(!canPlayTop, "Should not be able to play on Top when spinner is exposed on both sides");

    // Scenario 2: Play on Left
    // 5-5 is at index 0.
    // Play 5-2 on Left.
    // [2|5] - [5|5]
    game.board.place(d52, 'left');
    console.log("Board: [2|5] - [5|5]");

    validMoves = game.board.getValidMoves([d56]);
    canPlayTop = validMoves.some(m => m.side === 'top');

    assert(!canPlayTop, "Should not be able to play on Top when spinner is exposed on Right");

    // Scenario 3: Play on Right
    // [2|5] - [5|5] - [5|3]
    game.board.place(d53, 'right');
    console.log("Board: [2|5] - [5|5] - [5|3]");

    validMoves = game.board.getValidMoves([d56]);
    canPlayTop = validMoves.some(m => m.side === 'top');

    assert(canPlayTop, "Should be able to play Top now that spinner is enclosed");

    // Scenario 4: Verify Bottom as well
    let canPlayBottom = validMoves.some(m => m.side === 'bottom');
    assert(canPlayBottom, "Should be able to play Bottom now that spinner is enclosed");

    console.log("All Spinner Rule Tests Passed!");
}

testSpinnerRules();
