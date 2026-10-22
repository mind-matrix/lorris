<script lang="ts">
  import { formatRoomCode } from '../net/roomCode';
  import { MAX_SAVES, type SaveIndexEntry } from '../save/SaveStore';
  import type { ClientGameRef } from '../session/storage';

  // Every game this device can pick back up: offline games, online games it hosts, and
  // online games it joined (those are only references; the host holds the game).
  let {
    saves,
    refs,
    message = null,
    busy = false,
    onresume,
    onrejoin,
    ondelete,
    ondeleteref,
    onexport,
    onimport,
    onback,
  }: {
    saves: SaveIndexEntry[];
    refs: ClientGameRef[];
    message?: string | null;
    busy?: boolean;
    onresume: (entry: SaveIndexEntry) => void;
    onrejoin: (ref: ClientGameRef) => void;
    ondelete: (id: string) => void;
    ondeleteref: (roomCode: string) => void;
    onexport: (entry: SaveIndexEntry) => void;
    onimport: (file: File) => void;
    onback: () => void;
  } = $props();

  let fileInput: HTMLInputElement;
  const date = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<main class="saved">
  <h1>Saved games</h1>
  {#if message}<p class="message" role="status">{message}</p>{/if}

  {#if saves.length === 0 && refs.length === 0}
    <p class="empty">No saved games yet. Games save themselves as you play.</p>
  {/if}

  <ul class="list">
    {#each saves as save (save.id)}
      <li>
        <div class="info">
          <b>{save.label.text}</b>
          <small><span class="badge">{save.mode === 'offline' ? 'On this device' : 'Online · you host'}</span> {date(save.savedAt)}</small>
        </div>
        <div class="actions">
          <button class="btn" disabled={busy} onclick={() => onresume(save)}>{save.mode === 'offline' ? 'Resume' : 'Resume hosting'}</button>
          <button class="btn secondary" disabled={busy} onclick={() => onexport(save)}>Export</button>
          <button class="btn secondary" disabled={busy} onclick={() => confirm(`Delete "${save.label.text}"? This can't be undone.`) && ondelete(save.id)}>
            Delete
          </button>
        </div>
      </li>
    {/each}
    {#each refs as ref (ref.roomCode)}
      <li>
        <div class="info">
          <b>Saved game with {ref.hostName}</b>
          <small>
            <span class="badge">Online · joined</span>
            {ref.label} · Room {formatRoomCode(ref.roomCode)}
          </small>
          <small>{ref.savedByHost ? `Waiting for ${ref.hostName} to resume.` : `Last seen ${date(ref.savedAt)}.`}</small>
        </div>
        <div class="actions">
          <button class="btn" disabled={busy} onclick={() => onrejoin(ref)}>Rejoin</button>
          <button
            class="btn secondary"
            disabled={busy}
            onclick={() => confirm(`Forget the game with ${ref.hostName}? You won't be able to reclaim your seat.`) && ondeleteref(ref.roomCode)}
          >
            Delete
          </button>
        </div>
      </li>
    {/each}
  </ul>

  <p class="small">{saves.length} of {MAX_SAVES} saved games{saves.length >= MAX_SAVES ? ' (full: delete one to save another)' : ''}.</p>

  <input
    bind:this={fileInput}
    type="file"
    accept=".lorris,application/json"
    hidden
    onchange={(e) => {
      const file = e.currentTarget.files?.[0];
      if (file) onimport(file);
      e.currentTarget.value = '';
    }}
  />
  <button class="btn secondary" disabled={busy} onclick={() => fileInput.click()}>Import a saved game…</button>
  <button class="btn secondary" onclick={onback}>Back</button>
</main>

<style>
  .saved {
    max-width: 460px;
    margin: 0 auto;
    padding: 20px 16px calc(20px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h1 {
    margin: 0;
    text-align: center;
    font-size: 1.6rem;
  }
  .message {
    margin: 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--panel);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .empty,
  .small {
    margin: 0;
    color: var(--muted);
    text-align: center;
    font-size: 0.9rem;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  li {
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--panel);
  }
  .info b {
    display: block;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    color: var(--muted);
    font-size: 0.8rem;
    margin-top: 2px;
  }
  .badge {
    padding: 0 6px;
    border-radius: 6px;
    background: var(--bg);
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .actions .btn {
    min-height: 40px;
    font-size: 0.85rem;
  }
</style>
