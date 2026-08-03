/**
 * 示範模式的持久化層。
 *
 * 集合以 `sunny.<name>` 為鍵存於 localStorage。
 * 只有 src/data/adapters/local.js 會使用本模組——其他檔案一律走 repository
 * （憲章原則 III）。
 */

import { readCollection, writeCollection, clearAll, isStorageAvailable } from '../utils/storage.js';
import { buildSeedData, SEED_VERSION } from './seed.js';

const COLLECTIONS = [
  'users', 'rooms', 'orders', 'reviews', 'refunds', 'favorites',
  'riskChecks', 'channelPrices', 'adminLogs', 'settings', 'siteContent', 'messages'
];

const VERSION_KEY = 'seedVersion';

/**
 * 初次載入或版本更新時寫入種子資料（FR-072）。
 * 使用者清除瀏覽器資料後重新進入，也會走到這裡自動重建，而非顯示空站。
 */
export function ensureSeeded() {
  if (!isStorageAvailable()) {
    // 無痕模式等情境：改以記憶體內的資料運作，重新整理後歸零。
    // 這不是靜默失敗——app.js 會據此顯示提醒。
    return { seeded: false, storageAvailable: false };
  }

  const version = readCollection(VERSION_KEY, null);
  if (version === SEED_VERSION) return { seeded: false, storageAvailable: true };

  const data = buildSeedData();
  for (const name of COLLECTIONS) {
    writeCollection(name, data[name]);
  }
  writeCollection(VERSION_KEY, SEED_VERSION);
  return { seeded: true, storageAvailable: true };
}

/** 還原為初始種子資料（FR-073） */
export function resetToSeed() {
  clearAll();
  return ensureSeeded();
}

export function read(name) {
  const fallback = name === 'settings' || name === 'siteContent' ? {} : [];
  return readCollection(name, fallback);
}

export function write(name, value) {
  writeCollection(name, value);
}

/** 讀改寫的便利包裝，確保每次變更都會被持久化 */
export function mutate(name, mutator) {
  const current = read(name);
  const next = mutator(current);
  write(name, next);
  return next;
}

export { COLLECTIONS };
