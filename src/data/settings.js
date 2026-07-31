/**
 * 系統參數資料模組。
 *
 * 憲章「系統參數」條：可調整的營運參數必須集中於單一設定來源，
 * 不得硬編碼散落於程式碼中。範圍檢查同時在這裡與資料庫 CHECK 約束執行。
 */

import * as repo from './repository.js';
import { appError } from '../utils/errors.js';

/** 參數定義。新增參數時同步更新 supabase/schema.sql 的 settings_valid_range。 */
export const SETTING_SPECS = Object.freeze({
  pending_payment_minutes: {
    label: '未付款訂單保留時間（分鐘）',
    min: 5,
    max: 1440,
    fallback: 60
  }
});

export const getSettings = () => repo.getSystemSettings();

export async function getPendingPaymentMinutes() {
  const settings = await repo.getSystemSettings();
  const value = Number(settings?.pending_payment_minutes);
  return Number.isFinite(value) ? value : SETTING_SPECS.pending_payment_minutes.fallback;
}

export async function updateSetting(key, rawValue) {
  const spec = SETTING_SPECS[key];
  if (!spec) throw appError('NOT_FOUND', '未知的系統參數。');

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < spec.min || value > spec.max) {
    throw appError(
      'SETTING_OUT_OF_RANGE',
      `${spec.label}需介於 ${spec.min} 至 ${spec.max} 之間。`
    );
  }
  return repo.updateSystemSetting(key, value);
}
