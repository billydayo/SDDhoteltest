/**
 * localStorage adapter — 示範模式的資料實作。
 *
 * 與 supabase adapter 實作**完全相同的函式簽章**（憲章原則 III）。
 * 所有函式皆為非同步，即使本機操作可同步完成——這樣呼叫端不會因模式不同
 * 而出現兩種寫法。
 *
 * ⚠️ 本模組的登入為模擬：比對 localStorage 中的種子帳號明文密碼。
 *    介面必須標示為模擬（憲章原則 VI）。真實系統應由認證服務保管密碼。
 */

import * as store from '../../state/persistence.js';
import { appError } from '../../utils/errors.js';
import { rangesOverlap, todayInTaipei, isSameOrBefore, nightsBetween } from '../../utils/dates.js';

const SESSION_KEY = 'session';

/** 佔用房況的訂單狀態，與 schema.sql 的排除約束條件一致 */
const OCCUPYING = ['pending-payment', 'confirmed', 'refund-pending'];

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const clone = (v) => JSON.parse(JSON.stringify(v));
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// 工作階段
// ---------------------------------------------------------------------------

let sessionListeners = [];

function readSession() {
  const raw = store.read(SESSION_KEY);
  return Array.isArray(raw) ? null : (raw?.userId ? raw : null);
}

function writeSession(session) {
  store.write(SESSION_KEY, session ?? {});
  sessionListeners.forEach((fn) => {
    try { fn(session); } catch { /* 單一監聽器出錯不應影響其他監聽器 */ }
  });
}

function currentUser() {
  const session = readSession();
  if (!session) return null;
  return store.read('users').find((u) => u.id === session.userId) ?? null;
}

function requireUser() {
  const user = currentUser();
  if (!user) throw appError('SESSION_EXPIRED');
  return user;
}

function requireAdmin() {
  const user = requireUser();
  if (user.role !== 'admin') throw appError('FORBIDDEN');
  return user;
}

/** 對外的 profile 形狀：不含 password（與 Supabase 模式一致） */
function toProfile(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}

// ---------------------------------------------------------------------------
// 逾期訂單清理
// ---------------------------------------------------------------------------

/**
 * 逾期未付款的訂單自動取消並釋出房況（FR-099）。
 * repository 會在查詢房況、建立訂單、讀取訂單列表之前呼叫本函式。
 */
export async function expireStaleOrders() {
  const now = Date.now();
  let changed = 0;
  store.mutate('orders', (orders) =>
    orders.map((o) => {
      if (o.status === 'pending-payment' && o.expiresAt && Date.parse(o.expiresAt) < now) {
        changed += 1;
        return { ...o, status: 'cancelled', cancelReason: 'payment-timeout' };
      }
      return o;
    })
  );
  return changed;
}

// ---------------------------------------------------------------------------
// 房源
// ---------------------------------------------------------------------------

function occupiedRoomIds(checkIn, checkOut) {
  return new Set(
    store.read('orders')
      .filter((o) => OCCUPYING.includes(o.status))
      .filter((o) => rangesOverlap(o.checkIn, o.checkOut, checkIn, checkOut))
      .map((o) => o.roomId)
  );
}

/** 後台查某段日期的已預訂房源。房態是逐日的，因此不能只看 rooms.status。 */
export async function getOccupiedRoomIds(checkIn, checkOut) {
  return occupiedRoomIds(checkIn, checkOut);
}

