/** 收藏資料模組。 */

import * as repo from './repository.js';

export const listFavorites = () => repo.getFavorites();
export const addFavorite = (roomId) => repo.addFavorite(roomId);
export const removeFavorite = (roomId) => repo.removeFavorite(roomId);

export async function toggleFavorite(roomId, isFavorited) {
  if (isFavorited) {
    await removeFavorite(roomId);
    return false;
  }
  await addFavorite(roomId);
  return true;
}

/** 收藏的房源 ID 集合，供列表快速標記星號狀態 */
export async function favoriteRoomIds() {
  const favs = await listFavorites();
  return new Set(favs.map((f) => f.roomId));
}
