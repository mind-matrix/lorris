<script lang="ts">
  import { teamOf, type Seat } from '../core';
  import { formatRoomCode, inviteLink } from '../net/roomCode';
  import type { HostControls, LobbySnapshot, OnlineSession } from '../session/types';
  import ConnectionNotice from './ConnectionNotice.svelte';
  import JoinSettings from './JoinSettings.svelte';
  import MicButton from './MicButton.svelte';
  import type { VoiceChat } from './voiceChat.svelte';
  import QrCode from './QrCode.svelte';
  import SeatPicker from './SeatPicker.svelte';
  import { TEAM_NAME } from './labels';
  import { SHARE_MESSAGES, copyText, shareInvite } from './invite';

  let {
    session,
    voiceChat = null,
    onstarted,
    onexit,
  }: {
    session: OnlineSession & Partial<HostControls>;
    /** Voice chat for this room (null where the browser or connection can't carry voice). */
    voiceChat?: VoiceChat | null;
    onstarted: () => void;
    onexit: () => void;
  } = $props();

  let lobby = $state<LobbySnapshot | null>(null);
  let copied = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() =>
    session.subscribeLobby((l) => {
      lobby = l;
      if (l.started && (l.mySeat !== null || l.spectating)) onstarted();
    }),
  );

  // Voice chat's messages ("Microphone ready...") show here while the lobby is on screen.
  $effect(() => {
    const chat = voiceChat;
    if (!chat) return;
    chat.onmessage = showToast;
    return () => {
      if (chat.onmessage === showToast) chat.onmessage = () => {};
      clearTimeout(toastTimer);
    };
  });

  function showToast(text: string) {
    toast = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 2600);
  }

  /** Seated players can talk in the lobby; spectators and newcomers without a seat can't. */
  const canTalk = $derived(voiceChat !== null && lobby?.mySeat != null);
  const watching = $derived(lobby?.spectating ?? false);
  const seatOpenToSpectator = $derived(lobby?.seats.some((s) => s.kind === 'empty' || s.kind === 'bot') ?? false);

  const link = $derived(inviteLink(session.roomCode, location.href));
  const host = $derived(session.isHost ? (session as OnlineSession & HostControls) : null);
  const emptySeats = $derived(lobby?.seats.filter((s) => s.kind === 'empty').length ?? 0);

  async function share() {
    showCopied(SHARE_MESSAGES[await shareInvite(session.roomCode)]);
  }

  async function copy(text: string, message: string) {
    showCopied((await copyText(text)) === 'copied' ? message : 'Copy not available here');
  }

  function showCopied(message: string | null) {
    if (!message) return;
    copied = message;
    setTimeout(() => (copied = null), 2000);
  }

  function leave() {
    const question = session.isHost ? 'Close this room for everyone?' : watching ? 'Stop watching this game?' : 'Leave this game?';
    if (confirm(question)) {
      session.leave();
      onexit();
    }
  }

  const statusLabel = (seat: LobbySnapshot['seats'][number]) =>
    seat.kind === 'empty' ? 'Open seat' : seat.kind === 'bot' ? 'Bot' : seat.kind === 'reserved' || seat.status === 'reconnecting' ? 'Reconnecting…' : 'Here';
</script>

