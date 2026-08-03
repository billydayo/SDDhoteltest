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

// ---------------------------------------------------------------------------
// 逐日房態
//
// rooms.status 只保存「不分日期」的營運狀態：空房或整理中。
// 「已預訂」不寫進這個欄位——它本質上綁定日期，8/1 有訂單不代表 8/2 也有。
// 寫進欄位就得在退房後再改回來，任何一次漏改都會讓房間永遠賣不出去。
// 因此已預訂一律由訂單即時推導：有訂單就是已預訂，訂單取消就自動不是。
// ---------------------------------------------------------------------------

/** 某段日期內被有效訂單佔用的房源 id 集合 */
export const getOccupiedRoomIds = (checkIn, checkOut) => repo.getOccupiedRoomIds(checkIn, checkOut);

/**
 * 房源在指定日期下的實際房態。
 *
 * 整理中優先於已預訂：房間在整修，有沒有訂單都不該顯示成單純的已預訂。
 *
 * @param {object} room
 * @param {Set<string>|null} occupied 該日期的已預訂房源；null 代表未指定日期
 * @returns {'available'|'booked'|'maintenance'}
 */
export function effectiveRoomStatus(room, occupied) {
  if (room.status === 'maintenance') return 'maintenance';
  if (occupied?.has(room.id)) return 'booked';
  return 'available';
}

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
//
// 前綴的解析全部收在 adapters/supabase.js——只有那裡需要把前綴換回物件路徑。
// 本模組曾經另外放過一份 STORAGE_PREFIX／isStorageRef／toStoragePath，
// 但從來沒有人呼叫，兩份定義各自演化只會讓「哪一份才算數」變成問題。
// ---------------------------------------------------------------------------

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
