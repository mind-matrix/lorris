<script lang="ts">
  // Asked when leaving a game this device can save: keep it to resume later, or discard it.
  let {
    message,
    onsave,
    ondiscard,
    oncancel,
  }: { message: string; onsave: () => Promise<void> | void; ondiscard: () => void; oncancel: () => void } = $props();
  let busy = $state(false);

  async function save() {
    busy = true;
    try {
      await onsave();
    } finally {
      busy = false;
    }
  }
</script>

<div class="backdrop">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="leave-title">
    <h2 id="leave-title">Leave this game?</h2>
    <p class="small">{message}</p>
    <div class="row">
      <button class="btn" disabled={busy} onclick={save}>{busy ? 'Saving…' : 'Save and exit'}</button>
      <button class="btn secondary" disabled={busy} onclick={ondiscard}>Exit without saving</button>
      <button class="btn secondary" disabled={busy} onclick={oncancel}>Cancel</button>
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
