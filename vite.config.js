import { defineConfig, loadEnv } from 'vite'
import { openaiProxy } from './server/openai.js'

export default defineConfig(({ mode }) => {
  // SITE_URL: the public address of the app, used for link previews (og:image, og:url). Set it in .env or in the
  // hosting settings to override the default (the .env file is not deployed, so the default makes Vercel builds work).
  const site = (loadEnv(mode, process.cwd(), '').SITE_URL || 'https://cyanotype-tool-creator.vercel.app').replace(/\/+$/, '')
  return {
    plugins: [
      openaiProxy(),
      {
        name: 'site-meta',
        transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', site),
      },
    ],
  }
})
