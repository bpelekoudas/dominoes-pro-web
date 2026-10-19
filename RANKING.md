# Rating and seasons

The server keeps both numbers. A phone only displays them. A new player starts at **1200**. The number never resets, and it never goes below **100**.

## Which games change the rating

A game counts for rating only when every seat is a person with an account (a guest counts) and the host left the table on **Ranked**. One computer, or a table marked **Casual**, leaves the rating where it is. Those games still earn season points, once. A ranked all-human game earns season points twice.

A "game" here is one race to 150, not the whole best-of series.

## How a game moves the number

When the game ends, every player is paired with every other player. First place beat everyone else. Second beat the players who finished behind them, and so on.

For each pair the server asks two questions.

How surprising was it? If the ratings are `you` and `opp`:

```
expected = 1 / (1 + 10 ^ ((opp - you) / 400))
```

How close was it? The final scores (the winner has reached 150) make a result between 0 and 1:

```
result = 0.5 + (your score - their score) / 300
```

That result is kept between 0 and 1. Then the finishing order has the last word: whoever finished higher is treated as at least 0.6, and whoever finished lower is treated as at most 0.4. A squeaker still pays the winner. A blowout pays more. Two players on the same score, and neither leaving, are a tie: the result stays on the formula and can be 0.5.

The change for that pair is `K * (result - expected)`. A player's change for the game is the **average** of their pairs, so a four-player game does not pay three times a two-player game. The average is then capped at **40** points either way and rounded to a whole number. If that would drop someone under 100, they stop at 100.

`K` is 40 for a player's first 20 rated games, then 20. Once the rating is 2000 or higher, `K` is 10 even if those 20 games are not done yet.

Someone who leaves on a second missed turn finishes **last**. Everyone else keeps the order of their scores. The game still moves the rating when it was a ranked table.

The first five rated games show the number with a dotted gold mark. The number is real the whole time. After five rated games the mark goes away.

Every rated game stores the rating before, the rating after, and the change. That history stays on the profile when a guest later signs in with Google or email, because it is the same profile.

Games against a computer are counted on their own: games, wins, and losses. They do not move the rating.

## Season points

A season lasts **8 weeks**. The length can be changed with `SEASON_WEEKS`. The first season starts the first time this version opens the database, and that start is saved, so a restart does not move the calendar. Set `SEASON_EPOCH` to an ISO time only if you want a different start. Bryan does not have to set either one.

Points only go up during a season.

| What happened | Points |
| --- | --- |
| You were in a game that ended | 10 |
| You won | 25 |
| You finished second in a 3 or 4 player game | 10 |
| You played an UH-OH (a single play of 20 or more) | 5 each |
| Win streak | 5 for each win in a row, up to 25 |
| First win of the Denver day | 20 |

A ranked all-human game doubles that total. A computer game, a casual game, and a game where someone had no account pay the single amount.

A win adds to the streak. Any other finished game clears it. Leaving on a second miss still pays the 10 for the game ending, and any UH-OH already played, and it does not hand anyone a win.

The Denver day changes at midnight in `America/Denver`.

## Tiers

| Tier | Points |
| --- | --- |
| Rookie | 0 |
| Shuffler | 250 |
| Clacker | 600 |
| Hustler | 1100 |
| Shark | 1800 |
| Boss | 2800 |
| Big Shot | 4200 |
| UH-OH Legend | 6000 |

Rookie has no steps. Every other tier is split into III, II, then I, as evenly as whole points allow. Shuffler, for example, is III from 250, II from 366, and I from 483, and Clacker starts at 600. Legend steps are 1,000 points apart: III at 6000, II at 7000, I at 8000.

## A new season

At the start of a season the points drop four tiers, and not below Rookie. A Legend comes back as a Hustler (1100). A Hustler comes back as a Rookie. The lifetime rating does not move.

The best tier reached that season is saved, with a reward id such as `cosmetic:legend`. Nothing is granted yet. The store can read that table later.

## What you see

The rating and a small tier badge sit together on your profile chip, on each person in the lobby, and on each person at the table. Computers have neither.

When a game ends, the card shows each person's rating change when the game was ranked (`1212 → 1227, +15`), the season points and why, and a bar toward the next step. Climbing a tier or a step gets a short gold line.

The profile lists the rating, the provisional mark, ranked wins and losses, games played, the computer record, the current tier and points, when the season ends, and the peak tier this season.

The leaderboard shows the top 50 by rating and the top 50 by season points.
