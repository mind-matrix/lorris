// Streaming voice chat, built for the lowest data use.
//
// Topology: every player has one voice connection to the host (separate from the game
// connection, set up over the voice channel the first time anyone talks). A talker sends one
// stream to the host; the host forwards it to everyone else. So a talker on mobile data
// uploads one stream however many people listen, and only player-host links ever need a relay.
//
// Each host-player connection is created with all its audio "slots" up front: one for the
// player's microphone, and one per other seat for forwarded voices. Starting and stopping
// talking just attaches or detaches a track (replaceTrack): no renegotiation, and a detached
// slot sends no packets at all. While talking, Opus runs with the low-data settings in
// voiceSdp.ts (60 ms packets, DTX in pauses, mono, 12 kbps).

import type { Seat } from '../core';
import type { VoiceAccess } from '../session/types';
import type { PeerId } from './transport';
import { lowDataOpus, VOICE_MAX_BITRATE } from './voiceSdp';
import {
  MAX_TALK_MS,
  VOICE_VERSION,
  forwardingPlan,
  parseHostMessage,
  parsePlayerMessage,
  type HostToPlayer,
  type IceCandidate,
  type PlayerToHost,
} from './voiceProtocol';

export interface VoiceRtcDeps {
  access: VoiceAccess;
  createPeer(config: RTCConfiguration): RTCPeerConnection;
  iceServers(): Promise<RTCIceServer[]>;
  getMic(): Promise<MediaStream>;
  /** Plays a seat's incoming voice. Returns a function that stops it. */
  play(seat: Seat, track: MediaStreamTrack): () => void;
  /**
   * Host only: keeps an incoming voice flowing so it can be forwarded. Browsers (Chromium at
   * least) only produce audio from an incoming track while something consumes it, so the
   * host forwards nothing if it relies on its own speaker playing it. A muted media element
   * is enough, and muted media may always autoplay. Returns a function that releases it.
   */
  keepFlowing(track: MediaStreamTrack): () => void;
  now?: () => number;
}

export interface VoiceState {
  /** Seats talking right now (including this player). */
  talking: ReadonlySet<Seat>;
  /** This player is talking. */
  selfTalking: boolean;
}

/** Keep the microphone open this long after talking, for a quick reply; then it closes. */
const KEEP_MIC_MS = 8_000;

/** Shared by host and player: the microphone, and state listeners. */
abstract class VoiceBase {
  protected mic: MediaStream | null = null;
  private micRelease: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: VoiceState) => void>();
  protected disposed = false;
  protected offs: (() => void)[] = [];

  constructor(protected deps: VoiceRtcDeps) {}

  abstract state(): VoiceState;

  subscribe(listener: (s: VoiceState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  /** The open microphone (for a level meter), or null. */
  micStream(): MediaStream | null {
    return this.mic;
  }

  protected emit(): void {
    const s = this.state();
    for (const l of this.listeners) l(s);
  }

  protected async openMic(): Promise<MediaStreamTrack> {
    if (this.micRelease) clearTimeout(this.micRelease);
    this.micRelease = null;
    const live = this.mic?.getAudioTracks().find((t) => t.readyState === 'live');
    if (live) return live;
    this.mic = await this.deps.getMic();
    return this.mic.getAudioTracks()[0];
  }

  protected scheduleMicRelease(): void {
    if (this.micRelease) clearTimeout(this.micRelease);
    this.micRelease = setTimeout(() => this.closeMic(), KEEP_MIC_MS);
  }

  protected closeMic(): void {
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic = null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.micRelease) clearTimeout(this.micRelease);
    this.closeMic();
    for (const off of this.offs) off();
    this.offs = [];
    this.listeners.clear();
  }
}

/** Best effort: caps a sender's bitrate (Opus is also capped by the session settings). */
function capBitrate(sender: RTCRtpSender): void {
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = VOICE_MAX_BITRATE;
    void sender.setParameters(params).catch(() => {});
  } catch {
    // Not supported: the session's Opus cap still applies.
  }
}

// ---------------------------------------------------------------- host

