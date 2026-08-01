/**
 * 單元測試：純函式與判定規則。
 *
 * 挑選標準是「規則本身不明顯、改壞了不會有人發現」——
 * 例如逐日房態的優先序、退款級距的邊界、詞彙正規化。
 * 版面、對比、照片好不好看不在這裡，那些留給 browser-acceptance.md。
 *
 * 這一層刻意不碰 repository：那會寫入 localStorage，跑一次測試就把
 * 使用者的示範資料重置掉。需要真實資料流的情境交給 tests/e2e/。
 */

import { describe, it, expect } from './runner.js';

import { effectiveRoomStatus, formatRating } from '../src/data/rooms.js';
import { normalizeTerms, validateTerm, MAX_TERM_LENGTH, MAX_TERMS }
  from '../src/data/room-vocabulary.js';
import { removalPatch } from '../src/components/filter-bar.js';
import { buildNoResultHints, describeActiveFilters } from '../src/services/search.js';
import { calculateRefund, calculateTotal, formatTWD } from '../src/utils/money.js';
import { rangesOverlap, nightsBetween, addDays, validateStayRange } from '../src/utils/dates.js';
import { validateReason } from '../src/services/refunds.js';

// ---------------------------------------------------------------------------

describe('逐日房態（FR-015 / FR-051a）', () => {
  const room = { id: 'r1', status: 'available' };

  it('沒有指定日期時退回營運狀態', () => {
    expect(effectiveRoomStatus(room, null)).toBe('available');
  });

  it('當日有訂單即為已預訂', () => {
    expect(effectiveRoomStatus(room, new Set(['r1']))).toBe('booked');
  });

  it('當日沒有該房的訂單就是空房——別房被訂不影響', () => {
    expect(effectiveRoomStatus(room, new Set(['r2']))).toBe('available');
  });

  it('整理中優先於已預訂：房間在整修，有沒有訂單都不該只顯示已預訂', () => {
    const maintenance = { id: 'r1', status: 'maintenance' };
    expect(effectiveRoomStatus(maintenance, new Set(['r1']))).toBe('maintenance');
  });
});

describe('房況區間重疊（半開區間 [checkIn, checkOut)）', () => {
  it('退房日當天可以再訂——這是最容易寫錯的一格', () => {
    expect(rangesOverlap('2026-09-01', '2026-09-03', '2026-09-03', '2026-09-05')).toBeFalsy();
  });

  it('中間重疊', () => {
    expect(rangesOverlap('2026-09-01', '2026-09-05', '2026-09-03', '2026-09-04')).toBeTruthy();
  });

  it('完全不相交', () => {
    expect(rangesOverlap('2026-09-01', '2026-09-02', '2026-09-10', '2026-09-11')).toBeFalsy();
  });
});

describe('設施／特色詞彙（FR-010a）', () => {
  it('去空白、去空值、去重複，且保留原順序', () => {
    expect(normalizeTerms(['  浴缸 ', '陽台', '', '浴缸', null, '書桌']))
      .toEqual(['浴缸', '陽台', '書桌']);
  });

  it('非陣列回傳 null，讓呼叫端能區分「沒設定」與「設定成空的」', () => {
    expect(normalizeTerms('浴缸')).toBeNull();
    expect(normalizeTerms(undefined)).toBeNull();
  });

  it('空字串擋下', () => {
    expect(validateTerm('   ', [])).toBe('請輸入名稱。');
  });

  it('重複值擋下', () => {
    expect(validateTerm('浴缸', ['浴缸'])).toBe('這個項目已經在清單中。');
  });

  it('超過長度上限擋下', () => {
    expect(validateTerm('字'.repeat(MAX_TERM_LENGTH + 1), [])).toBeTruthy();
  });

  it('達到數量上限擋下', () => {
    const full = Array.from({ length: MAX_TERMS }, (_, i) => `項目${i}`);
    expect(validateTerm('再一個', full)).toBeTruthy();
  });

  it('正常值放行', () => {
    expect(validateTerm('溫泉湯屋', ['浴缸'])).toBeNull();
  });
});

