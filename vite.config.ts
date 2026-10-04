import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const apiTarget = process.env.VITE_DEV_API_TARGET || 'http://localhost:8787'

/**
 * In dev, serve /data/*.json straight from the repository's data directory so
 * the database view always reflects the latest file (public/data is only a
 * build-time copy and would otherwise go stale).
 */
function serveMusicData(): Plugin {
  return {
    name: 'serve-music-data',
    apply: 'serve',
    configureServer(server) {
      const dataDir = resolve(server.config.root, 'data')
      server.middlewares.use('/data', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]?.replace(/^\/+/, '') ?? ''
        if (!/^[a-z0-9-]+\.json$/i.test(name)) {
          next()
          return
        }
        readFile(resolve(dataDir, name), 'utf8')
          .then((content) => {
            res.statusCode = 200
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.setHeader('cache-control', 'no-store')
            res.end(content)
          })
          .catch(() => next())
      })
    },
  }
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [vue(), serveMusicData()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
})
