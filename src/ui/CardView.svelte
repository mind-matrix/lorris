<script lang="ts">
  import type { Card } from '../core';
  import { ATLAS, ATLAS_INDEX } from './cardAtlas.generated';
  import { cardLabel } from './labels';

  let { card, label }: { card: Card | 'back'; label?: string } = $props();

  // Position within the sprite atlas, as background-position percentages.
  const index = $derived(ATLAS_INDEX[card]);
  const x = $derived(((index % ATLAS.cols) / (ATLAS.cols - 1)) * 100);
  const y = $derived((Math.floor(index / ATLAS.cols) / (ATLAS.rows - 1)) * 100);
</script>

<div
  class="card"
  role="img"
  aria-label={label ?? (card === 'back' ? 'Face-down card' : cardLabel(card))}
  style:background-position="{x}% {y}%"
  style:background-size="{ATLAS.cols * 100}% {ATLAS.rows * 100}%"
></div>

<style>
  .card {
    width: var(--card-w, 64px);
    aspect-ratio: 200 / 270;
    background-image: url('./assets/cards.png');
    background-repeat: no-repeat;
    border-radius: calc(var(--card-w, 64px) * 0.07);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
  }
</style>
