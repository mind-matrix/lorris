<script lang="ts">
  import { onDestroy } from 'svelte';
  import { teamOf } from '../core';
  import { formatRoomCode } from '../net/roomCode';
  import type { HostControls, LobbySnapshot } from '../session/types';
  import JoinSettings from './JoinSettings.svelte';
  import { SHARE_MESSAGES, copyText, shareInvite } from './invite';
  import { TEAM_NAME } from './labels';

  // The host's in-game room menu: invite people, set join rules, release reserved seats.
  let {
    lobby,
    host,
    onclose,
    onmessage,
    updateAvailable = false,
    onupdate,
  }: {
    lobby: LobbySnapshot;
    host: HostControls;
    onclose: () => void;
    onmessage: (text: string) => void;
    updateAvailable?: boolean;
    onupdate?: () => void;
  } = $props();
  const updateNote = 'The game is paused and saved first; resume it after the update.';

  let now = $state(Date.now());
  const timer = setInterval(() => (now = Date.now()), 1000);
  onDestroy(() => clearInterval(timer));

  const reserved = $derived(lobby.seats.map((s, i) => ({ ...s, seat: i })).filter((s) => s.kind === 'reserved'));
  const openBots = $derived(lobby.seats.filter((s) => s.kind === 'bot').length);

  async function share() {
    const message = SHARE_MESSAGES[await shareInvite(lobby.roomCode)];
    if (message) onmessage(message);
  }

  async function copyCode() {
    onmessage((await copyText(lobby.roomCode)) === 'copied' ? 'Room code copied' : "Couldn't copy here");
  }

  const left = (until: number | undefined) => {
    const s = Math.max(0, Math.round(((until ?? now) - now) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="room-title">
  <h2 id="room-title">Room</h2>

  {#if updateAvailable}
    <div class="update-row">
      <span><b>Update available</b><small>{updateNote}</small></span>
      <button class="btn" onclick={onupdate}>Update now</button>
    </div>
  {/if}

  <button class="btn big" onclick={share}>Share invite link</button>
  <button class="code" onclick={copyCode} aria-label="Room code {formatRoomCode(lobby.roomCode)}, tap to copy">
    {formatRoomCode(lobby.roomCode)}
  </button>
  <p class="small">
    {#if !lobby.policy.midGameJoins}
      Joining is off, so people with the link can only watch for an open seat.
    {:else if openBots > 0}
      {openBots} bot seat{openBots > 1 ? 's are' : ' is'} open for someone to take over.
    {:else}
      Every seat has a player. Players who drop out can rejoin with the link.
    {/if}
  </p>

  {#if !lobby.pause.paused}
    <button
      class="btn secondary"
      onclick={() => {
        host.pauseGame();
        onclose();
      }}
    >
      Pause game
    </button>
  {/if}

  <JoinSettings policy={lobby.policy} onchange={(p) => host.setPolicy(p)} />

  {#if reserved.length > 0}
    <section>
      <h3>Kept for players who dropped out</h3>
      <ul>
        {#each reserved as s (s.seat)}
          <li class="team-{teamOf(s.seat)}">
            <span>
              <b>{s.name}</b> · {TEAM_NAME[teamOf(s.seat)]}
              <small>Opens to others in {left(s.reservedUntil)}</small>
            </span>
            <button class="btn secondary" onclick={() => confirm(`Give ${s.name}'s seat to anyone who joins?`) && host.releaseSeat(s.seat)}>
              Release seat
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <button class="btn secondary" onclick={onclose}>Done</button>
</div>

<style>
  .update-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--bg);
    box-shadow: inset 0 0 0 2px var(--accent);
    text-align: left;
  }
  .update-row small {
    display: block;
    color: var(--muted);
    font-size: 0.8rem;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 25;
    background: rgb(0 0 0 / 0.45);
  }
  .sheet {
    position: fixed;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    z-index: 26;
    width: min(100%, 440px);
    max-height: 90dvh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
    border-radius: 16px 16px 0 0;
    background: var(--panel);
    animation: rise 200ms ease-out;
  }
  @keyframes rise {
    from {
      transform: translate(-50%, 30%);
      opacity: 0;
    }
  }
  h2 {
    margin: 0;
    text-align: center;
    font-size: 1.1rem;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 0.95rem;
  }
  .big {
    min-height: 52px;
    font-size: 1.05rem;
  }
  .code {
    border: 0;
    background: none;
    color: var(--fg);
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 1.8rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    min-height: 44px;
    cursor: pointer;
  }
  .small,
  small {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
    text-align: center;
  }
  small {
    display: block;
    text-align: left;
    font-size: 0.8rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 10px;
    border-left: 5px solid var(--team-color);
    background: var(--bg);
  }
  .team-0 {
    --team-color: var(--team-a);
  }
  .team-1 {
    --team-color: var(--team-b);
  }
</style>
