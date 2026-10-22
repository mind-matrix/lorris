<script lang="ts">
  import { teamOf, type Seat } from '../core';
  import CardView from './CardView.svelte';

  let {
    name,
    seat,
    cardCount,
    isTurn,
    isDealer,
    bid,
    called,
    isMe,
    status = 'connected',
  }: {
    name: string;
    seat: Seat;
    cardCount: number;
    isTurn: boolean;
    isDealer: boolean;
    bid: number | 'pass' | null;
    called: number | null;
    isMe: boolean;
    /** Online only: is this seat's player here, reconnecting, or covered by a bot? */
    status?: 'connected' | 'reconnecting' | 'bot-controlled';
  } = $props();
</script>

<div class="seat team-{teamOf(seat)}" class:turn={isTurn} class:me={isMe}>
  <div class="name">
    {name}
    {#if isDealer}<span class="chip" title="Dealer">D</span>{/if}
  </div>
  {#if !isMe}
    <div class="count" aria-label="{cardCount} cards">
      <CardView card="back" label="" />
      <span>{cardCount}</span>
    </div>
  {/if}
  {#if status === 'reconnecting'}
    <div class="conn reconnecting" title="Reconnecting">● Reconnecting</div>
  {:else if status === 'bot-controlled'}
    <div class="conn" title="A bot is playing this seat until they're back">Bot playing</div>
  {/if}
  {#if called !== null}
    <div class="bubble called">Called {called}</div>
  {:else if bid !== null}
    <div class="bubble">{bid === 'pass' ? 'Pass' : bid}</div>
  {/if}
</div>

<style>
  .seat {
    --card-w: 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
    border-radius: 10px;
    background: var(--panel);
    border: 2px solid var(--team-color);
    min-width: 64px;
    font-size: 0.8rem;
    transition: box-shadow 200ms ease;
  }
  .team-0 {
    --team-color: var(--team-a);
  }
  .team-1 {
    --team-color: var(--team-b);
  }
  .turn {
    box-shadow: 0 0 0 3px var(--accent), 0 0 14px var(--accent);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 3px var(--accent), 0 0 4px var(--accent);
    }
  }
  .name {
    font-weight: 600;
    white-space: nowrap;
  }
  .chip {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    margin-left: 2px;
    border-radius: 50%;
    background: var(--accent);
    color: #111;
    font-size: 0.65rem;
  }
  .count {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .bubble {
    padding: 0 6px;
    white-space: nowrap;
    border-radius: 8px;
    background: var(--bg);
    font-weight: 600;
  }
  .conn {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
  }
  .conn.reconnecting {
    color: var(--accent);
  }
  .called {
    background: var(--team-color);
    color: #111;
  }
</style>
