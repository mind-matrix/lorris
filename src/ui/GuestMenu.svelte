<script lang="ts">
  import { formatRoomCode } from '../net/roomCode';
  import { SHARE_MESSAGES, shareInvite } from './invite';

  // A guest's in-game menu: invite someone, or ask the host for a pause.
  let {
    roomCode,
    paused,
    onpause,
    onclose,
    onmessage,
    updateAvailable = false,
    onupdate,
  }: {
    roomCode: string;
    paused: boolean;
    onpause: () => void;
    onclose: () => void;
    onmessage: (t: string) => void;
    updateAvailable?: boolean;
    onupdate?: () => void;
  } = $props();
  const updateNote = 'You rejoin your seat right after.';

  async function share() {
    const m = SHARE_MESSAGES[await shareInvite(roomCode)];
    if (m) onmessage(m);
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Game menu">
  <p class="code">{formatRoomCode(roomCode)}</p>

  {#if updateAvailable}
    <div class="update-row">
      <span><b>Update available</b><small>{updateNote}</small></span>
      <button class="btn" onclick={onupdate}>Update now</button>
    </div>
  {/if}
  <button class="btn big" onclick={share}>Share invite link</button>
  <button
    class="btn secondary"
    disabled={paused}
    onclick={() => {
      onpause();
      onclose();
    }}
  >
    {paused ? 'The game is paused' : 'Ask the host to pause'}
  </button>
  <button class="btn secondary" onclick={onclose}>Done</button>
</div>

<style>
  .update-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--bg);
    box-shadow: inset 0 0 0 2px var(--accent);
    text-align: left;
  }
  .update-row small {
    display: block;
    color: var(--muted);
    font-size: 0.8rem;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 25;
    background: rgb(0 0 0 / 0.45);
  }
  .sheet {
    position: fixed;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    z-index: 26;
    width: min(100%, 440px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
    border-radius: 16px 16px 0 0;
    background: var(--panel);
  }
  .code {
    margin: 0;
    text-align: center;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 1.6rem;
    font-weight: 700;
    letter-spacing: 0.12em;
  }
  .big {
    min-height: 50px;
  }
</style>
