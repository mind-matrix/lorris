<script lang="ts">
  import { untrack } from 'svelte';
  import { SUPPORTED_PLAYER_COUNTS } from '../core';
  import { NET_CONFIG } from '../net/config';
  import { ROOM_CODE_LENGTH, formatRoomCode, normalizeRoomCode } from '../net/roomCode';
  import { loadName, saveName } from '../session/profile';

  let {
    mode,
    initialCode = null,
    busy = false,
    onhost,
    onjoin,
    onback,
  }: {
    mode: 'host' | 'join';
    initialCode?: string | null;
    busy?: boolean;
    onhost: (opts: { name: string; playerCount: number }) => void;
    onjoin: (opts: { name: string; roomCode: string }) => void;
    onback: () => void;
  } = $props();

  let name = $state('');
  // Pre-filled once from an invite link; after that it's the player's to edit.
  let code = $state(untrack(() => (initialCode ? formatRoomCode(initialCode) : '')));
  let playerCount = $state<number>(SUPPORTED_PLAYER_COUNTS[0]);
  let error = $state<string | null>(null);

  loadName().then((n) => (name ||= n));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const clean = await saveName(name);
    if (!clean) return (error = 'Please enter a name.');
    if (mode === 'host') return onhost({ name: clean, playerCount });
    const roomCode = normalizeRoomCode(code);
    if (!roomCode) return (error = `Room codes are ${ROOM_CODE_LENGTH} letters and numbers, like ABC-234.`);
    onjoin({ name: clean, roomCode });
  }
</script>

<main class="setup">
  <h1>{mode === 'host' ? 'Host a game' : 'Join a game'}</h1>
  <form onsubmit={submit}>
    <label>
      Your name
      <input
        bind:value={name}
        maxlength={NET_CONFIG.maxNameLength}
        autocomplete="nickname"
        enterkeyhint={mode === 'host' ? 'go' : 'next'}
        required
      />
    </label>

    {#if mode === 'host'}
      <fieldset>
        <legend>Players</legend>
        <div class="row">
          {#each SUPPORTED_PLAYER_COUNTS as n}
            <button type="button" class="btn toggle" aria-pressed={playerCount === n} onclick={() => (playerCount = n)}>{n}</button>
          {/each}
        </div>
        <p class="hint">Empty seats can be filled with bots before you start.</p>
      </fieldset>
    {:else}
      <label>
        Room code
        <input
          class="code"
          bind:value={code}
          maxlength={ROOM_CODE_LENGTH + 2}
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          placeholder="ABC-234"
          enterkeyhint="go"
          required
        />
      </label>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <button class="btn big" type="submit" disabled={busy}>
      {busy ? 'Please wait…' : mode === 'host' ? 'Create room' : 'Join'}
    </button>
    <button class="btn secondary" type="button" onclick={onback}>Back</button>
  </form>
</main>

<style>
  .setup {
    max-width: 420px;
    margin: 0 auto;
    padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
  }
  h1 {
    text-align: center;
    font-size: 1.8rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-weight: 600;
  }
  input {
    min-height: 48px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    color: var(--fg);
    font: inherit;
    font-weight: 400;
    font-size: 1.05rem;
    user-select: text;
    -webkit-user-select: text;
  }
  input:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 1px;
  }
  .code {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 1.4rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    text-align: center;
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
  .hint {
    margin: 8px 0 0;
    text-align: center;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .error {
    margin: 0;
    color: var(--bad);
  }
  .big {
    min-height: 52px;
    font-size: 1.1rem;
  }
</style>
