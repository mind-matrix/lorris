<script lang="ts">
  // A small, non-blocking note at the bottom of the menu screens when a new version is ready.
  let { updating = false, onupdate }: { updating?: boolean; onupdate: () => void } = $props();
  let hidden = $state(false);
</script>

{#if !hidden}
  <div class="banner" role="status">
    <span>{updating ? 'Updating…' : 'Update available'}</span>
    <button class="btn" disabled={updating} onclick={onupdate}>Update</button>
    <button class="close" aria-label="Not now" disabled={updating} onclick={() => (hidden = true)}>✕</button>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    left: 50%;
    bottom: calc(12px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 14px;
    border-radius: 999px;
    background: var(--panel);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
    font-weight: 600;
    white-space: nowrap;
    animation: rise 200ms ease-out;
  }
  .banner .btn {
    min-height: 36px;
    border-radius: 999px;
  }
  .close {
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }
  @keyframes rise {
    from {
      transform: translate(-50%, 20px);
      opacity: 0;
    }
  }
</style>
