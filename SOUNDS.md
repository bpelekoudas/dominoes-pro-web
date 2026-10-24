# Game sounds

These are short recordings, trimmed and leveled, then saved as small mono MP3s in `packages/web/public/sounds/`. The game preloads them and plays them through the Web Audio API, so a phone does not wait on a new download when a tile lands.

Every file below is **CC0 1.0** (public domain). That license allows use in a commercial game with no attribution required. The notes here are for our own records. Each file is a trimmed, normalized encode of the creator's CC0 upload, taken from the Freesound high-quality preview of that upload.

| File | What you hear | Source | License |
| --- | --- | --- | --- |
| `clack.mp3` | A plastic domino slapped down. Pitch and volume wobble a little each play. | [Domino_sfx_moveTile](https://freesound.org/people/poenia/sounds/745028/) by poenia | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `clack-heavy.mp3` | A heavier tile-on-tile hit, pitched down. Used for doubles, and for the slam when UH-OH lands. | [clack.wav](https://freesound.org/people/schizoid2k/sounds/107360/) by schizoid2k ("sound of game tiles hitting each other") | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `ching.mp3` | Antique cash-register drawer, bell, and coins. Plays on every score of 10 or 15, and again inside a 20+ UH-OH, for every player at the table. | [Cha Ching.wav](https://freesound.org/people/deleted_user_96253/sounds/351304/) by deleted_user_96253 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `glass.mp3` | A window breaking, with shards falling. It starts when the tile hits, together with the heavy slam and the cha-ching. | [break-window.mp3](https://freesound.org/people/Kneeling/sounds/448004/) by Kneeling. That recording itself combines other CC0 effects, mainly [ngruber 204777](https://freesound.org/people/ngruber/sounds/204777/) and [gevaroy 173559](https://freesound.org/people/gevaroy/sounds/173559/). | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `buzz.mp3` | A short low mechanical buzz when it becomes your turn, separate from the cash register. | [tyre_buzzer.mp3](https://freesound.org/people/houbi-game/sounds/696600/) by houbi-game | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

The old synthesized crowd hit is gone. A short crowd "ohhh" with a license this safe was not available, so UH-OH is the glass, the heavy tile, and the register only.

Total size of the five files is about 30 KB.
