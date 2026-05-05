// test_spinner.js
const { Game, Board, Domino } = require('../game.js');

function assert(condition, message) {
    if (!condition) {
        console.error(`FAIL: ${message}`);
        process.exit(1);
    } else {
        console.log(`PASS: ${message}`);
    }
}

console.log("Testing Spinner Logic...");

const board = new Board();

// 1. Place First Double (Spinner)
const spinner = new Domino(5, 5);
let score = board.placeFirst(spinner);
assert(board.spinner === spinner, "First double should be marked as spinner");
assert(score === 10, "Spinner 5-5 should score 10");
assert(board.topOpen === 5, "Top open should be 5");
assert(board.bottomOpen === 5, "Bottom open should be 5");

// 2. Play on Top Branch
const topTile = new Domino(5, 2); // 5 touches spinner, 2 is open
score = board.place(topTile, 'top');
// Board: 5-5 (Center). Top: 5-2.
// Ends: 5 (Left Main), 5 (Right Main), 2 (Top Branch).
// Sum: 5 + 5 + 2 = 12.
// Wait, Spinner is the ONLY tile in main.
// So Left=Total(10). Right=Total(10). No, that was my logic quirk.
// Let's check `calculateScore` logic:
// if length=1: score = tile.total + branches.
// 10 + 2 = 12.
assert(score === 12, `Score after playing Top should be 12. Got ${score}`);
assert(board.topOpen === 2, "Top open should be 2");

// 3. Play on Left (Main Line)
const leftTile = new Domino(5, 3); // 5 touches spinner(5). 3 is open.
score = board.place(leftTile, 'left');
// Board: [3|5] - [5|5] (Spinner). Top: [5|2].
// Ends: 3 (Left), 5 (Right - Spinner side), 2 (Top).
// Note: Spinner is Right End. It is a double.
// Left: 3.
// Right: 5-5 (Double) -> 10.
// Top: 2.
// Total: 3 + 10 + 2 = 15.
assert(score === 15, `Score after playing Left should be 15. Got ${score}`);

// 4. Play on Bottom
const bottomTile = new Domino(5, 0); // 5 touches spinner, 0 open.
score = board.place(bottomTile, 'bottom');
// Ends: 3 (Left), 5-5 (Right), 2 (Top), 0 (Bottom).
// Total: 3 + 10 + 2 + 0 = 15.
assert(score === 15, `Score after playing Bottom should be 15. Got ${score}`);

// 5. Play on Right
const rightTile = new Domino(5, 4); // 5 touches spinner, 4 open.
score = board.place(rightTile, 'right');
// Board: [3|5] - [5|5] - [5|4].
// Ends: 3 (Left), 4 (Right), 2 (Top), 0 (Bottom).
// Spinner is now interior.
// Total: 3 + 4 + 2 + 0 = 9.
assert(score === 9, `Score after playing Right should be 9. Got ${score}`);

console.log("All Spinner Tests Passed!");
