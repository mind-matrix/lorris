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
  }: { roomCode: string; paused: boolean; onpause: () => void; onclose: () => void; onmessage: (t: string) => void } = $props();

  async function share() {
    const m = SHARE_MESSAGES[await shareInvite(roomCode)];
    if (m) onmessage(m);
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Game menu">
  <p class="code">{formatRoomCode(roomCode)}</p>
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
