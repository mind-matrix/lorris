// One background reading of this device's network, for the mic button. Uses only information
// the device already has: nothing is sent.

import type { NetworkSample } from '../net/networkQuality';
import type { VoiceMessaging } from '../session/types';

interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
}

export async function sampleNetwork(messaging: VoiceMessaging): Promise<NetworkSample> {
  const info = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return {
    online: navigator.onLine,
    effectiveType: info?.effectiveType,
    downlinkMbps: typeof info?.downlink === 'number' ? info.downlink : undefined,
    link: await messaging.linkStats(),
  };
}
