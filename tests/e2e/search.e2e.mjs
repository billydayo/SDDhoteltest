/**
 * 首頁搜尋與篩選（FR-010 / FR-018）。
 *
 * 這一支的存在理由是三個都在正式環境上出過事的 bug：
 *   ・關鍵字含逗號 → PostgREST 邏輯樹解析失敗，畫面顯示「操作未能完成」
 *   ・設施篩選傳 JS 陣列 → jsonb 欄位收到 Postgres 陣列語法，400
 *   ・三欄無條件必填 → 只想用設施篩選的人按下搜尋完全沒有反應
 * 三者在示範模式下都測不出來（local adapter 在記憶體裡過濾），
 * 因此本檔預設跑**資料庫模式**。
 */

import { openPage, goto, clickByText, setValue, text, count, sleep, createReporter }
  from './harness.mjs';

const r = createReporter('首頁搜尋與篩選');
const { browser, page, problems } = await openPage();

const reset = async () => {
  await goto(page, '#/', 2000);
  await clickByText(page, '清除全部條件');
  await sleep(2000);
  problems.length = 0;
};

const search = async () => {
  await page.click('.filter-bar button[type="submit"]');
  await sleep(2200);
};

const rooms = () => count(page, '.room-card');
const errors = () => page.evaluate(() =>
  [...document.querySelectorAll('.filter-bar .field__error')]
    .filter((e) => !e.hidden).map((e) => e.textContent));

// --- 條件式必填（FR-010）------------------------------------------------
// 前四條是回歸測試：無條件必填的版本會讓它們全部失敗。

await reset();
r.ok('初次載入沒有紅字', (await errors()).length === 0);
r.ok('初次載入顯示房源', await rooms() > 0);

await reset();
await page.evaluate(() => {
  document.querySelectorAll('input[name="amenities"]').forEach((i) => {
    if (i.value === '浴缸') i.checked = true;
  });
});
await search();
r.ok('只勾設施就能搜尋', (await errors()).length === 0 && await rooms() > 0);

await reset();
await setValue(page, '#filter-keyword', '套房');
await search();
r.ok('只填關鍵字就能搜尋', (await errors()).length === 0 && await rooms() > 0);

await reset();
await setValue(page, '#filter-guests', '4');
await search();
r.ok('只填人數就能搜尋', (await errors()).length === 0 && await rooms() > 0);

await reset();
await setValue(page, '#filter-checkIn', '2026-09-01');
await search();
r.check('日期只填一半要擋下', (await errors()).length, 2);
r.ok('被擋下時不執行搜尋', await rooms() > 0);   // 清單維持原狀，不是變成 0 筆

await reset();
await setValue(page, '#filter-guests', '0');
await search();
r.check('人數 0 給的是值不對的訊息', await errors(), ['入住人數需為大於 0 的整數。']);

// --- 關鍵字的特殊字元 ----------------------------------------------------
// 逗號是 PostgREST or() 的條件分隔符，未跳脫會讓整棵樹解析失敗。

for (const keyword of ['套房', '和風,雙人', '套房(A)', '日光.雙人', '親子"友善', 'a\\b']) {
  await reset();
  await setValue(page, '#filter-keyword', keyword);
  await search();
  const failed = problems.length > 0 || (await text(page, '#main h2')) === '操作未能完成';
  r.ok(`關鍵字「${keyword}」不出錯`, !failed, problems.join(' | '));
}

// --- 設施／特色的 AND 邏輯 -----------------------------------------------
// jsonb contains。單選也會踩到，不是多選才有問題。

const pick = (name, values) => page.evaluate((n, v) => {
  document.querySelectorAll(`input[name="${n}"]`).forEach((i) => { i.checked = v.includes(i.value); });
}, name, values);

await reset();
await pick('amenities', ['浴缸']);
await search();
const onlyBath = await rooms();
r.ok('單選設施有結果', problems.length === 0 && onlyBath > 0, problems.join(' | '));

await reset();
await pick('amenities', ['浴缸', '陽台']);
await search();
const bathAndBalcony = await rooms();
r.ok('多選是交集，不是聯集', bathAndBalcony > 0 && bathAndBalcony < onlyBath,
  `浴缸 ${onlyBath} 間 → 加陽台 ${bathAndBalcony} 間`);

await reset();
await pick('amenities', ['浴缸', '陽台']);
await pick('features', ['情侶推薦']);
await search();
r.ok('設施與特色可疊加', await rooms() <= bathAndBalcony);

// --- 房型頁籤與清除不受必填限制（FR-012）--------------------------------

await reset();
await setValue(page, '#filter-checkIn', '2026-09-01');
await search();                                    // 製造紅字狀態
await page.evaluate(() => [...document.querySelectorAll('.type-tabs button')]
  .find((b) => b.textContent.includes('套房'))?.click());
await sleep(2200);
r.ok('紅字狀態下切換房型頁籤不被擋', await rooms() > 0);

await clickByText(page, '清除全部條件');
await sleep(2200);
r.ok('清除全部條件不被擋', (await errors()).length === 0 && await rooms() > 0);

const summary = r.done(problems);
await browser.close();
process.exit(summary.failed ? 1 : 0);
