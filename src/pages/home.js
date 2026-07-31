/**
 * 首頁：主視覺、搜尋列、房型頁籤、房源列表（US1 / T034、T037、T039）。
 *
 * 搜尋條件存在 store，因此進出詳情頁再回來時條件仍在（T040）。
 */

import { render, renderLoading, renderError, createEmptyState } from '../app.js';
import { getSiteContent } from '../data/site-content.js';
import { searchRooms, buildNoResultHints } from '../services/search.js';
import { createRoomCard } from '../components/room-card.js';
import { createFilterBar, createTypeTabs, createActiveFilters, removalPatch }
  from '../components/filter-bar.js';
import * as store from '../state/store.js';

let cachedContent = null;

export async function renderHome() {
  renderLoading('正在載入房源…');
  try {
    if (!cachedContent) cachedContent = await getSiteContent();
    const result = await searchRooms();
    render(buildPage(cachedContent, result));
  } catch (err) {
    renderError(err, { retry: renderHome });
  }
}

/** 條件變更後重新查詢。patch 為 null 代表已被清空。 */
async function applyFilters(patch) {
  if (patch) store.setSearchFilters(patch);
  await renderHome();
}

function buildPage(content, result) {
  const frag = document.createDocumentFragment();
  const filters = result.filters;

  frag.append(buildHero(content));
  frag.append(createFilterBar(applyFilters));

  const active = createActiveFilters(filters, (key) => {
    applyFilters(removalPatch(key, filters));
  });
  if (active) frag.append(active);

  // 頁籤只改房型，其他條件維持有效（FR-012）
  frag.append(createTypeTabs(filters.type, (type) => applyFilters({ type })));

  if (result.error) {
    frag.append(createEmptyState({
      title: '搜尋條件有誤',
      body: result.error
    }));
    return frag;
  }

  frag.append(buildResultHeading(result));

  if (!result.rooms.length) {
    frag.append(buildNoResult(filters));
    return frag;
  }

  frag.append(buildRoomList(result));
  return frag;
}

function buildHero(content) {
  const hero = document.createElement('section');
  hero.className = 'card';
  hero.style.marginBottom = 'var(--sp-5)';

  if (content?.heroImage) {
    const img = document.createElement('img');
    img.src = content.heroImage;
    img.alt = `${content.heroTitle ?? 'Sunny 訂房平台'} 主視覺`;
    img.style.borderRadius = 'var(--radius)';
    img.style.marginBottom = 'var(--sp-4)';
    hero.append(img);
  }

  const h1 = document.createElement('h1');
  h1.textContent = content?.heroTitle ?? 'Sunny 訂房平台';
  const p = document.createElement('p');
  p.textContent = content?.heroSubtitle ?? '舒適住宿，安心入住';
  p.style.color = 'var(--c-text-muted)';
  p.style.marginBottom = '0';

  hero.append(h1, p);
  return hero;
}

function buildResultHeading(result) {
  const h2 = document.createElement('h2');
  h2.textContent = `共 ${result.rooms.length} 間房源`;

  if (result.dateFiltered) {
    const note = document.createElement('span');
    note.className = 'tag tag--info';
    note.style.marginInlineStart = 'var(--sp-2)';
    note.textContent = '已排除所選日期不可訂的房源';
    h2.append(note);
  }
  return h2;
}

/** FR-018：無結果時顯示有意義的空狀態與調整建議，而非空白畫面 */
function buildNoResult(filters) {
  const hints = buildNoResultHints(filters);

  const box = createEmptyState({
    title: '查無符合條件的房源',
    body: `可以試著：${hints.join('、')}。`
  });

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn btn--primary';
  clear.textContent = '清除全部條件';
  clear.addEventListener('click', () => {
    store.clearSearchFilters();
    renderHome();
  });
  box.append(clear);

  return box;
}

function buildRoomList(result) {
  const ul = document.createElement('ul');
  ul.className = 'room-list';

  const context = result.dateFiltered
    ? { checkIn: result.filters.checkIn, checkOut: result.filters.checkOut }
    : {};

  result.rooms.forEach((room) => ul.append(createRoomCard(room, context)));
  return ul;
}

/** 網站內容被後台改過後需要重新載入（US8 會用到） */
export function invalidateSiteContent() {
  cachedContent = null;
}
