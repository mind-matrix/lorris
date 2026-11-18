import { cloneState } from './state';
import type { GameState, PlayerView, Seat } from './types';

/**
 * The redacted view for one player: their own hand, card counts for everyone,
 * and the public table state. The RNG state and other hands are never included.
 * Returns fresh arrays so the caller can't affect the authoritative state.
 */
export function getPlayerView(state: GameState, seat: Seat): PlayerView {
  const { rng: _rng, hands, ...pub } = cloneState(state);
  return {
    ...pub,
    config: { ...pub.config },
    contract: pub.contract && { ...pub.contract },
    seat,
    myHand: hands[seat] ?? [],
    handCounts: hands.map((h) => h.length),
  };
}

/**
 * What a spectator may see: exactly a player's view with no hand at all. The cards on the table
 * (the trick in play, finished rounds) and card counts are public; nobody's hand is. `viewpoint`
 * only decides which seat is drawn at the bottom of the table.
 */
export function getSpectatorView(state: GameState, viewpoint: Seat = 0): PlayerView {
  return { ...getPlayerView(state, viewpoint), myHand: [] };
}
