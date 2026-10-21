<script lang="ts">
  import { SUITS, type Suit } from '../core';
  import { SUIT_NAME, SUIT_SYMBOL, isRed } from './labels';

  let { onpick }: { onpick: (suit: Suit) => void } = $props();
</script>

<div role="group" aria-label="Choose trump">
  <p>Choose trump</p>
  <div class="row">
    {#each SUITS as suit}
      <button class="btn suit" class:red={isRed(suit)} onclick={() => onpick(suit)} aria-label={SUIT_NAME[suit]}>
        {SUIT_SYMBOL[suit]}
      </button>
    {/each}
  </div>
</div>

<style>
  p {
    margin: 0 0 6px;
    text-align: center;
    font-weight: 600;
  }
  .row {
    display: flex;
    justify-content: center;
    gap: 10px;
  }
  .suit {
    font-size: 1.6rem;
    min-width: 56px;
    background: #fff;
    color: #111;
  }
  .suit.red {
    color: #d22;
  }
</style>
