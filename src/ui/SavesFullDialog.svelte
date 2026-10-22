<script lang="ts">
  import { MAX_SAVES, type SaveIndexEntry } from '../save/SaveStore';
  import SaveList from './SaveList.svelte';

  // Shown when starting a game while the saved games list is full.
  let {
    saves,
    ondelete,
    onstart,
    oncancel,
  }: { saves: SaveIndexEntry[]; ondelete: (id: string) => void; onstart: (withSaving: boolean) => void; oncancel: () => void } = $props();
  const full = $derived(saves.length >= MAX_SAVES);
</script>

<div class="backdrop">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="full-title">
    <h2 id="full-title">{full ? 'Saved games are full' : 'There is room now'}</h2>
    <p class="small">
      {full
        ? `You have ${MAX_SAVES} saved games. Delete one to save this game, or play it without saving.`
        : 'This game will be saved as you play.'}
    </p>
    <SaveList {saves} {ondelete} />
    <div class="row">
      {#if full}
        <button class="btn secondary" onclick={() => onstart(false)}>Play without saving</button>
      {:else}
        <button class="btn" onclick={() => onstart(true)}>Start game</button>
      {/if}
      <button class="btn secondary" onclick={oncancel}>Cancel</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(0 0 0 / 0.5);
  }
  .dialog {
    width: min(100%, 420px);
    padding: 18px;
    border-radius: 14px;
    background: var(--panel);
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
  }
  .small {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .row {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
  }
</style>
