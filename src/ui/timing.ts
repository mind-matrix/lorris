// Animation timings shared by the table, the hand, and bot pacing.

/** Gap between consecutive cards leaving the dealer's hand. */
export const DEAL_STEP_MS = 35;
/** How long one card takes to fly from the dealer to a seat. */
export const DEAL_FLIGHT_MS = 320;
/** How long a finished round stays on the table before it clears. */
export const ROUND_LINGER_MS = 1000;

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Total time to deal `totalCards`, or 0 when the user prefers reduced motion. */
export function dealDurationMs(totalCards: number): number {
  return prefersReducedMotion() ? 0 : (totalCards - 1) * DEAL_STEP_MS + DEAL_FLIGHT_MS;
}
