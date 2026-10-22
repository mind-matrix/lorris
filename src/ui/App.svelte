<script lang="ts">
  import { onMount } from 'svelte';
  import { makeConfig } from '../core';
  import { HeuristicBot, type Bot } from '../ai';
  import { roomCodeFromHash } from '../net/roomCode';
  import type { SavedHostGame } from '../net/HostSession';
  import { DEFAULT_PACING, LocalSession } from '../session/LocalSession';
  import { forgetHostedGame, lastJoinedRoom, savedHostedGame } from '../session/savedGames';
  import type { GameSession, OnlineSession } from '../session/types';
  import GameScreen from './GameScreen.svelte';
  import LobbyScreen from './LobbyScreen.svelte';
  import OnlineSetup from './OnlineSetup.svelte';
  import StartScreen, { type GameSetup } from './StartScreen.svelte';
  import { dealDurationMs } from './timing';

  type Screen =
    | { kind: 'menu' }
    | { kind: 'setup'; mode: 'host' | 'join'; code: string | null }
    | { kind: 'lobby'; session: OnlineSession }
    | { kind: 'game'; session: GameSession; online: OnlineSession | null };

  let screen = $state<Screen>({ kind: 'menu' });
  let busy = $state(false);
  let setupError = $state<string | null>(null);
  let resumable = $state<SavedHostGame | null>(null);
  let rejoinCode = $state<string | null>(null);

  // Online code (and Trystero) loads only when someone actually goes online.
  const online = () => import('../net/online');

  /** Bots wait for the deal animation to finish (plus a beat) before the first call. */
  const pacingFor = (playerCount: number) => ({
    ...DEFAULT_PACING,
    afterDeal: dealDurationMs(playerCount * makeConfig(playerCount).cardsPerPlayer) + 500,
  });

  onMount(() => {
    // An invite link (#join=CODE) opens straight into the join screen.
    const code = roomCodeFromHash(location.hash);
    if (code) {
      history.replaceState(null, '', location.pathname + location.search);
      screen = { kind: 'setup', mode: 'join', code };
    }
    void refreshResumable();

    // Phones pause background tabs. When we're visible (or online) again, check the connection.
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      if (screen.kind === 'lobby') screen.session.resume();
      if (screen.kind === 'game') screen.online?.resume();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  });

  async function refreshResumable() {
    resumable = await savedHostedGame();
    rejoinCode = resumable ? null : await lastJoinedRoom();
  }

  function startLocal({ playerCount, botCount }: GameSetup) {
    const humans = playerCount - botCount;
    // Humans take the first seats, so a lone human sits at seat 0; bots fill the rest.
    const bots: (Bot | null)[] = Array.from({ length: playerCount }, (_, seat) => (seat < humans ? null : new HeuristicBot()));
    const names = bots.map((bot, seat) => (bot ? `Bot ${seat + 1}` : humans === 1 ? 'You' : `Player ${seat + 1}`));
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const session = new LocalSession(makeConfig(playerCount), seed, bots, names, pacingFor(playerCount));
    screen = { kind: 'game', session, online: null };
  }

  async function withBusy(fn: () => Promise<void>) {
    busy = true;
    setupError = null;
    try {
      await fn();
    } catch {
      setupError = "Couldn't start online play. Check your connection and try again.";
    } finally {
      busy = false;
    }
  }

  const host = (opts: { name: string; playerCount: number }) =>
    withBusy(async () => {
      const session = await (await online()).hostGame({ ...opts, pacing: pacingFor(opts.playerCount) });
      screen = { kind: 'lobby', session };
    });

  const join = (opts: { name: string; roomCode: string }) =>
    withBusy(async () => {
      const session = await (await online()).joinGame(opts);
      screen = { kind: 'lobby', session };
    });

  const resume = () =>
    withBusy(async () => {
      // A plain copy: the session must not hold on to reactive UI state.
      const saved = $state.snapshot(resumable!) as SavedHostGame;
      const session = await (await online()).resumeHosting(saved, pacingFor(saved.lobby.config.playerCount));
      screen = { kind: 'lobby', session };
    });

  function toMenu() {
    if (screen.kind === 'lobby') screen.session.close();
    if (screen.kind === 'game') screen.session.close();
    screen = { kind: 'menu' };
    void refreshResumable();
  }

  /** Leaving an online game tells the others (the host ends it for everyone). */
  function leaveGame() {
    if (screen.kind === 'game' && screen.online) screen.online.leave();
    else if (screen.kind === 'game') screen.session.close();
    screen = { kind: 'menu' };
    void refreshResumable();
  }
</script>

{#if screen.kind === 'game'}
  {#key screen.session}
    <GameScreen
      session={screen.session}
      onexit={leaveGame}
      leaveQuestion={screen.online ? (screen.online.isHost ? 'End the game for everyone?' : 'Leave? A bot will take your seat.') : 'Leave this game?'}
      online={screen.online}
    />
  {/key}
{:else if screen.kind === 'lobby'}
  {@const session = screen.session}
  {#key session}
    <LobbyScreen {session} onstarted={() => (screen = { kind: 'game', session, online: session })} onexit={toMenu} />
  {/key}
{:else if screen.kind === 'setup'}
  <OnlineSetup
    mode={screen.mode}
    initialCode={screen.code}
    {busy}
    onhost={host}
    onjoin={join}
    onback={() => (screen = { kind: 'menu' })}
  />
  {#if setupError}<p class="setup-error" role="alert">{setupError}</p>{/if}
{:else}
  <StartScreen
    onstart={startLocal}
    onhost={() => (screen = { kind: 'setup', mode: 'host', code: null })}
    onjoin={(code) => (screen = { kind: 'setup', mode: 'join', code })}
    resumeCode={resumable?.roomCode ?? null}
    onresume={resume}
    ondiscard={async () => {
      await forgetHostedGame(resumable!.roomCode);
      void refreshResumable();
    }}
    {rejoinCode}
  />
{/if}

<style>
  .setup-error {
    max-width: 420px;
    margin: 0 auto;
    padding: 0 16px;
    color: var(--bad);
    text-align: center;
  }
</style>
