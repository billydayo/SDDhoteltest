/**
 * Supabase adapter — 資料庫模式的資料實作。
 *
 * 與 local adapter 實作**完全相同的函式簽章**（憲章原則 III）。
 *
 * 本檔是唯一知道 Supabase 存在的地方，也是唯一做 snake_case ⇄ camelCase
 * 轉換與錯誤轉譯的地方。原始資料庫錯誤絕不外洩到介面
 * （contracts/README.md §5）。
 */

import { getSupabaseClient, supabaseConfig } from '../../lib/supabase.js';
import { AppError, appError } from '../../utils/errors.js';
import { nightsBetween } from '../../utils/dates.js';

const client = () => getSupabaseClient();

// ---------------------------------------------------------------------------
// 錯誤轉譯（contracts/README.md §5）
// ---------------------------------------------------------------------------

function translate(error) {
  if (!error) return null;
  if (error instanceof AppError) return error;

  const code = error.code ?? '';
  const message = String(error.message ?? '');

  // 排除約束：同房源同區間已有有效訂單
  if (code === '23P01' || /orders_no_overlap/.test(message)) {
    return appError('ROOM_UNAVAILABLE', undefined, { cause: error });
  }
  // 狀態轉換守門 trigger 丟出的訊息
  if (/無法付款|逾期取消/.test(message)) {
    return appError('ORDER_EXPIRED', undefined, { cause: error });
  }
  /*
   * 「不允許的訂單狀態變更」是守門 trigger 的統包訊息，兩種情形都會走到它：
   *   ・已確認的訂單想直接取消——本來就該擋，那是退款審核的事
   *   ・待付款的訂單想取消，但資料庫還沒跑過 migrate-order-cancel.sql
   * 前者是正確行為，後者是部署沒跟上。翻成 FORBIDDEN 的「你沒有權限執行此操作」
   * 兩種都解釋不了，管理員也無從判斷該去修哪裡，因此獨立成一則訊息。
   */
  if (/不允許的訂單狀態變更/.test(message)) {
    return appError('ORDER_NOT_CANCELLABLE', undefined, { cause: error });
  }
  if (/退款申請已達上限/.test(message)) {
    return appError('REFUND_LIMIT_REACHED', undefined, { cause: error });
  }
  if (/僅管理員可變更角色/.test(message)) {
    return appError('ROLE_FORBIDDEN', undefined, { cause: error });
  }
  if (code === '23505') {
    if (/refunds_one_pending_per_order/.test(message)) {
      return appError('REFUND_ALREADY_PENDING', undefined, { cause: error });
    }
    if (/reviews_order_id_key|order_id/.test(message)) {
      return appError('REVIEW_ALREADY_EXISTS', undefined, { cause: error });
    }
    if (/favorites_pkey/.test(message)) {
      return appError('ALREADY_FAVORITED', undefined, { cause: error });
    }
  }
  if (code === '23514' && /settings_valid_range/.test(message)) {
    return appError('SETTING_OUT_OF_RANGE', undefined, { cause: error });
  }
  /*
   * 資料表或欄位不存在＝這台資料庫還沒跑過對應的 migration。
   *
   * 這不是使用者做錯了什麼，翻成「操作未能完成，請稍後再試」會讓人一直重試，
   * 而不論重試幾次都一樣。直接說出該做什麼，省下一輪追查。
   *   PGRST205 / 42P01：找不到資料表
   *   PGRST204 / 42703：找不到欄位
   */
  if (['PGRST205', 'PGRST204', '42P01', '42703'].includes(code)) {
    return appError('FEATURE_NOT_MIGRATED', undefined, { cause: error });
  }
  if (code === '42501' || error.status === 403) {
    return appError('FORBIDDEN', undefined, { cause: error });
  }
  if (code === 'PGRST301' || error.status === 401) {
    return appError('SESSION_EXPIRED', undefined, { cause: error });
  }
  if (error.status === 0 || /fetch|network|timeout/i.test(message)) {
    return appError('NETWORK_ERROR', undefined, { cause: error });
  }
  return appError('UNKNOWN', undefined, { cause: error });
}

/** 統一的查詢執行器：丟出業務錯誤，或回傳 data */
async function run(query) {
  const { data, error } = await query;
  if (error) throw translate(error);
  return data;
}

// ---------------------------------------------------------------------------
// 欄位對應
// ---------------------------------------------------------------------------

const toRoom = (r) => r && ({
  id: r.id, name: r.name, type: r.type,
  maxGuests: r.max_guests, nightlyPrice: r.nightly_price,
  images: r.images ?? [], amenities: r.amenities ?? [], features: r.features ?? [],
  description: r.description, status: r.status,
  averageRating: r.average_rating === null ? null : Number(r.average_rating),
  createdAt: r.created_at
});

