/**
 * Repository facade — 唯一的資料存取入口。
 *
 * 憲章原則 III：頁面與元件一律呼叫這裡，MUST NOT 直接呼叫 Supabase client，
 * MUST NOT 直接讀寫 localStorage。切換模式不需要改動任何頁面程式碼。
 *
 * 這裡也是 expireStaleOrders() 三個呼叫時機的執行點（data-model.md）。
 * 把它放在這一層而非交給個別頁面，是因為漏呼叫的後果很惡劣：
 * 過期訂單會持續佔用房況，使用者看到「已無空房」但實際上房是空的。
 */

import { isSupabaseConfigured, demoMode } from '../lib/supabase.js';
import * as localAdapter from './adapters/local.js';
import { ensureSeeded } from '../state/persistence.js';

/** @type {typeof localAdapter} */
let adapter = localAdapter;
let ready = false;
let bootInfo = { mode: 'demo', storageAvailable: true, seeded: false };

/**
 * 綁定 adapter。啟動時呼叫一次。
 *
 * 示範模式完全不 import supabase adapter——動態 import 讓那段程式碼
 * 連下載都不會發生，這是「零網路請求」的關鍵（憲章原則 II）。
 */
export async function initRepository() {
  if (ready) return bootInfo;

  if (isSupabaseConfigured) {
    adapter = await import('./adapters/supabase.js');
    bootInfo = { mode: 'supabase', storageAvailable: true, seeded: false };
  } else {
    adapter = localAdapter;
    const seedResult = ensureSeeded();
    bootInfo = { mode: 'demo', ...seedResult, reason: demoMode.reason };
  }

  ready = true;
  return bootInfo;
}

export function getMode() {
  return bootInfo.mode;
}

export function isDemoMode() {
  return bootInfo.mode === 'demo';
}

export function getBootInfo() {
  return bootInfo;
}

// ---------------------------------------------------------------------------
// 逾期清理 — 三個強制時機
// ---------------------------------------------------------------------------

let lastExpiry = 0;

/**
 * 節流：同一秒內的連續呼叫只跑一次，避免一個畫面裡多個查詢各打一次資料庫。
 * 節流窗口刻意設得很短，因為過期判定的正確性比省下的請求數重要。
 */
async function sweepExpired() {
  const now = Date.now();
  if (now - lastExpiry < 1000) return;
  lastExpiry = now;
  try {
    await adapter.expireStaleOrders();
  } catch {
    // 清理失敗不應該讓整個查詢失敗；最壞情況是這一輪仍看到過期訂單佔房，
    // 下一次查詢會再試一次。
  }
}

/**
 * 主動清理逾期訂單，回傳實際被取消的筆數。
 *
 * 與上面的 sweepExpired() 不同：這支不節流，且會把結果回報給呼叫端，
 * 讓應用程式知道「剛剛真的有訂單過期」而決定是否更新畫面。
 * 由 main.js 的定期掃描使用（FR-099）。
 */
