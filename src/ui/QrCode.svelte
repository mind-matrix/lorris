<script lang="ts">
  import { renderSVG } from 'uqr';

  let { text, label }: { text: string; label: string } = $props();
  // Dark on white with a quiet border, whatever the theme: that's what scanners read best.
  // The SVG comes from our own library call on our own URL, so injecting it is safe.
  const svg = $derived(renderSVG(text, { border: 2, ecc: 'M' }));
</script>

<div class="qr" role="img" aria-label={label}>{@html svg}</div>

<style>
  .qr {
    width: min(55vw, 200px);
    aspect-ratio: 1;
    padding: 6px;
    border-radius: 12px;
    background: #fff;
  }
  .qr :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