const fromRoom = (r) => ({
  name: r.name, type: r.type,
  max_guests: r.maxGuests, nightly_price: r.nightlyPrice,
  images: r.images, amenities: r.amenities, features: r.features,
  description: r.description, status: r.status
});

const toOrder = (o) => o && ({
  id: o.id, orderNo: o.order_no, userId: o.user_id, roomId: o.room_id,
  checkIn: o.check_in, checkOut: o.check_out, nights: o.nights,
  guestCount: o.guest_count, contactName: o.contact_name,
  phone: o.phone, email: o.email, paymentMethod: o.payment_method,
  totalAmount: o.total_amount, status: o.status,
  expiresAt: o.expires_at, cancelReason: o.cancel_reason, createdAt: o.created_at
});

const toReview = (r) => r && ({
  id: r.id, orderId: r.order_id, roomId: r.room_id, userId: r.user_id,
  rating: r.rating, comment: r.comment, category: r.category, status: r.status,
  autoVerdict: r.auto_verdict, autoRules: r.auto_rules ?? [],
  adminNote: r.admin_note, createdAt: r.created_at,
  adminReply: r.admin_reply ?? null,
  adminReplyAt: r.admin_reply_at ?? null,
  adminReplyBy: r.admin_reply_by ?? null
});

const toMessage = (m) => m && ({
  id: m.id, threadUserId: m.thread_user_id, senderId: m.sender_id,
  senderRole: m.sender_role, body: m.body,
  readAt: m.read_at, createdAt: m.created_at
});

const toRefund = (r) => r && ({
  id: r.id, orderId: r.order_id, userId: r.user_id, reason: r.reason,
  amount: r.amount, status: r.status, adminNote: r.admin_note,
  createdAt: r.created_at, reviewedAt: r.reviewed_at
});

const toProfile = (p) => p && ({
  id: p.id, role: p.role, displayName: p.display_name,
  phone: p.phone, createdAt: p.created_at, email: p.email ?? null
});

const toRiskCheck = (c) => c && ({
  id: c.id, roomId: c.room_id,
  brightness: c.brightness, clutter: c.clutter, contrast: c.contrast,
  riskScore: c.risk_score, riskLevel: c.risk_level,
  imagePath: c.image_path, checkedBy: c.checked_by, createdAt: c.created_at
});

const toChannelPrice = (c) => c && ({
  id: c.id, roomId: c.room_id, channel: c.channel,
  channelPrice: c.channel_price, capturedAt: c.captured_at, resolved: c.resolved
});

const toAdminLog = (l) => l && ({
  id: l.id, actorId: l.actor_id, action: l.action,
  targetTable: l.target_table, targetId: l.target_id,
  summary: l.summary ?? {}, createdAt: l.created_at
});

const toSiteContent = (s) => s && ({
  id: s.id, heroTitle: s.hero_title, heroSubtitle: s.hero_subtitle,
  heroImage: s.hero_image, updatedAt: s.updated_at
});

// ---------------------------------------------------------------------------
// 逾期訂單清理
// ---------------------------------------------------------------------------

export async function expireStaleOrders() {
  const sb = await client();
  const { data, error } = await sb.rpc('expire_stale_orders');
  if (error) throw translate(error);
  return data ?? 0;
}

// ---------------------------------------------------------------------------
// 房源
// ---------------------------------------------------------------------------

/**
 * 把值包成 PostgREST 邏輯樹裡安全的字面值。
 *
 * `or=(...)` 的內容是 PostgREST 自己解析的迷你語法，逗號是條件分隔符。
 * 使用者在關鍵字裡打一個逗號（「和風,雙人」）就會把一條 ilike 拆成兩半，
 * 整棵樹解析失敗，回 400 PGRST100，前端顯示「操作未能完成」。
 *
 * 包成雙引號字面值即可，內部的 `"` 與 `\` 要再跳脫。
 * 對不含特殊字元的關鍵字，加引號與否結果完全相同（實測驗證過），
 * 因此一律加，不必判斷哪些字元才需要。
 */
const pgrstValue = (value) => `"${String(value).replace(/["\\]/g, (c) => `\\${c}`)}"`;

