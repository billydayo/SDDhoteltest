/**
 * 稽核日誌寫入層（FR-114 ~ FR-118）。
 *
 * 設計要點：**變更與日誌必須在同一次操作中完成**，不能出現「改了但沒記錄」。
 * 因此本模組提供 `withAudit()` 包裝器——後台的每一個變更路徑都應該經過它，
 * 而不是各自記得去呼叫 appendAdminLog。
 *
 * 日誌僅可新增。本模組沒有 update 或 delete，資料庫端也沒有對應政策。
 */

import { appendAdminLog } from '../data/admin-logs.js';

/** 動作類型。新增後台功能時在此登記，讓日誌篩選有一致的詞彙。 */
export const ACTIONS = Object.freeze({
  ROOM_CREATE:     'room.create',
  ROOM_UPDATE:     'room.update',
  ROOM_DELETE:     'room.delete',
  ROOM_STATUS:     'room.status',
  ORDER_STATUS:    'order.status',
  REVIEW_APPROVE:  'review.approve',
  REVIEW_REJECT:   'review.reject',
  REVIEW_OVERRIDE: 'review.override',
  REVIEW_DELETE:   'review.delete',
  REFUND_APPROVE:  'refund.approve',
  REFUND_REJECT:   'refund.reject',
  USER_ROLE:       'user.role',
  USER_UPDATE:     'user.update',
  CONTENT_UPDATE:  'content.update',
  CHANNEL_RESOLVE: 'channel.resolve',
  RISK_CHECK_SAVE: 'risk.save',
  SETTING_UPDATE:  'setting.update',
  REPORT_EXPORT:   'report.export',
  REVIEW_REPLY:    'review.reply',
  MESSAGE_SEND:    'message.send'
});

export const ACTION_LABELS = Object.freeze({
  'room.create': '新增房源',
  'room.update': '編輯房源',
  'room.delete': '刪除房源',
  'room.status': '變更房態',
  'order.status': '變更訂單狀態',
  'review.approve': '評論審核通過',
  'review.reject': '評論審核駁回',
  'review.override': '覆寫自動審核結果',
  'review.delete': '刪除評論',
  'refund.approve': '退款核准',
  'refund.reject': '退款駁回',
  'user.role': '變更使用者權限',
  'user.update': '編輯使用者資料',
  'content.update': '更新網站內容',
  'channel.resolve': '標記渠道預警為已處理',
  'risk.save': '儲存房源檢測結果',
  'setting.update': '變更系統參數',
  'report.export': '匯出報表',
  'review.reply': '回覆評論',
  'message.send': '回覆會員訊息'
});

export const actionLabel = (action) => ACTION_LABELS[action] ?? action;

/**
 * 絕不寫入日誌的欄位。
 * FR-118：日誌不得記錄密碼、金鑰或真實個資。
 */
const REDACTED_KEYS = [
  'password', 'passwd', 'pwd', 'token', 'accessToken', 'refreshToken',
  'apiKey', 'anonKey', 'serviceRoleKey', 'secret', 'imageDataUrl', 'imageBlob'
];

function sanitize(value, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (REDACTED_KEYS.some((r) => k.toLowerCase().includes(r.toLowerCase()))) continue;
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.slice(0, 300);
  return value;
}

/** 只記錄真正有變動的欄位，讓日誌摘要維持可讀 */
export function diffSummary(before = {}, after = {}) {
  const summary = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const from = before[key];
    const to = after[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    summary[key] = { from: sanitize(from), to: sanitize(to) };
  }
  return summary;
}

/**
 * 執行一項後台變更並記錄日誌。
 *
 * 日誌寫入失敗時**整個操作視為失敗並向上拋出**——一筆沒有被記錄的變更
 * 比一次失敗的操作更糟（FR-114、SC-026）。
 *
 * @param {{action: string, targetTable: string, targetId?: string, summary?: object}} entry
 * @param {() => Promise<any>} operation
 */
export async function withAudit(entry, operation) {
  const result = await operation();
  await appendAdminLog({
    action: entry.action,
    targetTable: entry.targetTable,
    targetId: entry.targetId ?? result?.id ?? null,
    summary: sanitize(entry.summary ?? {})
  });
  return result;
}

/** 不需要包裝既有操作時，直接記一筆 */
export async function logAction(entry) {
  return appendAdminLog({
    action: entry.action,
    targetTable: entry.targetTable,
    targetId: entry.targetId ?? null,
    summary: sanitize(entry.summary ?? {})
  });
}
