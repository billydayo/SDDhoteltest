/**
 * 我的收藏（US10 / T097）。
 *
 * FR-092：依收藏時間由新到舊排序。
 * FR-095：已下架或被刪除的房源不得造成錯誤或空白卡片。
 */

import { render, renderLoading, renderError, createPageHeader, createEmptyState, toast, toastError } from '../app.js';
import { listFavorites, removeFavorite } from '../data/favorites.js';
import { getRoom } from '../data/rooms.js';
import { createRoomCard } from '../components/room-card.js';
import { actionButton } from '../components/admin-ui.js';
import { toUserMessage } from '../utils/errors.js';
import * as store from '../state/store.js';

export async function renderFavorites() {
  renderLoading('正在載入收藏…');

  try {
    const favorites = await listFavorites();

    // 房源可能已被管理員刪除：查不到就當成已下架，而不是讓整頁掛掉
    const entries = await Promise.all(
      favorites.map(async (fav) => ({
        favorite: fav,
        room: await getRoom(fav.roomId).catch(() => null)
      }))
    );

    store.setFavoriteRoomIds(favorites.map((f) => f.roomId));

    if (!entries.length) {
      render([
        createPageHeader('我的收藏'),
        createEmptyState({
          title: '還沒有收藏任何房源',
          body: '在房源卡片或詳情頁點選星號，就會加入這裡。',
          actionLabel: '前往瀏覽房源',
          actionHref: '#/'
        })
      ]);
      return;
    }

    render([
      createPageHeader('我的收藏', `共 ${entries.length} 間，依收藏時間由新到舊排列。`),
      buildList(entries)
    ]);
  } catch (err) {
    renderError(err, { retry: renderFavorites });
  }
}

function buildList(entries) {
  const ul = document.createElement('ul');
  ul.className = 'room-list';

  entries.forEach(({ favorite, room }) => {
    ul.append(room ? buildAvailableItem(room) : buildRemovedItem(favorite));
  });

  return ul;
}

function buildAvailableItem(room) {
  // 收藏頁用「取消收藏」取代星號，動作更直白
  const li = createRoomCard(room, { hideFavorite: true });

  const remove = actionButton('取消收藏', async () => {
    try {
      await removeFavorite(room.id);
      store.markFavorite(room.id, false);
      toast('已從收藏移除。');
      renderFavorites();
    } catch (err) {
      toastError(err);
    }
  });

  li.querySelector('.room-card__footer')?.append(remove);
  return li;
}

/** FR-095：房源已下架時明確標示，不顯示破損卡片 */
function buildRemovedItem(favorite) {
  const li = document.createElement('li');
  li.className = 'card';

  const title = document.createElement('h3');
  title.textContent = '此房源已下架';

  const note = document.createElement('p');
  note.style.color = 'var(--c-text-muted)';
  note.textContent = '這間房源已被移除，無法再預訂。';

  const remove = actionButton('從收藏移除', async () => {
    try {
      await removeFavorite(favorite.roomId);
      toast('已從收藏移除。');
      renderFavorites();
    } catch (err) {
      toastError(err);
    }
  });

  li.append(title, note, remove);
  return li;
}
