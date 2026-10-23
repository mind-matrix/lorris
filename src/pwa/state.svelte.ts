// Reactive update status for the UI.
export const pwaState = $state({
  /** A new version is installed and waiting. */
  updateAvailable: false,
  /** Set while we're saving and switching to the new version. */
  updating: false,
});
