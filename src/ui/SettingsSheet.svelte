<script lang="ts">
  import { settings, updateSettings } from './settings.svelte';
  import { season } from './season.svelte';
  import { HALLOWEEN_SEASON_END_LABEL } from '../seasonal/halloween';

  let { onclose }: { onclose: () => void } = $props();

  let closeButton: HTMLButtonElement;
  $effect(() => closeButton.focus({ preventScroll: true }));

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
  <header>
    <h2 id="settings-title">Settings</h2>
    <button bind:this={closeButton} class="btn secondary close" onclick={onclose}>Done</button>
  </header>

  <div class="row">
    <div class="text">
      <span id="sfx-label" class="label">Sound effects</span>
      <span class="hint">Like the Joker's laugh in Halloween season</span>
    </div>
    <button
      class="switch"
      role="switch"
      aria-checked={settings.soundEffects}
      aria-labelledby="sfx-label"
      onclick={() => updateSettings({ soundEffects: !settings.soundEffects })}
    >
      <span class="state">{settings.soundEffects ? 'On' : 'Off'}</span>
    </button>
  </div>

  <div class="row">
    <div class="text">
      <span id="music-label" class="label">Music</span>
      <span class="hint">Background music in Halloween season</span>
    </div>
    <button
      class="switch"
      role="switch"
      aria-checked={settings.music}
      aria-labelledby="music-label"
      onclick={() => updateSettings({ music: !settings.music })}
    >
      <span class="state">{settings.music ? 'On' : 'Off'}</span>
    </button>
  </div>

  {#if season.halloween}
    <p class="season">🎃 The Halloween theme is on until {HALLOWEEN_SEASON_END_LABEL}.</p>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.45);
  }
  .sheet {
    position: fixed;
    left: 50%;
    bottom: 0;
    z-index: 41;
    width: min(100%, 440px);
    transform: translateX(-50%);
    padding: 12px 16px calc(20px + env(safe-area-inset-bottom, 0px));
    border-radius: 16px 16px 0 0;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.35);
    animation: rise 160ms ease-out;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  .close {
    min-height: 40px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-top: 1px solid var(--line);
  }
  .text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .label {
    font-weight: 600;
  }
  .hint {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .switch {
    position: relative;
    flex: none;
    width: 76px;
    height: 40px;
    border: 0;
    border-radius: 999px;
    background: var(--line);
    color: var(--fg);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 150ms;
  }
  .switch::before {
    content: '';
    position: absolute;
    top: 4px;
    left: 4px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: transform 150ms;
  }
  .switch[aria-checked='true'] {
    background: var(--accent);
    color: #1d1d1f;
  }
  .switch[aria-checked='true']::before {
    transform: translateX(36px);
  }
  .state {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    right: 10px;
  }
  .switch[aria-checked='true'] .state {
    right: auto;
    left: 10px;
  }
  .switch:focus-visible {
    outline: 3px solid var(--fg);
    outline-offset: 2px;
  }
  .season {
    margin: 4px 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    font-size: 0.9rem;
    color: var(--muted);
  }
  @keyframes rise {
    from {
      transform: translate(-50%, 100%);
    }
  }
</style>
