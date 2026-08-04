/**
 * Vite 設定（T005、T010）。
 *
 * ## 開發代理
 *
 * 開發時把 API 呼叫代理到 FastAPI，讓前端一律以同源相對路徑 `/api/...` 呼叫。
 * 這樣 `api/client.ts` 不需要知道後端住在哪裡，也讓開發環境不必開 CORS 例外——
 * 憲章禁止 `allow_origins=["*"]` 搭配 `allow_credentials=True`，而開發時圖方便
 * 放寬 CORS 正是那個組合最常見的來源。
 *
 * ⚠️ **`VITE_` 前綴的變數會被寫進建置產物。** 只能承載公開資訊，
 * MUST NOT 放任何秘鑰（憲章前端約束、FR-085）。
 */
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
