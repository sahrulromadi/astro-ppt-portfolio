import { defineConfig } from 'astro/config';

import vercel from '@astrojs/vercel';

export default defineConfig({
  // Isi dengan URL production agar og:image (public/og.png) ikut dipasang.
  // site: 'https://nama-anda.vercel.app',
  adapter: vercel(),
});