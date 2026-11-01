// One background reading of this device's network, for the mic button. Uses only information
// the device already has: nothing is sent.

import type { NetworkSample } from '../net/networkQuality';
import type { LinkStats } from '../net/transport';

interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
}

export async function sampleNetwork(linkStats: () => Promise<LinkStats | null>): Promise<NetworkSample> {
  const info = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return {
    online: navigator.onLine,
    effectiveType: info?.effectiveType,
    downlinkMbps: typeof info?.downlink === 'number' ? info.downlink : undefined,
    link: await linkStats(),
  };
}
