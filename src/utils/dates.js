/**
 * 日期工具 — 一律以 `YYYY-MM-DD` 字串處理日曆日。
 *
 * 憲章原則 IV：
 * - 時區固定視為 Asia/Taipei
 * - MUST NOT 使用含時間的 timestamp 做比較
 * - MUST NOT 使用會受瀏覽器時區影響的 Date 轉換
 *
 * 因此本模組刻意不使用 `new Date(str)` 解析、不使用 `toISOString()`
 * （它會轉成 UTC，在台灣的凌晨會少一天）。所有運算走「字串 ⇄ 純數字」路徑。
 */

const TAIPEI = 'Asia/Taipei';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 今天（Asia/Taipei）的 YYYY-MM-DD */
export function todayInTaipei() {
  // en-CA 的日期格式恰好就是 YYYY-MM-DD，省去手動補零
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/** 訂房最早可選日期＝明天（憲章原則 IV：訂房需提前一天） */
export function earliestCheckIn() {
  return addDays(todayInTaipei(), 1);
}

export function isValidDateString(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const { y, m, d } = splitDate(value);
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= daysInMonth(y, m);
}

function splitDate(value) {
  return {
    y: Number(value.slice(0, 4)),
    m: Number(value.slice(5, 7)),
    d: Number(value.slice(8, 10))
  };
}

function pad(n) { return String(n).padStart(2, '0'); }

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y, m) {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/**
 * 日期 → 自 1970-01-01 起的天數。純算術，不經過 Date 物件，因此不受時區影響。
 * 用於夜數計算與區間比較。
 */
function toDayNumber(value) {
  const { y, m, d } = splitDate(value);
  // Howard Hinnant 的 days_from_civil 演算法
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** 天數 → YYYY-MM-DD，toDayNumber 的反函式 */
function fromDayNumber(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const year = y + (m <= 2 ? 1 : 0);
  return `${String(year).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
}

export function addDays(value, delta) {
  return fromDayNumber(toDayNumber(value) + delta);
}

/** 夜數＝退房日 − 入住日。退房當日不計為一晚（憲章原則 IV）。 */
export function nightsBetween(checkIn, checkOut) {
  return toDayNumber(checkOut) - toDayNumber(checkIn);
}

/**
 * 半開區間重疊判定（憲章原則 IV）：
 * [a, b) 與 [c, d) 重疊，若且唯若 a < d 且 c < b。
 *
 * 這讓「前一筆的退房日 = 後一筆的入住日」正確地不算重疊——
 * 這是本專案最容易誤判的邊界案例。
 */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const a = toDayNumber(aStart);
  const b = toDayNumber(aEnd);
  const c = toDayNumber(bStart);
  const d = toDayNumber(bEnd);
  return a < d && c < b;
}

function isBefore(a, b) { return toDayNumber(a) < toDayNumber(b); }
export function isSameOrBefore(a, b) { return toDayNumber(a) <= toDayNumber(b); }

/** 距離入住日還有幾天（以 Asia/Taipei 的今天為基準），用於退款級距 */
export function daysUntil(dateStr) {
  return toDayNumber(dateStr) - toDayNumber(todayInTaipei());
}

/**
 * 驗證訂房日期區間。回傳 null 表示通過，否則回傳可直接顯示的錯誤訊息。
 */
export function validateStayRange(checkIn, checkOut) {
  if (!isValidDateString(checkIn) || !isValidDateString(checkOut)) {
    return '請選擇有效的入住與退房日期。';
  }
  if (isSameOrBefore(checkOut, checkIn)) {
    return '退房日必須晚於入住日至少一晚。';
  }
  const earliest = earliestCheckIn();
  if (isBefore(checkIn, earliest)) {
    return `訂房需提前一天，最早可選日期為 ${formatDate(earliest)}。`;
  }
  return null;
}

/** 全站一致的日期顯示格式 */
export function formatDate(value) {
  if (!isValidDateString(value)) return '—';
  const { y, m, d } = splitDate(value);
  return `${y}/${pad(m)}/${pad(d)}`;
}

export function formatDateRange(checkIn, checkOut) {
  return `${formatDate(checkIn)} – ${formatDate(checkOut)}`;
}

/** 顯示含時間的時間戳（用於訂單建立時間、操作日誌） */
export function formatDateTime(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: TAIPEI,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(dt);
}

/** 剩餘時間（毫秒）→「12 分 30 秒」，用於待付款倒數 */
export function formatRemaining(ms) {
  if (ms <= 0) return '已逾期';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 小時 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}
