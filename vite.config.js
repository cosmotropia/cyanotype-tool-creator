import { defineConfig } from 'vite'
import { openaiProxy } from './server/openai.js'

export default defineConfig({
  plugins: [openaiProxy()],
})