export async function sweepExpiredOrders() {
  lastExpiry = Date.now();
  try {
    const count = await adapter.expireStaleOrders();
    return Number(count) || 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// 房源
// ---------------------------------------------------------------------------

/** 時機 1：查詢房況之前 */
export async function getRooms(filters = {}) {
  if (filters.checkIn && filters.checkOut) await sweepExpired();
  return adapter.getRooms(filters);
}

export const getRoomById = (id) => adapter.getRoomById(id);
export const getOccupiedRoomIds = (checkIn, checkOut) =>
  adapter.getOccupiedRoomIds(checkIn, checkOut);
export const createRoom = (input) => adapter.createRoom(input);
export const updateRoom = (id, patch) => adapter.updateRoom(id, patch);
export const deleteRoom = (id) => adapter.deleteRoom(id);

/** 房源展示照片。僅管理員可寫入（bucket 政策與 adapter 各擋一層）。 */
export const uploadRoomPhoto = (roomId, blob) => adapter.uploadRoomPhoto(roomId, blob);
export const deleteRoomPhoto = (ref) => adapter.deleteRoomPhoto(ref);

/**
 * 把 images 陣列的一項轉成可顯示的網址。
 * 同步函式——顯示路徑上不該為了組一個字串而等待。
 */
export const resolveRoomPhotoUrl = (value) => adapter.resolveRoomPhotoUrl(value);

export async function getFutureOrdersForRoom(roomId) {
  await sweepExpired();
  return adapter.getFutureOrdersForRoom(roomId);
}

// ---------------------------------------------------------------------------
// 訂單
// ---------------------------------------------------------------------------

/** 時機 2：讀取訂單列表之前 */
export async function getOrders(filters = {}) {
  await sweepExpired();
  return adapter.getOrders(filters);
}

export async function getOrderById(id) {
  await sweepExpired();
  return adapter.getOrderById(id);
}

/** 時機 3：建立訂單之前。漏了這一步，殭屍訂單會誤觸發排除約束。 */
export async function createOrder(input) {
  await sweepExpired();
  return adapter.createOrder(input);
}

export const payOrder = (id) => adapter.payOrder(id);
export const updateOrderStatus = (id, status, extra) => adapter.updateOrderStatus(id, status, extra);

export async function getOrderStats() {
  await sweepExpired();
  return adapter.getOrderStats();
}

// ---------------------------------------------------------------------------
// 評論・退款・收藏
// ---------------------------------------------------------------------------

export const getReviews = (filters) => adapter.getReviews(filters);
export const submitReview = (input) => adapter.submitReview(input);
export const moderateReview = (id, decision, note) => adapter.moderateReview(id, decision, note);
export const deleteReview = (id) => adapter.deleteReview(id);

export const getRefunds = (filters) => adapter.getRefunds(filters);
export const requestRefund = (input) => adapter.requestRefund(input);
export const moderateRefund = (id, decision, note) => adapter.moderateRefund(id, decision, note);

export const getFavorites = () => adapter.getFavorites();
export const addFavorite = (roomId) => adapter.addFavorite(roomId);
export const removeFavorite = (roomId) => adapter.removeFavorite(roomId);

// ---------------------------------------------------------------------------
// 房源品質檢測
// ---------------------------------------------------------------------------

export const getRiskChecks = (filters) => adapter.getRiskChecks(filters);
export const getLatestRiskCheck = (roomId) => adapter.getLatestRiskCheck(roomId);

/**
 * ⚠️ 唯一會儲存圖片的路徑，僅供後台房源檢測使用。
 *    前台安全檢測不得呼叫（FR-086）。
 */
export const saveRoomRiskCheck = (payload) => adapter.saveRoomRiskCheck(payload);

// ---------------------------------------------------------------------------
// 渠道比價（模擬）・操作日誌・系統參數
// ---------------------------------------------------------------------------

export const getChannelPrices = (filters) => adapter.getChannelPrices(filters);
export const resolveChannelAlert = (id) => adapter.resolveChannelAlert(id);

export const getAdminLogs = (filters) => adapter.getAdminLogs(filters);
export const appendAdminLog = (entry) => adapter.appendAdminLog(entry);
// 刻意沒有 updateAdminLog / deleteAdminLog：日誌僅可新增（FR-116）

export const getSystemSettings = () => adapter.getSystemSettings();
export const updateSystemSetting = (key, value) => adapter.updateSystemSetting(key, value);

// ---------------------------------------------------------------------------
// 個人檔案・網站內容
// ---------------------------------------------------------------------------

export const getProfile = (userId) => adapter.getProfile(userId);
export const listProfiles = () => adapter.listProfiles();
export const updateProfile = (id, patch) => adapter.updateProfile(id, patch);
export const setUserRole = (id, role) => adapter.setUserRole(id, role);

export const getSiteContent = () => adapter.getSiteContent();
export const updateSiteContent = (patch) => adapter.updateSiteContent(patch);

// ---------------------------------------------------------------------------
// 認證
// ---------------------------------------------------------------------------

export const signUp = (input) => adapter.signUp(input);
export const signIn = (input) => adapter.signIn(input);
export const signInWithGoogle = () => adapter.signInWithGoogle();
export const signOut = () => adapter.signOut();
export const getSession = () => adapter.getSession();
export const onAuthStateChange = (handler) => adapter.onAuthStateChange(handler);

export const resetToSeed = () => adapter.resetToSeed();
