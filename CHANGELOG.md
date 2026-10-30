# Changelog

## Unreleased

### Added
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
- Card dealing now uses the sfc32 random generator (128 bits of state, passes the standard PractRand and
  TestU01 BigCrush test batteries) instead of Mulberry32 (32 bits), seeded with 128 bits from the platform's
  cryptographic generator. Random picks are now exactly uniform (rejection sampling instead of rounding).
  Investigation found no bias in the old dealing; this removes a theoretical weakness and prepares for
  provable fairness in online games.
- Save format 2: older saves are migrated automatically and continue with fair deals.

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
