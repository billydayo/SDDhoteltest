/**
 * 渠道比價與控價（US11 / T101、T104）。
 *
 * ⚠️ 模擬功能。價格全部來自 `channel_prices` 表的種子資料。
 *    本模組 MUST NOT 爬取任何網站，MUST NOT 呼叫任何 OTA 的 API（FR-109）。
 *
 *    企劃書寫的是「定時爬蟲 / API 對接」。做不到的原因是硬限制而非偷懶：
 *    瀏覽器的 CORS 會擋掉跨網域抓取，伺服器端排程則需要 Edge Function
 *    （違反憲章原則 II），而自動爬取 OTA 平台通常也違反對方的服務條款。
 *    決策與替代方案評估記錄於 research.md。
 */

import { listChannelPrices, resolveAlert } from '../data/channel-prices.js';
import { formatTWD } from '../utils/money.js';
import { formatDateTime } from '../utils/dates.js';

/**
 * 把價格資料與房源合併成可直接呈現的比價列。
 *
 * @param {object[]} prices
 * @param {object[]} rooms
 * @returns {Array<{id, roomId, roomName, channel, websitePrice, channelPrice,
 *                  gap, gapPercent, isUndercut, capturedAt, resolved}>}
 */
export function buildComparison(prices, rooms) {
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  return prices
    .map((price) => {
      const room = roomById.get(price.roomId);
      if (!room) return null;

      const websitePrice = room.nightlyPrice;
      const gap = websitePrice - price.channelPrice;

      return {
        id: price.id,
        roomId: price.roomId,
        roomName: room.name,
        channel: price.channel,
        websitePrice,
        channelPrice: price.channelPrice,
        gap,
        // 官網價為分母：外部售價比官網低多少百分比
        gapPercent: websitePrice ? Math.round((gap / websitePrice) * 1000) / 10 : 0,
        isUndercut: price.channelPrice < websitePrice,
        capturedAt: price.capturedAt,
        resolved: price.resolved
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.gap - a.gap);
}

export async function loadComparison(rooms, { unresolvedOnly = false } = {}) {
  const prices = await listChannelPrices({ unresolvedOnly });
  return buildComparison(prices, rooms);
}

/** 尚未處理的賤賣預警（FR-111） */
export function undercutAlerts(comparison) {
  return comparison.filter((row) => row.isUndercut && !row.resolved);
}

export const markResolved = (id) => resolveAlert(id);

/**
 * 產生向平台申訴的郵件範本（FR-112）。
 *
 * 只組裝文字。系統不會、也不能代為寄送——本專案沒有任何郵件發送能力，
 * 這一點必須在畫面上說清楚，否則管理員會以為信已經寄出去了。
 */
export function buildComplaintEmail(row) {
  const subject = `【價格異常通知】${row.roomName} 於 ${row.channel} 之售價低於官方網站`;

  const body = [
    `${row.channel} 客戶服務團隊 您好：`,
    '',
    '我們是 Sunny 訂房平台。近期發現貴平台上架之本飯店房型售價低於本站官方售價，',
    '此情形可能違反雙方合約中的價格對等條款，說明如下：',
    '',
    `房源名稱：${row.roomName}`,
    `平台名稱：${row.channel}`,
    `官方網站售價：${formatTWD(row.websitePrice)}`,
    `貴平台售價：${formatTWD(row.channelPrice)}`,
    `價差：${formatTWD(row.gap)}（低於官網 ${row.gapPercent}%）`,
    `價格擷取時間：${formatDateTime(row.capturedAt)}`,
    '',
    '煩請協助查明售價設定並回覆處理進度。若係促銷活動所致，',
    '亦請提供活動名稱與期間，以利我們同步調整官方售價。',
    '',
    '順頌　商祺',
    '',
    'Sunny 訂房平台 營運團隊',
    '',
    '---',
    '本信件由 Sunny 訂房平台後台產生。此為展示用專案，內容中的價格為示範資料。'
  ].join('\n');

  return { subject, body };
}
