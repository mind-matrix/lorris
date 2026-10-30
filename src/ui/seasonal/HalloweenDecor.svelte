<script lang="ts">
  // Halloween-season scenery behind the menus: a moon, drifting bats and a cobweb.
  // Purely decorative: behind all content, never catches taps, hidden from screen readers.
  const bats = [
    { top: 16, delay: 0, size: 34 },
    { top: 26, delay: 7, size: 24 },
    { top: 9, delay: 13, size: 18 },
  ];
</script>

<div class="decor" aria-hidden="true">
  <div class="moon"></div>

  <svg class="web" viewBox="0 0 120 120">
    <g fill="none" stroke="currentColor" stroke-width="0.8">
      <path d="M0 0 L120 30 M0 0 L95 95 M0 0 L30 120 M0 0 L120 70 M0 0 L70 120" />
      <path d="M24 6 Q20 20 6 24" />
      <path d="M48 12 Q38 38 12 48" />
      <path d="M74 19 Q58 58 19 74" />
      <path d="M100 25 Q78 78 25 100" />
    </g>
    <path d="M70 0 V44" stroke="currentColor" stroke-width="0.6" />
    <circle cx="70" cy="47" r="3.5" fill="currentColor" />
  </svg>

  {#each bats as bat}
    <svg
      class="bat"
      viewBox="0 0 64 32"
      style:top="{bat.top}%"
      style:width="{bat.size}px"
      style:animation-delay="-{bat.delay}s"
    >
      <path
        class="wings"
        d="M32 12c-2-4-4-6-6-6 1 3 0 5-2 6-3-5-9-7-16-6 4 2 6 6 6 10 3-2 7-2 9 1 2-3 5-4 7-3 1 2 1 3 2 4 1-1 1-2 2-4 2-1 5 0 7 3 2-3 6-3 9-1 0-4 2-8 6-10-7-1-13 1-16 6-2-1-3-3-2-6-2 0-4 2-6 6z"
        fill="currentColor"
      />
    </svg>
  {/each}
</div>

<style>
  .decor {
    position: fixed;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    pointer-events: none;
    color: #0a060d;
  }
  .moon {
    position: absolute;
    /* Left of the Settings button, peeking out above the title. */
    top: calc(6px + env(safe-area-inset-top, 0px));
    right: 74px;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: radial-gradient(circle at 38% 35%, #fff6d8, #f1d79a 55%, #c9a660);
    box-shadow:
      0 0 30px 8px rgba(255, 214, 140, 0.25),
      0 0 90px 30px rgba(255, 170, 80, 0.08);
    opacity: 0.85;
  }
  .web {
    position: absolute;
    top: 0;
    left: 0;
    width: 120px;
    height: 120px;
    color: rgba(243, 233, 220, 0.18);
  }
  .bat {
    position: absolute;
    left: -60px;
    color: #000;
    filter: drop-shadow(0 0 1px rgba(255, 170, 90, 0.9)) drop-shadow(0 0 6px rgba(255, 122, 26, 0.45));
    animation: fly 22s linear infinite;
  }
  .wings {
    transform-origin: 50% 40%;
    animation: flap 0.35s ease-in-out infinite alternate;
  }
  @keyframes fly {
    0% {
      transform: translate(0, 0);
    }
    25% {
      transform: translate(30vw, 3vh);
    }
    50% {
      transform: translate(60vw, -2vh);
    }
    75% {
      transform: translate(90vw, 4vh);
    }
    100% {
      transform: translate(calc(100vw + 120px), 0);
    }
  }
  @keyframes flap {
    to {
      transform: scaleY(0.55);
    }
  }
  /* With reduced motion the bats stay put, perched where they are. */
  @media (prefers-reduced-motion: reduce) {
    .bat,
    .wings {
      animation: none !important;
    }
    .bat:nth-of-type(2) {
      left: 18%;
    }
    .bat:nth-of-type(3) {
      left: 52%;
    }
    .bat:nth-of-type(4) {
      left: 76%;
    }
  }
</style>