interface PlayerLink {
  seat: Seat;
  pc: RTCPeerConnection;
  micTransceiver: RTCRtpTransceiver;
  /** seat -> the sender forwarding that seat's voice to this player */
  slots: Map<Seat, RTCRtpSender>;
  incoming: MediaStreamTrack | null;
  stopPlayback: (() => void) | null;
  releaseFlow: (() => void) | null;
  remoteSet: boolean;
  pendingIce: IceCandidate[];
}

export class VoiceHost extends VoiceBase {
  private links = new Map<PeerId, PlayerLink>();
  private talking = new Set<Seat>();
  private talkTimers = new Map<Seat, ReturnType<typeof setTimeout>>();
  private hostMicTrack: MediaStreamTrack | null = null;

  constructor(deps: VoiceRtcDeps) {
    super(deps);
    this.offs.push(
      deps.access.link.onMessage((from, m) => void this.onMessage(from, m)),
      deps.access.onPeerLeave((peer) => this.dropLink(peer)),
    );
  }

  state(): VoiceState {
    return { talking: new Set(this.talking), selfTalking: this.talking.has(this.mySeat()) };
  }

  private mySeat(): Seat {
    return this.deps.access.mySeat() ?? 0;
  }

  /** The host starts talking. */
  async startTalking(): Promise<boolean> {
    try {
      this.hostMicTrack = await this.openMic();
    } catch {
      return false;
    }
    if (this.disposed) return false;
    await this.sync();
    this.setTalking(this.mySeat(), true);
    return true;
  }

  stopTalking(): void {
    this.setTalking(this.mySeat(), false);
    this.scheduleMicRelease();
  }

  protected closeMic(): void {
    super.closeMic();
    this.hostMicTrack = null;
  }

  private setTalking(seat: Seat, on: boolean): void {
    if (this.talking.has(seat) === on) return;
    clearTimeout(this.talkTimers.get(seat));
    this.talkTimers.delete(seat);
    if (on) {
      this.talking.add(seat);
      // Never forward one person's audio for longer than this in one go.
      this.talkTimers.set(seat, setTimeout(() => this.setTalking(seat, false), MAX_TALK_MS));
    } else this.talking.delete(seat);
    this.broadcast({ v: VOICE_VERSION, t: 'talk', seat, on });
    this.applyPlan();
    this.emit();
  }

  private broadcast(message: HostToPlayer): void {
    const peers = [...this.deps.access.seatedPeers().keys()];
    if (peers.length) this.deps.access.link.send(message, peers);
  }

  /** Sets up a voice connection to every seated player who doesn't have one yet. */
  private async sync(): Promise<void> {
    const seated = this.deps.access.seatedPeers();
    for (const [peer, link] of this.links) if (seated.get(peer) !== link.seat) this.dropLink(peer);
    await Promise.all([...seated].filter(([peer]) => !this.links.has(peer)).map(([peer, seat]) => this.connect(peer, seat)));
  }

