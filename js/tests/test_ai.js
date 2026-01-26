const { Domino, Deck, Board, Game, Player } = require('../game.js');

function assert(condition, message) {
    if (!condition) {
        console.error(`FAIL: ${message}`);
        process.exit(1);
    } else {
        console.log(`PASS: ${message}`);
    }
}

function testAI() {
    console.log("Testing AI...");
    const game = new Game();
    game.startNewGame();

    // Override Board to specific state
    // Board: [5|5] (10 points initial).
    // AI Hand: [5|0], [0|0], [6|6].

    // Mock setup
    game.board = new Board();
    const d55 = new Domino(5, 5);
    game.board.placeFirst(d55);

    // Setup AI player
    const ai = game.players[1];
    ai.hand = [
        new Domino(5, 0), // Play on right(5). New right=0. Score: 5(dbl) + 0 = 10. (Mult 5)
        new Domino(4, 4), // Invalid
        new Domino(5, 5)  // Already played
    ];
    // Replace hand with valid test case
    ai.hand = [
        new Domino(5, 0), // Move A. Left(5, dbl) + Right(0). Score 10. (Points: 10)
        new Domino(5, 2)  // Move B. Left(5, dbl) + Right(2). Score 12. (Points: 0)
    ];

    game.turnIndex = 1; // AI turn

    console.log("Testing Hard AI...");
    const move = game.getAIMove('hard');

    // Should pick 5-0 because it scores 10 points. 5-2 scores 0 points.
    assert(move.domino.val1 === 5 && move.domino.val2 === 0, "Hard AI should pick 5-0 to score points");

    console.log("Testing AI Weight tie-break...");
    // Hand: [5|0] (Score 10, Weight 5), [0|5]... same.
    // Hand: [5|0] (Score 10, Weight 5), [5|5] (Invalid)...
    // Let's create a scenario where both score 0, but one is heavier.
    // Board: [5|5]
    // Hand: [5|1] (Score 11, pts 0, weight 6). [5|2] (Score 12, pts 0, weight 7).
    // Should pick 5-2 to shed weight.

    ai.hand = [
        new Domino(5, 1),
        new Domino(5, 2)
    ];

    const move2 = game.getAIMove('hard');
    assert(move2.domino.val1 === 5 && move2.domino.val2 === 2, "Hard AI should pick heavier tile 5-2 when points are tied (0)");

}

testAI();
