/**
 * 收藏星號（US10 / T095、T098）。
 *
 * FR-093：未登入者點選時導向登入頁，登入後回到原房源並完成收藏。
 * 為此在導向前把「待完成的收藏」記在 router 的 pending redirect 裡。
 */

import { addFavorite, removeFavorite } from '../data/favorites.js';
import { toUserMessage } from '../utils/errors.js';
import { toast, toastError } from '../app.js';
import * as store from '../state/store.js';
import * as router from '../router.js';

/**
 * @param {object} room
 * @param {{ onChange?: (favorited: boolean) => void }} [options]
 * @returns {HTMLButtonElement}
 */
export function createFavoriteButton(room, options = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--ghost';

  const paint = () => {
    const on = store.isFavorited(room.id);
    btn.textContent = on ? '★ 已收藏' : '☆ 收藏';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? `取消收藏 ${room.name}` : `收藏 ${room.name}`);
  };
  paint();

  btn.addEventListener('click', async () => {
    if (!store.isSignedIn()) {
      // 登入後回到這個房源，使用者不必自己找回來
      router.setPendingRedirect(`#/rooms/${room.id}`);
      toast('請先登入後再收藏房源。');
      router.navigate('#/login');
      return;
    }

    const next = !store.isFavorited(room.id);
    btn.disabled = true;

    // 樂觀更新：先改畫面，失敗再改回來
    store.markFavorite(room.id, next);
    paint();

    try {
      if (next) await addFavorite(room.id);
      else await removeFavorite(room.id);
      options.onChange?.(next);
    } catch (err) {
      store.markFavorite(room.id, !next);
      paint();
      toastError(err);
    } finally {
      btn.disabled = false;
    }
  });

  return btn;
}
