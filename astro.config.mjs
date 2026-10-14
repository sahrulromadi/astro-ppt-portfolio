import { defineConfig } from 'astro/config';

import vercel from '@astrojs/vercel';

export default defineConfig({
  // Production URL: used for the absolute og:image / og:url link previews need.
  site: 'https://sahrulromadi.vercel.app',
  adapter: vercel(),
});