export async function getRooms(filters = {}) {
  const {
    keyword, type, guests, priceCap,
    amenities = [], features = [],
    checkIn, checkOut, bookableOnly = false,
    sort
  } = filters;

  let rooms = clone(store.read('rooms'));

  if (keyword) {
    const k = String(keyword).trim().toLowerCase();
    rooms = rooms.filter((r) =>
      `${r.name} ${r.description} ${r.amenities.join(' ')} ${r.features.join(' ')}`
        .toLowerCase().includes(k)
    );
  }
  if (type) rooms = rooms.filter((r) => r.type === type);
  if (Number.isFinite(Number(guests)) && Number(guests) > 0) {
    rooms = rooms.filter((r) => r.maxGuests >= Number(guests));
  }
  if (Number.isFinite(Number(priceCap)) && Number(priceCap) > 0) {
    rooms = rooms.filter((r) => r.nightlyPrice <= Number(priceCap));
  }
  // AND 邏輯：須同時具備所選的全部設施／特色（FR-010）
  // 舊資料或編輯中的房源可能缺少 amenities/features 陣列；這裡必須先正規化，
  // 否則多選時會在 `includes` 上觸發型別錯誤（NUG）。
  if (amenities.length) {
    rooms = rooms.filter((r) => {
      const roomAmenities = Array.isArray(r.amenities) ? r.amenities : [];
      return amenities.every((a) => roomAmenities.includes(a));
    });
  }
  if (features.length) {
    rooms = rooms.filter((r) => {
      const roomFeatures = Array.isArray(r.features) ? r.features : [];
      return features.every((f) => roomFeatures.includes(f));
    });
  }

  // 房態與日期可訂性
  if (bookableOnly || (checkIn && checkOut)) {
    // 「整理中」與「已預訂」一律排除於可訂清單（憲章原則 IV）
    rooms = rooms.filter((r) => r.status === 'available');
    if (checkIn && checkOut) {
      const taken = occupiedRoomIds(checkIn, checkOut);
      rooms = rooms.filter((r) => !taken.has(r.id));
    }
  }

  return sortRooms(rooms, sort);
}

function sortRooms(rooms, sort) {
  const by = {
    'price-asc':  (a, b) => a.nightlyPrice - b.nightlyPrice,
    'price-desc': (a, b) => b.nightlyPrice - a.nightlyPrice,
    // 尚無評分（null）一律排在最後，不視為 0 分
    'rating-desc': (a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1),
    'rating-asc':  (a, b) => (a.averageRating ?? 99) - (b.averageRating ?? 99)
  }[sort];
  return by ? rooms.sort(by) : rooms;
}

export async function getRoomById(id) {
  const room = store.read('rooms').find((r) => r.id === id);
  return room ? clone(room) : null;
}

export async function createRoom(input) {
  requireAdmin();
  const room = {
    id: uuid(),
    averageRating: null,
    status: 'available',
    images: [], amenities: [], features: [],
    createdAt: nowIso(),
    ...input
  };
  store.mutate('rooms', (rooms) => [...rooms, room]);
  return clone(room);
}

export async function updateRoom(id, patch) {
  requireAdmin();
  let updated = null;
  store.mutate('rooms', (rooms) =>
    rooms.map((r) => (r.id === id ? (updated = { ...r, ...patch, id }) : r))
  );
  if (!updated) throw appError('NOT_FOUND');
  return clone(updated);
}

export async function deleteRoom(id) {
  requireAdmin();
  store.mutate('rooms', (rooms) => rooms.filter((r) => r.id !== id));
  // 房源消失時一併清掉收藏，避免收藏清單出現破損卡片（FR-095）
  store.mutate('favorites', (favs) => favs.filter((f) => f.roomId !== id));
  store.mutate('channelPrices', (cp) => cp.filter((c) => c.roomId !== id));
  return true;
}

// ---------------------------------------------------------------------------
// 房源展示照片
//
// 示範模式沒有雲端儲存，改以 data URL 存在房源資料裡。
// utils/image.js 會先把圖片壓到約 900px 寬，否則 localStorage 的配額
// 撐不過幾張照片。
// ---------------------------------------------------------------------------

export async function uploadRoomPhoto(roomId, blobOrDataUrl) {
  requireAdmin();
  if (typeof blobOrDataUrl === 'string') return blobOrDataUrl;   // 已是 data URL

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(appError('UNKNOWN', '讀取圖片失敗，請換一張再試。'));
    reader.readAsDataURL(blobOrDataUrl);
  });
}

/** data URL 隨房源資料一起刪除，沒有額外的檔案要清 */
export async function deleteRoomPhoto() {
  requireAdmin();
  return true;
}

/** 示範模式的圖片參照本身就能直接顯示 */
export function resolveRoomPhotoUrl(value) {
  return value;
}

/** 某房源尚未到期的有效訂單，供刪除前的二次確認使用 */
export async function getFutureOrdersForRoom(roomId) {
  const today = todayInTaipei();
  return clone(
    store.read('orders').filter(
      (o) => o.roomId === roomId && OCCUPYING.includes(o.status) && !isSameOrBefore(o.checkOut, today)
    )
  );
}

// ---------------------------------------------------------------------------
// 訂單
// ---------------------------------------------------------------------------

