/**
 * 執行期的設施與房型特色清單（FR-010a）。
 *
 * 管理員可以在後台增刪，因此這兩份清單不是常數，必須在畫面繪製前取得。
 * 存在 system_settings 而非另開資料表：內容就是兩個字串陣列，
 * 為此新增一張表要連帶寫 RLS、grant 與遷移，維護成本遠高於它承載的資訊量。
 * 而 system_settings 的 RLS 已經是「所有人可讀、僅管理員可寫」——
 * 前台的訪客也需要讀得到，否則篩選器會是空的。
 *
 * 快取一份在模組內：首頁每次重繪都會用到，但它幾乎不變動。
 * 後台改完之後呼叫 invalidate() 讓下一次讀取重新取得。
 */

import * as repo from './repository.js';
import { DEFAULT_AMENITIES, DEFAULT_ROOM_FEATURES } from './vocabulary.js';

/** system_settings 的 key。與 supabase/schema.sql 的預設列一致。 */
const VOCABULARY_KEYS = Object.freeze({
  amenities: 'room_amenities',
  features: 'room_features'
});

/** 單一詞彙的長度上限。過長的標籤會把篩選器的 chip 撐爆版面。 */
export const MAX_TERM_LENGTH = 20;

/** 單一清單的項目上限。篩選器是一次全部列出的，太多就沒人掃得完。 */
export const MAX_TERMS = 40;

let cache = null;

/** 把任意輸入正規化成乾淨的字串陣列：去空白、去空值、去重複，並保留順序 */
export function normalizeTerms(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const out = [];
  value.forEach((item) => {
    const term = String(item ?? '').trim();
    if (!term || seen.has(term)) return;
    seen.add(term);
    out.push(term);
  });
  return out;
}

/**
 * 目前的設施與房型特色。
 *
 * 讀取失敗或尚未設定時退回預設值——篩選器空白會讓使用者以為功能壞了，
 * 而預設值至少讓畫面是可用的。
 *
 * @returns {Promise<{ amenities: string[], features: string[] }>}
 */
export async function getRoomVocabulary() {
  if (cache) return cache;

  let settings = {};
  try {
    settings = await repo.getSystemSettings();
  } catch {
    settings = {};
  }

  const pick = (key, fallback) => {
    const list = normalizeTerms(settings[key]);
    return list?.length ? list : [...fallback];
  };

  cache = {
    amenities: pick(VOCABULARY_KEYS.amenities, DEFAULT_AMENITIES),
    features: pick(VOCABULARY_KEYS.features, DEFAULT_ROOM_FEATURES)
  };
  return cache;
}

/** 後台改動後呼叫，下次讀取會重新取得 */
export const invalidateRoomVocabulary = () => { cache = null; };

/**
 * 寫入新的清單。
 *
 * @param {'amenities'|'features'} kind
 * @param {string[]} terms
 * @returns {Promise<string[]>} 實際存入的清單
 */
export async function saveRoomVocabulary(kind, terms) {
  const key = VOCABULARY_KEYS[kind];
  if (!key) throw new Error(`未知的詞彙種類：${kind}`);

  const list = normalizeTerms(terms) ?? [];
  await repo.updateSystemSetting(key, list);
  invalidateRoomVocabulary();
  return list;
}

/**
 * 新增前的檢查。回傳 null 代表可以加入。
 *
 * 分開成一支而不是塞進 save()：使用者一邊打字就要看到「這個已經有了」，
 * 不該等到按下儲存、送出一趟網路請求之後才知道。
 */
export function validateTerm(term, existing) {
  const value = String(term ?? '').trim();
  if (!value) return '請輸入名稱。';
  if (value.length > MAX_TERM_LENGTH) return `名稱請控制在 ${MAX_TERM_LENGTH} 字以內。`;
  if (existing.includes(value)) return '這個項目已經在清單中。';
  if (existing.length >= MAX_TERMS) return `最多只能有 ${MAX_TERMS} 個項目。`;
  return null;
}
