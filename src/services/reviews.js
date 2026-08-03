/**
 * 評論服務（US5 / T065、T067、T068）。
 *
 * FR-042：僅能對自己有已完成入住紀錄的房源撰寫。
 * FR-043：每筆訂單僅能對應一則評論（資料庫以 UNIQUE 約束保證）。
 * FR-045：送出後進入待審核，不得直接於前台公開。
 * FR-103：先經規則式自動審核初判，仍需管理員複核。
 */

import { listReviews, submitReview as persistReview } from '../data/reviews.js';
import { listOrders } from '../data/orders.js';
import { moderateReview } from './moderation.js';
import { appError } from '../utils/errors.js';
import { validateRating, normalizeText, isBlank } from '../utils/validation.js';
import { todayInTaipei, isSameOrBefore } from '../utils/dates.js';
import { MIN_LENGTH } from './moderation.js';
import * as store from '../state/store.js';

/**
 * 找出目前使用者在此房源、可以撰寫評論的訂單。
 *
 * 條件：訂單屬於自己、退房日已過、尚未寫過評論、且訂單狀態不是取消或退款。
 * 回傳空陣列代表不符合撰寫資格（FR-042）。
 */
export async function eligibleOrdersForRoom(roomId) {
  if (!store.isSignedIn()) return [];

  const today = todayInTaipei();
  const [orders, myReviews] = await Promise.all([
    listOrders({ roomId }),
    listReviews({ userId: store.currentProfile().id })
  ]);

  const reviewedOrderIds = new Set(myReviews.map((r) => r.orderId));

  return orders.filter((order) =>
    order.roomId === roomId
    && ['confirmed', 'completed'].includes(order.status)
    && isSameOrBefore(order.checkOut, today)      // 退房日已過
    && !reviewedOrderIds.has(order.id)
  );
}

/** 表單驗證。回傳 { field: message }，空物件代表通過。 */
function validateReviewForm({ rating, comment, category }) {
  const errors = {};

  const ratingError = validateRating(rating);
  if (ratingError) errors.rating = ratingError;

  if (isBlank(comment)) {
    errors.comment = '請填寫評論內容。';
  } else if (normalizeText(comment).length < MIN_LENGTH) {
    errors.comment = `評論內容請至少填寫 ${MIN_LENGTH} 個字。`;
  }

  if (isBlank(category)) errors.category = '請選擇評論類型。';

  return errors;
}

/**
 * 送出評論。
 *
 * 流程：表單驗證 → 規則式自動審核 → 寫入（狀態一律 pending）。
 *
 * 自動審核的結果只是初判，**不會**讓評論直接公開，也不會直接退件——
 * 它連同觸發的規則一起存起來，供管理員在審核佇列參考（FR-103）。
 */
export async function submitReview({ orderId, rating, comment, category }) {
  const errors = validateReviewForm({ rating, comment, category });
  if (Object.keys(errors).length) {
    throw appError('UNKNOWN', Object.values(errors)[0], { details: errors });
  }

  const profile = store.currentProfile();
  if (!profile) throw appError('SESSION_EXPIRED');

  // 重複偵測需要同一使用者先前的評論內容
  const previous = await listReviews({ userId: profile.id }).catch(() => []);

  const verdict = moderateReview(
    { rating: Number(rating), comment },
    { previousComments: previous.map((r) => r.comment) }
  );

  const review = await persistReview({
    orderId,
    rating: Number(rating),
    comment: normalizeText(comment, 1000),
    category,
    autoVerdict: verdict.verdict,
    autoRules: verdict.rules
  });

  return { review, verdict };
}

/** 目前使用者對此房源已送出的評論（含未公開者），供顯示審核進度 */
export async function myReviewsForRoom(roomId) {
  if (!store.isSignedIn()) return [];
  const mine = await listReviews({ userId: store.currentProfile().id });
  return mine.filter((r) => r.roomId === roomId);
}

export const REVIEW_STATUS = Object.freeze({
  pending:  { label: '待審核', tone: 'info' },
  approved: { label: '已公開', tone: 'ok' },
  rejected: { label: '未通過審核', tone: 'danger' }
});

export const reviewStatusLabel = (value) => REVIEW_STATUS[value]?.label ?? value;
