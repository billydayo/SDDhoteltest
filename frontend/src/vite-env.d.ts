/// <reference types="vite/client" />

/**
 * `import.meta.env` 的型別。
 *
 * 少了這份宣告，`import.meta.env.VITE_*` 是 `any`——而 `any` 會讓型別系統在
 * 讀取設定的地方完全失效，正是最不該失效的地方之一（憲章前端約束）。
 *
 * ⚠️ **這裡 MUST 只列公開資訊。** `VITE_` 前綴的變數會被原樣寫進建置產物，
 * 任何人都讀得到。金鑰、密碼、client secret MUST NOT 出現在此（FR-085、SC-022）。
 */
interface ImportMetaEnv {
  /** API 根路徑。預設 `/api`，由 Vite 開發代理轉給 FastAPI。 */
  readonly VITE_API_BASE_URL?: string

  /**
   * 設為字串 `'true'` 時，登入頁不顯示管理員的示範帳密卡片（預設顯示）。
   *
   * ⚠️ MUST 與後端的 `SEED_ADMIN_PASSWORD` 一起設定——只設一邊，
   * 得到的不是「比較安全」而是「壞掉」或「假裝安全」。理由見 pages/Login.tsx。
   */
  readonly VITE_HIDE_ADMIN_DEMO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
