# Lorris network protocol

Version: **3** (`PROTOCOL_VERSION` in `protocol.ts`). Version 2 added mid-game joining; version 3 added pausing, saving and resuming.

Online games are peer to peer over WebRTC data channels (Trystero). Public Nostr relays are used
only to find peers; game data never passes through them.

## Roles and trust

- **Host**: the player who created the room. Their device holds the full `GameState`, runs
  `applyAction` for every move, and runs every bot. The host always sits in seat 0.
- **Client**: every other player. A client only ever receives **its own** `PlayerView`
  (`getPlayerView(state, seat)`) and sends **intents** (actions). It never receives full state.
- Every incoming message is untrusted, in both directions. It's validated at runtime
  (`validate.ts`) before anything else looks at it.
- A message never says which seat it's for. The host works out the seat from the sending peer,
  so a client can't act for someone else.
- Trystero connects everyone in a room to everyone else, so clients can also reach other
  clients. Clients ignore anything not from the peer that sent them `WELCOME`.
  **Known limit:** a malicious player in the room could race the real host to send a `WELCOME`.
  This version accepts that risk: rooms are private, and joining one needs the code.

## Rooms

- **Room code**: 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L), shown as
  `ABC-DEF`. Typed input is case-insensitive, and spaces and dashes are ignored.
- **Trystero room ID** = the room code. **App ID** = `NET_CONFIG.appId`, which keeps our rooms
  separate from other apps.
- **Room password** = `roomPassword(code)`. Trystero uses it to encrypt connection setup data
  on the relays.
- **Invite link**: `<app url>#join=<CODE>`. Putting the code in the URL fragment means it works
  on static hosting and offline, and never reaches a server.

## Envelope

Every message is a JSON object with:

| Field | Type | Meaning |
|---|---|---|
| `v` | integer | Protocol version. Must equal the receiver's `PROTOCOL_VERSION`. |
| `seq` | integer ≥ 1 | Increases with every message from a sender. The host drops anything not newer than the last `seq` from that peer. |
| `type` | string | One of the types below. Unknown types are dropped. |

### Size and rate limits (see `config.ts`)

- **Size:** client → host messages over `maxClientMessageBytes` (4 KB) are dropped, and so are
  host → client messages over `maxHostMessageBytes` (64 KB).
- **Rate:** the host rate-limits each peer to `rateLimitPerSecond` (10/s), with bursts up to
  `rateLimitBurst` (30).
- **Strikes:** every message that is rate-limited, malformed, or the wrong version counts as a
  strike. After `maxStrikes` (50), the host sends `REJECTED RATE_LIMITED` and ignores that
  peer from then on.

## Client → host

| Type | Fields | Meaning |
|---|---|---|
| `HELLO` | `name: string`, `token: string \| null` | Join, or rejoin with a seat token. Sent to every peer when it joins the room, and broadcast on every heartbeat until a `WELCOME` arrives (and again while the host is missing). **Shape is frozen** for all versions. |
| `ACTION` | `requestId: int`, `action: Action` | An intent for the sender's own seat. Validated (`parseAction`), then applied with the rules engine. |
| `RESYNC` | none | "Send me my current `LOBBY` and `VIEW` again." |
| `PING` | `t: int` | Heartbeat, every `heartbeatIntervalMs` (3 s). |
| `LEAVE` | none | Leaving on purpose. In the lobby the seat is freed; mid-game it becomes an open bot seat at once. |
| `PAUSE_REQUEST` | none | "Can we pause?" The host decides. If they say no, the requester gets `EVENT pause-declined`. |
| `TAKE_SEAT` | `seat: int \| null` | A newcomer (no seat yet) asks for a seat: a specific one, or `null` for any open seat. Answered with `WELCOME` or `SEAT_DENIED`. |

Rules for `name` and `token`:
- **`name`:** trimmed, with control, invisible and text-direction characters removed. At most
  20 characters, and it can't be empty.
- **`token`:** 16 to 64 characters from `[A-Za-z0-9_-]`.

`Action` is one of:
- `{type:'BID', value:int}`
- `{type:'PASS'}`
- `{type:'CHOOSE_TRUMP', suit:'S'|'H'|'D'|'C'}`
- `{type:'PLAY_CARD', card}`, where `card` is like `"10H"` or `"JK"`
- `{type:'NEXT_SET'}`

Any other fields are ignored.

## Host → client

