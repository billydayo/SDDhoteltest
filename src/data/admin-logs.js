/**
 * 操作日誌資料模組。
 *
 * 僅可新增。本模組刻意不提供 update 或 delete——任何角色（含管理員）
 * 都不得竄改稽核紀錄（FR-116）。資料庫端也沒有對應的 RLS 政策，
 * 且已 REVOKE UPDATE/DELETE，因此即使繞過前端也改不了。
 */

import * as repo from './repository.js';

export const listAdminLogs = (filters) => repo.getAdminLogs(filters);
export const appendAdminLog = (entry) => repo.appendAdminLog(entry);
