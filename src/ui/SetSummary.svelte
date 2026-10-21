<script lang="ts">
  import type { PlayerView } from '../core';
  import { TEAM_NAME, SUIT_SYMBOL } from './labels';

  let {
    view,
    names,
    canDeal,
    ondeal,
    onnewgame,
  }: { view: PlayerView; names: string[]; canDeal: boolean; ondeal: () => void; onnewgame: () => void } = $props();

  const result = $derived(view.setHistory.at(-1)!);
  const endedEarly = $derived(result.roundsPlayed < view.config.tricksPerSet);
  const doubled = $derived(!result.made && result.delta === -2 * result.contract.value);
</script>

<div class="backdrop">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="set-title">
    {#if view.phase === 'gameOver'}
      <h2 id="set-title">{TEAM_NAME[view.winner!]} wins!</h2>
    {:else}
      <h2 id="set-title">Set {result.setNumber} over</h2>
    {/if}

    <p>
      {names[result.contract.seat]} ({TEAM_NAME[result.bidTeam]}) called {result.contract.value}
      {result.contract.forced ? '(forced)' : ''} with {SUIT_SYMBOL[result.trump]} trump and won
      {result.tricksWon[result.bidTeam]}.
    </p>
    <p class="delta" class:good={result.made}>
      {TEAM_NAME[result.bidTeam]} {result.delta > 0 ? '+' : ''}{result.delta}
      {doubled ? '(first miss counts double)' : ''}
    </p>

    {#if endedEarly}
      <p class="small">Result decided after {result.roundsPlayed} of {view.config.tricksPerSet} rounds.</p>
    {/if}

    <div class="totals">
      <span>{TEAM_NAME[0]}: <b>{view.scores[0]}</b></span>
      <span>{TEAM_NAME[1]}: <b>{view.scores[1]}</b></span>
    </div>
    {#if view.phase !== 'gameOver'}
      <p class="small">First team to {view.config.targetScore} wins</p>
    {/if}

    {#if view.phase === 'gameOver'}
      <button class="btn" onclick={onnewgame}>New game</button>
    {:else if canDeal}
      <button class="btn" onclick={ondeal}>Deal next set</button>
    {:else}
      <p class="small">{names[view.turn!]} will deal the next set…</p>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.5);
    padding: 16px;
    z-index: 10;
    animation: fade 200ms ease;
  }
  .modal {
    width: min(100%, 380px);
    padding: 18px;
    border-radius: 14px;
    background: var(--panel);
    text-align: center;
  }
  h2 {
    margin: 0 0 8px;
  }
  .delta {
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--bad);
  }
  .delta.good {
    color: var(--good);
  }
  .small {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .totals {
    display: flex;
    justify-content: center;
    gap: 18px;
    margin: 10px 0 14px;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
