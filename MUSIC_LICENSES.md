# Background music

Four instrumental loops. The player picks one in Settings, or leaves music off. Nothing here is fetched until they choose a track.

Every recording below is **CC0 1.0** (public domain dedication). That license allows copying, changing, and shipping the audio inside a commercial game, including iOS and Android builds, with no attribution required and no per-player fee. These are not Content ID registrations, not “personal use only,” and not NonCommercial licenses. The notes are our record. Attribution in the game is a courtesy, not a license condition.

The files in `packages/web/public/music/` are 128 kbps stereo MP3s. The game decodes the chosen file once and loops the buffer, so an MP3 frame gap does not click. Levels are matched to about −16 LUFS.

| File | In the menu | Title | Artist | Source | License |
| --- | --- | --- | --- | --- | --- |
| `rap.mp3` | Rap | Lofi Hip Hop Loop | Taylor Harris, published on OpenGameArt as omfgdude (OMF-Games). The source file’s artist tag is Taylor Harris. | [Lofi Hip Hop Loop](https://opengameart.org/content/lofi-hip-hop-loop) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `rock.mp3` | Rock | Rock Theme 3 | Umplix | [Rock Theme 3](https://opengameart.org/content/rock-theme-3) (the loop take) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `edm.mp3` | EDM | Synthwave House Loop | Fupi | [Synthwave House Loop](https://opengameart.org/content/synthwave-house-loop) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `classical.mp3` | Classical | Gymnopédie No. 1 | Erik Satie (composition, 1888, public domain). Performance by Teknopazzo, dedicated CC0. | [File:Gymnopedie No. 1..ogg](https://commons.wikimedia.org/wiki/File:Gymnopedie_No._1..ogg) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

The choice and the music volume live in this browser (`uhoh.music`, `uhoh.musicVolume`). Sound-effect mute is separate (`uhoh.mute`). Account profiles do not store these yet, so they are not synced to the server.
