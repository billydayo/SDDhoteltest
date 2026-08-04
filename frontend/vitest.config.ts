/**
 * Vitest 設定（T010）。
 *
 * 與 `vite.config.ts` 分開，因為兩者關心的東西不同：建置設定含開發代理與
 * 產物選項，測試設定含環境與 setup。合在一起時，改測試設定會動到建置設定的
 * 檔案，review 時看不出影響範圍。
 *
 * `environment: 'jsdom'` 是必要的——測的是 React 元件，需要 DOM。
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
