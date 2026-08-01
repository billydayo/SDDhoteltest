/** 房源資料模組。所有存取都委派給 repository（憲章原則 III）。 */

import * as repo from './repository.js';

export const uploadRoomPhoto = (roomId, blob) => repo.uploadRoomPhoto(roomId, blob);
export const deleteRoomPhoto = (ref) => repo.deleteRoomPhoto(ref);

export const listRooms = (filters) => repo.getRooms(filters);
export const getRoom = (id) => repo.getRoomById(id);
export const createRoom = (input) => repo.createRoom(input);
export const updateRoom = (id, patch) => repo.updateRoom(id, patch);
export const deleteRoom = (id) => repo.deleteRoom(id);
export const getFutureOrdersForRoom = (roomId) => repo.getFutureOrdersForRoom(roomId);

/** 房態變更是常見操作，獨立出來讓呼叫端讀起來更清楚 */
export const setRoomStatus = (id, status) => repo.updateRoom(id, { status });

/**
 * 平均評分的顯示值。null 代表尚無評分，必須顯示為文字而非 0 分（FR-047）。
 */
export function formatRating(averageRating) {
  return averageRating === null || averageRating === undefined
    ? { text: '尚無評分', hasRating: false }
    : { text: averageRating.toFixed(1), hasRating: true };
}

// ---------------------------------------------------------------------------
// 房源圖片
//
// rooms.images 是字串陣列，允許三種來源混用：
//   ・`https://…`     外部網址
//   ・`assets/…`      專案內的相對路徑（種子資料用）
//   ・`storage:<path>` 由後台上傳、存於 room-photos bucket
//   ・`data:image/…`  示範模式的上傳結果（沒有雲端可用）
//
// 用 `storage:` 前綴而非直接存公開網址，是為了刪除時能還原出物件路徑。
// 存公開網址就得反解析 URL 才知道要刪哪個檔，那很容易在 Supabase 改版時壞掉。
// ---------------------------------------------------------------------------

export const STORAGE_PREFIX = 'storage:';

export const isStorageRef = (value) => typeof value === 'string' && value.startsWith(STORAGE_PREFIX);

/** `storage:rooms/xxx.jpg` → `rooms/xxx.jpg` */
export const toStoragePath = (value) => (isStorageRef(value) ? value.slice(STORAGE_PREFIX.length) : null);

/** 把 images 陣列中的任一項轉成可直接放進 <img src> 的字串 */
export const resolveImageUrl = (value) => repo.resolveRoomPhotoUrl(value);

/**
 * 沒有照片、或照片載入失敗時的本地示意圖。
 * 種子資料的照片是外部網址，離線時一定載不到，因此後備必須留在專案內。
 */
export const FALLBACK_IMAGE = 'assets/rooms/room-fallback.svg';

/** 第一張圖，沒有圖片時回傳後備示意圖 */
export function primaryImage(room) {
  const first = room?.images?.[0];
  if (first) {
    const url = resolveImageUrl(first);
    if (url) return url;
  }
  return FALLBACK_IMAGE;
}
