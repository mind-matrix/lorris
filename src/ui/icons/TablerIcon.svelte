<!--
  Outline icons copied from Tabler Icons (MIT License, Copyright (c) 2020-2026 Paweł Kuna,
  https://github.com/tabler/tabler-icons). See THIRD-PARTY-NOTICES.md. Copied in rather than
  installed as a package, so building needs no extra download.
-->
<script lang="ts">
  const ICONS = {
    microphone: [
      'M9 5a3 3 0 0 1 3 -3a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3a3 3 0 0 1 -3 -3l0 -5',
      'M5 10a7 7 0 0 0 14 0',
      'M8 21l8 0',
      'M12 17l0 4',
    ],
    'microphone-off': [
      'M3 3l18 18',
      'M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1 -.13 .874m-2 2a3 3 0 0 1 -3.87 -2.872v-1',
      'M5 10a7 7 0 0 0 10.846 5.85m2 -2a6.967 6.967 0 0 0 1.152 -3.85',
      'M8 21l8 0',
      'M12 17l0 4',
    ],
  } as const;

  let { name, size = 24, stroke = 2 }: { name: keyof typeof ICONS; size?: number; stroke?: number } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#each ICONS[name] as d}<path {d} />{/each}
</svg>
