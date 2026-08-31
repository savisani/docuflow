import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default {
  plugins: [
    tailwindcss({ config: resolve(__dirname, 'tailwind.config.js') }),
    autoprefixer(),
  ],
}
