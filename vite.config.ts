import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Extra hostnames the dev server answers to, e.g. an https tunnel for testing Instagram/Facebook login locally.
  const env = loadEnv(mode, process.cwd(), '')
  const allowedHosts = (env.DEV_ALLOWED_HOSTS || '.trycloudflare.com').split(',').map((h) => h.trim()).filter(Boolean)

  return {
  plugins: [
    react(),
    // Dev only: serve the landing page at / and the manual at /manual/, as Express does in production.
    {
      name: 'static-page-folders',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const old = req.url?.match(/^\/welcome(?:\/|\/index\.html)?(\?.*)?$/)
          if (old) {
            res.statusCode = 301
            res.setHeader('Location', `/${old[1] ?? ''}`)
            return res.end()
          }
          const root = req.url?.match(/^\/(\?.*)?$/)
          if (root) req.url = `/welcome/index.html${root[1] ?? ''}`
          const m = req.url?.match(/^\/manual\/?(\?.*)?$/)
          if (m) req.url = `/manual/index.html${m[1] ?? ''}`
          next()
        })
      },
    },
  ],
  // Two pages: the React app, and the landing page (built to dist/welcome/, served at /).
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        welcome: fileURLToPath(new URL('./welcome/index.html', import.meta.url)),
      },
    },
  },
  // Agent worktrees under .claude/ hold copies of the repo; their tests are not this checkout's.
  test: { exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'] },
  server: {
    port: 5173,
    allowedHosts,
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.warn('⚠️ [Vite Proxy] Backend connection failed:', err.message);
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: 'Backend API server at port 5001 is offline or restarting.',
                  detail: err.message,
                })
              );
            }
          });
        },
      },
      '/api-docs': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  }
})
