/**
 * 訂房核心邏輯。
 *
 * 憲章原則 IV 的規則都在這裡執行：
 * - 日期以 YYYY-MM-DD 字串處理，時區固定 Asia/Taipei
 * - 夜數＝退房日 − 入住日，退房當日不計為一晚
 * - 入住日至少為明日（訂房需提前一天）
 * - 房態「整理中」與「已預訂」等同處理
 * - 待付款訂單同樣佔用房況，逾期後釋出
 *
 * 前端的重疊檢查是即時回饋；真正的保證來自資料庫的排除約束（FR-082）。
 * 因此本模組不會自行判定「一定訂得到」——它送出請求並轉譯結果。
 */

import * as repo from '../data/repository.js';
import { getRoom } from '../data/rooms.js';
import { getPendingPaymentMinutes } from '../data/settings.js';
import { appError } from '../utils/errors.js';
import { nightsBetween, validateStayRange, daysUntil } from '../utils/dates.js';
import { calculateTotal, calculateRefund } from '../utils/money.js';
import { validateGuestCount, validatePhone, validateEmail, required, collectErrors, hasErrors }
  from '../utils/validation.js';

/**
 * 試算一筆訂房。不寫入任何資料，供表單即時顯示夜數與總金額。
 * @returns {{ nights: number, totalAmount: number, error: string|null }}
 */
export async function quote({ roomId, checkIn, checkOut }) {
  const rangeError = validateStayRange(checkIn, checkOut);
  if (rangeError) return { nights: 0, totalAmount: 0, error: rangeError };

  const room = await getRoom(roomId);
  if (!room) return { nights: 0, totalAmount: 0, error: '查無此房源。' };

  const nights = nightsBetween(checkIn, checkOut);
  const totalAmount = calculateTotal(room.nightlyPrice, nights);
  return { nights, totalAmount, room, error: null };
}

/** 三步驟表單的欄位驗證。回傳 { field: message }，空物件代表通過。 */
export function validateBookingForm(input, room) {
  return collectErrors({
    contactName: required(input.contactName, '住客姓名'),
    phone: validatePhone(input.phone),
    email: validateEmail(input.email),
    guestCount: validateGuestCount(input.guestCount, room?.maxGuests),
    paymentMethod: required(input.paymentMethod, '付款方式'),
    dates: validateStayRange(input.checkIn, input.checkOut)
  });
}

/**
 * 建立訂單。成立後為「待付款」，並保留房間一段時間（FR-096、FR-097）。
 *
 * repository 會在寫入前先清理逾期訂單，因此不會被殭屍訂單誤擋。
 */
export async function createBooking(input) {
  const room = await getRoom(input.roomId);
  if (!room) throw appError('NOT_FOUND', '查無此房源。');
  if (room.status !== 'available') throw appError('ROOM_UNAVAILABLE');

  const errors = validateBookingForm(input, room);
  if (hasErrors(errors)) {
    throw appError('UNKNOWN', Object.values(errors)[0], { details: errors });
  }

  const nights = nightsBetween(input.checkIn, input.checkOut);
  const totalAmount = calculateTotal(room.nightlyPrice, nights);

  // 房況衝突由資料庫的排除約束判定，adapter 會轉譯為 ROOM_UNAVAILABLE。
  // 這裡不預先宣告成功——並行下前端的檢查結果隨時可能過期。
  const order = await repo.createOrder({
    roomId: room.id,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guestCount: Number(input.guestCount),
    contactName: input.contactName.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    paymentMethod: input.paymentMethod,
    totalAmount
  });

  return { order, room, nights, totalAmount };
}

/** 完成模擬付款：待付款 → 已確認（FR-096）。逾期會被拒絕（FR-100）。 */
export async function payBooking(orderId) {
  return repo.payOrder(orderId);
}

/** 保留時間（分鐘），供畫面顯示「請於 N 分鐘內完成付款」 */
export const holdMinutes = () => getPendingPaymentMinutes();

// ---------------------------------------------------------------------------
// 退款
// ---------------------------------------------------------------------------

/**
 * 退款試算（FR-041）。回傳 null 代表不可退款。
 * 級距：7 天以上全額、3–6 天 50%、1–2 天 20%、當日起不可退。
 */
export function quoteRefund(order) {
  if (!order || order.status !== 'confirmed') return null;
  return calculateRefund(order.totalAmount, daysUntil(order.checkIn));
}

export function refundUnavailableReason(order) {
  if (!order) return '查無此訂單。';
  if (order.status === 'pending-payment') return '訂單尚未完成付款，請直接等待逾期取消或完成付款。';
  if (order.status === 'refund-pending') return '此訂單已有審核中的退款申請。';
  if (order.status === 'refunded') return '此訂單已完成退款。';
  if (order.status === 'cancelled') return '此訂單已取消。';
  if (order.status === 'completed') return '入住日已過，無法申請退款。';
  if (daysUntil(order.checkIn) < 1) return '入住當日或已入住後不可申請退款。';
  return null;
}

export async function submitRefundRequest(order, reason) {
  const blocked = refundUnavailableReason(order);
  if (blocked) throw appError('REFUND_NOT_ALLOWED', blocked);

  const quoteResult = quoteRefund(order);
  if (!quoteResult) throw appError('REFUND_NOT_ALLOWED', '此訂單目前不可申請退款。');

  return repo.requestRefund({
    orderId: order.id,
    reason: reason.trim(),
    amount: quoteResult.amount
  });
}

// ---------------------------------------------------------------------------
// 房況
// ---------------------------------------------------------------------------

/** 某房源在指定區間是否可訂。供詳情頁的即時提示使用。 */
export async function isRoomBookable(roomId, checkIn, checkOut) {
  const rooms = await repo.getRooms({ checkIn, checkOut });
  return rooms.some((r) => r.id === roomId);
}
