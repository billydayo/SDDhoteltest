/**
 * T007：ESLint 設定。
 *
 * ## 為什麼 `any` 是 error 而不是 warn
 *
 * 憲章前端約束：「MUST NOT 使用未說明理由的 `any`」。warn 的問題是它會累積——
 * 一百個 warning 之後沒有人再讀它們，等於沒有規則。設為 error 之後，真的需要
 * `any` 的地方就必須寫一行 `eslint-disable-next-line` 並附上理由，
 * 而那行註解正是規則想要的東西。
 *
 * ## 為什麼要 type-checked 規則
 *
 * `no-floating-promises` 只有在拿得到型別資訊時才能運作。忘記 `await` 一個
 * fetch 是本專案最可能出現的一種 bug：畫面照常渲染，資料沒進來，也沒有錯誤。
 */
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      reactHooks.configs['recommended-latest'],
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // 憲章：MUST NOT 使用未說明理由的 any
      '@typescript-eslint/no-explicit-any': 'error',

      // 忘記 await 的 fetch：畫面照常渲染、資料沒進來、也沒有錯誤
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // FR-084：MUST NOT 靜默失敗。空的 catch 正是靜默失敗的標準寫法。
      'no-empty': ['error', { allowEmptyCatch: false }],

      // 業務資料 MUST NOT 存進 localStorage（憲章原則 III：資料存取的單一路徑）。
      // 認證 token 是唯一的例外，由 api/client.ts 統一處理（下方有 override）。
      //
      // 兩條規則都需要：`no-restricted-globals` 擋裸寫的 `localStorage`，
      // `no-restricted-properties` 擋 `window.localStorage`。只擋一種等於留了
      // 一個誰都會繞過的門。
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message: '只有 api/client.ts 可以碰儲存空間，且僅限認證 token。',
        },
        {
          object: 'window',
          property: 'sessionStorage',
          message: '只有 api/client.ts 可以碰儲存空間，且僅限認證 token。',
        },
      ],

      // 元件內 MUST NOT 直接 fetch（憲章原則 III）。唯一出口是 api/client.ts。
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: '業務資料 MUST NOT 存進 localStorage；一律經 api/client.ts 向後端取得。',
        },
        {
          name: 'sessionStorage',
          message: '業務資料 MUST NOT 存進 sessionStorage；一律經 api/client.ts 向後端取得。',
        },
        {
          name: 'fetch',
          message: 'MUST NOT 在元件內直接 fetch；一律經 api/client.ts（憲章原則 III）。',
        },
      ],
    },
  },

  // `api/client.ts` 是唯一被允許碰儲存空間與 fetch 的檔案——它就是那個出口。
  {
    files: ['src/api/client.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },

  // Context provider 與其 hook 放在同一個檔案是 React 的標準寫法，
  // 拆開只會讓兩個檔案永遠一起改。這裡關掉 fast-refresh 的提醒，
  // 代價是改動 AuthContext.tsx 時該分頁會整頁重載——開發期間可接受。
  {
    files: ['src/state/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // 測試檔：Vitest 全域，且允許非空斷言以簡化斷言寫法
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // 設定檔跑在 Node 上
  {
    files: ['*.config.{ts,js}'],
    languageOptions: { globals: globals.node },
  },
)
