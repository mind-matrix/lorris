<script lang="ts" module>
  export interface GameSetup {
    playerCount: number;
    botCount: number;
  }
</script>

<script lang="ts">
  import { SUPPORTED_PLAYER_COUNTS } from '../core';
  import HowToPlay from './HowToPlay.svelte';
  import { formatRoomCode } from '../net/roomCode';

  let {
    onstart,
    onhost,
    onjoin,
    offlineResume = null,
    onresumeoffline,
    hostedResume = null,
    onresumehosted,
    clientResume = null,
    onrejoinclient,
    savedCount = 0,
    onsavedgames,
    message = null,
  }: {
    onstart: (setup: GameSetup) => void;
    onhost: () => void;
    onjoin: (code: string | null) => void;
    /** The newest offline game saved on this device. */
    offlineResume?: { label: string; savedAt: number } | null;
    onresumeoffline: () => void;
    /** The newest online game this device hosts (saved, or autosaved before the app closed). */
    hostedResume?: { label: string; roomCode: string } | null;
    onresumehosted: () => void;
    /** The newest online game this device joined and still holds a seat in. */
    clientResume?: { hostName: string; label: string; savedByHost: boolean } | null;
    onrejoinclient: () => void;
    /** How many games are in the saved games list (offline, hosted, and joined). */
    savedCount?: number;
    onsavedgames: () => void;
    /** A problem to show (e.g. a damaged save). */
    message?: string | null;
  } = $props();

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

  {#if message}<p class="message" role="alert">{message}</p>{/if}

  {#if offlineResume}
    <section class="resume" aria-label="Saved game">
      <p><b>{offlineResume.label}</b></p>
      <p class="small">Saved {new Date(offlineResume.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
      <button class="btn" onclick={onresumeoffline}>Resume game</button>
    </section>
  {/if}

  {#if hostedResume}
    <section class="resume" aria-label="Online game you host">
      <p>You're hosting game <b>{formatRoomCode(hostedResume.roomCode)}</b></p>
      <p class="small">{hostedResume.label}</p>
      <button class="btn" onclick={onresumehosted}>Resume hosting</button>
    </section>
  {/if}

  {#if clientResume}
    <section class="resume" aria-label="Online game you joined">
      <p><b>Saved game with {clientResume.hostName}</b></p>
      <p class="small">
        {clientResume.label}{clientResume.savedByHost ? ` · waiting for ${clientResume.hostName} to resume` : ''}
      </p>
      <button class="btn" onclick={onrejoinclient}>Rejoin</button>
    </section>
  {/if}

  {#if savedCount > 0}
    <button class="btn secondary" onclick={onsavedgames}>Saved games ({savedCount})</button>
  {/if}

  <h2>Play online</h2>
  <div class="row online">
    <button class="btn big secondary" onclick={onhost}>Host a game</button>
    <button class="btn big secondary" onclick={() => onjoin(null)}>Join a game</button>
  </div>

  <h2>Play on this device</h2>
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
  h2 {
    margin: 8px 0 -6px;
    font-size: 1rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .online .btn {
    flex: 1;
  }
  .resume {
    padding: 12px;
    border-radius: 12px;
    background: var(--panel);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .resume p {
    margin: 0 0 8px;
  }
  .resume .small {
    margin-top: -6px;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .message {
    margin: 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--panel);
    color: var(--bad);
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
