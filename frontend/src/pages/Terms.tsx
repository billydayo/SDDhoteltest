/**
 * T059：服務條款與隱私聲明（FR-121、FR-122）。
 *
 * ⚠️ **本頁的重點不是法律文字，是把「這不是真的」講清楚。**
 *
 * 這個站看起來像一個真的訂房平台——它有房源、有價格、有付款流程、有訂單
 * 編號。使用者沒有理由知道它不是。因此 MUST 明確說明：本站為展示用專案、
 * 不提供真實住宿服務、不產生真實交易。
 *
 * 「模擬」兩個字寫在頁尾一行小字是不夠的。有人可能真的以為自己訂到了房間。
 */
export function Terms() {
  return (
    <article className="mx-auto max-w-(--container-measure) py-gap-4">
      <h1 className="font-display text-h1 text-ink">服務條款與隱私聲明</h1>
      <p className="mt-gap-2 text-small text-ink-muted">最後更新：2026 年 8 月</p>

      <section className="mt-gap-6 rounded-lg border border-warn/30 bg-warn-soft p-gap-5">
        <h2 className="font-display text-h3 text-ink">請先閱讀：本站為展示用專案</h2>
        <ul className="mt-gap-3 list-disc space-y-gap-2 pl-gap-5 text-ink">
          <li>
            本站<strong className="font-semibold">不提供真實的住宿服務</strong>
            。所有房源、照片、價格與空房狀態皆為展示用的示範資料。
          </li>
          <li>
            本站<strong className="font-semibold">不會產生任何實際交易</strong>
            。付款與退款流程全部為模擬，不涉及任何真實金流。
          </li>
          <li>
            本站
            <strong className="font-semibold">不會要求、不會接收、也不會儲存任何真實的支付資料</strong>
            ——包含信用卡號、有效期限、安全碼與銀行帳號。任何要求你輸入這些資料的畫面都不屬於本站。
          </li>
          <li>
            即使你完成了訂房與付款流程並取得訂單編號，
            <strong className="font-semibold">也不會有任何房間被保留給你</strong>。
          </li>
        </ul>
      </section>

      <section className="mt-gap-6">
        <h2 className="font-display text-h3 text-ink">關於你提供的資料</h2>
        <p className="mt-gap-2 text-ink-muted">
          註冊時我們會保存你的電子郵件、顯示名稱與密碼雜湊；訂房時會保存你填寫的聯絡姓名、
          電話與電子郵件。這些資料僅用於本站的展示功能，不會提供給任何第三方。
        </p>
        <p className="mt-gap-3 rounded-xs bg-surface-alt p-gap-4 text-ink">
          <strong className="font-semibold">請勿使用你在其他網站的真實密碼。</strong>
          本站為展示用專案，請使用一組專屬於此處的密碼。
        </p>
        <p className="mt-gap-3 text-ink-muted">
          若你以 Google 帳號登入，我們只取得你的電子郵件、顯示名稱與 Google 帳號識別碼，
          不會取得你的 Google 密碼，也無法代你存取其他 Google 服務。
        </p>
      </section>

      <section className="mt-gap-6">
        <h2 className="font-display text-h3 text-ink">刪除你的資料</h2>
        <p className="mt-gap-2 text-ink-muted">
          由於這是展示用專案，資料可能在任何時候被重設。請不要在此存放你需要保留的內容。
        </p>
      </section>

      <section className="mt-gap-6">
        <h2 className="font-display text-h3 text-ink">服務可用性</h2>
        <p className="mt-gap-2 text-ink-muted">
          本站不保證持續可用，也不提供任何形式的保固。功能可能隨時變更或停止。
        </p>
      </section>
    </article>
  )
}
