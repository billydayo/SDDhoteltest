/**
 * 退款服務（US4 / T061、T062）。
 *
 * FR-035：僅入住日未到且狀態為「已確認」的訂單可申請，且必須填寫原因。
 * FR-036：同一訂單不得同時存在兩筆審核中的申請。
 * FR-039：駁回後訂單回到「已確認」，會員可再次申請。
 * FR-041：退款金額依距入住日的天數分級。
 * FR-040：退款不產生任何實際金錢移轉，只變更狀態。
 *
 * 「一筆審核中」的最終保證來自資料庫的部分唯一索引
 * （`refunds_one_pending_per_order`）。這裡的檢查是即時回饋。
 */

import * as repo from '../data/repository.js';
import { listRefunds } from '../data/refunds.js';
import { appError } from '../utils/errors.js';
import { daysUntil } from '../utils/dates.js';
import { calculateRefund } from '../utils/money.js';
import { normalizeText, isBlank, REFUND_REASON_MIN_LENGTH } from '../utils/validation.js';

/** 退款級距，供畫面顯示政策說明（FR-041） */
export const REFUND_POLICY = Object.freeze([
  { label: '入住日前 7 天以上', percent: 100 },
  { label: '入住日前 3 至 6 天', percent: 50 },
  { label: '入住日前 1 至 2 天', percent: 20 },
  { label: '入住當日或已入住後', percent: 0 }
]);

/**
 * 退款試算。回傳 null 代表不可退款。
 * @returns {{ percent: number, amount: number }|null}
 */
export function quoteRefund(order) {
  if (!order || order.status !== 'confirmed') return null;
  return calculateRefund(order.totalAmount, daysUntil(order.checkIn));
}

/**
 * 不可申請退款的原因。回傳 null 代表可以申請。
 * 訊息可直接顯示給使用者（FR-075）。
 */
export function refundUnavailableReason(order) {
  if (!order) return '查無此訂單。';

  switch (order.status) {
    case 'pending-payment':
      return '訂單尚未完成付款。若不想繼續，等待保留時間過去即會自動取消。';
    case 'refund-pending':
      return '此訂單已有審核中的退款申請，請等待管理員處理。';
    case 'refunded':
      return '此訂單已完成退款。';
    case 'cancelled':
      return '此訂單已取消。';
    case 'completed':
      return '入住日已過，無法申請退款。';
    default:
      break;
  }

  // 已確認但入住日已到或已過（FR-041：當日起不可退款）
  if (daysUntil(order.checkIn) < 1) {
    return '入住當日或已入住後不可申請退款。';
  }
  return null;
}

/** 退款原因的驗證。回傳 null 代表通過。 */
export function validateReason(reason) {
  if (isBlank(reason)) return '請填寫退款原因。';
  if (normalizeText(reason).length < REFUND_REASON_MIN_LENGTH) {
    return `退款原因請至少填寫 ${REFUND_REASON_MIN_LENGTH} 個字。`;
  }
  return null;
}

/**
 * 送出退款申請。
 *
 * 送出成功後訂單狀態轉為「退款審核中」，該筆申請會出現在後台的審核佇列。
 */
export async function submitRefundRequest(order, reason) {
  const blocked = refundUnavailableReason(order);
  if (blocked) throw appError('REFUND_NOT_ALLOWED', blocked);

  const reasonError = validateReason(reason);
  if (reasonError) throw appError('REFUND_NOT_ALLOWED', reasonError);

  const quote = quoteRefund(order);
  if (!quote) throw appError('REFUND_NOT_ALLOWED', '此訂單目前不可申請退款。');

  return repo.requestRefund({
    orderId: order.id,
    reason: normalizeText(reason, 500),
    amount: quote.amount
  });
}

/**
 * 取得某訂單的退款申請紀錄，最新在前。
 *
 * RLS 已經把非本人的資料濾掉，因此這裡取回自己的全部申請再依訂單過濾即可，
 * 不需要為此在兩個 adapter 各加一個查詢參數。
 */
export async function refundsForOrder(orderId) {
  const all = await listRefunds();
  return all
    .filter((r) => r.orderId === orderId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const REFUND_STATUS = Object.freeze({
  pending:  { label: '審核中', tone: 'info' },
  approved: { label: '已核准', tone: 'ok' },
  rejected: { label: '已駁回', tone: 'danger' }
});

export const refundStatusLabel = (value) => REFUND_STATUS[value]?.label ?? value;
