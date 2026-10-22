<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ConnectionState } from '../session/types';

  // Small banner for transient states; a dialog for states that need a decision.
  // Every state says what's happening and offers a way out, so nobody is left on a spinner.
  let {
    connection,
    onretry,
    onkeepwaiting,
    onleave,
    inline = false,
  }: {
    connection: ConnectionState;
    /** Show the small banner inside the nearest positioned parent (e.g. the table) instead of the page top. */
    inline?: boolean;
    onretry?: () => void;
    onkeepwaiting?: () => void;
    onleave: () => void;
  } = $props();

  let now = $state(Date.now());
  const timer = setInterval(() => (now = Date.now()), 1000);
  onDestroy(() => clearInterval(timer));

  function countdown(deadline: number): string {
    const s = Math.max(0, Math.round((deadline - now) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
</script>

{#if connection.kind === 'connecting'}
  <div class="dialog-backdrop">
    <div class="dialog" role="status">
      <div class="spinner" aria-hidden="true"></div>
      <p><b>Looking for the game…</b></p>
      <p class="small">This usually takes a few seconds.</p>
      <button class="btn secondary" onclick={onleave}>Cancel</button>
    </div>
  </div>
{:else if connection.kind === 'reconnecting'}
  <div class="banner" class:inline role="status"><span class="dot"></span> Reconnecting…</div>
{:else if connection.kind === 'waiting-for-host'}
  <div class="banner" class:inline role="status">
    <span class="dot"></span> Waiting for the host · {countdown(connection.deadline)}
  </div>
{:else if connection.kind === 'waiting-to-resume'}
  <div class="dialog-backdrop">
    <div class="dialog" role="status">
      <p><b>Waiting for {connection.hostName} to resume the game</b></p>
      <p class="small">You'll rejoin your seat automatically as soon as they reopen it.</p>
      <button class="btn secondary" onclick={onleave}>Leave</button>
    </div>
  </div>
{:else if connection.kind === 'host-timeout'}
  <div class="dialog-backdrop">
    <div class="dialog" role="alertdialog" aria-labelledby="cn-title">
      <p id="cn-title"><b>The host hasn't come back yet.</b></p>
      <p class="small">They may have closed Lorris or lost their connection.</p>
      <div class="row">
        <button class="btn" onclick={onkeepwaiting}>Keep waiting</button>
        <button class="btn secondary" onclick={onleave}>Leave</button>
      </div>
    </div>
  </div>
{:else if connection.kind === 'failed' || connection.kind === 'rejected' || connection.kind === 'ended'}
  <div class="dialog-backdrop">
    <div class="dialog" role="alertdialog" aria-labelledby="cn-title">
      <p id="cn-title">{connection.message}</p>
      <div class="row">
        {#if connection.kind === 'rejected' && connection.needsUpdate}
          <button class="btn" onclick={() => location.reload()}>Update now</button>
        {:else if connection.kind === 'failed' && connection.canRetry && onretry}
          <button class="btn" onclick={onretry}>Try again</button>
        {/if}
        <button class="btn secondary" onclick={onleave}>Back to menu</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    top: calc(8px + env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    z-index: 15;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 24px);
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--panel);
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
  }
  /* On the table: below the top seat, above the play area. */
  .banner.inline {
    position: absolute;
    top: 27%;
    z-index: 5;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    animation: blink 1.2s ease-in-out infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.3;
    }
  }
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(0 0 0 / 0.5);
  }
  .dialog {
    width: min(100%, 360px);
    padding: 18px;
    border-radius: 14px;
    background: var(--panel);
    text-align: center;
  }
  .dialog p {
    margin: 0 0 10px;
  }
  .small {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .row {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 6px;
  }
  .spinner {
    width: 32px;
    height: 32px;
    margin: 4px auto 12px;
    border: 4px solid var(--line);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* Reduced motion: no spinning or blinking, the text says what's happening. */
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      border-top-color: var(--line);
      border-left-color: var(--accent);
    }
  }
</style>
