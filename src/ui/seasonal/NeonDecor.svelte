<script lang="ts">
  // GTA VI launch week scenery behind the menus: downtown Miami at sunset, under a violet and
  // pink tint so text stays readable, slowly drifting. Purely decorative: behind all content,
  // never catches taps, hidden from screen readers.
  //
  // Photo: "Miami Sunset" by Joe deSousa, CC0 1.0 (public domain dedication), via Wikimedia
  // Commons: https://commons.wikimedia.org/wiki/File:Miami_Sunset_(45863661094).jpg
  // Resized to 1600x900 WebP.
  import photo from '../assets/miami-sunset.webp';
</script>

<div class="decor" aria-hidden="true">
  <div class="photo" style:background-image="url({photo})"></div>
  <div class="tint"></div>
</div>

<style>
  .decor {
    position: fixed;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    pointer-events: none;
    background: #120726;
  }
  /* The skyline sits just below the middle of the photo; keep it in view on tall phones. */
  .photo {
    position: absolute;
    inset: -4%;
    background-size: cover;
    background-position: 56% 62%;
    animation: drift 40s ease-in-out infinite alternate;
  }
  @keyframes drift {
    from {
      transform: scale(1) translateX(0);
    }
    to {
      transform: scale(1.08) translateX(-2%);
    }
  }
  /* Night sky on top for the title, a neon-pink haze on the horizon, dark below for the panels. */
  .tint {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(11, 4, 32, 0.82) 0%, rgba(18, 7, 38, 0.6) 40%, rgba(18, 7, 38, 0.66) 70%, rgba(11, 4, 32, 0.9) 100%),
      radial-gradient(ellipse 120% 40% at 50% 62%, rgba(255, 79, 163, 0.28), transparent 70%);
  }
  @media (prefers-reduced-motion: reduce) {
    .photo {
      animation: none;
    }
  }
</style>