export async function getRooms(filters = {}) {
  const sb = await client();
  const {
    keyword, type, guests, priceCap,
    amenities = [], features = [],
    checkIn, checkOut, bookableOnly = false, sort
  } = filters;

  let q = sb.from('rooms').select('*');

  if (type) q = q.eq('type', type);
  if (Number(guests) > 0) q = q.gte('max_guests', Number(guests));
  if (Number(priceCap) > 0) q = q.lte('nightly_price', Number(priceCap));
  // jsonb 包含運算子＝AND 邏輯：須同時具備所選全部項目（FR-010）
  //
  // 必須先 JSON.stringify。直接傳 JS 陣列的話，supabase-js 會序列化成
  // Postgres 的陣列字面值 `cs.{浴缸,陽台}`——那是給 text[] 欄位用的語法，
  // 但這兩欄是 jsonb，Postgres 會拿它去 parse JSON 然後炸掉：
  //   22P02 invalid input syntax for type json / Token "浴缸" is invalid
  // 傳字串時 supabase-js 原樣帶過去，得到正確的 `cs.["浴缸","陽台"]`。
  if (amenities.length) q = q.contains('amenities', JSON.stringify(amenities));
  if (features.length) q = q.contains('features', JSON.stringify(features));
  if (keyword) {
    const k = `%${String(keyword).trim()}%`;
    q = q.or(`name.ilike.${pgrstValue(k)},description.ilike.${pgrstValue(k)}`);
  }
  if (bookableOnly || (checkIn && checkOut)) q = q.eq('status', 'available');

  const sorts = {
    'price-asc':   ['nightly_price', true],
    'price-desc':  ['nightly_price', false],
    'rating-desc': ['average_rating', false],
    'rating-asc':  ['average_rating', true]
  };
  if (sorts[sort]) {
    const [col, asc] = sorts[sort];
    // nullsFirst: false 讓「尚無評分」排在最後，而非被當成最低分
    q = q.order(col, { ascending: asc, nullsFirst: false });
  }

  let rooms = (await run(q)).map(toRoom);

  if (checkIn && checkOut) {
    const taken = await occupiedRoomIds(checkIn, checkOut);
    rooms = rooms.filter((r) => !taken.has(r.id));
  }
  return rooms;
}

/**
 * 佔用該區間的房源。半開區間比較以 SQL 表達：
 * 既有 [a,b) 與新 [c,d) 重疊 ⟺ a < d 且 c < b
 */
async function occupiedRoomIds(checkIn, checkOut) {
  const sb = await client();
  const rows = await run(
    sb.from('orders')
      .select('room_id')
      .in('status', ['pending-payment', 'confirmed', 'refund-pending'])
      .lt('check_in', checkOut)
      .gt('check_out', checkIn)
  );
  return new Set(rows.map((r) => r.room_id));
}

/** 後台查某段日期的已預訂房源。房態是逐日的，因此不能只看 rooms.status。 */
export const getOccupiedRoomIds = (checkIn, checkOut) => occupiedRoomIds(checkIn, checkOut);

export async function getRoomById(id) {
  const sb = await client();
  const rows = await run(sb.from('rooms').select('*').eq('id', id).limit(1));
  return toRoom(rows[0]) ?? null;
}

export async function createRoom(input) {
  const sb = await client();
  const rows = await run(sb.from('rooms').insert(fromRoom(input)).select());
  return toRoom(rows[0]);
}

export async function updateRoom(id, patch) {
  const sb = await client();
  const payload = {};
  for (const [k, v] of Object.entries(fromRoom({ ...patch }))) {
    if (v !== undefined) payload[k] = v;
  }
  const rows = await run(sb.from('rooms').update(payload).eq('id', id).select());
  if (!rows.length) throw appError('NOT_FOUND');
  return toRoom(rows[0]);
}

export async function deleteRoom(id) {
  const sb = await client();
  await run(sb.from('rooms').delete().eq('id', id));
  return true;
}

// ---------------------------------------------------------------------------
// 房源展示照片（僅管理員可寫）
// ---------------------------------------------------------------------------

const PHOTO_BUCKET = 'room-photos';
const STORAGE_PREFIX = 'storage:';

/**
 * 上傳一張房源照片。
 * @returns {Promise<string>} `storage:<path>` 形式的參照，直接存進 rooms.images
 */
export async function uploadRoomPhoto(roomId, blob) {
  const sb = await client();
  const path = `${roomId}/${Date.now()}-${Math.random().toString(16).slice(2, 8)}.jpg`;

  const { error } = await sb.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
  if (error) throw translate(error);

  return `${STORAGE_PREFIX}${path}`;
}