| Type | Fields | Meaning |
|---|---|---|
| `WELCOME` | `seat`, `token`, `roomCode`, `config` | You're seated. Store `token` (IndexedDB) to reclaim the seat later. The client resets its stored versions, because a host that resumed from a save may be one step behind what the client last saw. |
| `REJECTED` | `reason`, `hostVersion` | `VERSION_MISMATCH`, `ROOM_FULL`, `GAME_IN_PROGRESS`, `KICKED` or `RATE_LIMITED`. **Shape is frozen**, so any app version can show "please update". |
| `LOBBY` | `lobbyVersion: int`, `seats: SeatInfo[]`, `started: bool`, `policy: JoinPolicy`, `table: TableSummary \| null`, `pause: PauseState` | Who sits where, whether they're connected, the join rules, and (once started) public facts about the game. Sent whenever that changes, to seated players **and to newcomers without a seat**. Ignored unless `lobbyVersion` is newer than the last one received. |
| `SEAT_DENIED` | `reason` | A seat request that didn't work: `SEAT_TAKEN`, `RESERVED`, `NOT_OPEN`, `JOINS_DISABLED` or `NO_OPEN_SEATS`. It's also sent as `SEAT_EXPIRED` on a `HELLO` carrying the token of a seat that was given up. The newcomer stays connected. |
| `EVENT` | `event` | Table news. Clients write the wording themselves. Kinds: `took-seat {seat, name}` ("Priya took over a bot seat."), `returned {seat, name}` (a player got their seat back from a bot after a resume), and `pause-declined` (sent to the player who asked). `pause-requested` is host-only and is never sent over the network. |
| `VIEW` | `stateVersion: int`, `view: PlayerView` | The recipient's view after every change. Ignored unless `stateVersion` is newer, or if `view.seat` isn't the recipient's seat. |
| `ACTION_RESULT` | `requestId`, `error: {code, message} \| null` | The answer to an `ACTION`. `code` is a rules-engine error code (such as `NOT_YOUR_TURN`) or `NOT_SEATED`. |
| `PONG` | `t`, `stateVersion`, `lobbyVersion` | Reply to `PING`. If either version is ahead of the client's, the client missed a message and sends `RESYNC` (at most once a second). |
| `HOST_STATUS` | `status: 'ended' \| 'saved'`, `message`, `label?` | `ended`: the host closed the game, and clients forget it. `saved`: the host saved the game and closed the room. Clients keep their seat token and a small reference (`label` holds the names and score only), so they can rejoin when the host resumes. `paused` is reserved and unused. |

`SeatInfo` is `{ kind, name, status, reservedMs? }`. It never includes seat tokens. The four
`kind`s:

| `kind` | Meaning | Open to newcomers? |
|---|---|---|
| `empty` | Nobody sits here (lobby only). | Yes, before the start. |
| `bot` | A bot from the start, or a seat a human left for good (left, was kicked, their reservation ran out, or the host released it). | Yes, mid-game, if `policy.midGameJoins` is on. |
| `reserved` | A disconnected human holds the seat token. `status` is `reconnecting`, or `bot-controlled` once a bot covers their turns. `reservedMs` is the time left. | No, until the reservation runs out (`seatReservationMs`, 2 min) or the host releases it. |
| `human` | A connected human. | Never. |

`JoinPolicy` is `{ midGameJoins: bool, autoAssign: bool }`. Both are on by default.

`TableSummary` is `{ setNumber, phase, scores, tricksWon, trump, contract, handCounts, turn }`.
These are public facts only, never cards.

`PauseState` is `{ paused: bool, by: Seat | null, resuming: bool }`. `resuming` means the host has
reopened a saved game and is waiting for players before continuing.

## Flows

### Joining

1. The client connects to the room and sends `HELLO` (with no token) to each peer as it
   appears.
2. The host gives it the first empty seat and replies `WELCOME`, then `LOBBY`. It also sends
   `LOBBY` to everyone else.
3. If the room is full, the reply is `REJECTED ROOM_FULL`. If the game has started, it's
   `REJECTED GAME_IN_PROGRESS`; only token holders can rejoin a game in progress.
4. If no `WELCOME` arrives within `joinTimeoutMs` (20 s), the client stops and shows a friendly
   message. It suggests switching networks if Trystero reported a connection failure, and
   otherwise suggests checking the code.

### Joining a game in progress

1. A newcomer's `HELLO` (with no valid token) makes them a guest. The host sends `LOBBY`, which
   includes the public table summary. There are at most `maxGuests` (12) guests; beyond that,
   the reply is `REJECTED ROOM_FULL`.
2. **Auto-assign on:** the host seats the guest in the first open bot seat straight away. If
   there is none, it sends `SEAT_DENIED NO_OPEN_SEATS`, keeps the guest, and seats them on a
   later heartbeat if a seat opens up.
