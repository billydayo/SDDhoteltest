/**
 * FR-006：登入畫面 MUST 提醒本站為展示用專案、勿使用其在其他網站的真實密碼。
 *
 * 註冊頁一併使用——那裡才是使用者真的會輸入自己密碼的地方。這個站看起來像
 * 一個真的訂房平台，使用者沒有理由知道它不是，於是很可能順手填了他到處在用
 * 的那一組密碼。
 */
export function PasswordWarning() {
  return (
    <section className="rounded-lg border border-warn/30 bg-warn-soft p-gap-5">
      <h2 className="font-display text-h3 text-ink">請勿使用你的真實密碼</h2>
      <p className="mt-gap-2 text-small text-ink">
        本站為<strong className="font-semibold">展示用專案</strong>
        ，不提供真實住宿服務，也不會產生任何實際交易。
      </p>
      <p className="mt-gap-2 text-small text-ink">
        若你要自行註冊，請使用一組
        <strong className="font-semibold">專屬於此處</strong>的密碼，
        <strong className="font-semibold">不要沿用你在其他網站的真實密碼</strong>。
      </p>
      <p className="mt-gap-2 text-tiny text-ink-muted">
        密碼一律以 argon2id 雜湊保存，站方無法還原——但這不是重複使用密碼的理由。
      </p>
    </section>
  )
}
