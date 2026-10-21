<script lang="ts">
  import { makeConfig } from '../core';
  import { HeuristicBot, type Bot } from '../ai';
  import { DEFAULT_PACING, LocalSession } from '../session/LocalSession';
  import { dealDurationMs } from './timing';
  import type { GameSession } from '../net/protocol';
  import GameScreen from './GameScreen.svelte';
  import StartScreen, { type GameSetup } from './StartScreen.svelte';

  let session = $state<GameSession | null>(null);
  let names = $state<string[]>([]);

  function start({ playerCount, botCount }: GameSetup) {
    const humans = playerCount - botCount;
    // Humans take the first seats, so a lone human sits at seat 0; bots fill the rest.
    const bots: (Bot | null)[] = Array.from({ length: playerCount }, (_, seat) => (seat < humans ? null : new HeuristicBot()));
    names = bots.map((bot, seat) => (bot ? `Bot ${seat + 1}` : humans === 1 ? 'You' : `Player ${seat + 1}`));
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const config = makeConfig(playerCount);
    // Bots wait for the deal animation to finish (plus a beat) before the first call.
    const afterDeal = dealDurationMs(config.playerCount * config.cardsPerPlayer) + 500;
    session = new LocalSession(config, seed, bots, { ...DEFAULT_PACING, afterDeal });
  }

  function exit() {
    session?.close();
    session = null;
  }
</script>

{#if session}
  {#key session}
    <GameScreen {session} {names} onexit={exit} />
  {/key}
{:else}
  <StartScreen onstart={start} />
{/if}
