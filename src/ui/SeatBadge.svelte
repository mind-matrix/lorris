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
    voice = 'none',
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
    /** Online voice chat: not in voice, in voice, or talking right now. */
    voice?: 'none' | 'in' | 'speaking';
  } = $props();
</script>

<div class="seat team-{teamOf(seat)}" class:turn={isTurn} class:me={isMe} class:speaking={voice === 'speaking'}>
  <div class="name">
    {name}
    {#if voice !== 'none'}<span class="mic" title={voice === 'speaking' ? 'Talking' : 'In voice chat'} aria-label={voice === 'speaking' ? 'talking' : 'in voice chat'}>🎙</span>{/if}
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
    <div class="bubble" class:pass={bid === 'pass'}>{bid === 'pass' ? 'Pass' : `Call ${bid}`}</div>
  {/if}
</div>

<style>
  .mic {
    font-size: 0.75rem;
    opacity: 0.75;
  }
  .seat.speaking {
    box-shadow:
      0 0 0 2px var(--good),
      0 0 12px var(--good);
  }
  .seat.speaking .mic {
    opacity: 1;
  }
  /* Filled with the team's color, matching the score boxes, so teams read at a glance. */
  .seat {
    --card-w: 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
    border-radius: 10px;
    background: var(--team-color);
    color: var(--team-ink);
    border: 2px solid color-mix(in srgb, var(--team-color) 60%, #000);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
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
  /* Whose turn: a pulsing white ring (white, so it never looks like a team color). */
  .turn {
    box-shadow:
      0 0 0 3px #fff,
      0 0 0 5px rgba(0, 0, 0, 0.35),
      0 0 18px 4px rgba(255, 255, 255, 0.75);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      box-shadow:
        0 0 0 3px #fff,
        0 0 0 5px rgba(0, 0, 0, 0.35),
        0 0 6px 1px rgba(255, 255, 255, 0.4);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .turn {
      animation: none;
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
    background: var(--team-ink);
    color: #fff;
    font-size: 0.65rem;
  }
  .count {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  /* A player's call, large and high-contrast so it's readable across the table. */
  .bubble {
    margin-top: 2px;
    padding: 2px 8px;
    white-space: nowrap;
    border-radius: 8px;
    background: var(--team-ink);
    color: #fff;
    font-size: 0.85rem;
    font-weight: 800;
    letter-spacing: 0.02em;
  }
  .bubble.pass {
    background: rgba(0, 0, 0, 0.18);
    color: var(--team-ink);
    font-weight: 700;
  }
  .conn {
    font-size: 0.65rem;
    font-weight: 700;
    opacity: 0.8;
    white-space: nowrap;
  }
  .conn.reconnecting {
    opacity: 1;
  }
  /* The winning call: white, with a gold edge like the trump tile. */
  .called {
    background: #fff;
    color: var(--team-ink);
    box-shadow: 0 0 0 2px var(--trump-gold);
  }
</style>