function nextOrderNo() {
  const orders = store.read('orders');
  const stamp = todayInTaipei().replace(/-/g, '');
  const seq = String(orders.length + 1).padStart(4, '0');
  return `SN${stamp}${seq}`;
}

export async function getOrders({ userId, status, roomId } = {}) {
  let orders = clone(store.read('orders'));
  const user = currentUser();

  // 會員只看得到自己的訂單；管理員看得到全部（對應 Supabase 的 RLS）
  if (!user) return [];
  if (user.role !== 'admin') orders = orders.filter((o) => o.userId === user.id);
  else if (userId) orders = orders.filter((o) => o.userId === userId);

  if (status) orders = orders.filter((o) => o.status === status);
  if (roomId) orders = orders.filter((o) => o.roomId === roomId);

  return orders.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
}

export async function getOrderById(id) {
  const user = requireUser();
  const order = store.read('orders').find((o) => o.id === id || o.orderNo === id);
  if (!order) return null;
  // FR-034：會員不得檢視他人訂單。查無此訂單，不透露它存在。
  if (user.role !== 'admin' && order.userId !== user.id) return null;
  return clone(order);
}

export async function createOrder(input) {
  const user = requireUser();
  const room = await getRoomById(input.roomId);
  if (!room) throw appError('NOT_FOUND');
  if (room.status !== 'available') throw appError('ROOM_UNAVAILABLE');

  // 建立前重新查證房況（FR-025）。repository 已先呼叫 expireStaleOrders，
  // 因此這裡看到的佔用都是真的。
  const taken = occupiedRoomIds(input.checkIn, input.checkOut);
  if (taken.has(input.roomId)) throw appError('ROOM_UNAVAILABLE');

  const minutes = (await getSystemSettings()).pending_payment_minutes ?? 60;
  const nights = nightsBetween(input.checkIn, input.checkOut);

  const order = {
    id: uuid(),
    orderNo: nextOrderNo(),
    userId: user.id,
    roomId: input.roomId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    nights,
    guestCount: input.guestCount,
    contactName: input.contactName,
    phone: input.phone,
    email: input.email,
    paymentMethod: input.paymentMethod,
    totalAmount: input.totalAmount,
    status: 'pending-payment',
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    cancelReason: null,
    createdAt: nowIso()
  };

  store.mutate('orders', (orders) => [...orders, order]);
  return clone(order);
}

/** 待付款 → 已確認。逾期的訂單必須被拒（FR-100）。 */
export async function payOrder(id) {
  const user = requireUser();
  const order = store.read('orders').find((o) => o.id === id);
  if (!order || (user.role !== 'admin' && order.userId !== user.id)) throw appError('NOT_FOUND');
  if (order.status !== 'pending-payment') throw appError('ORDER_EXPIRED');
  if (Date.parse(order.expiresAt) < Date.now()) throw appError('ORDER_EXPIRED');

  return updateOrderFields(id, { status: 'confirmed' });
}

export async function updateOrderStatus(id, status, extra = {}) {
  requireUser();
  return updateOrderFields(id, { status, ...extra });
}

function updateOrderFields(id, patch) {
  let updated = null;
  store.mutate('orders', (orders) =>
    orders.map((o) => (o.id === id ? (updated = { ...o, ...patch }) : o))
  );
  if (!updated) throw appError('NOT_FOUND');
  return clone(updated);
}

/** 後台營運指標（US6）。無訂單時回傳 null 讓畫面顯示「—」而非 0。 */
export async function getOrderStats() {
  requireAdmin();
  const orders = store.read('orders');
  const paid = orders.filter((o) => ['confirmed', 'completed', 'refunded', 'refund-pending'].includes(o.status));
  const unpaidCancelled = orders.filter((o) => o.status === 'cancelled' && o.cancelReason === 'payment-timeout');
  const revenue = paid.reduce((sum, o) => sum + o.totalAmount, 0);
  return {
    totalOrders: orders.length,
    totalPlaced: orders.length,
    paidOrders: paid.length,
    unpaidCancelled: unpaidCancelled.length,
    revenue,
    // 分母為 0 時回傳 null，由畫面顯示破折號
    conversionRate: orders.length ? (paid.length / orders.length) : null,
    averageOrderValue: paid.length ? Math.round(revenue / paid.length) : null
  };
}

// ---------------------------------------------------------------------------
// 評論
// ---------------------------------------------------------------------------