{#if lobby && !session.isHost && !lobby.spectating && lobby.mySeat === null && lobby.connection.kind === 'connected'}
  <!-- Found the room but not seated yet: see the table and pick a seat (or wait for one). -->
  <SeatPicker
    {lobby}
    {session}
    onleave={() => {
      session.leave();
      onexit();
    }}
  />
{:else if lobby && !session.isHost && !lobby.spectating && lobby.mySeat === null}
  <!-- Still looking for the room: nothing to share or show yet. -->
  <main class="lobby joining">
    <p class="label">Joining game</p>
    <p class="code">{formatRoomCode(session.roomCode)}</p>
  </main>
{:else if lobby}
  <main class="lobby">
    <header>
      <p class="label">Room code</p>
      <button class="code" onclick={() => copy(session.roomCode, 'Code copied')} aria-label="Room code {formatRoomCode(session.roomCode)}, tap to copy">
        {formatRoomCode(session.roomCode)}
      </button>
    </header>

    <section class="invite">
      <QrCode text={link} label="QR code with the invite link" />
      <button class="btn" onclick={share}>Share invite link</button>
      <p class="small" aria-live="polite">{copied ?? 'Friends can scan the code, open the link, or type the room code.'}</p>
    </section>

    <section aria-label="Seats">
      <h2>Seats</h2>
      <ol class="seats">
        {#each lobby.seats as seat, i (i)}
          {@const speaking = voiceChat?.isSpeaking(i) ?? false}
          <li class="seat team-{teamOf(i)}" class:me={i === lobby.mySeat} class:speaking>
            <span class="name">
              {seat.kind === 'empty' ? 'Empty' : seat.name}
              {#if i === 0}<span class="tag">host</span>{/if}
              {#if i === lobby.mySeat}<span class="tag">you</span>{/if}
              {#if speaking}<span class="talk" role="img" aria-label="talking"><i></i><i></i><i></i></span>{/if}
            </span>
            <span class="status" class:warn={seat.status === 'reconnecting' && seat.kind === 'human'}>
              {TEAM_NAME[teamOf(i as Seat)]} · {statusLabel(seat)}
            </span>
            {#if host && i !== 0}
              {#if seat.kind === 'empty'}
                <button class="btn secondary small-btn" onclick={() => host.addBot(i)}>Add bot</button>
              {:else if seat.kind === 'bot'}
                <button class="btn secondary small-btn" onclick={() => host.freeSeat(i)}>Remove</button>
              {:else}
                <button class="btn secondary small-btn" onclick={() => confirm(`Remove ${seat.name}?`) && host.kick(i)}>Kick</button>
              {/if}
            {/if}
          </li>
        {/each}
      </ol>
      {#if lobby.spectators.length > 0}
        <p class="watchers"><span aria-hidden="true">👀</span> Watching: {lobby.spectators.join(', ')}</p>
      {/if}
    </section>

    {#if canTalk && voiceChat}
      <section class="voice" aria-label="Voice chat">
        <div class="voice-text">
          <b>Voice chat</b>
          <span class="small">Say hi before the deal. Hold the mic to talk, or tap to start and tap again to stop.</span>
        </div>
        <MicButton
          recording={voiceChat.talking}
          latched={voiceChat.latched}
          elapsedMs={voiceChat.elapsedMs}
          slow={voiceChat.slow}
          blocked={voiceChat.blocked}
          resetToken={voiceChat.resetToken}
          onstart={voiceChat.start}
          onstop={voiceChat.stop}
          onabort={voiceChat.stop}
          onunavailable={voiceChat.unavailable}
        />
      </section>
    {/if}

    {#if host}
      <JoinSettings policy={lobby.policy} onchange={(p) => host.setPolicy(p)} />
    {/if}

    <footer>
      {#if host}
        <button class="btn big" onclick={() => host.start()}>
          {emptySeats > 0 ? `Start with ${emptySeats} bot${emptySeats > 1 ? 's' : ''}` : 'Start game'}
        </button>
      {:else if lobby.mySeat !== null}
        <p class="waiting">Waiting for the host to start…</p>
      {:else if watching}
        <p class="waiting">You're watching. The table appears here when the host starts.</p>
        {#if lobby.notice}<p class="small" role="alert">{lobby.notice}</p>{/if}
        {#if seatOpenToSpectator}
          <button class="btn secondary" onclick={() => session.takeSeat?.(null)}>Take a seat and play</button>
        {/if}
      {/if}
      <button class="btn secondary" onclick={leave}>{session.isHost ? 'Close room' : watching ? 'Stop watching' : 'Leave'}</button>
    </footer>
  </main>

  {#if toast}<div class="toast" role="status">{toast}</div>{/if}

  <ConnectionNotice
    connection={lobby.connection}
    onretry={session.retry && (() => session.retry!())}
    onkeepwaiting={session.keepWaiting && (() => session.keepWaiting!())}
    onleave={() => {
      session.close();
      onexit();
    }}
  />
{/if}

{#if lobby && !session.isHost && !lobby.spectating && lobby.mySeat === null}
  <ConnectionNotice
    connection={lobby.connection}
    onretry={session.retry && (() => session.retry!())}
    onleave={() => {
      session.close();
      onexit();
    }}
  />
{/if}

<style>
  .joining {
    text-align: center;
    padding-top: 48px;
  }
  .lobby {
    max-width: 440px;
    margin: 0 auto;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  header {
    text-align: center;
  }
  .label {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .code {
    border: 0;
    background: none;
    color: var(--fg);
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 2.4rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    min-height: 48px;
    cursor: pointer;
  }
  .invite {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .small {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
    text-align: center;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1rem;
  }
  .seats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .seat {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    align-items: center;
    column-gap: 10px;
    min-height: 56px;
    padding: 6px 10px;
    border-radius: 10px;
    border-left: 5px solid var(--team-color);
    background: var(--panel);
  }
  .team-0 {
    --team-color: var(--team-a);
  }
  .team-1 {
    --team-color: var(--team-b);
  }
  .seat.me {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .name {
    font-weight: 600;
  }
  .status {
    grid-row: 2;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .status.warn {
    color: var(--accent);
  }
  .seat .btn {
    grid-row: 1 / span 2;
    grid-column: 2;
  }
  .small-btn {
    min-height: 40px;
    font-size: 0.85rem;
  }
  .tag {
    margin-left: 4px;
    padding: 0 6px;
    border-radius: 6px;
    background: var(--team-color);
    color: #111;
    font-size: 0.7rem;
    font-weight: 700;
  }
  footer {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .big {
    min-height: 52px;
    font-size: 1.1rem;
  }
  .waiting {
    margin: 0;
    text-align: center;
    font-weight: 600;
  }
  .watchers {
    margin: 8px 0 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .voice {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--panel);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .voice-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
  }
  .voice-text .small {
    text-align: left;
  }
  .seat.speaking {
    box-shadow: inset 0 0 0 2px var(--good);
  }
  /* Three little bars bouncing next to whoever is talking. */
  .talk {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 12px;
    margin-left: 6px;
    vertical-align: middle;
  }
  .talk i {
    width: 3px;
    height: 100%;
    border-radius: 2px;
    background: var(--good);
    animation: talk 0.6s ease-in-out infinite alternate;
  }
  .talk i:nth-child(2) {
    animation-delay: -0.2s;
  }
  .talk i:nth-child(3) {
    animation-delay: -0.4s;
  }
  @keyframes talk {
    from {
      transform: scaleY(0.3);
    }
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(20px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 30;
    max-width: min(90%, 400px);
    padding: 8px 14px;
    border-radius: 10px;
    background: var(--panel);
    box-shadow: 0 4px 18px rgb(0 0 0 / 0.3);
    font-size: 0.9rem;
    text-align: center;
  }
</style>
