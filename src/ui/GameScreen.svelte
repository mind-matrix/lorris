<script lang="ts">
  import { untrack } from 'svelte';
  import { getLegalActionsFromView, teamOf, type Action, type GameEvent, type PlayerView, type Seat } from '../core';
  import type { GameSession } from '../net/protocol';
  import BidPanel from './BidPanel.svelte';
  import CardView from './CardView.svelte';
  import Hand from './Hand.svelte';
  import ScoreBar from './ScoreBar.svelte';
  import SeatBadge from './SeatBadge.svelte';
  import SetSummary from './SetSummary.svelte';
  import TrumpPicker from './TrumpPicker.svelte';
  import { TEAM_NAME } from './labels';
  import { DEAL_FLIGHT_MS, DEAL_STEP_MS, ROUND_LINGER_MS, dealDurationMs } from './timing';

  let { session, names, onexit }: { session: GameSession; names: string[]; onexit: () => void } = $props();

  // The UI only ever holds player views, one per human seat on this device.
  let views = $state<Record<Seat, PlayerView>>({});
  // Whose view is on screen. With several humans (pass-and-play) it follows the turn.
  let activeSeat = $state<Seat>(-1);
  let coverFor = $state<Seat | null>(null);
  let toast = $state<string | null>(null);
  let lastSeq = -1;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // Subscribe once per session. The listeners read and write component state, so run them
  // untracked; otherwise this effect would depend on that state and resubscribe in a loop.
  $effect(() => {
    const current = session;
    return untrack(() => {
      const seats = current.seats;
      activeSeat = seats[0];
      const unsubscribers = seats.map((seat) =>
        current.subscribe(seat, (v) => {
          views[seat] = v;
          if (seat === seats[0]) onEvents(v);
          followTurn(v);
        }),
      );
      return () => {
        unsubscribers.forEach((u) => u());
        clearTimeout(toastTimer);
      };
    });
  });

  function followTurn(v: PlayerView) {
    if (v.turn === null || !session.seats.includes(v.turn) || v.turn === activeSeat) return;
    activeSeat = v.turn;
    // Hide the hand until the next human takes the device.
    if (session.seats.length > 1) coverFor = v.turn;
  }

  /** Shows public events that nothing else on screen explains (misdeals, forced calls) as a short toast. */
  function onEvents(v: PlayerView) {
    const fresh = v.log.filter((e) => e.seq > lastSeq);
    if (v.log.length) lastSeq = v.log[v.log.length - 1].seq;
    for (const e of fresh) {
      const text = describe(e);
      if (text) showToast(text);
    }
  }

  function describe(e: GameEvent): string | null {
    switch (e.type) {
      case 'MISDEAL':
        return `${TEAM_NAME[e.team]} held every trump and the Joker. Re-dealing!`;
      case 'FORCED_BID':
        return `Everyone passed: ${names[e.seat]} must call ${e.value}`;
      default:
        return null;
    }
  }

  function showToast(text: string) {
    toast = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 2600);
  }

  function leave() {
    if (view?.phase === 'gameOver' || confirm('Leave this game?')) onexit();
  }

  async function act(action: Action) {
    const err = await session.submit(activeSeat, action);
    if (err) showToast(err.message);
  }

  const view = $derived(views[activeSeat]);
  const legal = $derived(view ? getLegalActionsFromView(view) : []);
  const playable = $derived(
    view?.phase === 'playing' && view.turn === activeSeat
      ? legal.flatMap((a) => (a.type === 'PLAY_CARD' ? [a.card] : []))
      : null,
  );

  // Seat layout: me at the bottom, others anti-clockwise around an ellipse (right, top, left).
  // Radii are percentages of the table; seats use a narrower x radius so side badges stay on the table.
  function seatPosition(seat: Seat, rx: number, ry = rx): { x: number; y: number } {
    const n = view!.config.playerCount;
    const angle = (((seat - activeSeat + n) % n) * 2 * Math.PI) / n;
    return { x: 50 + rx * Math.sin(angle), y: 50 + ry * Math.cos(angle) };
  }

  // Six seats need wider seat spacing and a tighter, smaller cluster of played cards.
  const layout = $derived(
    view && view.config.playerCount > 4
      ? { seatX: 38, seatY: 38, trickX: 13, trickY: 19 }
      : { seatX: 35, seatY: 38, trickX: 13, trickY: 15 },
  );

  // A finished round stays on the table briefly (winner highlighted), then the table clears
  // by itself so nobody has to play a card just to tidy up.
  let clearedRound = $state('');
  const lastRoundKey = $derived(view ? `${view.setNumber}:${view.completedTricks.length}` : '');
  $effect(() => {
    if (!view || view.completedTricks.length === 0 || view.trick.plays.length > 0) return;
    const key = lastRoundKey;
    const timer = setTimeout(() => (clearedRound = key), ROUND_LINGER_MS);
    return () => clearTimeout(timer);
  });

  const shownTrick = $derived.by(() => {
    if (!view) return null;
    if (view.trick.plays.length > 0) return { plays: view.trick.plays, winner: null as Seat | null };
    const last = view.completedTricks.at(-1);
    return last && clearedRound !== lastRoundKey ? { plays: last.plays, winner: last.winner } : null;
  });

  // A set over screen waits until the last round has been seen and cleared.
  const showSummary = $derived(view !== undefined && (view.phase === 'setOver' || view.phase === 'gameOver') && shownTrick === null);

  // Dealing: each new deal (SET_STARTED event) plays an animation of cards flying from the
  // dealer to every seat, in real dealing order (one at a time, starting with the cutter).
  const dealSeq = $derived.by(() => {
    if (!view) return -1;
    for (let i = view.log.length - 1; i >= 0; i--) if (view.log[i].type === 'SET_STARTED') return view.log[i].seq;
    return -1;
  });
  const totalCards = $derived(view ? view.config.playerCount * view.config.cardsPerPlayer : 0);
  let dealing = $state(false);
  $effect(() => {
    if (dealSeq < 0) return;
    const ms = untrack(() => dealDurationMs(totalCards));
    if (ms === 0) return;
    dealing = true;
    const timer = setTimeout(() => (dealing = false), ms);
    return () => clearTimeout(timer);
  });
  /** Seat receiving the k-th dealt card. */
  const dealtTo = (k: number) => (view!.cutter + k) % view!.config.playerCount;
  /** When each of my cards lands, so the hand can reveal it at the right moment. */
  const myDealDelays = $derived.by(() => {
    if (!view) return null;
    const n = view.config.playerCount;
    const offset = (activeSeat - view.cutter + n) % n;
    return new Map(view.myHand.map((card, i) => [card, (i * n + offset) * DEAL_STEP_MS + DEAL_FLIGHT_MS]));
  });

  // Prompt under the hand when it's my lead, since an empty table doesn't say "your move".
  const leadHint = $derived.by(() => {
    if (!view || view.phase !== 'playing' || view.turn !== activeSeat || view.trick.plays.length > 0) return null;
    return view.completedTricks.at(-1)?.winner === activeSeat ? 'You won that round: lead the next card' : 'Your lead: play any card';
  });

  const bidOf = (seat: Seat) => (view?.phase === 'bidding' ? (view.bids.find((b) => b.seat === seat)?.bid ?? null) : null);

  const status = $derived.by(() => {
    if (!view || view.turn === null) return '';
    if (dealing) return view.dealer === activeSeat ? 'You are dealing…' : `${names[view.dealer]} is dealing…`;
    const who = view.turn === activeSeat ? 'You' : names[view.turn];
    switch (view.phase) {
      case 'bidding':
        return view.turn === activeSeat ? '' : `${who} is calling…`;
      case 'choosingTrump':
        return view.turn === activeSeat ? '' : `${who} is choosing trump…`;
      case 'playing':
        return view.turn === activeSeat ? 'Your turn' : `${names[view.turn]}'s turn`;
      default:
        return '';
    }
  });
