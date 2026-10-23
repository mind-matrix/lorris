// Runs ISMCTS searches off the main thread, so the UI never freezes while bots think.
/// <reference lib="webworker" />

import { IsmctsBot } from '../ismcts/IsmctsBot';
import type { ThinkRequest, ThinkResponse } from './protocol';

const bots = new Map<number, IsmctsBot>();

self.onmessage = (e: MessageEvent<ThinkRequest>) => {
  const { id, botId, seed, view, legal } = e.data;
  let bot = bots.get(botId);
  if (!bot) bots.set(botId, (bot = new IsmctsBot(seed)));
  const r = bot.decide(view, legal);
  const response: ThinkResponse = { id, action: r.action, iterations: r.iterations, ms: r.ms };
  (self as unknown as Worker).postMessage(response);
};
