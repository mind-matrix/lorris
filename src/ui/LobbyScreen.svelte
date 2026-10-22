<script lang="ts">
  import { teamOf, type Seat } from '../core';
  import { formatRoomCode, inviteLink } from '../net/roomCode';
  import type { HostControls, LobbySnapshot, OnlineSession } from '../session/types';
  import ConnectionNotice from './ConnectionNotice.svelte';
  import JoinSettings from './JoinSettings.svelte';
  import QrCode from './QrCode.svelte';
  import SeatPicker from './SeatPicker.svelte';
  import { TEAM_NAME } from './labels';
  import { SHARE_MESSAGES, copyText, shareInvite } from './invite';

  let {
    session,
    onstarted,
    onexit,
  }: { session: OnlineSession & Partial<HostControls>; onstarted: () => void; onexit: () => void } = $props();

  let lobby = $state<LobbySnapshot | null>(null);
  let copied = $state<string | null>(null);

  $effect(() =>
    session.subscribeLobby((l) => {
      lobby = l;
      if (l.started && l.mySeat !== null) onstarted();
    }),
  );

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
    const question = session.isHost ? 'Close this room for everyone?' : 'Leave this game?';
    if (confirm(question)) {
      session.leave();
      onexit();
    }
  }

  const statusLabel = (seat: LobbySnapshot['seats'][number]) =>
    seat.kind === 'empty' ? 'Open seat' : seat.kind === 'bot' ? 'Bot' : seat.kind === 'reserved' || seat.status === 'reconnecting' ? 'Reconnecting…' : 'Here';
</script>

{#if lobby && !session.isHost && lobby.mySeat === null && lobby.connection.kind === 'connected'}
  <!-- Found the room but not seated yet: see the table and pick a seat (or wait for one). -->
  <SeatPicker
    {lobby}
    {session}
    onleave={() => {
      session.leave();
      onexit();
    }}
  />
{:else if lobby && !session.isHost && lobby.mySeat === null}
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
          <li class="seat team-{teamOf(i)}" class:me={i === lobby.mySeat}>
            <span class="name">
              {seat.kind === 'empty' ? 'Empty' : seat.name}
              {#if i === 0}<span class="tag">host</span>{/if}
              {#if i === lobby.mySeat}<span class="tag">you</span>{/if}
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
    </section>

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
      {/if}
      <button class="btn secondary" onclick={leave}>{session.isHost ? 'Close room' : 'Leave'}</button>
    </footer>
  </main>

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

{#if lobby && !session.isHost && lobby.mySeat === null}
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
</style>
