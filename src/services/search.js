/**
 * 搜尋與篩選服務。
 *
 * 篩選條件：關鍵字、入住／退房日期、入住人數、價格上限、設施、房型特色（FR-010）。
 * 設施與特色採 AND 邏輯：勾選多項時須同時具備全部。
 */

import { listRooms } from '../data/rooms.js';
import * as store from '../state/store.js';
import { validateStayRange, isValidDateString } from '../utils/dates.js';
import { validatePriceCap } from '../utils/validation.js';

/**
 * 依目前的搜尋條件取得房源。
 *
 * 日期只填一邊時不套用可訂性篩選——那是使用者還沒填完，不該直接顯示
 * 「查無房源」（spec：無結果時必須給調整建議，而非空白）。
 */
export async function searchRooms(overrides = {}) {
  const filters = { ...store.getSearchFilters(), ...overrides };

  const priceError = validatePriceCap(filters.priceCap);
  if (priceError) return { rooms: [], error: priceError, filters };

  const hasBothDates = isValidDateString(filters.checkIn) && isValidDateString(filters.checkOut);
  if (hasBothDates) {
    const dateError = validateStayRange(filters.checkIn, filters.checkOut);
    if (dateError) return { rooms: [], error: dateError, filters };
  }

  const rooms = await listRooms({
    keyword: filters.keyword || undefined,
    type: filters.type || undefined,
    guests: filters.guests || undefined,
    priceCap: filters.priceCap || undefined,
    amenities: filters.amenities ?? [],
    features: filters.features ?? [],
    checkIn: hasBothDates ? filters.checkIn : undefined,
    checkOut: hasBothDates ? filters.checkOut : undefined,
    sort: filters.sort || undefined
  });

  return { rooms, error: null, filters, dateFiltered: hasBothDates };
}

/**
 * 無結果時的調整建議（FR-018）。
 * 依目前條件給具體建議，而非一句「查無資料」。
 */
export function buildNoResultHints(filters) {
  const hints = [];
  if (filters.priceCap) hints.push('提高價格上限');
  if (filters.amenities?.length) hints.push('減少設施條件');
  if (filters.features?.length) hints.push('減少房型特色條件');
  if (filters.guests) hints.push('降低入住人數');
  if (filters.checkIn && filters.checkOut) hints.push('更換入住日期');
  if (filters.type) hints.push('切換到「全部房型」');
  if (filters.keyword) hints.push('清除關鍵字');
  return hints.length ? hints : ['清除部分篩選條件後再試一次'];
}

/** 目前生效的條件清單，供畫面顯示可逐項移除的標籤 */
export function describeActiveFilters(filters) {
  const chips = [];
  if (filters.keyword) chips.push({ key: 'keyword', label: `關鍵字：${filters.keyword}` });
  if (filters.type) chips.push({ key: 'type', label: `房型已篩選` });
  if (filters.checkIn && filters.checkOut) {
    chips.push({ key: 'dates', label: `${filters.checkIn} 至 ${filters.checkOut}` });
  }
  if (filters.guests) chips.push({ key: 'guests', label: `${filters.guests} 人` });
  if (filters.priceCap) chips.push({ key: 'priceCap', label: `每晚 ${filters.priceCap} 元以下` });
  (filters.amenities ?? []).forEach((a) => chips.push({ key: `amenity:${a}`, label: a }));
  (filters.features ?? []).forEach((f) => chips.push({ key: `feature:${f}`, label: f }));
  return chips;
}

export const SORT_OPTIONS = Object.freeze([
  { value: '',             label: '預設排序' },
  { value: 'price-asc',    label: '價格由低到高' },
  { value: 'price-desc',   label: '價格由高到低' },
  { value: 'rating-desc',  label: '評分由高到低' },
  { value: 'rating-asc',   label: '評分由低到高' }
]);