  private async connect(peer: PeerId, seat: Seat): Promise<void> {
    const iceServers = await this.deps.iceServers();
    if (this.disposed || this.links.has(peer)) return;
    const pc = this.deps.createPeer({ iceServers });
    const micTransceiver = pc.addTransceiver('audio', { direction: 'recvonly' });
    const slots = new Map<Seat, RTCRtpSender>();
    for (let s = 0; s < this.deps.access.playerCount; s++) {
      if (s === seat) continue;
      slots.set(s as Seat, pc.addTransceiver('audio', { direction: 'sendonly', streams: [new MediaStream()] }).sender);
    }
    const link: PlayerLink = { seat, pc, micTransceiver, slots, incoming: null, stopPlayback: null, releaseFlow: null, remoteSet: false, pendingIce: [] };
    this.links.set(peer, link);
    pc.onicecandidate = (e) => this.deps.access.link.send({ v: VOICE_VERSION, t: 'ice', candidate: e.candidate ? toIce(e.candidate) : null }, peer);
    pc.ontrack = (e) => {
      if (e.transceiver !== micTransceiver) return;
      link.incoming = e.track;
      link.releaseFlow?.();
      link.releaseFlow = this.deps.keepFlowing(e.track); // so it can be forwarded, whatever the host's speaker does
      link.stopPlayback?.();
      link.stopPlayback = this.deps.play(seat, e.track); // the host hears them too
      this.applyPlan();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.dropLink(peer); // set up again next time someone talks
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (this.links.get(peer) !== link) return;
    const slotMids: Record<string, Seat> = {};
    for (const t of pc.getTransceivers()) {
      for (const [s, sender] of slots) if (t.sender === sender && t.mid) slotMids[t.mid] = s;
    }
    this.deps.access.link.send({ v: VOICE_VERSION, t: 'offer', sdp: offer.sdp!, mic: micTransceiver.mid!, slots: slotMids }, peer);
  }

  private dropLink(peer: PeerId): void {
    const link = this.links.get(peer);
    if (!link) return;
    this.links.delete(peer);
    link.stopPlayback?.();
    link.releaseFlow?.();
    link.pc.close();
    if (this.talking.has(link.seat)) this.setTalking(link.seat, false);
    else this.applyPlan();
  }

  private async onMessage(from: PeerId, raw: unknown): Promise<void> {
    const seat = this.deps.access.seatedPeers().get(from);
    const m = parsePlayerMessage(raw);
    if (seat === undefined || !m) return; // only seated players take part
    if (m.t === 'talk') {
      if (m.on) await this.sync();
      this.setTalking(seat, m.on);
      return;
    }
    const link = this.links.get(from);
    if (!link) return;
    if (m.t === 'answer') {
      if (link.remoteSet) return;
      await link.pc.setRemoteDescription({ type: 'answer', sdp: lowDataOpus(m.sdp) }).catch(() => this.dropLink(from));
      link.remoteSet = true;
      for (const c of link.pendingIce.splice(0)) await link.pc.addIceCandidate(c).catch(() => {});
      for (const sender of link.slots.values()) capBitrate(sender);
      this.applyPlan();
    } else if (m.t === 'ice' && m.candidate) {
      if (link.remoteSet) await link.pc.addIceCandidate(m.candidate).catch(() => {});
      else link.pendingIce.push(m.candidate);
    }
  }

  /** Attaches each talker's audio to every other player's slot, and detaches the rest. */
  private applyPlan(): void {
    const sources = new Map<Seat, MediaStreamTrack>();
    if (this.hostMicTrack) sources.set(this.mySeat(), this.hostMicTrack);
    for (const link of this.links.values()) if (link.incoming) sources.set(link.seat, link.incoming);
    const listeners = new Map([...this.links].map(([peer, l]) => [peer, l.seat] as const));
    const plan = forwardingPlan(listeners, this.talking, sources, this.deps.access.playerCount);
    for (const [peer, slots] of plan) {
      const link = this.links.get(peer)!;
      for (const [seat, track] of slots) {
        const sender = link.slots.get(seat);
        if (sender && sender.track !== track) void sender.replaceTrack(track).catch(() => {});
      }
    }
  }

  dispose(): void {
    for (const peer of [...this.links.keys()]) this.dropLink(peer);
    for (const t of this.talkTimers.values()) clearTimeout(t);
    super.dispose();
  }
}

// ---------------------------------------------------------------- player

export class VoiceGuest extends VoiceBase {
  private pc: RTCPeerConnection | null = null;
  private micTransceiver: RTCRtpTransceiver | null = null;
  private slots: Record<string, Seat> = {};
  private playback = new Map<Seat, () => void>();
  private talkers = new Set<Seat>();
  private talkingSelf = false;
  private remoteSet = false;
  private pendingIce: IceCandidate[] = [];
  /** The host stopped forwarding (the length limit): the UI should stop too. */
  onForcedStop: (() => void) | null = null;

  constructor(deps: VoiceRtcDeps) {
    super(deps);
    this.offs.push(
      deps.access.link.onMessage((from, m) => {
        if (from === deps.access.hostPeer()) void this.onMessage(m);
      }),
      deps.access.onPeerLeave((peer) => {
        if (peer === deps.access.hostPeer()) this.closeConnection();
      }),
    );
  }

