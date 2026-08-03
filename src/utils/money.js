/**
 * 金額工具 — 一律以整數（新臺幣元）運算。
 *
 * 憲章原則 IV：MUST 以整數運算，MUST NOT 以浮點數累加，顯示時才格式化。
 * FR-070：金額以新臺幣元顯示，且不得出現小數。
 */

const twd = new Intl.NumberFormat('zh-TW', {
  style: 'currency',
  currency: 'TWD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

/** 顯示為「NT$3,200」 */
export function formatTWD(amount) {
  if (!Number.isFinite(amount)) return '—';
  return twd.format(Math.round(amount));
}

/** 總金額＝每晚房價 × 夜數。入住人數不影響價格（見 spec Assumptions）。 */
export function calculateTotal(nightlyPrice, nights) {
  const price = toInteger(nightlyPrice);
  const n = toInteger(nights);
  if (price === null || n === null || n <= 0) return null;
  return price * n;
}

/**
 * 退款金額級距（FR-041）：
 *   入住日前 7 天以上   → 全額
 *   入住日前 3–6 天     → 50%
 *   入住日前 1–2 天     → 20%
 *   入住當日或已入住後  → 不可退款
 *
 * 回傳 { rate, amount } 或 null（代表不可退款）。
 * 以整數運算：先乘後除並四捨五入，避免浮點誤差累積。
 */
export function calculateRefund(totalAmount, daysBeforeCheckIn) {
  const total = toInteger(totalAmount);
  if (total === null) return null;

  let percent;
  if (daysBeforeCheckIn >= 7) percent = 100;
  else if (daysBeforeCheckIn >= 3) percent = 50;
  else if (daysBeforeCheckIn >= 1) percent = 20;
  else return null;

  return { percent, amount: Math.round((total * percent) / 100) };
}

/** 平均客單價。無訂單時回傳 null，由呼叫端顯示「—」而非 0（避免除以零）。 */
export function average(total, count) {
  if (!count) return null;
  return Math.round(total / count);
}

/** 成交率百分比。無訂單時回傳 null。 */
export function rate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function formatPercent(value) {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function toInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}