</script>

{#if view}
  <div class="screen">
    <ScoreBar {view} onleave={leave} />

    <main class="table" aria-label="Table">
      {#each view.handCounts as count, seat}
        {@const pos = seatPosition(seat, layout.seatX, layout.seatY)}
        <div class="seat-pos" style:left="{pos.x}%" style:top="{pos.y}%">
          <SeatBadge
            name={names[seat]}
            {seat}
            cardCount={count}
            isTurn={view.turn === seat}
            isDealer={view.dealer === seat}
            bid={bidOf(seat)}
            called={view.phase !== 'bidding' && view.contract?.seat === seat ? view.contract.value : null}
            isMe={seat === activeSeat}
          />
        </div>
      {/each}

      {#if shownTrick}
        <div class="trick" class:done={shownTrick.winner !== null} class:six={view.config.playerCount > 4}>
          {#each shownTrick.plays as play (play.card)}
            {@const to = seatPosition(play.seat, layout.trickX, layout.trickY)}
            {@const from = seatPosition(play.seat, layout.seatX, layout.seatY)}
            <div
              class="played"
              class:winner={shownTrick.winner === play.seat}
              style:left="{to.x}%"
              style:top="{to.y}%"
              style:--from-left="{from.x}%"
              style:--from-top="{from.y}%"
            >
              <CardView card={play.card} />
            </div>
          {/each}
        </div>
      {/if}

      {#if dealing}
        {#key dealSeq}
          {@const from = seatPosition(view.dealer, layout.seatX, layout.seatY)}
          <div class="deal" aria-hidden="true">
            {#each { length: totalCards } as _, k}
              {@const to = seatPosition(dealtTo(k), layout.seatX, layout.seatY)}
              <div
                class="flying"
                style:--from-left="{from.x}%"
                style:--from-top="{from.y}%"
                style:--to-left="{to.x}%"
                style:--to-top="{to.y}%"
                style:animation-delay="{k * DEAL_STEP_MS}ms"
                style:animation-duration="{DEAL_FLIGHT_MS}ms"
              >
                <CardView card="back" label="" />
              </div>
            {/each}
          </div>
        {/key}
      {/if}

      {#if toast}
        <div class="toast" role="status">{toast}</div>
      {/if}
    </main>

    <section class="controls" aria-live="polite">
      {#if dealing}
        <p class="status">{status}</p>
      {:else if view.phase === 'bidding' && view.turn === activeSeat}
        <BidPanel {legal} onact={act} />
      {:else if view.phase === 'choosingTrump' && view.turn === activeSeat}
        <TrumpPicker onpick={(suit) => act({ type: 'CHOOSE_TRUMP', suit })} />
      {:else}
        <p class="status">{status}</p>
      {/if}
    </section>

    {#key dealSeq}
      <Hand
        cards={view.myHand}
        maxCards={view.config.cardsPerPlayer}
        dealDelays={dealing ? myDealDelays : null}
        hint={leadHint}
        trump={view.trump}
        {playable}
        onplay={(card) => act({ type: 'PLAY_CARD', card })}
      />
    {/key}
  </div>

  {#if showSummary}
    <SetSummary
      {view}
      {names}
      canDeal={legal.some((a) => a.type === 'NEXT_SET')}
      ondeal={() => act({ type: 'NEXT_SET' })}
      onnewgame={onexit}
    />
  {/if}

  {#if coverFor !== null}
    <button class="cover" onclick={() => (coverFor = null)}>
      <span>Pass the device to <b>{names[coverFor]}</b> ({TEAM_NAME[teamOf(coverFor)]})</span>
      <span class="small">Tap when ready</span>
    </button>
  {/if}
{/if}

<style>
  .screen {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    padding-bottom: env(safe-area-inset-bottom);
    position: relative;
  }
  .table {
    position: relative;
    flex: 1;
    min-height: 260px;
    margin: 8px;
    border-radius: 24px;
    background: radial-gradient(ellipse at center, var(--felt-light), var(--felt));
    box-shadow: inset 0 0 0 6px var(--felt-edge);
    overflow: hidden;
  }
  .seat-pos {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 2;
  }
  .trick {
    position: absolute;
    inset: 0;
    --card-w: clamp(48px, 15vw, 72px);
  }
  .trick.six {
    --card-w: clamp(42px, 12.5vw, 62px);
  }
  .played {
    position: absolute;
    transform: translate(-50%, -50%);
    animation: fly-in 280ms ease-out;
  }
  .trick.done .played {
    opacity: 0.75;
  }
  .trick.done .played.winner {
    opacity: 1;
    z-index: 1;
    filter: drop-shadow(0 0 8px var(--accent));
  }
  /* Cards slide in from the seat that played them. */
  @keyframes fly-in {
    from {
      left: var(--from-left);
      top: var(--from-top);
      transform: translate(-50%, -50%) scale(0.6);
      opacity: 0.4;
    }
  }
  .toast {
    position: absolute;
    left: 50%;
    top: 22%;
    transform: translateX(-50%);
    max-width: 80%;
    padding: 6px 12px;
    border-radius: 10px;
    background: var(--panel);
    font-size: 0.85rem;
    text-align: center;
    z-index: 3;
    animation: fade 200ms ease;
  }
  /* Fixed height (fits the call panel) so switching between panels and status never shifts the layout. */
  .controls {
    height: 84px;
    padding: 0 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .status {
    margin: 0;
    line-height: 44px;
    font-weight: 600;
  }
  .deal {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    --card-w: 30px;
  }
  /* Every card starts stacked at the dealer and flies to its seat, then vanishes into the hand. */
  .flying {
    position: absolute;
    left: var(--to-left);
    top: var(--to-top);
    opacity: 0;
    transform: translate(-50%, -50%);
    animation-name: deal;
    animation-timing-function: ease-out;
    animation-fill-mode: backwards;
  }
  @keyframes deal {
    from {
      left: var(--from-left);
      top: var(--from-top);
      opacity: 1;
    }
    85% {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  .cover {
    position: fixed;
    inset: 0;
    z-index: 20;
    border: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    justify-content: center;
    background: var(--felt);
    color: #fff;
    font: inherit;
    font-size: 1.1rem;
  }
  .small {
    font-size: 0.85rem;
    opacity: 0.8;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
