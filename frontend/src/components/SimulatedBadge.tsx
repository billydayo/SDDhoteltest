/**
 * T159（提前建立）：模擬資料的標示（FR-110）。
 *
 * 原訂於 US11 隨渠道比價頁一起建立，但**營運總覽也顯示賤賣預警筆數**
 * （T126、FR-111），而那個數字同樣來自模擬資料。等到 T159 再建立的話，
 * 總覽上那個數字會有一段時間沒有標示——而沒有標示的數字會被當成真的。
 *
 * ## 為什麼文案來自後端
 *
 * `simulatedNotice` 是每一列資料的一部分（`schemas/channel.py`），不是前端的
 * 裝飾。前端自己寫一份文案的話，兩邊遲早會分歧，而分歧時**匯出的檔案**帶著
 * 後端那句、**畫面上**是前端那句——收到檔案的人與看畫面的人得到不同的說法。
 *
 * 因此 `notice` 有值時一律用它；沒有值（例如總覽只回一個數字）才用預設句。
 */

/** `notice` 未提供時的預設句。⚠️ 與 `services/channel.py` 的 `SIMULATED_NOTICE` 同義。 */
const FALLBACK_NOTICE = '模擬資料：此模組不連線至任何外部平台。'

interface SimulatedBadgeProps {
  /** 後端隨資料回傳的說明。省略時使用預設句。 */
  notice?: string
  /**
   * `banner` 為頁面頂端的常駐提示（FR-110 要求常駐，MUST NOT 可關閉）；
   * `inline` 為表格列或卡片內的小標記。
   */
  variant?: 'banner' | 'inline'
}

export function SimulatedBadge({ notice, variant = 'banner' }: SimulatedBadgeProps) {
  const text = notice ?? FALLBACK_NOTICE

  if (variant === 'inline') {
    return (
      <span
        className="inline-flex items-center rounded-pill border border-warn/30 bg-warn-soft px-gap-2 py-px text-tiny text-ink-muted"
        title={text}
      >
        模擬資料
      </span>
    )
  }

  // ⚠️ **沒有關閉按鈕，這是刻意的。** FR-110 要求常駐——可以關掉的提示，
  // 在使用者關掉之後就不存在了，而他之後看到的每一個數字都沒有標示。
  return (
    <p
      role="note"
      className="rounded-base border border-warn/30 bg-warn-soft px-gap-4 py-gap-3 text-small text-ink"
    >
      <span aria-hidden="true" className="mr-gap-2">
        ⚠
      </span>
      {text}
    </p>
  )
}
