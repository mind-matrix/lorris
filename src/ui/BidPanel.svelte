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
  .panel p {
    margin: 0 0 6px;
    text-align: center;
    font-weight: 600;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
</style>
