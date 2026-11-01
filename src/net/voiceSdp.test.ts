import { describe, expect, it } from 'vitest';
import { lowDataOpus } from './voiceSdp';

const SDP = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9',
  'c=IN IP4 0.0.0.0',
  'a=mid:0',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
  'a=rtpmap:111 opus/48000/2',
  'a=rtcp-fb:111 transport-cc',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=rtpmap:9 G722/8000',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=mid:1',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  '',
].join('\r\n');

describe('lowDataOpus', () => {
  const out = lowDataOpus(SDP);

  it('turns on DTX, mono and a 12 kbps cap, keeping the browser\'s own Opus parameters', () => {
    const fmtp = out.match(/a=fmtp:111 [^\r\n]*/g)!;
    expect(fmtp).toHaveLength(2);
    for (const line of fmtp) {
      expect(line).toContain('minptime=10');
      expect(line).toContain('useinbandfec=1');
      expect(line).toContain('usedtx=1');
      expect(line).toContain('stereo=0');
      expect(line).toContain('maxaveragebitrate=12000');
    }
  });

  it('asks for 60 ms packets on every audio section and drops header extensions', () => {
    expect(out.match(/a=ptime:60/g)).toHaveLength(2);
    expect(out.match(/a=maxptime:60/g)).toHaveLength(2);
    expect(out).not.toContain('a=extmap');
  });

  it('is idempotent: applying it twice changes nothing more', () => {
    expect(lowDataOpus(out)).toBe(out);
  });

  it('adds Opus parameters when the browser gave none, and leaves non-Opus descriptions alone', () => {
    const noFmtp = SDP.replace(/a=fmtp:111[^\r\n]*\r\n/g, '');
    expect(lowDataOpus(noFmtp)).toMatch(/a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 usedtx=1/);
    const noOpus = 'v=0\r\nm=audio 9 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n';
    expect(lowDataOpus(noOpus)).toBe(noOpus);
  });
});
