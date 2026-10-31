<script lang="ts">
  import TablerIcon from './icons/TablerIcon.svelte';
  import { PushToTalk } from './pushToTalk';

  let {
    recording,
    latched,
    elapsedMs,
    slow,
    blocked,
    resetToken = 0,
    onstart,
    onstop,
    onabort,
    onunavailable,
  }: {
    /** Recording right now. */
    recording: boolean;
    /** Tapped on: keeps recording until tapped again. */
    latched: boolean;
    elapsedMs: number;
    /** The network is too slow for voice messages: greyed out. */
    slow: boolean;
    /** No microphone access. */
    blocked: boolean;
    /** Changing it makes the button forget a press in progress (e.g. recording couldn't start). */
    resetToken?: number;
    onstart: (latched: boolean) => void;
    onstop: () => void;
    onabort: () => void;
    /** Pressed while greyed out: explain why. */
    onunavailable: () => void;
  } = $props();

  const unavailable = $derived((slow || blocked) && !recording);
  const seconds = $derived(Math.floor(elapsedMs / 1000));

  const ptt = new PushToTalk({ start: (l) => onstart(l), stop: () => onstop(), abort: () => onabort() });

  // Recording ended elsewhere (length limit, couldn't start): the next press starts fresh.
  $effect(() => {
    void resetToken;
    if (!recording) ptt.reset();
  });

  // Never keep recording in the background.
  $effect(() => {
    const onHide = () => document.visibilityState === 'hidden' && ptt.cancel();
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  });

  function pointerdown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection or long-press menu while holding
    if (unavailable) {
      onunavailable();
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ptt.down();
  }

  function keydown(e: KeyboardEvent) {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      if (unavailable) onunavailable();
      else ptt.down();
    }
  }

  function keyup(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      ptt.up();
    }
  }

  const label = $derived(
    recording
      ? latched
        ? `Recording, ${seconds} seconds. Tap to send.`
        : `Recording, ${seconds} seconds. Release to send.`
      : blocked
        ? 'Voice message: no microphone access'
        : slow
          ? 'Voice message: network too slow right now'
          : 'Voice message: hold to record, or tap to start',
  );
</script>

<button
  class="mic"
  class:recording
  class:unavailable
  aria-label={label}
  aria-pressed={recording}
  aria-disabled={unavailable}
  title={label}
  onpointerdown={pointerdown}
  onpointerup={() => ptt.up()}
  onpointercancel={() => ptt.cancel()}
  onkeydown={keydown}
  onkeyup={keyup}
  onblur={() => ptt.cancel()}
  oncontextmenu={(e) => e.preventDefault()}
>
  <TablerIcon name={blocked && !recording ? 'microphone-off' : 'microphone'} />
  {#if recording}
    <span class="time" aria-hidden="true">{seconds}s</span>
  {/if}
</button>

<style>
  .mic {
    position: relative;
    width: 48px;
    height: 48px;
    flex: none;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 50%;
    border: 2px solid var(--line);
    background: var(--panel);
    color: var(--fg);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    /* Holding must not select text, open a menu, or scroll the page. */
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: none;
    transition:
      background 120ms,
      border-color 120ms,
      opacity 120ms;
  }
  .mic:focus-visible {
    outline: 3px solid var(--fg);
    outline-offset: 2px;
  }
  .mic.recording {
    background: #d92d2d;
    border-color: #d92d2d;
    color: #fff;
  }
  /* A pulsing ring while recording. */
  .mic.recording::after {
    content: '';
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    border: 3px solid #d92d2d;
    animation: pulse 1.2s ease-out infinite;
  }
  .mic.unavailable {
    opacity: 0.4;
    filter: grayscale(1);
    cursor: not-allowed;
  }
  .time {
    position: absolute;
    top: -10px;
    right: -6px;
    min-width: 22px;
    padding: 1px 5px;
    border-radius: 999px;
    background: #fff;
    color: #d92d2d;
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1.4;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  @keyframes pulse {
    from {
      opacity: 0.8;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(1.35);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mic.recording::after {
      animation: none;
      opacity: 0.6;
    }
  }
</style>