/** 刪除已上傳的照片。外部網址或相對路徑不需要刪檔，直接略過。 */
export async function deleteRoomPhoto(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(STORAGE_PREFIX)) return true;
  const sb = await client();
  const { error } = await sb.storage.from(PHOTO_BUCKET).remove([ref.slice(STORAGE_PREFIX.length)]);
  if (error) throw translate(error);
  return true;
}

/** `storage:<path>` → 公開網址；其餘形式原樣回傳 */
export function resolveRoomPhotoUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(STORAGE_PREFIX)) return value;
  const path = value.slice(STORAGE_PREFIX.length);
  // getPublicUrl 是純字串組合，不發請求，因此可以同步取得
  const base = supabaseConfig.url.replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

export async function getFutureOrdersForRoom(roomId) {
  const sb = await client();
  const today = new Date().toISOString().slice(0, 10);
  const rows = await run(
    sb.from('orders').select('*')
      .eq('room_id', roomId)
      .in('status', ['pending-payment', 'confirmed', 'refund-pending'])
      .gt('check_out', today)
  );
  return rows.map(toOrder);
}

// ---------------------------------------------------------------------------
// 訂單
// ---------------------------------------------------------------------------

export async function getOrders({ userId, status, roomId } = {}) {
  const sb = await client();
  let q = sb.from('orders').select('*').order('check_in', { ascending: true });
  // RLS 已經把非本人的資料濾掉；userId 僅供管理員進一步縮小範圍
  if (userId) q = q.eq('user_id', userId);
  if (status) q = q.eq('status', status);
  if (roomId) q = q.eq('room_id', roomId);
  return (await run(q)).map(toOrder);
}

export async function getOrderById(id) {
  const sb = await client();
  const column = /^[0-9a-f-]{36}$/i.test(id) ? 'id' : 'order_no';
  const rows = await run(sb.from('orders').select('*').eq(column, id).limit(1));
  return toOrder(rows[0]) ?? null;
}

export async function createOrder(input) {
  const sb = await client();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) throw appError('SESSION_EXPIRED');

  const rows = await run(
    sb.from('orders').insert({
      user_id: auth.user.id,
      room_id: input.roomId,
      check_in: input.checkIn,
      check_out: input.checkOut,
      nights: nightsBetween(input.checkIn, input.checkOut),
      guest_count: input.guestCount,
      contact_name: input.contactName,
      phone: input.phone,
      email: input.email,
      payment_method: input.paymentMethod,
      total_amount: input.totalAmount,
      status: 'pending-payment'
      // expires_at 由資料庫預設值依 system_settings 計算，前端不指定
    }).select()
  );
  return toOrder(rows[0]);
}

export async function payOrder(id) {
  const sb = await client();
  // 逾期判定由 guard_order_transition trigger 執行，這裡只送出轉換請求。
  // 若已逾期，trigger 會丟出錯誤並被轉譯為 ORDER_EXPIRED。
  const rows = await run(
    sb.from('orders').update({ status: 'confirmed' })
      .eq('id', id).eq('status', 'pending-payment').select()
  );
  if (!rows.length) throw appError('ORDER_EXPIRED');
  return toOrder(rows[0]);
}

/**
 * 會員主動取消尚未付款的訂單。
 *
 * 只送 status 與 cancel_reason；「必須是待付款」這條規則由資料庫的
 * guard_order_transition trigger 強制執行（FR-081：權限與狀態規則不得只靠前端）。
 * 這裡不先查一次再更新——那中間有競態，而且 trigger 本來就會擋。
 */
export async function cancelOrder(id) {
  const sb = await client();
  const rows = await run(
    sb.from('orders')
      .update({ status: 'cancelled', cancel_reason: 'member-cancelled' })
      .eq('id', id)
      .select()
  );
  if (!rows.length) throw appError('NOT_FOUND');
  return toOrder(rows[0]);
}

export async function updateOrderStatus(id, status, extra = {}) {
  const sb = await client();
  const payload = { status };
  if (extra.cancelReason !== undefined) payload.cancel_reason = extra.cancelReason;
  const rows = await run(sb.from('orders').update(payload).eq('id', id).select());
  if (!rows.length) throw appError('NOT_FOUND');
  return toOrder(rows[0]);
}

