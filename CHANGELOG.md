# Changelog

## Unreleased

### Added
- Voice chat in the lobby: seated players can talk before the game starts, with the same mic button, and a
  talking player's seat shows bouncing bars. The voice connection carries on into the game and back.
- Play again in the same room: when a game ends, the host taps "Play again" and everyone returns to the lobby
  in their seats, with the same room code. The host can add or remove bots, newcomers can take empty seats, and
  the next game starts with a fresh deal. Players and spectators see "Waiting for the host…" meanwhile.
- Spectators: tick "Just watch" when joining a game to watch instead of play, before or during the game. A
  spectator sees the cards on the table (the round in play and finished rounds), scores, calls and card counts,
  but never anyone's hand: the host sends spectators a view with no hand at all. Spectators can't move, pause
  or talk, and are never seated automatically; before the start they can choose "Take a seat and play". The
  lobby lists who is watching. Up to 12 spectators per room.
- GTA VI launch week theme, November 18 to 25, 2026 (India time), celebrating the game's release. An original
  fan theme (no Rockstar logos, art, fonts or music; not affiliated with Rockstar Games):
  - A neon "sunset city" look: teal felt with hot-pink rims, sunset-orange and cyan teams, glowing buttons, and
    a photo of downtown Miami at sunset behind the menus, tinted violet and pink and slowly drifting ("Miami
    Sunset" by Joe deSousa, CC0, via Wikimedia Commons).
  - "Lorris" as a buzzing pink neon sign on the home page.
  - Original synthwave background music (A minor, 96 BPM), synthesized in the app with no audio files.
  - Playing the Joker shows the "Joker heist" to every player: police-light sweeps, the Joker spinning in, a
    neon sign, five stars lighting up and cash raining down, with a synth siren sting. Tap to skip; reduced
    motion shows a still version. Bots wait for it before their next move.
  - The final score shows "Mission complete".
- Voice chat in online games, streaming live: a round mic button at the right of the controls. Hold it to talk
  while held, or tap it to start talking and tap again to stop. Voices go through the host to everyone at the
  table (no team channels, in keeping with the no-table-talk rule), and each talker's seat glows. Built for the
  lowest data use: nothing is set up until someone talks, nothing is sent while nobody talks, and while talking
  the audio uses about 9.5 kbps per stream (about 71 KB per minute) thanks to longer packets, silence
  suppression, mono and a 12 kbps cap. A talker uploads one stream however many people listen. The microphone is
  only open around talking; a tapped-on mic switches off after 20 seconds of silence, and the host stops
  forwarding after 2 minutes. The button greys out when the network is too slow, measured in the background
  without sending anything.
- Halloween season, every year from October 18 to November 7 (India time): the week of Halloween plus a week
  either side.
  - The whole app switches to a Halloween theme: a candlelit purple table, pumpkin-orange accents, and a moon,
    bats and cobwebs behind the menus. Always dark during the season.
  - The home page shows "Lorris" in dripping-blood lettering (a renamed subset of the open-source Nosifer font,
    SIL Open Font License).
  - Original background music (a music-box tune over an organ drone), synthesized in the app with no audio files.
    It starts after the first tap, pauses when the app is in the background, and plays more quietly during games.
  - Playing the Joker shows "The Portrait of Giggles Mortimer", a haunted clown portrait that tears open and
    laughs, to every player at the table. Tap to skip. With reduced motion, a still frame shows instead. Bots wait
    for the animation before their next move.
- Settings, from the gear button on the home page and in games: Sound effects (on/off) and Music (on/off), saved
  on the device.

### Changed
- The online protocol is now version 4 (spectators, playing again). Everyone in a room needs the updated app.
- Playtest fixes for readability:
  - The trump suit in the top bar is now a gold tile with a large suit symbol, and it pops in when chosen.
  - Calls are easy to read: each player's call shows as "Call 5" (or "Pass") in a large bubble under their seat,
    the winning call as a white "Called 5" with a gold edge, and the calling team's score box shows "Call 5".
  - The board stands out from the page in every theme: brighter felt, a wooden rim with a highlight, a faint felt
    texture and a shadow. In the Halloween theme the rim glows pumpkin orange.
  - Score boxes and player boxes are filled with their team's color, so teams read at a glance; your team's box
    has a frame. Whose turn it is now shows as a pulsing white ring, which can't be mistaken for a team color.
- Card dealing now uses the sfc32 random generator (128 bits of state, passes the standard PractRand and
  TestU01 BigCrush test batteries) instead of Mulberry32 (32 bits), seeded with 128 bits from the platform's
  cryptographic generator. Random picks are now exactly uniform (rejection sampling instead of rounding).
  Investigation found no bias in the old dealing; this removes a theoretical weakness and prepares for
  provable fairness in online games.
- Save format 2: older saves are migrated automatically and continue with fair deals.
- Leaving a game you can save (an offline game, or one you host, with or without other people) now asks
  "Save and exit" or "Exit without saving" instead of always saving. Hosts who save tell everyone the game can
  be resumed later; exiting without saving discards the saved game (and, when hosting, ends it for everyone).

### Added (tests)
- A permanent statistical fairness test on 7,200 simulated Sets per table size: no link between a seat's hands
  from one Set to the next, the strongest hand moving seats at the rate chance predicts, equal Joker share and
  hand strength for every seat, and every card equally likely in every position.
- Known-answer tests for sfc32 and SplitMix32 against a reference C implementation.

## v0.0.1

### Added
- Rules engine for 4 and 6 players: calling, trump, follow-suit and Joker rules, misdeal re-deal, scoring with the
  first-failure penalty, and sets that end as soon as the result is decided.
- Random and heuristic bots, plus a 1,000-game bot simulation test.
- Mobile-first Svelte UI: start screen, table, deal and play animations, pass-and-play, light and dark mode.
- Offline-capable PWA with app icons generated from the card art.
- GitHub Pages deployment workflow.
