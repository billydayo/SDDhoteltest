/**
 * 評論自動審核引擎（US5 / T066）。
 *
 * ⚠️ 這是**規則式**引擎，不是 AI。介面上一律標示為「自動審核（規則式）」，
 *    MUST NOT 被描述為人工智慧判讀（憲章原則 VI、FR-103a）。
 *
 * 企劃書寫的是「AI 送審」。之所以做成規則式，是因為呼叫 LLM 需要 API 金鑰，
 * 而沒有建置步驟的前端沒有任何地方能安全存放金鑰；藏到伺服器端則需要
 * Edge Function，違反憲章原則 II 且會讓示範模式失效。理由與替代方案評估
 * 記錄於 research.md。
 *
 * 設計上刻意讓判定**可解釋**：每一條觸發的規則都會回報代碼，管理員在審核
 * 佇列看得到「為什麼被退件」，而不是一個黑箱分數。這在審核場景比信心分數有用。
 *
 * 自動判定不是最終結果——一律仍需管理員複核，且可被覆寫（FR-103、FR-103b）。
 */

import { normalizeText } from '../utils/validation.js';

export const MIN_LENGTH = 10;

/** 規則代碼 → 給管理員看的說明 */
export const RULES = Object.freeze({
  PROFANITY:      { label: '含不當字詞', severity: 'reject' },
  TOO_SHORT:      { label: '內容過短', severity: 'reject' },
  GIBBERISH:      { label: '疑似亂碼或無意義字元', severity: 'reject' },
  CONTACT_INFO:   { label: '含疑似聯絡方式或外部連結', severity: 'reject' },
  DUPLICATE:      { label: '與先前送出的評論重複', severity: 'reject' },
  RATING_MISMATCH:{ label: '評分與文字內容明顯矛盾', severity: 'flag' },
  ALL_CAPS_SHOUT: { label: '大量重複標點或全形驚嘆', severity: 'flag' }
});

export const ruleLabel = (code) => RULES[code]?.label ?? code;

// ---------------------------------------------------------------------------
// 詞表
//
// 刻意保持精簡且可讀。這是展示用專案，不追求完整的內容審核詞庫——
// 真實系統應改用專門的審核服務，並定期更新詞表。
// ---------------------------------------------------------------------------

const PROFANITY = [
  '幹你', '去死', '白痴', '智障', '垃圾店', '詐騙', '騙錢',
  'fuck', 'shit', 'bitch', 'asshole'
];

const STRONG_NEGATIVE = [
  '很差', '超爛', '極差', '髒亂', '噁心', '骯髒', '有蟑螂', '有老鼠',
  '態度差', '不推薦', '別來', '後悔', 'failed', 'terrible', 'awful'
];

const STRONG_POSITIVE = [
  '很棒', '超讚', '極佳', '完美', '推薦', '滿意', '乾淨舒適',
  'excellent', 'perfect', 'amazing'
];

// 外部連結、電子郵件、電話、通訊軟體帳號
const CONTACT_PATTERNS = [
  /https?:\/\/\S+/i,
  /www\.\S+\.\S+/i,
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /\b09\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/,      // 台灣手機
  /\b\d{2,4}[-\s]?\d{6,8}\b/,               // 市話
  /(line|賴|微信|wechat|telegram|ig)\s*[:：]?\s*[\w.@-]{3,}/i
];

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/**
 * @param {{ rating: number, comment: string }} review
 * @param {{ previousComments?: string[] }} [context] 同一使用者先前送出的評論，用於重複偵測
 * @returns {{ verdict: 'auto-pass'|'auto-reject', rules: string[], explanation: string }}
 */
export function moderateReview(review, context = {}) {
  const comment = normalizeText(review?.comment ?? '');
  const rating = Number(review?.rating);
  const rules = [];

  if (comment.length < MIN_LENGTH) rules.push('TOO_SHORT');
  if (containsAny(comment, PROFANITY)) rules.push('PROFANITY');
  if (isGibberish(comment)) rules.push('GIBBERISH');
  if (CONTACT_PATTERNS.some((re) => re.test(comment))) rules.push('CONTACT_INFO');

  const previous = (context.previousComments ?? []).map((c) => normalizeText(c));
  if (previous.some((c) => c && c === comment)) rules.push('DUPLICATE');

  // 評分與文字矛盾：高分配強烈負評，或低分配強烈好評
  const negative = containsAny(comment, STRONG_NEGATIVE);
  const positive = containsAny(comment, STRONG_POSITIVE);
  if ((rating >= 4 && negative && !positive) || (rating <= 2 && positive && !negative)) {
    rules.push('RATING_MISMATCH');
  }

  if (/[!！?？]{4,}/.test(comment)) rules.push('ALL_CAPS_SHOUT');

  // 只要有任一條 severity 為 reject 的規則被觸發就退件；
  // flag 類規則僅標記，交由管理員判斷。
  const rejected = rules.some((code) => RULES[code]?.severity === 'reject');

  return {
    verdict: rejected ? 'auto-reject' : 'auto-pass',
    rules,
    explanation: buildExplanation(rejected, rules)
  };
}

function buildExplanation(rejected, rules) {
  if (!rules.length) return '未觸發任何規則，待管理員複核後公開。';
  const names = rules.map(ruleLabel).join('、');
  return rejected
    ? `自動退件：${names}。管理員複核後可覆寫此結果。`
    : `已標記待留意：${names}。仍需管理員複核。`;
}

function containsAny(text, words) {
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
}

/**
 * 亂碼偵測：同一字元連續重複過多，或幾乎不含中日韓文字與英數字。
 * 標點與空白本身不算內容。
 */
function isGibberish(text) {
  if (!text) return true;
  if (/(.)\1{5,}/.test(text)) return true;

  const meaningful = text.replace(/[^一-鿿a-zA-Z0-9぀-ヿ]/g, '');
  return meaningful.length < Math.max(4, Math.floor(text.length * 0.4));
}