export async function getOrderStats() {
  const sb = await client();
  // RLS 讓管理員取得全部訂單；一般會員只會拿到自己的，因此本函式僅供後台呼叫
  const rows = await run(sb.from('orders').select('status,total_amount,cancel_reason'));
  const paid = rows.filter((o) => ['confirmed', 'completed', 'refunded', 'refund-pending'].includes(o.status));
  // 逾期與會員自行取消都算「未付款就取消」，只算逾期會低估這個指標
  const UNPAID_CANCEL = ['payment-timeout', 'member-cancelled'];
  const unpaidCancelled = rows.filter((o) => o.status === 'cancelled' && UNPAID_CANCEL.includes(o.cancel_reason));
  const revenue = paid.reduce((s, o) => s + o.total_amount, 0);
  return {
    totalOrders: rows.length,
    totalPlaced: rows.length,
    paidOrders: paid.length,
    unpaidCancelled: unpaidCancelled.length,
    revenue,
    conversionRate: rows.length ? paid.length / rows.length : null,
    averageOrderValue: paid.length ? Math.round(revenue / paid.length) : null
  };
}

// ---------------------------------------------------------------------------
// 評論
// ---------------------------------------------------------------------------

export async function getReviews({ roomId, status, userId } = {}) {
  const sb = await client();
  let q = sb.from('reviews').select('*').order('created_at', { ascending: false });
  if (roomId) q = q.eq('room_id', roomId);
  if (status) q = q.eq('status', status);
  if (userId) q = q.eq('user_id', userId);
  return (await run(q)).map(toReview);
}

export async function submitReview(input) {
  const sb = await client();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) throw appError('SESSION_EXPIRED');

  const order = await getOrderById(input.orderId);
  if (!order) throw appError('REVIEW_NOT_ALLOWED');

  const rows = await run(
    sb.from('reviews').insert({
      order_id: input.orderId,
      room_id: order.roomId,
      user_id: auth.user.id,
      rating: input.rating,
      comment: input.comment,
      category: input.category,
      status: 'pending',
      auto_verdict: input.autoVerdict ?? null,
      auto_rules: input.autoRules ?? []
    }).select()
  );
  return toReview(rows[0]);
}

/**
 * 業者回覆一則評論（FR-103d）。傳 null 或空字串等於收回回覆。
 *
 * 回覆人與時間由 stamp_review_reply trigger 蓋章，這裡刻意不送——
 * 前端送得出來的東西，前端就改得掉，那兩個欄位是要拿來查責任的。
 */
export async function replyToReview(id, body) {
  const sb = await client();
  const value = body?.trim() ? body.trim() : null;
  const rows = await run(
    sb.from('reviews').update({ admin_reply: value }).eq('id', id).select()
  );
  if (!rows.length) throw appError('NOT_FOUND');
  return toReview(rows[0]);
}

export async function moderateReview(id, decision, note = null) {
  const sb = await client();
  const rows = await run(
    sb.from('reviews').update({ status: decision, admin_note: note }).eq('id', id).select()
  );
  if (!rows.length) throw appError('NOT_FOUND');
  return toReview(rows[0]);   // 平均評分由資料庫 trigger 重算
}

export async function deleteReview(id) {
  const sb = await client();
  await run(sb.from('reviews').delete().eq('id', id));
  return true;
}

// ---------------------------------------------------------------------------
// 退款
// ---------------------------------------------------------------------------

export async function getRefunds({ status, userId } = {}) {
  const sb = await client();
  let q = sb.from('refunds').select('*').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (userId) q = q.eq('user_id', userId);
  return (await run(q)).map(toRefund);
}

export async function requestRefund(input) {
  const sb = await client();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) throw appError('SESSION_EXPIRED');

  const rows = await run(
    sb.from('refunds').insert({
      order_id: input.orderId,
      user_id: auth.user.id,
      reason: input.reason,
      amount: input.amount,
      status: 'pending'
    }).select()
  );
  await updateOrderStatus(input.orderId, 'refund-pending');
  return toRefund(rows[0]);
}

export async function moderateRefund(id, decision, note = null) {
  const sb = await client();
  const rows = await run(
    sb.from('refunds').update({
      status: decision, admin_note: note, reviewed_at: new Date().toISOString()
    }).eq('id', id).select()
  );
  if (!rows.length) throw appError('NOT_FOUND');
  const refund = toRefund(rows[0]);
  await updateOrderStatus(refund.orderId, decision === 'approved' ? 'refunded' : 'confirmed');
  return refund;
}

// ---------------------------------------------------------------------------
// 收藏
// ---------------------------------------------------------------------------

export async function getFavorites() {
  const sb = await client();
  const rows = await run(
    sb.from('favorites').select('user_id,room_id,created_at')
      .order('created_at', { ascending: false })
  );
  return rows.map((f) => ({ userId: f.user_id, roomId: f.room_id, createdAt: f.created_at }));
}

