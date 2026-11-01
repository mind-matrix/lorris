// Messages on the voice channel ('vc'). The audio itself goes over a separate voice connection
// between each player and the host; these small JSON messages set it up and say who's talking.
//
// Host -> player:  offer  { sdp, mic, slots }   set up the voice connection
//                  ice    { candidate }          connection details as they're found
//                  talk   { seat, on }           someone started or stopped talking
// Player -> host:  answer { sdp }
//                  ice    { candidate }
//                  talk   { on }                 I'm starting or stopping talking

import type { Seat } from '../core';

export const VOICE_VERSION = 2;
const MAX_SDP = 32 * 1024;
const MAX_CANDIDATE = 1024;
const MAX_SEAT = 5;

export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export type HostToPlayer =
  | { v: 2; t: 'offer'; sdp: string; /** the media section carrying the player's microphone */ mic: string; /** media section -> whose voice it carries */ slots: Record<string, Seat> }
  | { v: 2; t: 'ice'; candidate: IceCandidate | null }
  | { v: 2; t: 'talk'; seat: Seat; on: boolean };

export type PlayerToHost =
  | { v: 2; t: 'answer'; sdp: string }
  | { v: 2; t: 'ice'; candidate: IceCandidate | null }
  | { v: 2; t: 'talk'; on: boolean };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isSeat = (x: unknown): x is Seat => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= MAX_SEAT;
const isMid = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 16;
const isSdp = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_SDP && x.startsWith('v=0');

function parseCandidate(x: unknown): IceCandidate | null | undefined {
  if (x === null) return null; // end of candidates
  if (!isObj(x) || typeof x.candidate !== 'string' || x.candidate.length > MAX_CANDIDATE) return undefined;
  if (!(x.sdpMid === null || isMid(x.sdpMid))) return undefined;
  if (!(x.sdpMLineIndex === null || (Number.isInteger(x.sdpMLineIndex) && (x.sdpMLineIndex as number) >= 0 && (x.sdpMLineIndex as number) < 16))) return undefined;
  return { candidate: x.candidate, sdpMid: x.sdpMid as string | null, sdpMLineIndex: x.sdpMLineIndex as number | null };
}

export function parseHostMessage(x: unknown): HostToPlayer | null {
  if (!isObj(x) || x.v !== VOICE_VERSION) return null;
  if (x.t === 'offer') {
    if (!isSdp(x.sdp) || !isMid(x.mic) || !isObj(x.slots)) return null;
    const entries = Object.entries(x.slots);
    if (entries.length > MAX_SEAT || !entries.every(([mid, seat]) => isMid(mid) && isSeat(seat))) return null;
    return { v: 2, t: 'offer', sdp: x.sdp, mic: x.mic, slots: Object.fromEntries(entries) as Record<string, Seat> };
  }
  if (x.t === 'ice') {
    const c = parseCandidate(x.candidate);
    return c === undefined ? null : { v: 2, t: 'ice', candidate: c };
  }
  if (x.t === 'talk') return isSeat(x.seat) && typeof x.on === 'boolean' ? { v: 2, t: 'talk', seat: x.seat, on: x.on } : null;
  return null;
}

export function parsePlayerMessage(x: unknown): PlayerToHost | null {
  if (!isObj(x) || x.v !== VOICE_VERSION) return null;
  if (x.t === 'answer') return isSdp(x.sdp) ? { v: 2, t: 'answer', sdp: x.sdp } : null;
  if (x.t === 'ice') {
    const c = parseCandidate(x.candidate);
    return c === undefined ? null : { v: 2, t: 'ice', candidate: c };
  }
  if (x.t === 'talk') return typeof x.on === 'boolean' ? { v: 2, t: 'talk', on: x.on } : null;
  return null;
}

/**
 * The host's forwarding plan: for each listening player, which seat's voice each of their
 * slots should carry right now. A slot carries a voice only while that seat is talking and
 * its audio has arrived; otherwise it's paused, which sends no packets at all.
 *
 * `listeners`: player connection -> their seat. `sources`: seat -> where its audio comes from.
 * Returns: player connection -> (slot seat -> source, or null for paused).
 */
export function forwardingPlan<Source>(
  listeners: ReadonlyMap<string, Seat>,
  talking: ReadonlySet<Seat>,
  sources: ReadonlyMap<Seat, Source>,
  playerCount: number,
): Map<string, Map<Seat, Source | null>> {
  const plan = new Map<string, Map<Seat, Source | null>>();
  for (const [peer, mySeat] of listeners) {
    const slots = new Map<Seat, Source | null>();
    for (let seat = 0; seat < playerCount; seat++) {
      if (seat === mySeat) continue; // nobody hears themselves
      slots.set(seat as Seat, talking.has(seat as Seat) ? (sources.get(seat as Seat) ?? null) : null);
    }
    plan.set(peer, slots);
  }
  return plan;
}

/** Longest a player may talk in one go; the host stops forwarding after this. */
export const MAX_TALK_MS = 120_000;
