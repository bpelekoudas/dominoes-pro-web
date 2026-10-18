# UhOh Dominoes: House Rules

Approved by the owner on October 17, 2026. This file is the rules the server enforces.
The older single-player page in the repo root is not this game, and it still scores a 5.

## Setup

- Double-six set, 28 tiles (0–0 through 6–6).
- 2 to 4 players, 7 tiles each.
- Undealt tiles are the boneyard: 14 with 2 players, 7 with 3, none with 4.

## Leading

- The first hand of a series: whoever holds 6–6 plays it. If nobody was dealt 6–6, the highest double on the table is the lead, and that player must play it.
- Every later hand: the winner of the previous hand leads and may play any tile. This continues across games in the same series. Confirmed by the owner.
- After a tied locked hand, the next lead is the tied player who holds the tile with the lowest end. Example: one player holds 2–2, the other holds 3–1. The 3–1 player leads, because they hold a 1.

## Spinner

- The first double played is the spinner.
- Its two long sides are the only open ends until both of those sides have a tile.
- After that, the other two sides open as well.

## Turns

- Play a tile that matches an open end.
- If you cannot play and the boneyard is missing or empty, you knock.
- The boneyard is a table setting, with two choices:
  1. Draw one tile. If it fits, you must play it. If it does not, the turn passes.
  2. Draw until you can play. You knock only when the boneyard is empty.

## Scoring on the board

- After every play, including the opening tile, add the pips on all open ends.
- A double sitting on an open end counts both halves.
- If the total is a multiple of 5 and at least 10, that player scores the total.
- A total of 5 scores nothing. So does 0.

## Ending a hand

- Domino: the first player to play their last tile wins the hand. They collect everyone else's remaining pips, rounded down to a multiple of 5. A leftover of 5 does count. The "at least 10" rule is only for board scoring.
- Locked hand: nobody can play and the boneyard is empty. The lightest hand wins and collects everyone else's pips, rounded down the same way.
- Tied locked hand: the other players' pips are split evenly. Each share is rounded down to a multiple of 5. Confirmed by the owner.

## Winning

- The moment a player reaches 150, the game ends. That includes a score played in the middle of a hand. The hand stops, and the table goes to the game summary. If the series is still going, the next game starts after that. Leftovers at the end of a hand can also cross 150, and that ends the game too.
- A series is best of 3, best of 5, or best of 7.
- Every hand records finishing order. First is the player who went out, the lightest hand in a lock, or the player who reached 150 on a score. Everyone else is ordered by remaining pips, lowest first. A tie shares that place and the next place number is skipped. The order is stored with the hand. It does not award points.

## At the table

- Each person has 30 seconds on their turn. The server skips the turn when the clock runs out. It does not play a tile and it does not draw. If that same person misses again the next time the turn returns, the game ends for the table. The screen reads `Game ended - <name> left`, with the scores at that moment. Rejoining before that next turn expires keeps them in. Computers are not on the clock.
- Computers can be Easy, Medium, Hard, or Expert. Each one waits two seconds before it plays. They only use what a person at the table could see.
- Talk is preset lines and a few reactions. There is no free typing. About one line every two seconds.

## Decisions made while building

These are the spots the written rules did not spell out. The two owner questions are settled. The rest are the readings this game uses.

1. **Who leads.** Confirmed: the winner of a hand leads the next hand, inside a game and into the next game of the series. Only the very first hand of a series uses the 6–6 rule.
2. **Tied lock money.** Confirmed: split the other players' pips evenly, then round each person's share down to a multiple of 5. Two players splitting 19 get 5 each. A share of 5 is kept. A share under 5 becomes 0.
3. **No double was dealt on the opening hand.** The player with the heaviest tile leads and must play that tile. Heaviest means the higher pip total, then the higher single pip. This is rare: every double would have to be sitting in the boneyard.
4. **150 ends the game immediately.** Confirmed by the owner after a 2-player game reached 155 on a board score of 10 and the hand kept going. A board score that takes someone to 150 or more stops the hand on that play. The hand-end count can do it too. The winner of that game leads the next game, unless the series is over. If two players are tied at the top and both are at 150 or more, the game continues until one is strictly ahead.
5. **Two players reach 150 together.** The higher score wins the game. If they are tied at the top, and that score is at least 150, the game continues until one player is strictly ahead.
6. **Spinner scoring.** West and east are the long sides. North and south open only after both long sides have a tile. A bare double scores both halves once (5–5 is 10, 6–6 is 12 and does not score). A spinner with only one long side played still counts as a double on that open end (4–4 with one side open counts 8). Once both long sides have a tile, the spinner itself drops out of the total. Only the outer ends of arms that have actually been played count. An unplayed short side adds nothing, even when the other short side has a tile. A double at the outer end of an arm still counts both halves. Examples: 5–0, 0–4, spinner 4–4, 4–6, 6–2 totals 5 + 2 = 7. 0–4, spinner 4–4, 4–6, 6–2 totals 0 + 2 = 2. Spinner 4–4 with outer ends 5, 3, and a down arm of 3, and the up side empty, totals 5 + 3 + 3 = 11. Spinner 5–5 with outer ends 3 and 5, a down arm of 2, and the up side empty, totals 3 + 5 + 2 = 10 and scores 10. The math line and the points awarded are the same total. A board total of 5 scores nothing.
7. **An opening tile that is not a double** is set with the lower pip to the west. Both ends are open, so this has no effect on play.
8. **A locked hand is called** when a player knocks, or draws the boneyard dry, and nobody has a legal tile. The other players do not each have to tap knock.
9. **Turn order** is seat order, clockwise from the leader. The host is seat 1. Later players sit in the order they joined.
10. **Draw until you can play** is one tap. Each tile that comes off the boneyard is stored in that hand's action log.