export async function addFavorite(roomId) {
  const sb = await client();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) throw appError('SESSION_EXPIRED');
  const { error } = await sb.from('favorites').insert({ user_id: auth.user.id, room_id: roomId });
  if (error) {
    const translated = translate(error);
    // 重複收藏視為成功（冪等），與 local adapter 行為一致
    if (translated.code === 'ALREADY_FAVORITED') return true;
    throw translated;
  }
  return true;
}

export async function removeFavorite(roomId) {
  const sb = await client();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) throw appError('SESSION_EXPIRED');
  await run(sb.from('favorites').delete().eq('user_id', auth.user.id).eq('room_id', roomId));
  return true;
}

// ---------------------------------------------------------------------------
// 房源品質檢測（僅管理員）
// ---------------------------------------------------------------------------

const RISK_BUCKET = 'room-risk';

export async function getRiskChecks({ roomId } = {}) {
  const sb = await client();
  let q = sb.from('room_risk_checks').select('*').order('created_at', { ascending: false });
  if (roomId) q = q.eq('room_id', roomId);
  const rows = (await run(q)).map(toRiskCheck);
  return rows.map((c) => ({ ...c, imageUrl: publicUrlFor(sb, c.imagePath) }));
}

export async function getLatestRiskCheck(roomId) {
  const checks = await getRiskChecks({ roomId });
  return checks[0] ?? null;
}

function publicUrlFor(sb, path) {
  if (!path) return null;
  return sb.storage.from(RISK_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * 儲存房源檢測結果與受檢圖片。
 *
 * ⚠️ 這是本專案唯一會上傳圖片的函式，且僅供後台的房源檢測使用。
 *    前台「安全檢測」的照片絕不經過這裡——pages/risk-check.js 不會 import
 *    呼叫本函式的模組（FR-086、憲章原則 VI）。
 */
export async function saveRoomRiskCheck({ roomId, metrics, imageBlob }) {
  const sb = await client();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) throw appError('SESSION_EXPIRED');

  // 重新檢測時先移除舊圖，使其不再可讀取（FR-107）
  const previous = await getRiskChecks({ roomId });
  if (previous.length) {
    await sb.storage.from(RISK_BUCKET).remove(previous.map((c) => c.imagePath).filter(Boolean));
    await run(sb.from('room_risk_checks').delete().eq('room_id', roomId));
  }

  const path = `${roomId}/${Date.now()}.jpg`;
  const { error: uploadError } = await sb.storage
    .from(RISK_BUCKET)
    .upload(path, imageBlob, { contentType: imageBlob.type || 'image/jpeg', upsert: true });
  if (uploadError) throw translate(uploadError);

  const rows = await run(
    sb.from('room_risk_checks').insert({
      room_id: roomId,
      brightness: metrics.brightness,
      clutter: metrics.clutter,
      contrast: metrics.contrast,
      risk_score: metrics.riskScore,
      risk_level: metrics.riskLevel,
      image_path: path,
      checked_by: auth.user.id
    }).select()
  );
  const check = toRiskCheck(rows[0]);
  return { ...check, imageUrl: publicUrlFor(sb, check.imagePath) };
}

// ---------------------------------------------------------------------------
// 渠道比價（模擬資料）
// ---------------------------------------------------------------------------

export async function getChannelPrices({ unresolvedOnly = false } = {}) {
  const sb = await client();
  let q = sb.from('channel_prices').select('*').order('captured_at', { ascending: false });
  if (unresolvedOnly) q = q.eq('resolved', false);
  return (await run(q)).map(toChannelPrice);
}

export async function resolveChannelAlert(id) {
  const sb = await client();
  const rows = await run(sb.from('channel_prices').update({ resolved: true }).eq('id', id).select());
  if (!rows.length) throw appError('NOT_FOUND');
  return toChannelPrice(rows[0]);
}

// ---------------------------------------------------------------------------
// 操作日誌（僅可新增）
// ---------------------------------------------------------------------------

export async function getAdminLogs({ actorId, action, from, to } = {}) {
  const sb = await client();
  let q = sb.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(500);
  if (actorId) q = q.eq('actor_id', actorId);
  if (action) q = q.eq('action', action);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);
  return (await run(q)).map(toAdminLog);
}

export async function appendAdminLog(entry) {
  const sb = await client();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) throw appError('SESSION_EXPIRED');
  const rows = await run(
    sb.from('admin_logs').insert({
      actor_id: auth.user.id,
      action: entry.action,
      target_table: entry.targetTable,
      target_id: entry.targetId ?? null,
      summary: entry.summary ?? {}
    }).select()
  );
  return toAdminLog(rows[0]);
}

// 刻意不提供 updateAdminLog / deleteAdminLog。資料庫也沒有對應的 RLS 政策，
// 且已 REVOKE UPDATE/DELETE——即使有人硬寫也會被擋下（FR-116）。