  state(): VoiceState {
    const talking = new Set(this.talkers);
    const me = this.deps.access.mySeat();
    if (me !== null) {
      if (this.talkingSelf) talking.add(me);
      else talking.delete(me);
    }
    return { talking, selfTalking: this.talkingSelf };
  }

  async startTalking(): Promise<boolean> {
    const host = this.deps.access.hostPeer();
    if (!host || this.deps.access.mySeat() === null) return false;
    let track: MediaStreamTrack;
    try {
      track = await this.openMic();
    } catch {
      return false;
    }
    if (this.disposed) return false;
    this.talkingSelf = true;
    this.attachMic(track);
    this.send({ v: VOICE_VERSION, t: 'talk', on: true });
    this.emit();
    return true;
  }

  stopTalking(): void {
    if (!this.talkingSelf) return;
    this.talkingSelf = false;
    this.attachMic(null);
    this.send({ v: VOICE_VERSION, t: 'talk', on: false });
    this.scheduleMicRelease();
    this.emit();
  }

  private attachMic(track: MediaStreamTrack | null): void {
    const sender = this.micTransceiver?.sender;
    if (!sender || sender.track === track) return;
    void sender.replaceTrack(track).catch(() => {});
    if (track) capBitrate(sender);
  }

  private send(message: PlayerToHost): void {
    const host = this.deps.access.hostPeer();
    if (host) this.deps.access.link.send(message, host);
  }

  private async onMessage(raw: unknown): Promise<void> {
    const m = parseHostMessage(raw);
    if (!m) return;
    if (m.t === 'talk') {
      if (m.seat === this.deps.access.mySeat()) {
        if (!m.on && this.talkingSelf) {
          this.stopTalking();
          this.onForcedStop?.();
        }
        return;
      }
      if (m.on) this.talkers.add(m.seat);
      else this.talkers.delete(m.seat);
      this.emit();
      return;
    }
    if (m.t === 'offer') {
      await this.answer(m);
      return;
    }
    if (m.t === 'ice' && m.candidate) {
      // Candidates can arrive while the connection is still being set up: keep them until then.
      if (this.pc && this.remoteSet) await this.pc.addIceCandidate(m.candidate).catch(() => {});
      else this.pendingIce.push(m.candidate);
    }
  }

  private async answer(offer: Extract<HostToPlayer, { t: 'offer' }>): Promise<void> {
    this.closeConnection();
    const iceServers = await this.deps.iceServers();
    if (this.disposed) return;
    const pc = this.deps.createPeer({ iceServers });
    this.pc = pc;
    this.slots = offer.slots;
    pc.onicecandidate = (e) => this.send({ v: VOICE_VERSION, t: 'ice', candidate: e.candidate ? toIce(e.candidate) : null });
    pc.ontrack = (e) => {
      const seat = e.transceiver.mid !== null ? this.slots[e.transceiver.mid] : undefined;
      if (seat === undefined) return;
      this.playback.get(seat)?.();
      this.playback.set(seat, this.deps.play(seat, e.track));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && this.pc === pc) this.closeConnection();
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: lowDataOpus(offer.sdp) });
      for (const t of pc.getTransceivers()) {
        if (t.mid === offer.mic) {
          t.direction = 'sendonly';
          this.micTransceiver = t;
        } else t.direction = 'recvonly';
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.remoteSet = true;
      for (const c of this.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      this.send({ v: VOICE_VERSION, t: 'answer', sdp: answer.sdp! });
      // Already talking (the first press set this connection up): send audio now.
      const live = this.mic?.getAudioTracks().find((t) => t.readyState === 'live') ?? null;
      this.attachMic(this.talkingSelf ? live : null);
    } catch {
      this.closeConnection();
    }
  }

  private closeConnection(): void {
    for (const stop of this.playback.values()) stop();
    this.playback.clear();
    this.pc?.close();
    this.pc = null;
    this.micTransceiver = null;
    this.remoteSet = false;
    this.pendingIce = [];
    if (this.talkers.size) {
      this.talkers.clear();
      this.emit();
    }
  }

  dispose(): void {
    if (this.talkingSelf) this.stopTalking();
    this.closeConnection();
    super.dispose();
  }
}

function toIce(c: RTCIceCandidate): IceCandidate {
  return { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex };
}
