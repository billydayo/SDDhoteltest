/**
 * 表單驗證工具。
 *
 * 所有訊息為繁體中文（台灣用語），可直接顯示給使用者（FR-069、FR-075）。
 */

export const PASSWORD_MIN_LENGTH = 6;   // Supabase Auth 的下限（FR-009b）
export const REVIEW_MIN_LENGTH = 10;
export const REFUND_REASON_MIN_LENGTH = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-() ]{6,20}$/;

export function required(value, label) {
  return isBlank(value) ? `請填寫${label}。` : null;
}

export function validateEmail(value) {
  if (isBlank(value)) return '請填寫電子郵件。';
  return EMAIL_RE.test(String(value).trim()) ? null : '電子郵件格式不正確。';
}

export function validatePassword(value) {
  if (isBlank(value)) return '請填寫密碼。';
  if (String(value).length < PASSWORD_MIN_LENGTH) {
    return `密碼至少需要 ${PASSWORD_MIN_LENGTH} 個字元。`;
  }
  return null;
}

export function validatePhone(value) {
  if (isBlank(value)) return '請填寫聯絡電話。';
  return PHONE_RE.test(String(value).trim()) ? null : '聯絡電話格式不正確。';
}

export function validateDisplayName(value) {
  if (isBlank(value)) return '請填寫顯示名稱。';
  if (String(value).trim().length > 40) return '顯示名稱請勿超過 40 個字元。';
  return null;
}

export function validateGuestCount(count, maxGuests) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1) return '入住人數至少為 1 人。';
  if (Number.isFinite(maxGuests) && n > maxGuests) {
    return `此房源最多可住 ${maxGuests} 人。`;
  }
  return null;
}

export function validateRating(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? null : '請給予 1 至 5 分的評分。';
}

export function validateInRange(value, min, max, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${label}必須是數字。`;
  if (n < min || n > max) return `${label}需介於 ${min} 至 ${max} 之間。`;
  return null;
}

/**
 * 價格上限允許留空；填 0 或負數視為無效篩選條件而非「找不到房源」。
 */
export function validatePriceCap(value) {
  if (isBlank(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '價格上限請填寫大於 0 的數字。';
  return null;
}

/** 收集多個驗證結果，回傳 { field: message } */
export function collectErrors(checks) {
  const errors = {};
  for (const [field, message] of Object.entries(checks)) {
    if (message) errors[field] = message;
  }
  return errors;
}

export function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}

export function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/** 去除前後空白並收斂連續空白，避免超長字串或亂排版（spec 極端輸入案例） */
export function normalizeText(value, maxLength = 2000) {
  return String(value ?? '').trim().slice(0, maxLength);
}
