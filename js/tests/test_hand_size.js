
const { Game } = require('./game');

function runTest() {
    console.log("Starting Hand Size & Boneyard Validation...");

    // Test 2 Players
    const game2 = new Game();
    game2.startNewGame(2);

    let p1Tiles = game2.players[0].hand.length;
    let p2Tiles = game2.players[1].hand.length;
    let boneyard = game2.deck.tiles.length;
    let total = p1Tiles + p2Tiles + boneyard; // Minus 1 because startNewGame plays a tile?
    // Wait, startNewGame calls determineFirstPlayer which plays 1 tile.
    // So total remaining in hands + boneyard = 28 - 1.
    // Let's check initial distribution by creating game but NOT auto-playing?
    // But determineFirstPlayer removes one tile from ONE player.
    // So sum of hand lengths + boneyard + 1 (played) should be 28.

    // However, I want to verify they STARTED with 7.
    // Since one tile is played immediately, one player will have 6.

    console.log(`\n2 Players:`);
    console.log(`P0: ${p1Tiles}, P1: ${p2Tiles}, Boneyard: ${boneyard}`);
    // One player should have 6, one 7. Boneyard should be 14.
    // Total tiles = 6 + 7 + 14 + 1(played) = 28.

    if (boneyard === 14 && (p1Tiles + p2Tiles === 13)) {
         console.log("PASS: 2 Players (7 each, 1 played, 14 boneyard)");
    } else {
         console.error("FAIL: 2 Players stats incorrect.");
    }


    // Test 3 Players
    const game3 = new Game();
    game3.startNewGame(3);

    let p1_3 = game3.players[0].hand.length;
    let p2_3 = game3.players[1].hand.length;
    let p3_3 = game3.players[2].hand.length;
    let bone_3 = game3.deck.tiles.length;

    console.log(`\n3 Players:`);
    console.log(`P0: ${p1_3}, P1: ${p2_3}, P2: ${p3_3}, Boneyard: ${bone_3}`);
    // Start with 7 each (21 total). Boneyard 7.
    // One played -> One player has 6. Total hands = 6+7+7 = 20.

    if (bone_3 === 7 && (p1_3 + p2_3 + p3_3 === 20)) {
        console.log("PASS: 3 Players (7 each, 1 played, 7 boneyard)");
    } else {
        console.error("FAIL: 3 Players stats incorrect.");
    }

    // Test 4 Players
    const game4 = new Game();
    game4.startNewGame(4);

    let p1_4 = game4.players[0].hand.length;
    let p2_4 = game4.players[1].hand.length;
    let p3_4 = game4.players[2].hand.length;
    let p4_4 = game4.players[3].hand.length;
    let bone_4 = game4.deck.tiles.length;

    console.log(`\n4 Players:`);
    console.log(`P0: ${p1_4}, P1: ${p2_4}, P2: ${p3_4}, P3: ${p4_4}, Boneyard: ${bone_4}`);
    // Start with 7 each (28 total). Boneyard 0.
    // One played -> One player has 6. Total hands = 6+7+7+7 = 27.

    if (bone_4 === 0 && (p1_4 + p2_4 + p3_4 + p4_4 === 27)) {
        console.log("PASS: 4 Players (7 each, 1 played, 0 boneyard)");
    } else {
        console.error("FAIL: 4 Players stats incorrect.");
    }
}

runTest();
