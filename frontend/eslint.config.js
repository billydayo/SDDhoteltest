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
      // 認證 token 是唯一的例外，由 api/client.ts 統一處理。
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: '業務資料 MUST NOT 存進 localStorage；一律經 api/client.ts 向後端取得。',
        },
      ],
    },
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
