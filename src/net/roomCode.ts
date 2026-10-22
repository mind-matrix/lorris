// Short, human-friendly room codes and invite links.

/** No 0/O, 1/I/L: nothing that's easy to misread or mistype. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function generateRoomCode(randomValues: (array: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a)): string {
  const n = ROOM_CODE_ALPHABET.length;
  const out: string[] = [];
  // Rejection sampling avoids bias toward the first characters of the alphabet.
  while (out.length < ROOM_CODE_LENGTH) {
    for (const byte of randomValues(new Uint8Array(ROOM_CODE_LENGTH))) {
      if (byte < 256 - (256 % n) && out.length < ROOM_CODE_LENGTH) out.push(ROOM_CODE_ALPHABET[byte % n]);
    }
  }
  return out.join('');
}

/** Turns user input like " abc-def " into "ABCDEF", or null if it isn't a valid code. */
export function normalizeRoomCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** "ABCDEF" -> "ABC-DEF" for display. */
export function formatRoomCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/**
 * Invite links put the code in the URL fragment: it works on static hosting (GitHub Pages),
 * works offline through the service worker, and never reaches any server's logs.
 */
export function inviteLink(code: string, appUrl: string): string {
  return `${appUrl.split('#')[0]}#join=${code}`;
}

export function roomCodeFromHash(hash: string): string | null {
  const match = /(?:^#|&)join=([^&]+)/.exec(hash);
  return match ? normalizeRoomCode(decodeURIComponent(match[1])) : null;
}

/**
 * Password for the signaling layer, so offers/answers on public relays are encrypted.
 * Anyone with the room code can join (the code is the invite); this keeps relay operators
 * and passers-by from reading connection details.
 */
export function roomPassword(code: string): string {
  return `lorris-room:${code}`;
}
