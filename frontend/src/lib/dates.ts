/**
 * T044：日曆日處理。
 *
 * ⚠️ **MUST NOT 使用 `new Date("YYYY-MM-DD")` 解析。**
 *
 * 這是本專案前端最容易犯、也最難察覺的一個錯。ECMAScript 規定「只有日期」的
 * ISO 字串以 **UTC** 解讀，因此在台北（UTC+8）：
 *
 *     new Date('2026-08-04').getDate()   // → 3，不是 4
 *
 * 少一天。而且它不會拋錯，畫面上只是日期少一天——使用者選了 8/04 卻看到
 * 8/03，或訂到了前一晚。單元測試若也用 `new Date(str)` 產生期望值，
 * 兩邊會一起錯，測試全綠。
 *
 * 本模組一律**以字串為主要表示**（與後端的 `YYYY-MM-DD` 一對一對應），
 * 需要運算時才用 `Date.UTC` 轉成時間戳——UTC 沒有日光節約時間，兩個午夜
 * 之間永遠是 86400000 的整數倍。用本地時間做同樣的減法，在有 DST 的時區
 * 會出現 23 或 25 小時的一天，夜數就會算錯。
 */

/** 線上格式：四位年、兩位月、兩位日，**必須補零**（contracts/README.md）。 */
const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 一天的毫秒數。以 UTC 計算時這個值恆定。 */
const MS_PER_DAY = 86_400_000

export interface CalendarParts {
  year: number
  month: number // 1–12，**不是** JS 的 0–11
  day: number
}

/**
 * 嚴格解析 `YYYY-MM-DD`。格式錯誤或日期不存在時回傳 `null`。
 *
 * 兩層檢查缺一不可：正規式鎖住形狀（擋掉 `2026-8-4` 這種未補零的形式），
 * 再回頭比對還原出的年月日是否相同（擋掉 `2026-02-30` —— `Date.UTC` 會把它
 * 悄悄捲成 3/02 而不報錯）。
 *
 * **未補零特別危險**：日期字串在本專案會被排序與比較，而 `'2026-8-4'` 在
 * 字典序下大於 `'2026-08-05'`。這種錯不拋例外，只讓順序悄悄錯掉。
 */
export function parseCalendarDate(value: string): CalendarParts | null {
  if (!CALENDAR_DATE_RE.test(value)) return null

  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))

  const stamp = Date.UTC(year, month - 1, day)
  const back = new Date(stamp)
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null // 例如 2026-02-30
  }
  return { year, month, day }
}

/** `YYYY-MM-DD` 是否為合法的日曆日。 */
export function isCalendarDate(value: string): boolean {
  return parseCalendarDate(value) !== null
}

/** 日曆日 → UTC 午夜的時間戳。**僅供本模組內部運算使用。** */
function toStamp(value: string): number | null {
  const parts = parseCalendarDate(value)
  if (!parts) return null
  return Date.UTC(parts.year, parts.month - 1, parts.day)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** UTC 時間戳 → `YYYY-MM-DD`。 */
function fromStamp(stamp: number): string {
  const d = new Date(stamp)
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate(),
  )}`
}

/**
 * 使用者所在時區的今天，格式 `YYYY-MM-DD`。
 *
 * 這裡刻意用**本地**的年月日欄位（`getFullYear` 等）而非 UTC：
 * 「今天」對使用者而言就是他手機上顯示的日期。後端另以 Asia/Taipei 判定，
 * 兩者在跨日的那一小段時間可能差一天——這是刻意接受的，**且後端說了算**：
 * 使用者若選了一個後端認為是「今天」的日期，會收到「訂房需提前一天」的
 * 明確訊息，而不是靜默地被接受成錯誤的日期。
 */
export function today(now: Date = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )}`
}

/** 明天——訂房的最早可選日期（FR-022）。 */
export function tomorrow(now: Date = new Date()): string {
  return addDays(today(now), 1)
}

/** 日曆日加減天數。輸入非法時原樣回傳，讓錯誤在驗證層而非此處顯現。 */
export function addDays(value: string, days: number): string {
  const stamp = toStamp(value)
  if (stamp === null) return value
  return fromStamp(stamp + days * MS_PER_DAY)
}

/**
 * 夜數 = 退房日 − 入住日。**退房當日不計為一晚。**
 *
 * 8/01–8/02 為 1 晚，不是 0 也不是 2。任一端非法時回傳 0。
 */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = toStamp(checkIn)
  const b = toStamp(checkOut)
  if (a === null || b === null) return 0
  return Math.round((b - a) / MS_PER_DAY)
}

/** 字典序比較。因為格式固定補零，字串比較與日期比較等價。 */
export function compareCalendarDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 顯示格式。**全站一致**（FR-069、T172a）。
 *
 * 用 `2026/08/04` 而非 `2026年8月4日`：後者在表格與並排的日期區間裡寬度不一，
 * 而訂房畫面到處都是「入住 – 退房」的成對日期。
 */
export function formatDisplayDate(value: string): string {
  const parts = parseCalendarDate(value)
  if (!parts) return value
  return `${String(parts.year).padStart(4, '0')}/${pad(parts.month)}/${pad(parts.day)}`
}

/** 顯示一段住宿區間，例如 `2026/08/04 – 2026/08/06（2 晚）`。 */
export function formatStay(checkIn: string, checkOut: string): string {
  const nights = nightsBetween(checkIn, checkOut)
  return `${formatDisplayDate(checkIn)} – ${formatDisplayDate(checkOut)}（${String(nights)} 晚）`
}

/**
 * 帶時區的時間戳（後端的 `timestamptz`）→ 顯示字串。
 *
 * 這裡**可以**用 `new Date(iso)`：完整的 ISO 時間戳含時區資訊，不是「只有
 * 日期」的字串，因此沒有被當成 UTC 午夜的問題。分界就在這裡——
 * 日曆日絕不用它，時間戳一定用它。
 */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getFullYear()).padStart(4, '0')}/${pad(d.getMonth() + 1)}/${pad(
    d.getDate(),
  )} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 距離某個時間戳還剩幾秒。已過期為 0。供付款倒數使用（FR-102）。 */
export function secondsUntil(iso: string, now: Date = new Date()): number {
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return 0
  return Math.max(0, Math.floor((target - now.getTime()) / 1000))
}
