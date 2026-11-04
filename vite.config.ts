import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Extra hostnames the dev server answers to, e.g. an https tunnel for testing Instagram/Facebook login locally.
  const env = loadEnv(mode, process.cwd(), '')
  const allowedHosts = (env.DEV_ALLOWED_HOSTS || '.trycloudflare.com').split(',').map((h) => h.trim()).filter(Boolean)

  return {
  plugins: [react()],
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
