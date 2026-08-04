/**
 * T045：金額。
 *
 * ⚠️ **整數新臺幣元，MUST NOT 出現小數**（FR-070、憲章原則 IV）。
 *
 * 房價 × 夜數若走浮點數會出現 `2999.9999999999995` 這種值。四捨五入後多數
 * 時候剛好對，偶爾差一元——而那一元會出現在使用者的帳單上，且不會有任何
 * 錯誤訊息。金額的來源一律是後端算好的整數，前端只負責顯示與**預覽**。
 *
 * 「預覽」很重要：本模組算出的金額只用於畫面上的即時試算，**送出訂單時
 * 一律以後端重算的為準**——`OrderCreateIn` 根本沒有 `totalAmount` 欄位，
 * 前端算錯也影響不到實際帳目（FR-024）。
 */

/** 千分位格式化。以 zh-TW 的 `Intl` 產生，與整站語系一致。 */
const FORMATTER = new Intl.NumberFormat('zh-TW', {
  maximumFractionDigits: 0,
  useGrouping: true,
})

/**
 * 顯示金額，例如 `NT$ 12,000`。
 *
 * 非整數或非有限數一律回傳 `—`，**MUST NOT 顯示 `NaN` 或 `NT$ undefined`**。
 * 使用者看到 `NaN` 只會以為網站壞了；看到 `—` 至少知道這裡沒有資料。
 */
export function formatTWD(amount: number): string {
  if (!Number.isFinite(amount)) return '—'
  return `NT$ ${FORMATTER.format(Math.round(amount))}`
}

/** 不帶幣別前綴的金額，供表格右對齊的數字欄使用。 */
export function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '—'
  return FORMATTER.format(Math.round(amount))
}

/**
 * 每晚價格 × 夜數的**預覽**金額。
 *
 * 回傳整數。任一輸入非法時回 0——回 `NaN` 會一路傳到畫面上變成 `NT$ NaN`。
 */
export function previewTotal(nightlyPrice: number, nights: number): number {
  if (!Number.isFinite(nightlyPrice) || !Number.isFinite(nights)) return 0
  if (nights <= 0) return 0
  return Math.round(nightlyPrice) * Math.trunc(nights)
}

/**
 * 這個值是不是一個合法的金額（非負整數）。
 *
 * 用於開發期間確認後端回應的形狀。金額出現小數代表某處用了浮點數運算，
 * 那是要修的 bug，不是要容忍的輸入。
 */
export function isValidAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}
