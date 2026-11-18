<script lang="ts">
  // GTA VI launch week: when the Joker is played, a short neon "Joker heist" moment for everyone
  // at the table. Sirens sweep, the Joker spins in, five stars light up and cash rains down.
  // Original artwork and sound (see neonHeist.ts). Tap anywhere (or Escape) to skip.
  import { onMount } from 'svelte';
  import CardView from '../CardView.svelte';
  import { sfxContext } from '../audio.svelte';
  import { prefersReducedMotion } from '../timing';
  import { HEIST_MS, HEIST_REDUCED_MS, playHeistSting } from './neonHeist';

  let {
    player,
    onclose,
  }: {
    /** Who played the Joker ("You" for this device's player). */
    player: string;
    onclose: () => void;
  } = $props();

  let closeButton: HTMLButtonElement;
  const reduced = prefersReducedMotion();
  const sign = 'JOKER HEIST'.split('');
  // Fixed positions and timings, so it looks the same on every device at the table.
  const cash = Array.from({ length: 16 }, (_, i) => ({ x: (i * 37 + 11) % 100, delay: ((i * 0.29) % 1.6) + 0.6, spin: i % 2 ? 1 : -1 }));

  onMount(() => {
    closeButton.focus({ preventScroll: true });
    const ctx = sfxContext();
    const stopSound = ctx && !reduced ? playHeistSting(ctx) : null;
    const timer = setTimeout(onclose, reduced ? HEIST_REDUCED_MS : HEIST_MS);
    return () => {
      clearTimeout(timer);
      stopSound?.();
    };
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="heist" class:reduced role="dialog" aria-modal="true" aria-labelledby="heist-caption">
  <button bind:this={closeButton} class="backdrop" aria-label="Skip the animation" onclick={onclose}></button>
  <div class="siren red" aria-hidden="true"></div>
  <div class="siren blue" aria-hidden="true"></div>

  {#each cash as c}
    <span class="cash" aria-hidden="true" style:left="{c.x}%" style:animation-delay="{c.delay}s" style:--spin={c.spin}>$</span>
  {/each}

  <p class="sign" aria-hidden="true">
    {#each sign as ch, i}<span style:animation-delay="{0.15 + i * 0.07}s">{ch === ' ' ? ' ' : ch}</span>{/each}
  </p>

  <div class="card" aria-hidden="true"><CardView card="JK" label="" /></div>

  <p class="stars" aria-hidden="true">
    {#each { length: 5 } as _, i}<span style:animation-delay="{1.2 + i * 0.22}s">★</span>{/each}
  </p>

  <p id="heist-caption" class="caption" aria-live="assertive">
    {player === 'You' ? 'You pulled' : `${player} pulled`} off the Joker heist!
  </p>
  <p class="hint" aria-hidden="true">Tap to skip</p>
</div>

<style>
  /* Always a neon night, whatever the app's theme. */
  .heist {
    position: fixed;
    inset: 0;
    z-index: 50;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: env(safe-area-inset-top, 0px) 1rem env(safe-area-inset-bottom, 0px);
    background: radial-gradient(ellipse at 50% 60%, rgba(40, 8, 70, 0.92), rgba(6, 2, 16, 0.95));
    color: #fbeffd;
    animation: fade-in 160ms ease-out;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 3;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }
  .backdrop:focus-visible {
    outline: 3px solid #35e0ff;
    outline-offset: -6px;
  }
  .sign,
  .card,
  .stars,
  .caption,
  .hint,
  .cash {
    position: relative;
    z-index: 2;
    pointer-events: none;
    margin: 0;
    text-align: center;
  }
  /* Police-light sweeps from the top corners, alternating red and blue. */
  .siren {
    position: absolute;
    top: -40vmax;
    width: 80vmax;
    height: 80vmax;
    border-radius: 50%;
    opacity: 0;
    mix-blend-mode: screen;
    animation: siren 0.7s ease-in-out 6;
  }
  .siren.red {
    left: -40vmax;
    background: conic-gradient(from 90deg, transparent 0 70%, rgba(255, 40, 80, 0.75) 80%, transparent 90%);
  }
  .siren.blue {
    right: -40vmax;
    background: conic-gradient(from 180deg, transparent 0 10%, rgba(40, 120, 255, 0.75) 20%, transparent 30%);
    animation-delay: 0.35s;
  }
  @keyframes siren {
    0%,
    100% {
      opacity: 0;
      transform: rotate(-20deg);
    }
    50% {
      opacity: 1;
      transform: rotate(20deg);
    }
  }
  /* A neon sign, buzzing on letter by letter. */
  .sign {
    font-size: clamp(1.8rem, 10vw, 3rem);
    font-weight: 900;
    font-style: italic;
    letter-spacing: 0.06em;
  }
  .sign span {
    display: inline-block;
    color: #fff;
    opacity: 0.12;
    text-shadow: none;
    animation: neon-on 0.5s steps(1) forwards;
  }
  @keyframes neon-on {
    0% {
      opacity: 0.12;
    }
    30% {
      opacity: 1;
      text-shadow: 0 0 6px #ff4fa3, 0 0 18px #ff4fa3, 0 0 36px #ff4fa3;
    }
    45% {
      opacity: 0.3;
      text-shadow: none;
    }
    100% {
      opacity: 1;
      text-shadow:
        0 0 4px #fff,
        0 0 10px #ff4fa3,
        0 0 24px #ff4fa3,
        0 0 48px #b3156a;
    }
  }
  .card {
    --card-w: min(34vw, 150px);
    filter: drop-shadow(0 0 16px rgba(53, 224, 255, 0.8));
    animation: card-in 900ms cubic-bezier(0.2, 1.4, 0.4, 1) 0.25s backwards;
  }
  @keyframes card-in {
    from {
      transform: scale(0.2) rotateY(720deg) rotate(-30deg);
      opacity: 0;
    }
  }
  .stars {
    font-size: clamp(1.6rem, 8vw, 2.4rem);
    letter-spacing: 0.2em;
  }
  .stars span {
    display: inline-block;
    color: #3a2a55;
    animation: star-on 300ms ease-out forwards;
  }
  @keyframes star-on {
    0% {
      transform: scale(0.4);
    }
    60% {
      transform: scale(1.5);
      color: #fff6b0;
    }
    100% {
      transform: scale(1);
      color: #ffd23f;
      text-shadow: 0 0 10px rgba(255, 210, 63, 0.9);
    }
  }
  .caption {
    font-size: 1.15rem;
    font-weight: 700;
    color: #35e0ff;
    text-shadow: 0 0 10px rgba(53, 224, 255, 0.6);
  }
  .hint {
    font-size: 0.85rem;
    color: #c3a9d9;
  }
  /* Cash raining down through the scene. */
  .cash {
    position: absolute;
    top: -10%;
    z-index: 1;
    font-size: 1.6rem;
    font-weight: 900;
    color: #5cf2a9;
    text-shadow: 0 0 8px rgba(92, 242, 169, 0.8);
    animation: fall 2.4s linear forwards;
    opacity: 0;
  }
  @keyframes fall {
    0% {
      opacity: 1;
      transform: translateY(0) rotate(0);
    }
    100% {
      opacity: 0.7;
      transform: translateY(115vh) rotate(calc(var(--spin) * 540deg));
    }
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  /* Reduced motion: no sirens, rain or spinning; the sign and stars are simply lit. */
  .reduced .siren,
  .reduced .cash {
    display: none;
  }
  .reduced .sign span,
  .reduced .stars span,
  .reduced .card,
  .reduced {
    animation: none;
  }
  .reduced .sign span {
    opacity: 1;
    text-shadow: 0 0 10px #ff4fa3;
  }
  .reduced .stars span {
    color: #ffd23f;
  }
</style>
