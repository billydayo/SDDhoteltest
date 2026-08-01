/**
 * 首頁：主視覺、搜尋列、房型頁籤、房源列表（US1 / T034、T037、T039）。
 *
 * 搜尋條件存在 store，因此進出詳情頁再回來時條件仍在（T040）。
 */

import { render, renderLoading, renderError, createEmptyState, createErrorState }
  from '../app.js';
import { getSiteContent } from '../data/site-content.js';
import { resolveImageUrl } from '../data/rooms.js';
import { getRoomVocabulary } from '../data/room-vocabulary.js';
import { searchRooms, buildNoResultHints } from '../services/search.js';
import { createRoomCard } from '../components/room-card.js';
import { createFilterBar, createTypeTabs, createActiveFilters, removalPatch }
  from '../components/filter-bar.js';
import * as store from '../state/store.js';

let cachedContent = null;

export async function renderHome() {
  renderLoading('正在載入房源…');
  try {
    // 網站內容拿不到就沒有主視覺可畫，那是整頁級的失敗，仍走 renderError。
    if (!cachedContent) cachedContent = await getSiteContent();
  } catch (err) {
    renderError(err, { retry: renderHome });
    return;
  }

  /*
   * 查詢失敗**不**取代整頁。
   *
   * 原本是整個 #main 換成錯誤畫面，連搜尋列一起消失——使用者填了三個必填欄位、
   * 勾了幾項設施，只因為關鍵字裡有個逗號就全部歸零，還得從頭再填一次。
   * 改成只讓結果區顯示錯誤，搜尋列與目前的條件都留在畫面上，
   * 使用者可以直接改掉那個字元再按一次搜尋。
   */
  // 設施／特色可由後台增刪，因此繪製前取一次。
  // room-vocabulary 內有快取，正常情況下不會每次重繪都打一次資料庫。
  const vocabulary = await getRoomVocabulary();

  let result;
  try {
    result = await searchRooms();
  } catch (err) {
    result = { rooms: [], error: null, failure: err, filters: store.getSearchFilters() };
  }
  render(buildPage(cachedContent, result, vocabulary));
}

/** 條件變更後重新查詢。patch 為 null 代表已被清空。 */
async function applyFilters(patch) {
  if (patch) store.setSearchFilters(patch);
  await renderHome();
}

function buildPage(content, result, vocabulary) {
  const frag = document.createDocumentFragment();
  const filters = result.filters;

  frag.append(buildHero(content));
  frag.append(createFilterBar(applyFilters, vocabulary));

  const active = createActiveFilters(filters, (key) => {
    applyFilters(removalPatch(key, filters));
  });
  if (active) frag.append(active);

  // 頁籤只改房型，其他條件維持有效（FR-012）
  frag.append(createTypeTabs(filters.type, (type) => applyFilters({ type })));

  // 條件本身寫錯：使用者改一下就好，不需要重試按鈕
  if (result.error) {
    frag.append(createEmptyState({
      title: '搜尋條件有誤',
      body: result.error
    }));
    return frag;
  }

  // 查詢真的失敗：可能是暫時性的，給重試入口。搜尋列已在上方，條件不會消失。
  if (result.failure) {
    frag.append(createErrorState(result.failure, { retry: renderHome }));
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

/**
 * 主視覺。
 *
 * 圖片以 object-fit: cover 鋪滿一個高度受限的區塊，而不是以原始尺寸流動排版——
 * 後者會讓 1600×600 的圖在寬螢幕上撐出近 500px 高，把搜尋列整個推到摺線以下。
 * 訂房網站最重要的元件是搜尋列，主視覺不該吃掉整個第一屏。
 *
 * 文字壓在圖片上，因此需要漸層遮罩保住對比（見 styles/layout.css 的 .hero::after）。
 */
function buildHero(content) {
  const hero = document.createElement('section');
  hero.className = 'hero';

  // 後台可以上傳主視覺，存起來的是 storage:<path>，要先轉成真正的網址
  const heroSrc = content?.heroImage ? resolveImageUrl(content.heroImage) : null;

  if (heroSrc) {
    const img = document.createElement('img');
    img.className = 'hero__image';
    img.src = heroSrc;
    img.alt = `${content.heroTitle ?? 'Sunny 訂房平台'} 主視覺`;
    // 圖片載不到時退回純色版面，不要留一塊破圖擋在標題後面
    img.addEventListener('error', () => {
      img.remove();
      hero.classList.add('hero--plain');
    }, { once: true });
    hero.append(img);
  } else {
    hero.classList.add('hero--plain');
  }

  const inner = document.createElement('div');
  inner.className = 'hero__inner';

  const h1 = document.createElement('h1');
  h1.textContent = content?.heroTitle ?? 'Sunny 訂房平台';

  const p = document.createElement('p');
  p.className = 'hero__lede';
  p.textContent = content?.heroSubtitle ?? '舒適住宿，安心入住';

  inner.append(h1, p);
  hero.append(inner);
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
