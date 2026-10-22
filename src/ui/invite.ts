import { formatRoomCode, inviteLink } from '../net/roomCode';

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/** Opens the system share sheet with the invite link, or copies it where sharing isn't available. */
export async function shareInvite(roomCode: string): Promise<ShareResult> {
  const url = inviteLink(roomCode, location.href);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Lorris', text: `Join my Lorris game: ${formatRoomCode(roomCode)}`, url });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // Some browsers expose share() but refuse it; fall back to copying.
    }
  }
  return copyText(url);
}

export async function copyText(text: string): Promise<'copied' | 'failed'> {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export const SHARE_MESSAGES: Record<ShareResult, string | null> = {
  shared: null,
  cancelled: null,
  copied: 'Invite link copied',
  failed: "Couldn't copy here. Share the room code instead.",
};
