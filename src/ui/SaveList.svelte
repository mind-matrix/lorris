<script lang="ts">
  import type { SaveIndexEntry } from '../save/SaveStore';

  // A compact list of saved games with a Delete button on each (used when the list is full).
  let { saves, ondelete }: { saves: SaveIndexEntry[]; ondelete: (id: string) => void } = $props();

  const date = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const modeLabel = (e: SaveIndexEntry) => (e.mode === 'offline' ? 'On this device' : 'Online · hosting');
</script>

<ul class="saves">
  {#each saves as save (save.id)}
    <li>
      <span class="info">
        <b>{save.label.text}</b>
        <small>{modeLabel(save)} · {date(save.savedAt)}</small>
      </span>
      <button class="btn secondary" onclick={() => confirm(`Delete "${save.label.text}"? This can't be undone.`) && ondelete(save.id)}>
        Delete
      </button>
    </li>
  {/each}
</ul>

<style>
  .saves {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 50dvh;
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--bg);
    text-align: left;
  }
  .info {
    min-width: 0;
  }
  b {
    display: block;
    overflow-wrap: anywhere;
  }
  small {
    color: var(--muted);
    font-size: 0.8rem;
  }
</style>
