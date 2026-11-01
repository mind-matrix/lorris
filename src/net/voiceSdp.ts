// Low-data settings for the voice connection's Opus audio, applied to the session description
// received from the other side (which is what tells each browser how to send).
//
// Measured in Chromium with speech-like audio (talking with pauses), on the wire including
// packet headers: about 9.7 kbps instead of the browser default 33.5 kbps, or roughly 71 KB
// instead of 245 KB per minute of talking, per stream. The savings come from:
// - 60 ms packets instead of 20 ms: a third as many packets, so a third of the header overhead,
//   which costs more than the voice itself at these bitrates;
// - DTX (discontinuous transmission): almost nothing is sent in the pauses between words;
// - mono, capped at 12 kbps, which is plenty for speech;
// - no optional RTP header extensions (a few dozen bytes on every packet).

export const VOICE_MAX_BITRATE = 12_000;
const PTIME_MS = 60;

export function lowDataOpus(sdp: string): string {
  // Every Opus payload type, in every audio section.
  const types = new Set([...sdp.matchAll(/a=rtpmap:(\d+) opus\/48000/gi)].map((m) => m[1]));
  if (types.size === 0) return sdp;
  const extra = `usedtx=1;stereo=0;sprop-stereo=0;maxaveragebitrate=${VOICE_MAX_BITRATE};cbr=0`;
  let out = sdp;
  for (const pt of types) {
    out = out.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`, 'g'), (_, params: string) => {
      // Keep the browser's own parameters, minus any we set (so they're never duplicated).
      const kept = params
        .split(';')
        .map((p) => p.trim())
        .filter((p) => p && !/^(usedtx|stereo|sprop-stereo|maxaveragebitrate|cbr)=/i.test(p));
      return `a=fmtp:${pt} ${[...kept, extra].join(';')}`;
    });
    // Sections where the browser gave no parameters at all: add ours after the codec line.
    out = out.replace(new RegExp(`(a=rtpmap:${pt} opus/48000[^\\r\\n]*\\r?\\n)(?!a=fmtp:${pt} )`, 'gi'), (line: string, rtpmap: string, offset: number, all: string) => {
      const section = all.slice(offset).split(/\r?\nm=/)[0];
      return new RegExp(`a=fmtp:${pt} `).test(section) ? line : `${rtpmap}a=fmtp:${pt} ${extra}\r\n`;
    });
  }
  out = out.replace(/a=extmap:[^\r\n]*\r?\n/g, '');
  out = out.replace(/a=(max)?ptime:\d+\r?\n/g, '');
  out = out.replace(/(m=audio[^\r\n]*\r?\n)/g, `$1a=ptime:${PTIME_MS}\r\na=maxptime:${PTIME_MS}\r\n`);
  return out;
}
