<script lang="ts">
  import type { Card, Suit } from '../core';
  import CardView from './CardView.svelte';
  import { sortHand } from './labels';

  let {
    cards,
    maxCards,
    dealDelays,
    hint,
    trump,
    playable,
    onplay,
  }: {
    cards: Card[];
    /** Size cards for a full hand, so they don't grow (and shift the layout) as the hand empties. */
    maxCards: number;
    /** While dealing: when each card lands (ms), so it appears as it's dealt. Null otherwise. */
    dealDelays: Map<Card, number> | null;
    /** Optional prompt shown under the hand (in the reserved hint line) when no card is selected. */
    hint: string | null;
    trump: Suit | null;
    playable: Card[] | null;
    onplay: (card: Card) => void;
  } = $props();

  let selected = $state<Card | null>(null);
  const sorted = $derived(sortHand(cards, trump));
  const message = $derived(selected ? 'Tap again to play' : hint);

  // Drop the selection when it's no longer valid (card played, turn over).
  $effect(() => {
    if (selected && !(playable ?? []).includes(selected)) selected = null;
  });

  // Tap once to lift a card, tap again to play it, so a stray tap doesn't throw a card.
  function tap(card: Card) {
    if (!playable?.includes(card)) return;
    if (selected === card) {
      selected = null;
      onplay(card);
    } else {
      selected = card;
    }
  }
</script>

<div class="hand" style:--n={Math.max(maxCards, sorted.length)}>
  {#each sorted as card (card)}
    {@const canPlay = playable?.includes(card) ?? false}
    <button
      class="slot"
      class:selected={selected === card}
      class:playable={canPlay}
      class:dealt={dealDelays !== null}
      style:animation-delay={dealDelays ? `${dealDelays.get(card) ?? 0}ms` : undefined}
      class:dim={playable !== null && !canPlay}
      disabled={!canPlay}
      onclick={() => tap(card)}
      aria-pressed={selected === card}
    >
      <CardView {card} />
    </button>
  {/each}
</div>
<!-- Always rendered (just hidden when empty) so showing a message doesn't shift the layout. -->
<p class="hint" class:shown={message !== null} aria-live="polite">{message ?? '\u00a0'}</p>

<style>
  .hand {
    /* Cards overlap so 8 fit on a 360px screen, and spread out on wider ones. */
    --card-w: min(84px, calc((100vw - 24px) / (1 + (var(--n) - 1) * 0.62)));
    display: flex;
    justify-content: center;
    padding: 18px 8px 4px;
    min-height: calc(var(--card-w) * 1.35 + 22px);
  }
  .slot {
    all: unset;
    position: relative;
    cursor: pointer;
    margin-left: calc(var(--card-w) * -0.38);
    transition: transform 150ms ease, filter 150ms ease;
    border-radius: 6px;
    -webkit-tap-highlight-color: transparent;
  }
  .slot:first-child {
    margin-left: 0;
  }
  .slot:disabled {
    cursor: default;
  }
  .slot.dim {
    filter: brightness(0.6) saturate(0.5);
  }
  /* Playable cards sit a little higher than the rest; the selected one higher still. */
  .slot.playable {
    transform: translateY(-8px);
  }
  .slot.selected {
    z-index: 1;
    transform: translateY(-20px);
  }
  /* Cards appear in the hand as the deal reaches this seat. */
  .slot.dealt {
    animation: arrive 180ms ease-out backwards;
  }
  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateY(-24px) scale(0.85);
    }
  }
  .slot:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .hint {
    visibility: hidden;
    margin: 0;
    line-height: 1.2rem;
    text-align: center;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .hint.shown {
    visibility: visible;
  }
</style>
