<script lang="ts">
  import { teamOf } from '../core';
  import type { HostControls, TableInfo } from '../session/types';
  import { SHARE_MESSAGES, shareInvite } from './invite';
  import { TEAM_NAME } from './labels';

  // Covers the table while an online game is paused, or while the host reopens a saved game.
  let {
    table,
    names,
    roomCode,
    host = null,
    onmessage,
  }: {
    table: TableInfo;
    names: string[];
    roomCode: string;
    /** Set for the host: they control pausing and continuing. */
    host?: HostControls | null;
    onmessage: (text: string) => void;
  } = $props();

  const pause = $derived(table.pause!);
  const hostName = $derived(names[0] ?? 'the host');
  const missing = $derived(table.seats.filter((s, i) => i !== 0 && s.kind === 'reserved').length);
  let busy = $state(false);

  async function share() {
    const m = SHARE_MESSAGES[await shareInvite(roomCode)];
    if (m) onmessage(m);
  }

  async function saveAndClose() {
    if (!confirm('Save the game and close the room? Everyone will be told you can resume it later.')) return;
    busy = true;
    await host!.saveAndClose();
  }
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title">
  <div class="card">
    {#if pause.resuming}
      <h2 id="pause-title">{host ? 'Resuming your saved game' : `Waiting for ${hostName} to continue`}</h2>
      {#if host}
        <p class="small">Players rejoin with their own seats and cards. Continue when you're ready.</p>
        <ul class="seats">
          {#each table.seats as seat, i (i)}
            <li class="team-{teamOf(i)}">
              <span><b>{seat.name}</b> <small>{TEAM_NAME[teamOf(i)]}</small></span>
              <span class="state" class:missing={seat.kind === 'reserved'}>
                {i === 0 ? 'You' : seat.kind === 'bot' ? 'Bot' : seat.kind === 'reserved' ? 'Not back yet' : 'Back'}
              </span>
            </li>
          {/each}
        </ul>
        <button class="btn secondary" onclick={share}>Share invite link</button>
        <button class="btn big" onclick={() => host!.continueResumed()}>
          {missing > 0 ? `Continue with bots for ${missing} missing player${missing > 1 ? 's' : ''}` : 'Continue'}
        </button>
        {#if missing > 0}<p class="small">Missing players can still take their seats back from the bots later.</p>{/if}
      {:else}
        <p class="small">The game picks up right where it was saved.</p>
      {/if}
    {:else}
      <h2 id="pause-title">Game paused</h2>
      <p class="small">
        {pause.by !== null && pause.by !== 0 ? `Paused at ${names[pause.by]}'s request.` : `Paused by ${hostName}.`}
        {host ? '' : ' Waiting for the host to resume play.'}
      </p>
      {#if host}
        <button class="btn big" disabled={busy} onclick={() => host!.unpauseGame()}>Resume play</button>
        <button class="btn secondary" disabled={busy} onclick={saveAndClose}>{busy ? 'Saving…' : 'Save and close room'}</button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 6;
    display: grid;
    place-items: center;
    padding: 12px;
    background: rgb(0 0 0 / 0.45);
    border-radius: inherit;
  }
  .card {
    width: min(100%, 360px);
    max-height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    border-radius: 14px;
    background: var(--panel);
    text-align: center;
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  .small,
  small {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .big {
    min-height: 50px;
  }
  .seats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-align: left;
  }
  .seats li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    border-radius: 8px;
    border-left: 5px solid var(--team-color);
    background: var(--bg);
  }
  .team-0 {
    --team-color: var(--team-a);
  }
  .team-1 {
    --team-color: var(--team-b);
  }
  .state {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--good);
  }
  .state.missing {
    color: var(--accent);
  }
</style>
