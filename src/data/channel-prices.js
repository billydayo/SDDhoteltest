/**
 * 渠道價格資料模組。
 *
 * ⚠️ 這裡的價格是系統內的**示範資料**，不是從 Agoda、Booking 或任何平台
 *    擷取來的。本專案不實作爬蟲，也不呼叫任何 OTA 的 API（FR-109）。
 *    畫面上必須標示為模擬（FR-110）。
 */

import * as repo from './repository.js';

export const listChannelPrices = (filters) => repo.getChannelPrices(filters);
export const resolveAlert = (id) => repo.resolveChannelAlert(id);
export const listUnresolvedAlerts = () => repo.getChannelPrices({ unresolvedOnly: true });
