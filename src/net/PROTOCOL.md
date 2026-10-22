# Lorris network protocol

Version: **1** (`PROTOCOL_VERSION` in `protocol.ts`).

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
| `LEAVE` | none | Leaving on purpose. In the lobby the seat is freed; mid-game a bot takes it over at once. |

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
| `LOBBY` | `lobbyVersion: int`, `seats: SeatInfo[]`, `started: bool` | Who sits where, and whether they're connected. Sent whenever that changes, both in the lobby and during the game. Ignored unless `lobbyVersion` is newer than the last one received. |
| `VIEW` | `stateVersion: int`, `view: PlayerView` | The recipient's view after every change. Ignored unless `stateVersion` is newer, or if `view.seat` isn't the recipient's seat. |
| `ACTION_RESULT` | `requestId`, `error: {code, message} \| null` | The answer to an `ACTION`. `code` is a rules-engine error code (such as `NOT_YOUR_TURN`) or `NOT_SEATED`. |
| `PONG` | `t`, `stateVersion`, `lobbyVersion` | Reply to `PING`. If either version is ahead of the client's, the client missed a message and sends `RESYNC` (at most once a second). |
| `HOST_STATUS` | `status: 'paused' \| 'ended'`, `message` | The host ended the game. `paused` is reserved for later. |

`SeatInfo` is `{ kind: 'empty' | 'human' | 'bot', name, status: 'connected' | 'reconnecting' | 'bot-controlled' }`.
Seat tokens are never included.

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
  reports gone, shows as `reconnecting`. After `botTakeoverMs` (30 s), a bot plays the seat
  (`bot-controlled`). In the lobby, the seat is freed instead.
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

### Version mismatch

- **Client is the wrong version:** the host answers its `HELLO` with `REJECTED
  VERSION_MISMATCH` and includes its own `hostVersion`.
- **Host is the wrong version:** the client reads the frozen `REJECTED` shape and tells the
  player who needs to update.

## Changing the protocol

Bump `PROTOCOL_VERSION` for any change to a message's shape. Never change `HELLO`, `REJECTED`,
or the envelope fields `v` and `seq`.
