import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// A tab opened before a deploy asks for page files that no longer exist. Reload once to get the new ones.
// The timestamp stops a reload loop if the file is still missing after reloading.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'chunkReloadAt'
  let last = 0
  try { last = Number(sessionStorage.getItem(KEY) || 0) } catch { /* storage blocked */ }
  if (Date.now() - last < 30_000) return
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* storage blocked */ }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
