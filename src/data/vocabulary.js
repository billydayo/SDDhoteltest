/**
 * 設施與房型特色的共用詞彙表。
 *
 * 搜尋篩選器、後台房源表單與種子資料都從這裡取值，避免三處各自定義而漂移。
 * 新增詞彙時只改這裡，同時記得更新 supabase/seed.sql 的對應資料。
 *
 * 篩選採 AND 邏輯：勾選多項時，房源必須同時具備全部所選項目（FR-010）。
 */

/** 可作為篩選條件的設施 */
export const AMENITIES = Object.freeze([
  '免費 Wi-Fi',
  '冷氣',
  '獨立衛浴',
  '浴缸',
  '陽台',
  '小冰箱',
  '書桌',
  '衣櫃',
  '客廳區',
  '咖啡機',
  '備品組',
  '加床服務',
  '嬰兒床可租借'
]);

/** 可作為篩選條件的房型特色 */
export const ROOM_FEATURES = Object.freeze([
  '採光佳',
  '安靜樓層',
  '商務友善',
  '情侶推薦',
  '親子友善',
  '朋友同行',
  '泡澡放鬆',
  '無障礙',
  '可加床'
]);

/** 房型代碼與顯示名稱 */
export const ROOM_TYPES = Object.freeze([
  { value: 'single', label: '單人房' },
  { value: 'double', label: '雙人房' },
  { value: 'twin',   label: '雙床房' },
  { value: 'family', label: '家庭房' },
  { value: 'suite',  label: '套房' }
]);

/** 訂單狀態的顯示名稱與語意色 */
export const ORDER_STATUS = Object.freeze({
  'pending-payment': { label: '待付款',     tone: 'warn' },
  'confirmed':       { label: '已確認',     tone: 'ok' },
  'refund-pending':  { label: '退款審核中', tone: 'info' },
  'refunded':        { label: '已退款',     tone: 'neutral' },
  'cancelled':       { label: '已取消',     tone: 'neutral' },
  'completed':       { label: '已完成',     tone: 'neutral' }
});

/** 房態的顯示名稱 */
export const ROOM_STATUS = Object.freeze({
  available:   { label: '空房',   tone: 'ok' },
  booked:      { label: '已預訂', tone: 'info' },
  maintenance: { label: '整理中', tone: 'warn' }
});

/** 模擬付款方式（憲章原則 VI：永遠是模擬，不串接任何金流） */
export const PAYMENT_METHODS = Object.freeze([
  { value: 'LINE Pay',      label: 'LINE Pay' },
  { value: 'credit-card',   label: '信用卡' },
  { value: 'bank-transfer', label: '銀行轉帳' }
]);

/** 評論類型 */
export const REVIEW_CATEGORIES = Object.freeze([
  { value: 'cleanliness', label: '清潔' },
  { value: 'service',     label: '服務' },
  { value: 'value',       label: '性價比' },
  { value: 'location',    label: '位置' },
  { value: 'facility',    label: '設施' }
]);

export const typeLabel = (value) =>
  ROOM_TYPES.find((t) => t.value === value)?.label ?? value;

export const orderStatusLabel = (value) =>
  ORDER_STATUS[value]?.label ?? value;

export const roomStatusLabel = (value) =>
  ROOM_STATUS[value]?.label ?? value;
