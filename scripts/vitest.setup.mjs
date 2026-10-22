// Node 18 has no global `crypto` (Node 20+ and every browser do). Tests use the same Web Crypto API.
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