// ---------------------------------------------------------------------------
// 系統參數
// ---------------------------------------------------------------------------

export async function getSystemSettings() {
  const sb = await client();
  const rows = await run(sb.from('system_settings').select('key,value'));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * 用 upsert 而非 update。
 *
 * 設施與房型特色（room_amenities / room_features）是後來才加的 key，
 * 若堅持 update，既有資料庫在跑過遷移之前第一次儲存就會拿到 NOT_FOUND——
 * 而那是一個「還沒設定過」的正常狀態，不是錯誤。
 * 權限仍由 RLS 的 settings_update／settings_insert 把關，不會因此放寬。
 */
export async function updateSystemSetting(key, value) {
  const sb = await client();
  const rows = await run(
    sb.from('system_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select()
  );
  if (!rows.length) throw appError('NOT_FOUND');
  return getSystemSettings();
}

// ---------------------------------------------------------------------------
// 個人檔案
// ---------------------------------------------------------------------------

export async function getProfile(userId) {
  const sb = await client();
  let target = userId;
  if (!target) {
    const { data: auth } = await sb.auth.getUser();
    if (!auth?.user) return null;
    target = auth.user.id;
  }
  const rows = await run(sb.from('profiles').select('*').eq('id', target).limit(1));
  if (!rows.length) return null;
  const { data: auth } = await sb.auth.getUser();
  return { ...toProfile(rows[0]), email: auth?.user?.id === target ? auth.user.email : null };
}

export async function listProfiles() {
  const sb = await client();
  return (await run(sb.from('profiles').select('*').order('created_at', { ascending: false })))
    .map(toProfile);
}

export async function updateProfile(id, patch) {
  const sb = await client();
  const payload = {};
  if (patch.displayName !== undefined) payload.display_name = patch.displayName;
  if (patch.phone !== undefined) payload.phone = patch.phone;
  if (patch.role !== undefined) payload.role = patch.role;
  const rows = await run(sb.from('profiles').update(payload).eq('id', id).select());
  if (!rows.length) throw appError('NOT_FOUND');
  return toProfile(rows[0]);
}

export async function setUserRole(id, role) {
  return updateProfile(id, { role });
}

// ---------------------------------------------------------------------------
// 網站內容
// ---------------------------------------------------------------------------

const SITE_CONTENT_ID = '00000000-0000-0000-0000-000000000001';

export async function getSiteContent() {
  const sb = await client();
  const rows = await run(sb.from('site_content').select('*').eq('id', SITE_CONTENT_ID).limit(1));
  return toSiteContent(rows[0]) ?? null;
}

export async function updateSiteContent(patch) {
  const sb = await client();
  const payload = { updated_at: new Date().toISOString() };
  if (patch.heroTitle !== undefined) payload.hero_title = patch.heroTitle;
  if (patch.heroSubtitle !== undefined) payload.hero_subtitle = patch.heroSubtitle;
  if (patch.heroImage !== undefined) payload.hero_image = patch.heroImage;
  const rows = await run(
    sb.from('site_content').update(payload).eq('id', SITE_CONTENT_ID).select()
  );
  return toSiteContent(rows[0]);
}

// ---------------------------------------------------------------------------
// 認證（Supabase Auth — 真實認證）
// ---------------------------------------------------------------------------

export async function signUp({ email, password, displayName }) {
  const sb = await client();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  });
  if (error) {
    if (/already registered|already been registered/i.test(error.message)) {
      throw appError('EMAIL_TAKEN', undefined, { cause: error });
    }
    if (/password/i.test(error.message)) {
      throw appError('WEAK_PASSWORD', undefined, { cause: error });
    }
    throw translate(error);
  }
  return data.user ? { id: data.user.id, email: data.user.email, displayName } : null;
}

export async function signIn({ email, password }) {
  const sb = await client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  // FR-004：一律回傳同一則訊息，不透露該電子郵件是否已註冊
  if (error) throw appError('INVALID_CREDENTIALS', undefined, { cause: error });
  return getProfile(data.user.id);
}

export async function signInWithGoogle() {
  const sb = await client();
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) {
    // Google provider 未於 Supabase Dashboard 啟用時的訊息，若不特別處理會被
    // 歸到通用的「操作未能完成」，使用者與維運者都無從得知該去哪裡設定。
    if (/provider is not enabled|Unsupported provider/i.test(error.message ?? '')) {
      throw appError(
        'CONFIG_ERROR',
        'Google 登入尚未啟用。請於 Supabase Dashboard 的 Authentication → Providers → Google 完成設定，或改用電子郵件登入。',
        { cause: error }
      );
    }
    throw translate(error);
  }
  return true;   // 瀏覽器隨即導向 Google，本函式不會有後續回傳
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
  return true;
}

