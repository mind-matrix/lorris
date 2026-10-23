<script lang="ts">
  import { teamOf, type PlayerView, type Team } from '../core';
  import { formatRoomCode } from '../net/roomCode';
  import { SUIT_NAME, SUIT_SYMBOL, TEAM_NAME, isRed } from './labels';

  let {
    view,
    onleave,
    roomCode = null,
    onshare,
    isHost = false,
    updateAvailable = false,
    onupdate,
  }: {
    view: PlayerView;
    onleave: () => void;
    /** Online games: the room code, shown on a Share button to re-invite a player who dropped out. */
    roomCode?: string | null;
    onshare?: () => void;
    /** The host's button opens the Room sheet (with sharing inside) instead of sharing directly. */
    isHost?: boolean;
    /** A new app version is waiting: a dot on the menu button online, an Update chip offline. */
    updateAvailable?: boolean;
    onupdate?: () => void;
  } = $props();
  const myTeam = $derived(teamOf(view.seat));

  // Once a call is made, each team's card shows its progress toward its own goal:
  // the calling team needs `call` rounds; the other team needs enough to make that impossible.
  function goal(team: Team): { won: number; target: number; label: string } | null {
    if (!view.contract || (view.phase !== 'playing' && view.phase !== 'setOver')) return null;
    const calling = teamOf(view.contract.seat) === team;
    const target = calling ? view.contract.value : view.config.tricksPerSet - view.contract.value + 1;
    return { won: view.tricksWon[team], target, label: calling ? 'calling' : 'blocking' };
  }
</script>

<header class="bar">
  <div class="top">
    <span class="set">Set {view.setNumber}</span>
    {#if view.trump}
      <span class="trump" class:red={isRed(view.trump)} aria-label="Trump: {SUIT_NAME[view.trump]}">
        Trump <b>{SUIT_SYMBOL[view.trump]}</b>
      </span>
    {/if}
    {#if roomCode}
      <button
        class="btn secondary share"
        onclick={onshare}
        aria-label={isHost ? `Room ${formatRoomCode(roomCode)}: invite and settings` : `Share invite to room ${formatRoomCode(roomCode)}`}
      >
        {#if isHost}
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        {/if}
        <span class="code">{formatRoomCode(roomCode)}</span>
        {#if updateAvailable}<span class="dot" title="Update available"></span>{/if}
      </button>
    {:else if updateAvailable}
      <button class="btn secondary update" onclick={onupdate}>Update</button>
    {/if}
    <button class="btn secondary leave" class:alone={!roomCode} onclick={onleave}>Leave</button>
  </div>
  <div class="scores">
    {#each [0, 1] as const as team}
      {@const g = goal(team)}
      <div class="score team-{team}" class:mine={team === myTeam}>
        <div class="line">
          <span class="label">{TEAM_NAME[team]}</span>
          {#if team === myTeam}<span class="you">you</span>{/if}
          <span class="points" aria-label="{view.scores[team]} points">{view.scores[team]}</span>
        </div>
        <!-- Always takes up its line (empty during bidding) so the layout doesn't jump when play starts. -->
        <div class="goal" class:met={g !== null && g.won >= g.target}>
          {#if g}Rounds {g.won}/{g.target} <span class="why">· {g.label}</span>{:else}&nbsp;{/if}
        </div>
      </div>
    {/each}
  </div>
</header>

<style>
  .bar {
    padding: 6px 10px 8px;
    background: var(--panel);
    font-size: 0.85rem;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 6px;
  }
  .set {
    color: var(--muted);
  }
  .trump {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--bg);
    font-weight: 600;
  }
  .trump b {
    font-size: 1.15rem;
    line-height: 1;
  }
  .trump.red b {
    color: var(--red-suit);
  }
  .share {
    position: relative;
  }
  /* A quiet "new version" marker on the menu button; the menu itself has the Update button. */
  .dot {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--panel);
  }
  .update {
    margin-left: auto;
    min-height: 36px;
    padding: 0 12px;
    font-size: 0.85rem;
  }
  .leave,
  .share {
    min-height: 36px;
    padding: 0 12px;
    font-size: 0.85rem;
  }
  /* Share and Leave sit together on the right. */
  .share,
  .leave.alone {
    margin-left: auto;
  }
  .update + .leave.alone {
    margin-left: 0;
  }
  .share {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .share .code {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 0.04em;
  }
  .scores {
    display: flex;
    gap: 8px;
  }
  .score {
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
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
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mine .label {
    font-weight: 700;
  }
  .you {
    padding: 0 5px;
    border-radius: 6px;
    background: var(--team-color);
    color: #111;
    font-size: 0.7rem;
    font-weight: 700;
  }
  .points {
    margin-left: auto;
    font-size: 1.2rem;
    font-weight: 700;
  }
  .goal {
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .goal.met {
    color: var(--good);
  }
  .why {
    font-weight: 400;
    color: var(--muted);
  }
</style>
