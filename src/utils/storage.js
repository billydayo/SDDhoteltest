/**
 * localStorage 存取封裝。
 *
 * 憲章「儲存容量」與 FR-074：寫入失敗（容量已滿）必須被攔截並向使用者說明，
 * 不得導致資料靜默遺失。因此本模組永遠不會吞掉寫入錯誤——它會丟出帶有
 * 業務語意的 AppError，由呼叫端轉為畫面訊息。
 */

import { AppError } from './errors.js';

const PREFIX = 'sunny.';

function key(name) {
  return `${PREFIX}${name}`;
}

/** localStorage 是否可用（無痕模式或政策封鎖時可能不可用） */
export function isStorageAvailable() {
  try {
    const probe = `${PREFIX}__probe__`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function readCollection(name, fallback = []) {
  try {
    const raw = window.localStorage.getItem(key(name));
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    // 資料毀損時回退到預設值而非讓整個應用程式當掉。
    // 種子資料會在下一次啟動時重建（spec「資料被清除」邊界案例）。
    return fallback;
  }
}

export function writeCollection(name, value) {
  try {
    window.localStorage.setItem(key(name), JSON.stringify(value));
  } catch (err) {
    if (isQuotaError(err)) {
      throw new AppError(
        'STORAGE_FULL',
        '瀏覽器儲存空間已滿，資料未能保存。請清理瀏覽器資料後再試一次。',
        { cause: err }
      );
    }
    throw new AppError(
      'STORAGE_UNAVAILABLE',
      '無法寫入瀏覽器儲存空間，資料未能保存。',
      { cause: err }
    );
  }
}

export function removeCollection(name) {
  try {
    window.localStorage.removeItem(key(name));
  } catch {
    // 移除失敗不影響使用者流程，忽略
  }
}

/** 清除本應用程式的所有資料（供「還原為初始種子資料」使用） */
export function clearAll() {
  try {
    const doomed = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // 同上
  }
}

function isQuotaError(err) {
  if (!err) return false;
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014
  );
}
