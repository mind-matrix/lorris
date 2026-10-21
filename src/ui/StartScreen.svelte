<script lang="ts" module>
  export interface GameSetup {
    playerCount: number;
    botCount: number;
  }
</script>

<script lang="ts">
  import { SUPPORTED_PLAYER_COUNTS } from '../core';
  import HowToPlay from './HowToPlay.svelte';

  let { onstart }: { onstart: (setup: GameSetup) => void } = $props();

  let playerCount = $state<number>(SUPPORTED_PLAYER_COUNTS[0]);
  let botCount = $state(3);
  // At least one human must be at the table.
  $effect(() => {
    if (botCount > playerCount - 1) botCount = playerCount - 1;
  });
  const humans = $derived(playerCount - botCount);
</script>

<main class="start">
  <h1>Lorris</h1>
  <p class="tag">The game of big promises and bigger comebacks</p>

  <fieldset>
    <legend>Players</legend>
    <div class="row">
      {#each SUPPORTED_PLAYER_COUNTS as n}
        <button class="btn toggle" aria-pressed={playerCount === n} onclick={() => (playerCount = n)}>{n}</button>
      {/each}
    </div>
  </fieldset>

  <fieldset>
    <legend>Bots</legend>
    <div class="row stepper">
      <button class="btn secondary" aria-label="Fewer bots" disabled={botCount <= 0} onclick={() => botCount--}>−</button>
      <output aria-live="polite">{botCount}</output>
      <button class="btn secondary" aria-label="More bots" disabled={botCount >= playerCount - 1} onclick={() => botCount++}>+</button>
    </div>
    <p class="hint">
      {humans} human{humans > 1 ? 's' : ''} on this device{humans > 1 ? ' (pass and play)' : ''}
    </p>
  </fieldset>

  <button class="btn big" onclick={() => onstart({ playerCount, botCount })}>Start game</button>

  <details>
    <summary>How to Play</summary>
    <HowToPlay />
  </details>
</main>

<style>
  .start {
    max-width: 420px;
    margin: 0 auto;
    padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 16px;
    text-align: center;
  }
  h1 {
    margin: 8px 0 0;
    font-size: 2.6rem;
    letter-spacing: 0.05em;
  }
  .tag {
    margin: 0;
    color: var(--muted);
  }
  fieldset {
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 10px 12px 12px;
  }
  legend {
    padding: 0 6px;
    font-weight: 600;
  }
  .row {
    display: flex;
    justify-content: center;
    gap: 12px;
  }
  .toggle {
    min-width: 72px;
  }
  .toggle[aria-pressed='false'] {
    background: var(--panel);
    color: var(--fg);
  }
  .stepper output {
    min-width: 40px;
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 44px;
  }
  .hint {
    margin: 8px 0 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .big {
    font-size: 1.15rem;
    min-height: 52px;
  }
  details {
    text-align: left;
    font-size: 0.9rem;
  }
  summary {
    cursor: pointer;
    min-height: 44px;
    line-height: 44px;
    font-weight: 600;
    font-size: 1.05rem;
  }
</style>
