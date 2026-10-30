<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import SettingsSheet from './SettingsSheet.svelte';
  import HalloweenDecor from './seasonal/HalloweenDecor.svelte';
  import { HalloweenMusic } from './seasonal/halloweenMusic';
  import { audioContext, audioState } from './audio.svelte';
  import { settings } from './settings.svelte';
  import { applySeason, season, watchSeason } from './season.svelte';
  import { makeConfig, randomSeed } from '../core';
  import { createInGameBot, type Bot } from '../ai';
  import { roomCodeFromHash } from '../net/roomCode';
  import { DEFAULT_PACING, LocalSession } from '../session/LocalSession';
  import { loadName } from '../session/profile';
  import { clientRefs, forgetClientRef, migrateLegacyHostedGames } from '../session/savedGames';
  import type { ClientGameRef } from '../session/storage';
  import type { GameSession, OnlineSession } from '../session/types';
  import { saveStore } from '../save/appStore';
  import { newSaveId } from '../save/envelope';
  import { autosaveOffline, restoreOffline } from '../save/offline';
  import { SaveLimitError, type SaveIndexEntry } from '../save/SaveStore';
  import { SAVE_FILE_TYPE, parseSaveFile, saveFileContents, saveFileName } from '../save/transfer';
  import GameScreen from './GameScreen.svelte';
  import LobbyScreen from './LobbyScreen.svelte';
  import OnlineSetup from './OnlineSetup.svelte';
  import SavedGamesScreen from './SavedGamesScreen.svelte';
  import SavesFullDialog from './SavesFullDialog.svelte';
  import StartScreen, { type GameSetup } from './StartScreen.svelte';
  import { dealDurationMs } from './timing';
  import UpdateBanner from './UpdateBanner.svelte';
  import { applyUpdate, checkForUpdate } from '../pwa/register';
  import { pwaState } from '../pwa/state.svelte';
  import { saveThenUpdate, type UpdateContext } from '../pwa/updateFlow';
  import type { Autosaver } from '../save/SaveStore';
  import type { HostControls } from '../session/types';

  type Screen =
    | { kind: 'menu' }
    | { kind: 'saves' }
    | { kind: 'setup'; mode: 'host' | 'join'; code: string | null }
    | { kind: 'lobby'; session: OnlineSession }
    | { kind: 'game'; session: GameSession; online: OnlineSession | null; stopSaving?: () => void; autosaver?: Autosaver; saveId?: string };

  let screen = $state<Screen>({ kind: 'menu' });
  let settingsOpen = $state(false);

  // Seasonal theme: follow the date, and put the theme on the page.
  onMount(() => watchSeason());
  $effect(() => applySeason(season.halloween));

  // Halloween-season music: plays once sound is unlocked (the first tap), while the app is on
  // screen and Music is on in Settings. Quieter during a game, so it never covers the table.
  const MUSIC_LEVEL_IN_GAME = 0.45;
  let music: HalloweenMusic | null = null;
  $effect(() => {
    const wanted = season.halloween && settings.music && audioState.unlocked && audioState.visible;
    const level = screen.kind === 'game' ? MUSIC_LEVEL_IN_GAME : 1;
    if (!wanted) {
      music?.stop();
      music = null;
      return;
    }
    if (!music) {
      const ctx = audioContext();
      if (!ctx) return;
      music = new HalloweenMusic(ctx);
      music.setLevel(level);
      music.start();
    } else music.setLevel(level);
  });
  onDestroy(() => music?.stop());
  let busy = $state(false);
  let setupError = $state<string | null>(null);
  let menuMessage = $state<string | null>(null);
  let savesMessage = $state<string | null>(null);

  /** Saved games on this device (offline and hosted), newest first; and joined-game references. */
  let saves = $state<SaveIndexEntry[]>([]);
  let refs = $state<ClientGameRef[]>([]);
  const offlineResume = $derived(saves.find((s) => s.role === 'offline') ?? null);
  const hostedResume = $derived(saves.find((s) => s.role === 'host') ?? null);
  /** Starting a game while the saved games list is full: ask what to do. */
  let fullFor = $state<GameSetup | null>(null);

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
    void migrateLegacyHostedGames().then(refresh);

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

  // If a client loses its seat mid-game (it was given up while they were away), go back to
  // the seat picker so they can take an open seat.
  $effect(() => {
    if (screen.kind !== 'game' || !screen.online || screen.online.isHost) return;
    const online = screen.online;
    return online.subscribeLobby((l) => {
      if (l.started && l.mySeat === null && l.connection.kind === 'connected') screen = { kind: 'lobby', session: online };
    });
  });

  async function refresh() {
    saves = await saveStore.list();
    refs = await clientRefs();
  }

  // ---------- Offline games ----------

  async function startLocal(setup: GameSetup) {
    if (await saveStore.canCreate()) return beginLocal(setup, true);
    saves = await saveStore.list();
    fullFor = setup;
  }

  function beginLocal({ playerCount, botCount }: GameSetup, withSaving: boolean) {
    fullFor = null;
    const humans = playerCount - botCount;
    // Humans take the first seats, so a lone human sits at seat 0; bots fill the rest.
    const bots: (Bot | null)[] = Array.from({ length: playerCount }, (_, seat) => (seat < humans ? null : createInGameBot()));
    const names = bots.map((bot, seat) => (bot ? `Bot ${seat + 1}` : humans === 1 ? 'You' : `Player ${seat + 1}`));
    const seed = randomSeed(); // 128 bits from the platform's cryptographic generator
    const session = new LocalSession({ config: makeConfig(playerCount), seed }, bots, names, pacingFor(playerCount));
    // Autosave after every move, so closing the app (or a crash) loses nothing.
    const saveId = newSaveId();
    const saving = withSaving ? autosaveOffline(saveStore, saveId, session) : null;
    screen = { kind: 'game', session, online: null, stopSaving: saving?.stop, autosaver: saving?.autosaver, saveId: saving ? saveId : undefined };
  }

  /** Returns an error message to show, or null once the game is open. */
  async function resumeOffline(id: string): Promise<string | null> {
    const loaded = await saveStore.load(id);
    if (!loaded.ok) return loaded.error.message;
    const session = restoreOffline(loaded.save, pacingFor(loaded.save.game.state.config.playerCount));
    const { stop, autosaver } = autosaveOffline(saveStore, id, session);
    screen = { kind: 'game', session, online: null, stopSaving: stop, autosaver, saveId: id };
    return null;
  }

  // ---------- Online games ----------

  async function withBusy(fn: () => Promise<void>) {
    busy = true;
    setupError = null;
    try {
      await fn();
    } catch {
      setupError = "Couldn't start online play. Check your connection and try again.";
      menuMessage = setupError;
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

  /** Reopens a saved hosted game: same room, paused until the host continues. */
  async function resumeHosted(id: string): Promise<string | null> {
    const loaded = await saveStore.load(id);
    if (!loaded.ok) return loaded.error.message;
    if (loaded.save.mode !== 'online') return resumeOffline(id);
    await withBusy(async () => {
      const session = await (await online()).resumeHosting(loaded.save, pacingFor(loaded.save.game.state.config.playerCount));
      screen = { kind: 'lobby', session };
    });
    return null;
  }

  /** Rejoins a game we're seated in; if the host hasn't reopened it yet, we wait for them. */
  const rejoin = (ref: ClientGameRef) =>
    withBusy(async () => {
      const name = (await loadName()) || 'Player';
      const session = await (await online()).joinGame({ roomCode: ref.roomCode, name, waitForHost: ref.hostName });
      screen = { kind: 'lobby', session };
    });

  // ---------- Saved games list, export, import ----------

  async function exportSave(entry: SaveIndexEntry) {
    const warning =
      entry.mode === 'online'
        ? "This file contains every player's cards and the room password. Keep it to yourself (it's for moving the game to another device). Export?"
        : 'This file contains every hand in the game. Export it to move the game to another device?';
    if (!confirm(warning)) return;
    const loaded = await saveStore.load(entry.id);
    if (!loaded.ok) return (savesMessage = loaded.error.message);
    const name = saveFileName(loaded.save);
    const file = new File([saveFileContents(loaded.save)], name, { type: SAVE_FILE_TYPE });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Lorris saved game' });
        return;
      }
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    savesMessage = `Saved as ${name}.`;
  }

  async function importSave(file: File) {
    const loaded = parseSaveFile(await file.text());
    if (!loaded.ok) return (savesMessage = loaded.error.message);
    const save = loaded.save;
    if ((await saveStore.has(save.id)) && !confirm('This game is already saved here. Replace it with the imported copy?')) return;
    try {
      await saveStore.save(save, save.mode === 'offline' ? 'offline' : 'host');
      savesMessage = `Imported "${save.label.text}".`;
    } catch (e) {
      savesMessage = e instanceof SaveLimitError ? e.message : "Couldn't import that game.";
    }
    await refresh();
  }

  // ---------- App updates ----------

  /**
   * Switch to the new version. Mid-game, save first: offline games finish their autosave; an
   * online host pauses, saves and tells everyone; a client just rejoins its seat afterwards.
   */
  async function updateNow() {
    const ctx: UpdateContext = {};
    if (screen.kind === 'game') {
      const question = !screen.online
        ? 'Update now? Your game is saved and you can resume it right after.'
        : screen.online.isHost
          ? 'Update now? The game is paused and saved, and everyone is told. Tap "Resume hosting" after the update.'
          : "Update now? You'll leave the table for a moment; tap \"Rejoin\" after the update to get your seat back.";
      if (!confirm(question)) return;
      if (!screen.online) ctx.offline = screen.autosaver ?? null;
      else if (screen.online.isHost) ctx.host = screen.online as OnlineSession & HostControls;
    }
    await saveThenUpdate(ctx, applyUpdate);
  }

  // ---------- Leaving ----------

  function toMenu() {
    if (screen.kind === 'lobby') screen.session.close();
    if (screen.kind === 'game') screen.session.close();
    screen = { kind: 'menu' };
    void refresh();
  }

  /** Leaving an online game tells the others (the host ends it for everyone). */
  function leaveGame() {
    if (screen.kind === 'game' && screen.online) screen.online.leave();
    else if (screen.kind === 'game') {
      // Offline games stay saved; they can be resumed from the start screen.
      screen.stopSaving?.();
      screen.session.close();
    }
    screen = { kind: 'menu' };
    setTimeout(() => void refresh(), 400);
  }

  /** Offline: the game is saved after every move, so keep that save and exit. Host: also tell everyone. */
  async function saveAndExit() {
    if (screen.kind !== 'game') return;
    if (screen.online) {
      if (screen.online.isHost) await (screen.online as OnlineSession & HostControls).saveAndClose();
    } else {
      screen.stopSaving?.();
      await screen.autosaver?.flush();
      screen.session.close();
    }
    screen = { kind: 'menu' };
    void refresh();
  }

  /** Exit and forget the saved game (online, the host ending it does this). */
  async function exitWithoutSaving() {
    if (screen.kind !== 'game') return;
    if (screen.online) return leaveGame();
    const { saveId, autosaver } = screen;
    screen.stopSaving?.();
    screen.session.close();
    screen = { kind: 'menu' };
    await autosaver?.flush();
    if (saveId) await saveStore.delete(saveId);
    void refresh();
  }

  /** Leave offers to save only where this device keeps the game: offline (if saving) or as the host. */
  const leaveChoice = $derived(
    screen.kind !== 'game'
      ? null
      : screen.online
        ? screen.online.isHost
          ? {
              message: 'Save and exit: everyone is told you can resume the game later. Exit without saving: the game ends for everyone.',
              onsave: saveAndExit,
              ondiscard: exitWithoutSaving,
            }
          : null
        : screen.saveId
          ? {
              message: 'Save and exit to resume this game later from the start screen, or exit without saving to discard it.',
              onsave: saveAndExit,
              ondiscard: exitWithoutSaving,
            }
          : null,
  );
</script>

{#if screen.kind === 'game'}
  {#key screen.session}
    <GameScreen
      session={screen.session}
      onexit={leaveGame}
      {leaveChoice}
      leaveQuestion={screen.online ? 'Leave? A bot will take your seat.' : 'Leave this game? It is not saved.'}
      online={screen.online}
      updateAvailable={pwaState.updateAvailable}
      onupdate={updateNow}
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
{:else if screen.kind === 'saves'}
  <SavedGamesScreen
    {saves}
    {refs}
    {busy}
    message={savesMessage}
    onresume={async (e) => (savesMessage = e.role === 'offline' ? await resumeOffline(e.id) : await resumeHosted(e.id))}
    onrejoin={rejoin}
    ondelete={async (id) => {
      await saveStore.delete(id);
      await refresh();
    }}
    ondeleteref={async (code) => {
      await forgetClientRef(code);
      await refresh();
    }}
    onexport={exportSave}
    onimport={importSave}
    onback={() => {
      savesMessage = null;
      screen = { kind: 'menu' };
    }}
  />
{:else}
  <StartScreen
    onstart={startLocal}
    onhost={() => (screen = { kind: 'setup', mode: 'host', code: null })}
    onjoin={(code) => (screen = { kind: 'setup', mode: 'join', code })}
    offlineResume={offlineResume ? { label: offlineResume.label.text, savedAt: offlineResume.savedAt } : null}
    onresumeoffline={async () => (menuMessage = await resumeOffline(offlineResume!.id))}
    hostedResume={hostedResume ? { label: hostedResume.label.text, roomCode: hostedResume.id.replace(/^room-/, '') } : null}
    onresumehosted={async () => (menuMessage = await resumeHosted(hostedResume!.id))}
    clientResume={refs[0] ? { hostName: refs[0].hostName, label: refs[0].label, savedByHost: refs[0].savedByHost } : null}
    onrejoinclient={() => rejoin(refs[0])}
    savedCount={saves.length + refs.length}
    onsavedgames={() => (screen = { kind: 'saves' })}
    message={menuMessage}
    onchecknow={checkForUpdate}
    onsettings={() => (settingsOpen = true)}
  />
  {#if settingsOpen}
    <SettingsSheet onclose={() => (settingsOpen = false)} />
  {/if}
  {#if fullFor}
    <SavesFullDialog
      {saves}
      ondelete={async (id) => {
        await saveStore.delete(id);
        saves = await saveStore.list();
      }}
      onstart={(withSaving) => beginLocal(fullFor!, withSaving)}
      oncancel={() => (fullFor = null)}
    />
  {/if}
{/if}

<!-- Halloween scenery behind the menus (not over the table, where it would distract). -->
{#if season.halloween && screen.kind !== 'game'}
  <HalloweenDecor />
{/if}

<!-- The full banner only where nobody is mid-game: the start screen, saved games, and setup. -->
{#if pwaState.updateAvailable && (screen.kind === 'menu' || screen.kind === 'saves' || screen.kind === 'setup')}
  <UpdateBanner updating={pwaState.updating} onupdate={updateNow} />
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
