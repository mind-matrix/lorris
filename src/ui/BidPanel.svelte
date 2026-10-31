<script lang="ts">
  import type { Action } from '../core';

  let { legal, onact }: { legal: Action[]; onact: (a: Action) => void } = $props();
  const bids = $derived(legal.filter((a) => a.type === 'BID'));
</script>

<div class="panel" role="group" aria-label="Make a call">
  <p>Your call</p>
  <div class="row">
    {#each bids as bid}
      {#if bid.type === 'BID'}
        <button class="btn" onclick={() => onact(bid)}>{bid.value}</button>
      {/if}
    {/each}
    <button class="btn secondary" onclick={() => onact({ type: 'PASS' })}>Pass</button>
  </div>
</div>

<style>
  .panel {
    width: 100%;
  }
  .panel p {
    margin: 0 0 6px;
    text-align: center;
    font-weight: 600;
  }
  /* One row that always fits: the number buttons share the space (narrow phones, or room
     left for the mic button) instead of pushing Pass onto a second line. */
  .row {
    display: flex;
    flex-wrap: nowrap;
    justify-content: center;
    gap: 6px;
  }
  .row .btn {
    flex: 0 1 44px;
    min-width: 0;
    padding-inline: 0;
  }
  .row .btn.secondary {
    flex: 0 0 auto;
    padding-inline: 12px;
  }
</style>
