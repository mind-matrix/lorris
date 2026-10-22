<script lang="ts">
  import { onDestroy } from 'svelte';
  import { teamOf } from '../core';
  import { formatRoomCode } from '../net/roomCode';
  import type { LobbySnapshot, OnlineSession } from '../session/types';
  import { SUIT_SYMBOL, TEAM_NAME, isRed } from './labels';

  // For a newcomer with no seat yet: the public table, and which seats they can take.
  let { lobby, session, onleave }: { lobby: LobbySnapshot; session: OnlineSession; onleave: () => void } = $props();

  let now = $state(Date.now());
  const timer = setInterval(() => (now = Date.now()), 1000);
  onDestroy(() => clearInterval(timer));

  const joinsAllowed = $derived(!lobby.started || lobby.policy.midGameJoins);
  const isOpen = (kind: string) => joinsAllowed && (lobby.started ? kind === 'bot' : kind === 'empty' || kind === 'bot');
  const anyOpen = $derived(lobby.seats.some((s) => isOpen(s.kind)));
  let requested = $state<number | null | undefined>(undefined);
  $effect(() => {
    // A reply (denial) clears the "Taking seat…" state.
    if (lobby.notice) requested = undefined;
  });

  function take(seat: number | null) {
    requested = seat;
    session.takeSeat?.(seat);
  }

  function countdown(until: number | undefined): string {
    const s = Math.max(0, Math.round(((until ?? now) - now) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
</script>

<main class="picker">
  <header>
    <p class="label">Game {formatRoomCode(lobby.roomCode)}{lobby.started ? ' · in progress' : ''}</p>
    {#if lobby.table}
      {@const t = lobby.table}
      <div class="summary">
        <span>Set {t.setNumber}</span>
        {#if t.trump}<span class="trump" class:red={isRed(t.trump)}>Trump {SUIT_SYMBOL[t.trump]}</span>{/if}
        {#if t.contract}<span>Call {t.contract.value} by {lobby.seats[t.contract.seat]?.name || `seat ${t.contract.seat + 1}`}</span>{/if}
      </div>
      <div class="scores">
        {#each [0, 1] as const as team}
          <div class="score team-{team}"><span>{TEAM_NAME[team]}</span><b>{t.scores[team]}</b></div>
        {/each}
      </div>
    {/if}
  </header>

  {#if lobby.notice}
    <p class="notice" role="alert">{lobby.notice}</p>
  {:else if !joinsAllowed}
    <p class="notice" role="status">The host isn't letting new players join right now.</p>
  {:else if !anyOpen}
    <p class="notice" role="status">This game is full. You can wait for the next game or ask the host.</p>
  {:else}
    <p class="hint">Pick a seat. You'll take over that bot's cards and team.</p>
  {/if}

  <ol class="seats" aria-label="Seats">
    {#each lobby.seats as seat, i (i)}
      {@const open = isOpen(seat.kind)}
      <li class="seat team-{teamOf(i)}">
        <span class="name">
          {seat.kind === 'empty' ? 'Empty seat' : seat.name}
          <span class="team">{TEAM_NAME[teamOf(i)]}</span>
        </span>
        <span class="status">
          {#if seat.kind === 'bot'}Bot{open ? ' · open' : ''}
          {:else if seat.kind === 'reserved'}Kept for {seat.name} · {countdown(seat.reservedUntil)}
          {:else if seat.kind === 'empty'}Open
          {:else}Playing{/if}
        </span>
        {#if open}
          <button class="btn take" disabled={requested !== undefined} onclick={() => take(i)}>
            {requested === i ? 'Taking…' : 'Take seat'}
          </button>
        {/if}
      </li>
    {/each}
  </ol>

  <footer>
    {#if anyOpen}
      <button class="btn secondary" disabled={requested !== undefined} onclick={() => take(null)}>Any open seat</button>
    {:else}
      <p class="small">You'll be seated automatically if a seat opens and the host allows it.</p>
    {/if}
    <button class="btn secondary" onclick={onleave}>Leave</button>
  </footer>
</main>

<style>
  .picker {
    max-width: 440px;
    margin: 0 auto;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .label {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    text-align: center;
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 14px;
    margin: 8px 0;
    font-size: 0.9rem;
  }
  .trump {
    font-weight: 700;
  }
  .trump.red {
    color: var(--red-suit);
  }
  .scores {
    display: flex;
    gap: 8px;
  }
  .score {
    flex: 1;
    display: flex;
    justify-content: space-between;
    padding: 6px 10px;
    border-radius: 8px;
    border-left: 5px solid var(--team-color);
    background: var(--panel);
  }
  .team-0 {
    --team-color: var(--team-a);
  }
  .team-1 {
    --team-color: var(--team-b);
  }
  .notice {
    margin: 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--panel);
    box-shadow: inset 0 0 0 2px var(--accent);
    text-align: center;
  }
  .hint,
  .small {
    margin: 0;
    text-align: center;
    color: var(--muted);
    font-size: 0.9rem;
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
    align-items: center;
    column-gap: 10px;
    min-height: 56px;
    padding: 6px 10px;
    border-radius: 10px;
    border-left: 5px solid var(--team-color);
    background: var(--panel);
  }
  .name {
    font-weight: 600;
  }
  .team {
    margin-left: 6px;
    padding: 0 6px;
    border-radius: 6px;
    background: var(--team-color);
    color: #111;
    font-size: 0.7rem;
    font-weight: 700;
  }
  .status {
    grid-row: 2;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .take {
    grid-row: 1 / span 2;
    grid-column: 2;
    min-height: 40px;
    font-size: 0.85rem;
  }
  footer {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