describe('移除單一篩選條件（FR-010）', () => {
  const filters = {
    keyword: '套房', amenities: ['浴缸', '陽台'], features: ['情侶推薦'],
    checkIn: '2026-09-01', checkOut: '2026-09-03'
  };

  it('移除設施只拿掉那一項，其餘保留', () => {
    expect(removalPatch('amenity:浴缸', filters)).toEqual({ amenities: ['陽台'] });
  });

  it('移除特色', () => {
    expect(removalPatch('feature:情侶推薦', filters)).toEqual({ features: [] });
  });

  it('日期是一組，一起移除', () => {
    expect(removalPatch('dates', filters)).toEqual({ checkIn: '', checkOut: '' });
  });

  it('其餘欄位清成空字串', () => {
    expect(removalPatch('keyword', filters)).toEqual({ keyword: '' });
  });
});

describe('退款級距（FR-041）', () => {
  it('7 天以上全額', () => {
    expect(calculateRefund(10000, 7).percent).toBe(100);
  });

  it('第 6 天落在 50% 這一段', () => {
    expect(calculateRefund(10000, 6).percent).toBe(50);
  });

  it('第 3 天仍是 50%', () => {
    expect(calculateRefund(10000, 3).percent).toBe(50);
  });

  it('第 2 天降到 20%', () => {
    expect(calculateRefund(10000, 2).percent).toBe(20);
  });

  // 不可退是用 null 表達，不是 percent: 0。
  // 兩者在畫面上都顯示「不可退款」，但 null 讓呼叫端無法誤把它當成一筆 0 元的退款。
  it('當日不可退', () => {
    expect(calculateRefund(10000, 0)).toBeNull();
  });

  it('已入住（負數天）不可退', () => {
    expect(calculateRefund(10000, -3)).toBeNull();
  });

  it('金額依比例計算並四捨五入', () => {
    expect(calculateRefund(2999, 3)).toEqual({ percent: 50, amount: 1500 });
  });
});

describe('訂房日期驗證（FR-022 / FR-023）', () => {
  const today = new Date().toISOString().slice(0, 10);

  it('退房日等於入住日要擋下', () => {
    expect(validateStayRange(today, today)).toBeTruthy();
  });

  it('今天入住要擋下（需提前一天）', () => {
    expect(validateStayRange(today, addDays(today, 2))).toBeTruthy();
  });

  it('明天入住、後天退房放行', () => {
    expect(validateStayRange(addDays(today, 1), addDays(today, 2))).toBeNull();
  });

  it('夜數計算', () => {
    expect(nightsBetween('2026-09-01', '2026-09-04')).toBe(3);
  });
});

describe('退款原因驗證', () => {
  it('空白擋下', () => {
    expect(validateReason('   ')).toBeTruthy();
  });

  it('過短擋下', () => {
    expect(validateReason('不去了')).toBeTruthy();
  });

  it('足夠長度放行', () => {
    expect(validateReason('臨時有事無法成行，麻煩協助取消這筆訂單。')).toBeNull();
  });
});

describe('無結果時的調整建議（FR-018）', () => {
  it('依實際生效的條件給建議，不是一句罐頭訊息', () => {
    const hints = buildNoResultHints({ priceCap: '2000', guests: '4', amenities: ['浴缸'] });
    expect(hints).toContain('提高價格上限');
    expect(hints).toContain('降低入住人數');
    expect(hints).toContain('減少設施條件');
  });

  it('沒有任何條件時仍給得出話，不會是空陣列', () => {
    expect(buildNoResultHints({}).length).toBe(1);
  });
});

describe('生效條件的標籤', () => {
  it('日期成對時才顯示，只填一邊不算', () => {
    expect(describeActiveFilters({ checkIn: '2026-09-01' }).length).toBe(0);
    expect(describeActiveFilters({ checkIn: '2026-09-01', checkOut: '2026-09-03' }).length).toBe(1);
  });

  it('設施與特色各自成為一個可移除的標籤', () => {
    const chips = describeActiveFilters({ amenities: ['浴缸', '陽台'], features: ['情侶推薦'] });
    expect(chips.map((c) => c.key))
      .toEqual(['amenity:浴缸', 'amenity:陽台', 'feature:情侶推薦']);
  });
});

describe('金額', () => {
  it('夜數乘價格', () => {
    expect(calculateTotal(2600, 3)).toBe(7800);
  });

  it('顯示為新臺幣且帶千分位', () => {
    expect(formatTWD(7800)).toContain('7,800');
  });
});

describe('評分顯示（FR-047）', () => {
  it('沒有評分時顯示文字，不是 0 分', () => {
    expect(formatRating(null).text).toBe('尚無評分');
    expect(formatRating(null).hasRating).toBeFalsy();
  });

  it('有評分時保留一位小數', () => {
    expect(formatRating(4).text).toBe('4.0');
  });
});
