/**
 * 產生 Cloudflare Pages 的 `_redirects`（由 package.json 的 postbuild 自動執行）。
 *
 * 這個檔案解決兩個只會在正式環境出現、而且都不會有錯誤訊息的問題。
 *
 * ## 一、房源照片會全部變成破圖
 *
 * 後端存進 `rooms.images` 的是 `/uploads/<uuid>.jpg`——一個**同源的絕對路徑**
 * （見 backend/src/sunny/services/room_photos.py 的 `PUBLIC_PREFIX`）。開發時
 * Vite 的 proxy 把它轉給 FastAPI，所以看起來一切正常。
 *
 * 但正式環境前端住在 Cloudflare Pages、後端住在 DigitalOcean，`/uploads/x.jpg`
 * 於是指向 Pages 而不是後端。Pages 上沒有這個檔案，SPA 的 catch-all 會回一份
 * `index.html`——瀏覽器拿到 `Content-Type: text/html` 卻要當圖片畫，
 * 結果是破圖。API 全部 200、資料完全正確、console 也不見得有紅字。
 *
 * 這裡把它 302 轉到後端。用 302 而不是 200 rewrite 是因為 `_redirects` 的
 * 200 只能指向同一個 Pages 專案內的路徑，跨網域一定得用轉址。
 *
 * ## 二、重新整理任何非首頁的網址會得到 404
 *
 * React Router 是前端路由：`/rooms/123` 這個路徑在 Pages 上沒有對應檔案。
 * 從首頁點過去沒事（沒有發出請求），但重新整理或直接貼網址就會落到伺服器上，
 * 而伺服器不知道這條路徑。catch-all 把所有未命中的路徑交回 index.html。
 *
 * ⚠️ **順序有意義。** `_redirects` 是第一條命中者生效，catch-all MUST 在最後，
 * 否則它會先吃掉 /uploads 的規則。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = resolve(FRONTEND_ROOT, 'dist', '_redirects')

/**
 * 從 `VITE_API_BASE_URL` 取出後端的來源（scheme + host）。
 *
 * 該變數的值是 API 的基底位址，例如 `https://api.example.com`；開發與預覽時
 * 則是相對路徑 `/api`（見 src/api/client.ts）。相對路徑代表「前後端同源」，
 * 這種情況下 /uploads 本來就會落在對的地方，不需要轉址。
 */
function apiOrigin() {
  const raw = process.env.VITE_API_BASE_URL?.trim()
  if (!raw || raw.startsWith('/')) return null

  try {
    return new URL(raw).origin
  } catch {
    // 拋出而不是靜默略過：值填錯（少了 https://、多了空白）時，若這裡默默
    // 當成「沒設定」，建置會成功、部署會成功，然後照片全部是破圖——
    // 而那時已經沒有任何線索指向這個變數。
    throw new Error(
      `VITE_API_BASE_URL 不是合法的網址：${raw}\n` +
        '應為完整位址（例：https://api.example.com）或相對路徑 /api。',
    )
  }
}

const origin = apiOrigin()
const lines = ['# 由 scripts/build-redirects.mjs 產生，請勿手動編輯。', '']

if (origin) {
  lines.push('# 房源照片：後端回的是同源絕對路徑，實際檔案在 DigitalOcean 上。')
  lines.push(`/uploads/*  ${origin}/uploads/:splat  302`)
  lines.push('')
} else {
  lines.push('# VITE_API_BASE_URL 未設定或為相對路徑，視為前後端同源，不轉址 /uploads。')
  lines.push('')
}

lines.push('# SPA catch-all。MUST 為最後一條。')
lines.push('/*  /index.html  200')
lines.push('')

mkdirSync(dirname(OUTPUT), { recursive: true })
writeFileSync(OUTPUT, lines.join('\n'), 'utf8')

console.log(
  origin
    ? `[build-redirects] 已寫入 dist/_redirects，/uploads → ${origin}`
    : '[build-redirects] 已寫入 dist/_redirects（同源，未加入 /uploads 轉址）',
)
