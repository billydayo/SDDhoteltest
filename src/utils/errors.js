/**
 * 業務錯誤型別與錯誤碼目錄。
 *
 * 契約（specs/001-booking-site/contracts/README.md §5）：
 * adapter 必須把資料庫層錯誤轉為業務錯誤，不得讓原始訊息外洩到介面。
 * 此檔是那張轉譯表的目的地——所有錯誤碼與使用者可見訊息集中於此，
 * 讓兩個 adapter 產生一致的錯誤語彙。
 */

export class AppError extends Error {
  /**
   * @param {string} code    錯誤碼，見下方 MESSAGES
   * @param {string} message 可直接顯示給使用者的繁體中文訊息
   * @param {{cause?: unknown, details?: unknown}} [options]
   */
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
  }
}

/** 錯誤碼 → 預設的使用者可見訊息 */
export const MESSAGES = Object.freeze({
  ROOM_UNAVAILABLE:      '此房源於所選日期已無空房。',
  ORDER_EXPIRED:         '此訂單已因逾期未付款而取消，請重新訂房。',
  ORDER_NOT_CANCELLABLE: '只有尚未付款的訂單可以直接取消。已付款的訂單請改用申請退款。',
  REFUND_ALREADY_PENDING:'此訂單已有審核中的退款申請。',
  REFUND_NOT_ALLOWED:    '此訂單目前不可申請退款。',
  REFUND_LIMIT_REACHED:  '你的退款申請已達上限 5 筆，無法再提出新的申請。',
  REVIEW_ALREADY_EXISTS: '此訂單已撰寫過評論。',
  REVIEW_NOT_ALLOWED:    '需完成入住後才能撰寫評論。',
  ALREADY_FAVORITED:     '此房源已在你的收藏清單中。',
  FORBIDDEN:             '你沒有權限執行此操作。',
  ROLE_FORBIDDEN:        '你沒有權限變更角色。',
  SESSION_EXPIRED:       '登入已逾時，請重新登入。',
  NOT_FOUND:             '查無此資料。',
  INVALID_CREDENTIALS:   '電子郵件或密碼錯誤。',
  EMAIL_TAKEN:           '此電子郵件已被註冊。',
  WEAK_PASSWORD:         '密碼至少需要 6 個字元。',
  SETTING_OUT_OF_RANGE:  '設定值超出可接受的範圍。',
  NETWORK_ERROR:         '目前無法連線，請稍後再試。已保留你填寫的內容。',
  CONFIG_ERROR:          '資料庫設定有誤，請檢查 src/config.js 的憑證。',
  STORAGE_FULL:          '瀏覽器儲存空間已滿，資料未能保存。',
  STORAGE_UNAVAILABLE:   '無法寫入瀏覽器儲存空間，資料未能保存。',
  DEMO_UNSUPPORTED:      '此功能需要連線至資料庫，示範模式不支援。',
  UNKNOWN:               '操作未能完成，請稍後再試。'
});

export function appError(code, override, options) {
  return new AppError(code, override ?? MESSAGES[code] ?? MESSAGES.UNKNOWN, options);
}

/**
 * 任意錯誤 → 可顯示的訊息。
 * 非 AppError 一律回傳通用訊息，避免把原始技術錯誤洩漏到畫面上。
 */
export function toUserMessage(err) {
  if (err instanceof AppError) return err.message;
  return MESSAGES.UNKNOWN;
}

export function isAppError(err, code) {
  return err instanceof AppError && (code === undefined || err.code === code);
}