export async function getSession() {
  const sb = await client();
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  const profile = await getProfile(data.session.user.id);
  return { user: profile };
}

export function onAuthStateChange(handler) {
  let unsubscribe = () => {};
  client().then((sb) => {
    const { data } = sb.auth.onAuthStateChange((_event, session) => handler(session));
    unsubscribe = () => data.subscription.unsubscribe();
  });
  return () => unsubscribe();
}

// ---------------------------------------------------------------------------
// 私訊（FR-123 ~ FR-127）
//
// 討論串以「會員」為單位。管理員不是討論串的一端，而是可以進入任何一串的角色，
// 因此這裡沒有 recipient 的概念，也沒有「指派給哪位客服」的欄位。
// ---------------------------------------------------------------------------

/**
 * 一位會員的完整對話。
 * 會員只讀得到自己的（RLS messages_select），管理員讀得到任何人的。
 */
export async function getMessages(threadUserId) {
  const sb = await client();
  const rows = await run(
    sb.from('messages').select('*')
      .eq('thread_user_id', threadUserId)
      .order('created_at', { ascending: true })
  );
  return rows.map(toMessage);
}

/**
 * 後台的討論串清單：每位會員一列，含最後一則訊息與未讀數。
 *
 * 一次把全部訊息撈回來在前端分組，而不是讓資料庫做 group by——
 * PostgREST 沒有聚合語法，硬做要另開 RPC 或 view，而這個量級（示範專案）
 * 的訊息總數是幾百則，在前端分組更簡單也更容易改。
 */
export async function getMessageThreads() {
  const sb = await client();
  const rows = (await run(
    sb.from('messages').select('*').order('created_at', { ascending: true })
  )).map(toMessage);

  const byUser = new Map();
  rows.forEach((m) => {
    if (!byUser.has(m.threadUserId)) {
      byUser.set(m.threadUserId, { userId: m.threadUserId, messages: [] });
    }
    byUser.get(m.threadUserId).messages.push(m);
  });

  return [...byUser.values()]
    .map((t) => ({
      userId: t.userId,
      lastMessage: t.messages[t.messages.length - 1],
      total: t.messages.length,
      // 後台的「未讀」＝會員說了話但還沒有人讀
      unread: t.messages.filter((m) => m.senderRole === 'member' && !m.readAt).length
    }))
    .sort((a, b) => (a.lastMessage.createdAt < b.lastMessage.createdAt ? 1 : -1));
}

/**
 * 送出一則訊息。
 *
 * sender_id 與 sender_role 一律由 stamp_message_sender trigger 蓋章，
 * 這裡送了也會被覆寫——會員若能自稱 admin，就能偽造一則官方回覆給自己看，
 * 而那是自己的討論串，RLS 擋不住。
 */
export async function sendMessage({ threadUserId, body }) {
  const sb = await client();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) throw appError('SESSION_EXPIRED');

  const rows = await run(
    sb.from('messages').insert({
      thread_user_id: threadUserId ?? auth.user.id,
      sender_id: auth.user.id,          // trigger 會再覆寫一次，這裡只是不送 null
      sender_role: 'member',            // 同上：實際角色由伺服器判定
      body
    }).select()
  );
  return toMessage(rows[0]);
}

/**
 * 把對方送來、自己還沒讀的訊息標記為已讀。
 *
 * 只標記「對方送的」：把自己送出的訊息標成已讀沒有意義，
 * 而且會讓對方的未讀數莫名歸零。
 */
export async function markMessagesRead(threadUserId, readerRole) {
  const sb = await client();
  const senderRole = readerRole === 'admin' ? 'member' : 'admin';
  await run(
    sb.from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('thread_user_id', threadUserId)
      .eq('sender_role', senderRole)
      .is('read_at', null)
      .select()
  );
}

// ---------------------------------------------------------------------------
// 維護
// ---------------------------------------------------------------------------

/**
 * Supabase 模式沒有「一鍵還原」——重建資料需要在 SQL Editor 重跑 seed.sql。
 * 這是刻意的：從前端清空整個資料庫是危險且不必要的能力。
 */
export async function resetToSeed() {
  throw appError(
    'FORBIDDEN',
    '資料庫模式請於 Supabase SQL Editor 重新執行 supabase/seed.sql 以還原示範資料。'
  );
}

export const mode = 'supabase';
