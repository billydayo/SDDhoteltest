/**
 * 集中式狀態。
 *
 * 存放跨頁面共用的短暫狀態：目前的使用者、搜尋條件、收藏集合、系統參數。
 * 這裡**不**是資料的家——資料的家是 repository。本模組只快取畫面需要的東西，
 * 並在變更時通知訂閱者。
 */

const state = {
  session: null,          // { user: profile } 或 null
  profile: null,
  mode: 'demo',
  settings: {},
  favoriteRoomIds: new Set(),
  // 搜尋條件跨頁保留（FR：切換頁籤或進出詳情頁不得清除其他篩選條件）
  searchFilters: {
    keyword: '',
    type: '',
    checkIn: '',
    checkOut: '',
    guests: '',
    priceCap: '',
    amenities: [],
    features: [],
    sort: ''
  }
};

const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(reason) {
  listeners.forEach((fn) => {
    try { fn(state, reason); } catch { /* 單一訂閱者出錯不影響其他訂閱者 */ }
  });
}

// ---------------------------------------------------------------------------
// 工作階段
// ---------------------------------------------------------------------------

export function setSession(session) {
  state.session = session;
  state.profile = session?.user ?? null;
  if (!session) state.favoriteRoomIds = new Set();
  notify('session');
}

export const currentProfile = () => state.profile;
export const isSignedIn = () => Boolean(state.profile);
export const isAdmin = () => state.profile?.role === 'admin';

/** 未登入 = 訪客。角色只有三種：訪客、會員、管理員（FR-008）。 */
export function currentRole() {
  if (!state.profile) return 'guest';
  return state.profile.role === 'admin' ? 'admin' : 'member';
}

// ---------------------------------------------------------------------------
// 模式與設定
// ---------------------------------------------------------------------------

export function setMode(mode) {
  state.mode = mode;
  notify('mode');
}

export function setSettings(settings) {
  state.settings = settings ?? {};
  notify('settings');
}

// ---------------------------------------------------------------------------
// 搜尋條件
// ---------------------------------------------------------------------------

export function setSearchFilters(patch) {
  state.searchFilters = { ...state.searchFilters, ...patch };
  notify('filters');
  return state.searchFilters;
}

export function clearSearchFilters() {
  state.searchFilters = {
    keyword: '', type: '', checkIn: '', checkOut: '',
    guests: '', priceCap: '', amenities: [], features: [], sort: ''
  };
  notify('filters');
  return state.searchFilters;
}

export const getSearchFilters = () => ({ ...state.searchFilters });

/** 目前生效的條件數量，供「已套用 N 項篩選」與清除按鈕使用 */
export function activeFilterCount() {
  const f = state.searchFilters;
  let n = 0;
  if (f.keyword) n += 1;
  if (f.type) n += 1;
  if (f.checkIn && f.checkOut) n += 1;
  if (f.guests) n += 1;
  if (f.priceCap) n += 1;
  n += f.amenities.length + f.features.length;
  return n;
}

// ---------------------------------------------------------------------------
// 收藏（快取，資料仍以 repository 為準）
// ---------------------------------------------------------------------------

export function setFavoriteRoomIds(ids) {
  state.favoriteRoomIds = new Set(ids);
  notify('favorites');
}

export function markFavorite(roomId, favorited) {
  if (favorited) state.favoriteRoomIds.add(roomId);
  else state.favoriteRoomIds.delete(roomId);
  notify('favorites');
}

export const isFavorited = (roomId) => state.favoriteRoomIds.has(roomId);