3. **Auto-assign off:** the guest picks a seat and sends `TAKE_SEAT`.
4. **Taking the seat:** the host turns that seat into a human seat with a new token. The game
   state isn't touched, so the newcomer inherits that seat's hand, team and position. A bot
   move that is scheduled or being computed is dropped, because the bot runner rechecks who
   controls the seat before submitting. Then:
   - the newcomer gets `WELCOME`, `LOBBY` and `VIEW`
   - everyone gets `EVENT took-seat`
5. **Two claims at once:** the host handles one message at a time, so only one can win. The
   other finds a human in the seat and gets `SEAT_DENIED SEAT_TAKEN`.
6. **Returning after the reservation expired:** a player who comes back with the token of a
   seat that was given up gets `SEAT_DENIED SEAT_EXPIRED`, and becomes a newcomer.

### Starting

The host sends `start`, which puts bots in any empty seats. Everyone gets `LOBBY` with
`started: true`, then their first `VIEW`.

### Playing

- The client sends `ACTION`. The host applies it for the sender's seat and replies with
  `ACTION_RESULT`.
- After every accepted action (from anyone, including bots), the host sends each connected
  client its own `VIEW`.
- If the client gets no `ACTION_RESULT` within `actionTimeoutMs` (8 s), the client reports a
  timeout and the player can try again.

### Heartbeats and disconnects

- **Silent client:** a client with no messages for `peerTimeoutMs` (9 s), or that Trystero
  reports gone, shows as `reserved` (`reconnecting`). After `botTakeoverMs` (30 s), a bot covers
  their turns (`bot-controlled`). After `seatReservationMs` (2 min), the seat becomes an open
  `bot` seat and their token stops working. In the lobby, the seat is freed after
  `botTakeoverMs` instead.
- **Returning client:** any valid message from the seat's peer, or a `HELLO` with the seat
  token from a new peer (after a reload), gives the human their seat back immediately. A bot
  move that was about to happen is cancelled.
- **Client losing the host:** if the client hears nothing from the host for `peerTimeoutMs`,
  it shows `reconnecting`, then `waiting-for-host` with a deadline of `hostWaitMs` (3 min).
  It keeps broadcasting `HELLO` with its token.
- **Back in the foreground** (`visibilitychange`): the client pings at once, and rebuilds the
  connection if the host has been silent too long. The host resets its silence timers, since
  its own timers were paused.

### Host leaving

The design is to pause and wait for the host, with a timeout:

- **Saving:** after every change, the host saves the full game and lobby to its own IndexedDB.
  This never leaves the device.
- **Coming back:** if the host's app closes, reopening it offers to resume. The resumed host
  rejoins the room as a new peer. Clients waiting for the host keep broadcasting `HELLO` with
  their tokens and are seated again.
- **Timeout:** if the wait runs out, clients choose "Keep waiting" (another `hostWaitMs`) or
  "Leave".
- **Ending on purpose:** when the host ends the game, it sends `HOST_STATUS ended` and deletes
  its save.

### Pausing

- **Who can pause:** the host pauses directly. A player sends `PAUSE_REQUEST`, and the host
  accepts (the game pauses, with `by` set to that player) or declines (`EVENT pause-declined`).
- **While paused:**
  - every `ACTION` gets `ACTION_RESULT` with error `PAUSED`
  - bots stop, and any move one was computing is dropped
  - the bot-takeover and reservation clocks are frozen
- **Unpausing:** only the host can. The disconnect clocks restart with a fresh grace period, so
  nobody loses a seat because of a pause.

### Saving, leaving and resuming

- **Saving:** the host autosaves after every move: the full state and lobby, in a checksummed
  save envelope (see `src/save`), with **hashed** seat tokens. Saves stay on the host's device
  only; clients never receive or store one.
- **Save and close:** from the pause screen, the host saves, sends `HOST_STATUS saved`, and closes
  the room.
- **Resuming:** the host reopens the save, with the same room code and password. Everyone sees
  `LOBBY` with `pause.resuming = true`. Returning players rejoin with their tokens through the
  usual `HELLO` and get their own seats and hands back. Seats whose players haven't returned
  show as `reserved`, so strangers are refused (`SEAT_DENIED RESERVED`).
- **Continuing:** seats whose players haven't returned become free `bot` seats, so a bot plays
  them and newcomers may take them. If the original player comes back while their seat is still
  a bot seat, their token gets it back (`EVENT returned`).
- **After a crash:** the latest autosave is resumed the same way.

### Version mismatch

- **Client is the wrong version:** the host answers its `HELLO` with `REJECTED
  VERSION_MISMATCH` and includes its own `hostVersion`.
- **Host is the wrong version:** the client reads the frozen `REJECTED` shape and tells the
  player who needs to update.

## Changing the protocol

Bump `PROTOCOL_VERSION` for any change to a message's shape. Never change `HELLO`, `REJECTED`,
or the envelope fields `v` and `seq`.
