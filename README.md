# Uh Oh Dominoes

Friends sit at a private table, share a code, and play straight dominoes to the end of a series. Phones are the main way to play.

The server owns the shuffle, the deal, every move, and the score. A phone only says what the player wants to do, then draws what the server sends back. One player never sees another player's tiles, or the boneyard.

The old single-player page is still here, untouched, so the current site can keep running:

- `index.html`, `game.js`, `ui.js`, and `style.css` are the original game against the computer.
- Do not point the live domain at this multiplayer server until you mean to switch.
- The old page still scores a total of 5. The new game does not. The rules it enforces are in [docs/house-rules.md](docs/house-rules.md).

## How a table works

1. Someone creates a room and picks 2–4 players, a boneyard rule, and a best-of-3, 5, or 7 series.
2. They share a short code or a link (`/r/CODE`).
3. Everyone else joins with a display name. There are no accounts yet.
4. The host deals when the table is full. Empty seats can be filled with computers (Easy or Normal) and removed again before the deal. Play vs computer on the home screen fills the player count you picked (one, two, or three computers) and deals immediately, using that boneyard and series. Computers play on the server, about a second after the tile is theirs, so you can watch.
5. Play goes to 150, then on through the series. Refreshing the phone puts you back in your seat.

Talk is a row of preset lines, plus a short note of your own (80 characters). Preset packs are set up so a character can bring their own lines later. That pack stays hidden until the player owns the character.

## Rules worth knowing

- A board that adds up to 5 scores nothing. 10, 15, 20, and so on score the whole amount.
- The first double is the spinner. The cross opens only after both long sides have a tile.
- Going out pays the other players' pips, rounded down to a multiple of 5. A leftover of 5 still counts.
- A locked tie splits what's left, and each share is rounded down. The player with the lowest tile-end leads next.
- The winner of a hand leads the next hand, including the first hand of the next game. Only the first hand of a whole series starts from the double-six.

The two open questions in the original spec are settled. A few smaller gaps are written down in the house rules.

## Stack

TypeScript, in three pieces:

| Piece | What it is | Why |
| --- | --- | --- |
| `packages/rules` | The rules, with no files, network, or database | The same code can be tested and can replay a hand |
| `packages/server` | Node, Fastify, WebSockets, SQLite | One process is enough for a friends' table and is easy to host |
| `packages/web` | React and Vite | A phone-sized table that only renders what the server sends |

Node 22 is required. SQLite is the one built into Node, so there is no separate database to run. Each hand stores a 32-byte seed from the operating system's random source, the shuffled deck, and every action. The shuffle is Fisher-Yates fed by HMAC-SHA256 of that seed, with the usual bias fix. Replaying the seed rebuilds the deck. Replaying the deck and the actions rebuilds the hand. The seed and the deck never go to the browsers.

This shape is what a real-money operator would later need: the server, not the phone, decides the shuffle and whether a move counts, and the record of each hand can be audited. It is not a licensed gaming system today.

## Run it locally

Install Node 22, then:

```bash
npm install
npm test
npm run dev
```

Open http://localhost:5173 . The dev server proxies the game socket to port 8787.

`npm test` runs the rules tests, the room tests, and the original single-player checks.

To run the built app as one process:

```bash
npm run build
npm start
```

That serves the site and the socket on port 8787. The database file is `data/uhoh.sqlite`. Override the location with `DATA_DIR` or `DB_FILE`, and the port with `PORT`.

While a hand is going, a scoring play floats `+N` in gold from that end for about a second. The addition across the open ends, such as `2+2+6+5=15`, stays on by default as a compact line so a test table can be checked by eye. To hide the addition, set `SHOW_SCORE_MATH` to `0` (`false`, `off`, and `no` also hide it) and restart the server. Unset, empty, or `1` leaves it on. The page reads the flag from `/config.js` when it loads, so changing it does not need a rebuild.

The copy link uses that same `/config.js` address: `PUBLIC_URL` if you set it, otherwise the host the request came in on. A phone on the Render table copies an `onrender.com` link. Set `PUBLIC_URL` only when that host header is not the address friends should open (a tunnel, for example).

## Deploy

Any host that runs Node 22 can take this. Give it a persistent disk for the SQLite file, or the hands disappear when the machine restarts. The server listens on the `PORT` it is given (8787 when that variable is unset) and on every network interface, which is what a host's proxy expects.

```bash
npm ci
npm run build
PORT=8080 DATA_DIR=/data npm start
```

A container build is in the `Dockerfile`. It listens on 8080 and keeps the database in `/data`.

```bash
docker build -t uhoh-dominoes .
docker run -p 8080:8080 -v uhoh-data:/data uhoh-dominoes
```

The phone opens the live connection on the same address as the page, using `wss` whenever the page is `https`. If that connection drops, the phone tries again on its own and comes back to the same seat. Leave the current static site alone until you are ready to send the domain here.

## Put a test table on Render

This costs **$7.25 per month**: $7 for the smallest web service that stays on, plus $0.25 for a 1 GB disk. Render bills by the second, so a few days of testing is a few dollars. The Render account itself (the Hobby workspace) is free. A card is required, because this is a paid service. Outbound traffic past the 5 GB included each month is $0.15 per GB. A game among friends will not get near that.

The free service is $0, and it is the wrong place for this test. It cannot have a disk, so every room and every hand is wiped whenever the service restarts, redeploys, or goes to sleep. It goes to sleep after 15 minutes with nobody connected, then takes about a minute to wake up. The live connection works only while it is awake. Each workspace also gets 750 free hours a month; when those run out, the free service stops until the next month.

`render.yaml` already chooses the paid service, Node 22, the build and start commands, the `/health` check, and the disk. You do not fill those in by hand.

1. Sign up at [render.com](https://render.com). Signing in with GitHub is the shortest path.
2. If Render asks to connect GitHub, allow it to see the `dominoes-pro-web` repository.
3. In the Render dashboard, choose **New**, then **Blueprint**.
4. Pick the `dominoes-pro-web` repository, then pick the branch `cursor/multiplayer-rebuild-238c`. After that branch is merged, pick `main` instead.
5. Render shows the service from `render.yaml`. The name is `uhoh-dominoes`, the plan is the $7 instance, and the disk is 1 GB. Apply it. The first build takes a few minutes.
6. When the service says it is live, open the `onrender.com` address Render shows. Create a room on your phone and send the link.

A new deploy stops the old copy for a few seconds before the new one starts. That is how a disk stays consistent. Phones show "Reconnecting…" and sit back down by themselves. The game file lives on the disk at `/var/data`, so rooms survive that restart.

## What is deliberately not here yet

Tile skins, table themes, avatars, ratings, tournaments, accounts, and anything involving real money. The seat is a name plus a token stored on the phone. If that phone is wiped, that seat cannot be recovered. A player who walks away in the middle of a hand leaves the table waiting on their turn.
