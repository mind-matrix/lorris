// Browsers only allow sound after the player has interacted with the page, and an effect
// triggered by another player's move doesn't count. So one shared AudioContext is created
// (or resumed) on any tap or key press, and effects use it later. Until then they stay silent.

let ctx: AudioContext | null = null;
let installed = false;

function unlock(): void {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    // iOS can suspend the context again (calls, the app backgrounded): each tap revives it.
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Call once at startup. */
export function installAudioUnlock(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, unlock, { capture: true, passive: true });
}

/** The shared context if sound is allowed right now, otherwise null (play silently). */
export function audioContext(): AudioContext | null {
  return ctx && ctx.state === 'running' ? ctx : null;
}
