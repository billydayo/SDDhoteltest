/**
 * 房源品質檢測資料模組。
 *
 * ⚠️ 本模組只服務**後台的房源檢測**。前台「安全檢測」的照片絕不經過這裡，
 *    也絕不寫入任何儲存（FR-086、憲章原則 VI）。
 *    前台頁面 src/pages/risk-check.js 不得 import 本模組。
 */

import * as repo from './repository.js';

export const listRiskChecks = (filters) => repo.getRiskChecks(filters);
export const getLatestRiskCheck = (roomId) => repo.getLatestRiskCheck(roomId);
export const saveRoomRiskCheck = (payload) => repo.saveRoomRiskCheck(payload);
