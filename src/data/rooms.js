/** 房源資料模組。所有存取都委派給 repository（憲章原則 III）。 */

import * as repo from './repository.js';

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
