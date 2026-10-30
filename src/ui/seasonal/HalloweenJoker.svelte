<script lang="ts">
  import { onMount } from 'svelte';
  import { prefersReducedMotion } from '../timing';
  import { playHauntedPortrait } from './hauntedPortrait';

  let {
    player,
    onclose,
  }: {
    /** Who played the Joker ("You" for this device's player). */
    player: string;
    onclose: () => void;
  } = $props();

  let canvas: HTMLCanvasElement;
  let closeButton: HTMLButtonElement;

  onMount(() => {
    const stop = playHauntedPortrait(canvas, { reducedMotion: prefersReducedMotion(), onDone: onclose });
    closeButton.focus({ preventScroll: true });
    return stop;
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="scare" role="dialog" aria-modal="true" aria-labelledby="joker-caption">
  <button bind:this={closeButton} class="backdrop" aria-label="Skip the animation" onclick={onclose}></button>
  <canvas bind:this={canvas} width="144" height="192" aria-hidden="true"></canvas>
  <p id="joker-caption" class="caption" aria-live="assertive">
    {player === 'You' ? 'You played' : `${player} played`} the Joker!
  </p>
  <p class="hint" aria-hidden="true">Tap to skip</p>
</div>

<style>
  /* Always dark, whatever the app's theme: it's a candlelit room. */
  .scare {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: env(safe-area-inset-top, 0px) 1rem env(safe-area-inset-bottom, 0px);
    background: rgba(8, 4, 6, 0.86);
    color: #efe2c6;
    animation: fade-in 180ms ease-out;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }
  .backdrop:focus-visible {
    outline: 3px solid #efe2c6;
    outline-offset: -6px;
  }
  canvas {
    position: relative;
    pointer-events: none;
    display: block;
    width: min(82vw, 55dvh);
    aspect-ratio: 3 / 4;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    box-shadow:
      0 0 0 2px #2a1a20,
      0 20px 50px rgba(0, 0, 0, 0.7);
  }
  .caption,
  .hint {
    position: relative;
    pointer-events: none;
    margin: 0;
    text-align: center;
  }
  .caption {
    font-size: 1.15rem;
    font-weight: 600;
    color: #d9b260;
  }
  .hint {
    font-size: 0.85rem;
    color: #b9a682;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .scare {
      animation: none;
    }
  }
</style>
