// Browsers only allow sound after the player has interacted with the page, and an effect
// triggered by another player's move doesn't count. So one shared AudioContext is created
// (or resumed) on any tap or key press, and effects use it later. Until then they stay silent.

import { settings } from './settings.svelte';

let ctx: AudioContext | null = null;
let installed = false;

/** Reactive: whether sound can play now (unlocked by a tap) and whether the app is on screen. */
export const audioState = $state({ unlocked: false, visible: true });

function unlock(): void {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    // iOS can suspend the context again (calls, the app backgrounded): each tap revives it.
    if (ctx.state === 'suspended') void ctx.resume().then(() => (audioState.unlocked = true));
    else audioState.unlocked = ctx.state === 'running';
  } catch {
    ctx = null;
  }
}

/** Call once at startup. */
export function installAudioUnlock(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, unlock, { capture: true, passive: true });
  // Music stops while the app is in the background (and saves battery).
  const onVisibility = () => (audioState.visible = document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', onVisibility);
  onVisibility();
}

/** The shared context if the browser allows sound right now, otherwise null. */
export function audioContext(): AudioContext | null {
  return ctx && ctx.state === 'running' ? ctx : null;
}

/** For sound effects: the shared context, or null when sound effects are off in Settings. */
export function sfxContext(): AudioContext | null {
  return settings.soundEffects ? audioContext() : null;
}
