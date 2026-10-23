// Service worker registration and the update flow, on top of vite-plugin-pwa's virtual module.

import { registerSW } from 'virtual:pwa-register';
import { pwaState } from './state.svelte';
import { UpdateChecker } from './UpdateChecker';

let applyUpdateFn: ((reload?: boolean) => Promise<void>) | null = null;
let checker: UpdateChecker | null = null;

export function setupServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  applyUpdateFn = registerSW({
    immediate: true,
    // registerType 'prompt': a new version waits; we show "Update available" and let the player choose.
    onNeedRefresh: () => (pwaState.updateAvailable = true),
    onRegisteredSW: (swUrl, registration) => {
      if (!registration) return;
      // Fetch sw.js (and anything it imports) from the network on every check, never the HTTP
      // cache. Re-registering with a different updateViaCache just updates the registration.
      if (registration.updateViaCache !== 'none') {
        void navigator.serviceWorker.register(swUrl, { scope: registration.scope, updateViaCache: 'none' }).catch(() => {});
      }
      checker = new UpdateChecker(() => registration.update(), document);
      checker.start();
    },
  });
}

/** Look for a new version now (the About screen's button). */
export async function checkForUpdate(): Promise<boolean> {
  return (await checker?.check(true)) ?? false;
}

/**
 * Switch to the waiting version: tells it to skip waiting; the page reloads itself once the new
 * service worker takes control. Call only after saving whatever is in progress.
 */
export async function applyUpdate(): Promise<void> {
  if (!applyUpdateFn) return;
  pwaState.updating = true;
  await applyUpdateFn(true);
}
