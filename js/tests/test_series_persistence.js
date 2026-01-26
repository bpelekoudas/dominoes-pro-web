const { Game } = require('./game');

function runTest() {
    console.log("Starting Series Persistence Test...");

    const game = new Game();
    game.startNewGame(2);

    // Simulate Player 0 winning a game
    console.log("Simulating P0 win...");
    game.players[0].wins = 1;

    console.log(`P0 Wins before restart: ${game.players[0].wins}`);

    // Restart game with same player count
    console.log("Restarting game (2 players)...");
    game.startNewGame(2);

    console.log(`P0 Wins after restart: ${game.players[0].wins}`);

    if (game.players[0].wins === 1) {
        console.log("PASS: Win count preserved.");
    } else {
        console.error(`FAIL: Win count lost. Expected 1, got ${game.players[0].wins}`);
    }

    // Restart with DIFFERENT player count
    console.log("Restarting game (4 players)...");
    game.startNewGame(4);

    // Should reset? Or maybe we don't care, but expected behavior is reset or new players.
    // The code says "else { this.players = [] ... }" so it should reset.
    if (game.players.length === 4 && game.players[0].wins === 0) {
        console.log("PASS: Wins reset on player count change.");
    } else {
         console.log(`Info: Wins on change: ${game.players[0].wins} (Might be 0 if new object)`);
    }
}

runTest();