export async function getReviews({ roomId, status, userId } = {}) {
  let reviews = clone(store.read('reviews'));
  const user = currentUser();

  if (roomId) reviews = reviews.filter((r) => r.roomId === roomId);
  if (userId) reviews = reviews.filter((r) => r.userId === userId);

  if (status) {
    reviews = reviews.filter((r) => r.status === status);
  } else if (!user || user.role !== 'admin') {
    // 非管理員：只看得到已通過的評論，加上自己的全部（對應 RLS）
    reviews = reviews.filter((r) => r.status === 'approved' || (user && r.userId === user.id));
  }
  return reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function submitReview(input) {
  const user = requireUser();
  const exists = store.read('reviews').some((r) => r.orderId === input.orderId);
  if (exists) throw appError('REVIEW_ALREADY_EXISTS');

  const order = store.read('orders').find((o) => o.id === input.orderId);
  if (!order || order.userId !== user.id) throw appError('REVIEW_NOT_ALLOWED');
  if (!isSameOrBefore(order.checkOut, todayInTaipei())) throw appError('REVIEW_NOT_ALLOWED');

  const review = {
    id: uuid(),
    orderId: input.orderId,
    roomId: order.roomId,
    userId: user.id,
    rating: input.rating,
    comment: input.comment,
    category: input.category,
    status: 'pending',                       // 一律待管理員複核（FR-103）
    autoVerdict: input.autoVerdict ?? null,
    autoRules: input.autoRules ?? [],
    adminNote: null,
    createdAt: nowIso()
  };
  store.mutate('reviews', (reviews) => [...reviews, review]);
  refreshRoomRating(order.roomId);
  return clone(review);
}

export async function moderateReview(id, decision, note = null) {
  requireAdmin();
  let updated = null;
  store.mutate('reviews', (reviews) =>
    reviews.map((r) => (r.id === id ? (updated = { ...r, status: decision, adminNote: note }) : r))
  );
  if (!updated) throw appError('NOT_FOUND');
  refreshRoomRating(updated.roomId);
  return clone(updated);
}

export async function deleteReview(id) {
  requireAdmin();
  const review = store.read('reviews').find((r) => r.id === id);
  if (!review) throw appError('NOT_FOUND');
  store.mutate('reviews', (reviews) => reviews.filter((r) => r.id !== id));
  refreshRoomRating(review.roomId);
  return true;
}

/**
 * 重算房源平均評分。只計入已通過審核的評論（FR-046）。
 * 無評論時設為 null，讓前台顯示「尚無評分」而非 0 分（FR-047）。
 * Supabase 模式由資料庫 trigger 做同一件事。
 */
function refreshRoomRating(roomId) {
  const approved = store.read('reviews').filter((r) => r.roomId === roomId && r.status === 'approved');
  const value = approved.length
    ? Math.round((approved.reduce((s, r) => s + r.rating, 0) / approved.length) * 10) / 10
    : null;
  store.mutate('rooms', (rooms) =>
    rooms.map((r) => (r.id === roomId ? { ...r, averageRating: value } : r))
  );
}

// ---------------------------------------------------------------------------
// 退款
// ---------------------------------------------------------------------------

export async function getRefunds({ status, userId } = {}) {
  let refunds = clone(store.read('refunds'));
  const user = currentUser();
  if (!user) return [];
  if (user.role !== 'admin') refunds = refunds.filter((r) => r.userId === user.id);
  else if (userId) refunds = refunds.filter((r) => r.userId === userId);
  if (status) refunds = refunds.filter((r) => r.status === status);
  return refunds.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function requestRefund(input) {
  const user = requireUser();
  const order = store.read('orders').find((o) => o.id === input.orderId);
  if (!order || order.userId !== user.id) throw appError('NOT_FOUND');
  if (order.status !== 'confirmed') throw appError('REFUND_NOT_ALLOWED');

  const myRefunds = store.read('refunds').filter((r) => r.userId === user.id);

  const pending = myRefunds.some((r) => r.orderId === input.orderId && r.status === 'pending');
  if (pending) throw appError('REFUND_ALREADY_PENDING');

  // 單一會員上限 5 筆，只計審核中與已核准——駁回的不佔額度（見 services/refunds.js）
  const counted = myRefunds.filter((r) => ['pending', 'approved'].includes(r.status)).length;
  if (counted >= 5) throw appError('REFUND_LIMIT_REACHED');

  const refund = {
    id: uuid(),
    orderId: input.orderId,
    userId: user.id,
    reason: input.reason,
    amount: input.amount,
    status: 'pending',
    adminNote: null,
    createdAt: nowIso(),
    reviewedAt: null
  };
  store.mutate('refunds', (refunds) => [...refunds, refund]);
  updateOrderFields(input.orderId, { status: 'refund-pending' });
  return clone(refund);
}

export async function moderateRefund(id, decision, note = null) {
  requireAdmin();
  let updated = null;
  store.mutate('refunds', (refunds) =>
    refunds.map((r) =>
      r.id === id ? (updated = { ...r, status: decision, adminNote: note, reviewedAt: nowIso() }) : r
    )
  );
  if (!updated) throw appError('NOT_FOUND');
  // 核准 → 已退款並釋出房況；駁回 → 回到已確認且可再次申請（FR-038、FR-039）
  updateOrderFields(updated.orderId, {
    status: decision === 'approved' ? 'refunded' : 'confirmed'
  });
  return clone(updated);
}

// ---------------------------------------------------------------------------
// 收藏
// ---------------------------------------------------------------------------

export async function getFavorites() {
  const user = currentUser();
  if (!user) return [];
  return clone(
    store.read('favorites')
      .filter((f) => f.userId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );
}

export async function addFavorite(roomId) {
  const user = requireUser();
  const exists = store.read('favorites').some((f) => f.userId === user.id && f.roomId === roomId);
  if (exists) return true;   // 冪等：重複收藏視為成功
  store.mutate('favorites', (favs) => [...favs, { userId: user.id, roomId, createdAt: nowIso() }]);
  return true;
}

export async function removeFavorite(roomId) {
  const user = requireUser();
  store.mutate('favorites', (favs) =>
    favs.filter((f) => !(f.userId === user.id && f.roomId === roomId))
  );
  return true;
}

// ---------------------------------------------------------------------------
// 房源品質檢測（僅管理員）
// ---------------------------------------------------------------------------

export async function getRiskChecks({ roomId } = {}) {
  let checks = clone(store.read('riskChecks'));
  if (roomId) checks = checks.filter((c) => c.roomId === roomId);
  return checks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getLatestRiskCheck(roomId) {
  const checks = await getRiskChecks({ roomId });
  return checks[0] ?? null;
}

/**
 * 儲存房源檢測結果。
 * 示範模式以 data URL 存圖（僅此路徑，且僅管理員）。前台的安全檢測
 * 完全不會呼叫本函式——它連 import 都沒有（FR-086）。
 */
export async function saveRoomRiskCheck({ roomId, metrics, imageDataUrl }) {
  const admin = requireAdmin();
  const check = {
    id: uuid(),
    roomId,
    brightness: metrics.brightness,
    clutter: metrics.clutter,
    contrast: metrics.contrast,
    riskScore: metrics.riskScore,
    riskLevel: metrics.riskLevel,
    imagePath: imageDataUrl,
    checkedBy: admin.id,
    createdAt: nowIso()
  };
  // 重新檢測時移除該房源的舊紀錄，使舊圖不再可讀取（FR-107）
  store.mutate('riskChecks', (checks) => [...checks.filter((c) => c.roomId !== roomId), check]);
  return clone(check);
}

// ---------------------------------------------------------------------------
// 渠道比價（模擬資料）
// ---------------------------------------------------------------------------

export async function getChannelPrices({ unresolvedOnly = false } = {}) {
  requireAdmin();
  let prices = clone(store.read('channelPrices'));
  if (unresolvedOnly) prices = prices.filter((p) => !p.resolved);
  return prices.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export async function resolveChannelAlert(id) {
  requireAdmin();
  let updated = null;
  store.mutate('channelPrices', (prices) =>
    prices.map((p) => (p.id === id ? (updated = { ...p, resolved: true }) : p))
  );
  if (!updated) throw appError('NOT_FOUND');
  return clone(updated);
}

// ---------------------------------------------------------------------------
// 操作日誌（僅可新增）
// ---------------------------------------------------------------------------

export async function getAdminLogs({ actorId, action, from, to } = {}) {
  requireAdmin();
  let logs = clone(store.read('adminLogs'));
  if (actorId) logs = logs.filter((l) => l.actorId === actorId);
  if (action) logs = logs.filter((l) => l.action === action);
  if (from) logs = logs.filter((l) => l.createdAt >= from);
  if (to) logs = logs.filter((l) => l.createdAt <= to);
  return logs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function appendAdminLog(entry) {
  const admin = requireAdmin();
  const log = {
    id: uuid(),
    actorId: admin.id,
    action: entry.action,
    targetTable: entry.targetTable,
    targetId: entry.targetId ?? null,
    summary: entry.summary ?? {},
    createdAt: nowIso()
  };
  store.mutate('adminLogs', (logs) => [...logs, log]);
  return clone(log);
}

// 刻意不提供 updateAdminLog / deleteAdminLog。日誌僅可新增（FR-116）。

// ---------------------------------------------------------------------------
// 系統參數
// ---------------------------------------------------------------------------

export async function getSystemSettings() {
  return clone(store.read('settings'));
}

export async function updateSystemSetting(key, value) {
  requireAdmin();
  const next = { ...store.read('settings'), [key]: value };
  store.write('settings', next);
  return clone(next);
}

// ---------------------------------------------------------------------------
// 個人檔案
// ---------------------------------------------------------------------------

export async function getProfile(userId) {
  const user = requireUser();
  const target = userId ?? user.id;
  if (user.role !== 'admin' && target !== user.id) throw appError('FORBIDDEN');
  return toProfile(store.read('users').find((u) => u.id === target));
}

export async function listProfiles() {
  requireAdmin();
  return store.read('users').map(toProfile);
}

export async function updateProfile(id, patch) {
  const user = requireUser();
  if (user.role !== 'admin' && id !== user.id) throw appError('FORBIDDEN');
  // 一般使用者不得自行改角色（對應 prevent_role_escalation trigger）
  if ('role' in patch && user.role !== 'admin') throw appError('ROLE_FORBIDDEN');

  let updated = null;
  store.mutate('users', (users) =>
    users.map((u) => (u.id === id ? (updated = { ...u, ...patch, id }) : u))
  );
  if (!updated) throw appError('NOT_FOUND');
  return toProfile(updated);
}

export async function setUserRole(id, role) {
  requireAdmin();
  return updateProfile(id, { role });
}

// ---------------------------------------------------------------------------
// 網站內容
// ---------------------------------------------------------------------------

export async function getSiteContent() {
  return clone(store.read('siteContent'));
}

export async function updateSiteContent(patch) {
  requireAdmin();
  const next = { ...store.read('siteContent'), ...patch, updatedAt: nowIso() };
  store.write('siteContent', next);
  return clone(next);
}

// ---------------------------------------------------------------------------
// 認證（模擬）
// ---------------------------------------------------------------------------

export async function signUp({ email, password, displayName }) {
  const users = store.read('users');
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    throw appError('EMAIL_TAKEN');
  }
  const user = {
    id: uuid(),
    email: email.trim(),
    password,                       // 示範模式專屬，見檔頭警語
    role: 'member',
    displayName,
    phone: '',
    createdAt: nowIso()
  };
  store.mutate('users', (list) => [...list, user]);
  writeSession({ userId: user.id });
  return toProfile(user);
}

export async function signIn({ email, password }) {
  const user = store.read('users').find(
    (u) => u.email.toLowerCase() === String(email).trim().toLowerCase()
  );
  // FR-004：訊息不得透露該電子郵件是否已註冊
  if (!user || user.password !== password) throw appError('INVALID_CREDENTIALS');
  writeSession({ userId: user.id });
  return toProfile(user);
}

/** FR-089：示範模式不支援第三方登入，且不得假造授權畫面 */
export async function signInWithGoogle() {
  throw appError('DEMO_UNSUPPORTED');
}

export async function signOut() {
  writeSession(null);
  return true;
}

export async function getSession() {
  const user = currentUser();
  return user ? { user: toProfile(user) } : null;
}

export function onAuthStateChange(handler) {
  sessionListeners.push(handler);
  return () => {
    sessionListeners = sessionListeners.filter((fn) => fn !== handler);
  };
}

// ---------------------------------------------------------------------------
// 維護
// ---------------------------------------------------------------------------

export async function resetToSeed() {
  store.resetToSeed();
  writeSession(null);
  return true;
}

export const mode = 'demo';
