/**
 * Cloudflare Worker：把 sddhotel.<帳號>.workers.dev 的請求原封不動轉給 Droplet。
 *
 * ## 這支東西為什麼存在
 *
 * `*.workers.dev` 的 DNS 由 Cloudflare 掌控，**不能用 A 記錄指到自己的機器**。
 * 想讓那個網址顯示 Droplet 上的站台，只能由 Worker 代為抓取再回傳。
 *
 * ## 它刻意什麼都不做
 *
 * 路由、SPA fallback、`/api` 前綴剝除、快取標頭、CSP——全部由 Droplet 上的
 * Caddy 處理（deploy/Caddyfile）。這裡只做轉發。
 *
 * 這個分工是重點，不是偷懶：**瀏覽器眼中所有東西都在
 * `https://sddhotel.<帳號>.workers.dev` 這一個來源底下**，因此同源架構的三個
 * 好處原封不動地成立——沒有 CORS、`/uploads/<uuid>.jpg` 真的是同源路徑、
 * 前端不需要 `VITE_API_BASE_URL`。一旦在這裡開始自己處理路由，那些保證就會
 * 開始跟 Caddyfile 分歧，而分歧的症狀只會在正式環境出現。
 *
 * ## 部署
 *
 *     cd deploy/worker
 *     npx wrangler deploy
 *
 * ⚠️ `wrangler.jsonc` 的 name 是 `sddhotel`，與現有那個 Worker 同名——
 * 部署會**取代**目前跑在該網址上的舊版靜態站。這是預期行為。
 */
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url)

    // 只換掉 scheme 與主機，path 與 query 原樣帶過去。
    // ⚠️ MUST 保留 search：`/api/rooms?check_in=...` 少了它會變成一個沒有
    // 篩選條件的查詢——回 200、有資料、但不是使用者要的那批。
    const target = new URL(incoming.pathname + incoming.search, env.ORIGIN)

    // 用原請求建構，method、headers 與 body 都會沿用。
    // Host 由 fetch 依 target 自行帶上（Workers 不允許手動設定），
    // 因此 Caddy 收到的 Host 是 APP_HOSTNAME，站台區塊才比對得到。
    const proxied = new Request(target, request)

    // ⚠️ `redirect: 'manual'` 不能省。
    //
    // 預設是 follow，也就是 Worker 會自己跟著轉址跑完，然後把**最終**回應交給
    // 瀏覽器。後端登入流程與 Google 回呼都靠 302 把使用者送到下一頁，被 Worker
    // 吃掉之後，瀏覽器的網址列不會變、前端也收不到那次導向——畫面看起來像卡住，
    // 而伺服器日誌上每一步都是成功的。
    return fetch(proxied, { redirect: 'manual' })
  },
}
