// Applying an update reloads the page, so first make sure nothing in progress is lost.

export interface UpdateContext {
  /** An offline game: its autosaver must finish writing the latest state. */
  offline?: { flush(): Promise<void> } | null;
  /**
   * The host of an online game: pause, save, and tell everyone it was saved (they see "Game
   * saved. <host> can resume it later."); after the reload the host taps "Resume hosting".
   */
  host?: { pauseGame(): void; saveAndClose(): Promise<void> } | null;
  // A client needs nothing: its seat token is stored, the host keeps the seat for it, and it
  // rejoins after the reload with "Rejoin".
}

export async function saveThenUpdate(ctx: UpdateContext, apply: () => Promise<void>): Promise<void> {
  if (ctx.offline) await ctx.offline.flush();
  if (ctx.host) {
    ctx.host.pauseGame();
    await ctx.host.saveAndClose();
  }
  await apply();
}
