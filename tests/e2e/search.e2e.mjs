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
const { browser, page, problems, consoleIssues } = await openPage();

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
const ALL_ROOMS = await rooms();
r.ok('初次載入沒有紅字', (await errors()).length === 0);
r.ok('初次載入顯示房源', ALL_ROOMS > 0);

await reset();
await search();
r.check('什麼都不填直接搜尋 → 顯示全部房源', await rooms(), ALL_ROOMS);

await reset();
await setValue(page, '#filter-priceCap', '3000');
await search();
r.ok('只填價格上限就能搜尋', (await errors()).length === 0 && await rooms() > 0);

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
r.check('只填入住日 → 提示補退房日與人數', await errors(),
  ['選了日期就要填退房日。', '查詢特定日期時請填寫入住人數。']);
r.ok('被擋下時不執行搜尋', await rooms() > 0);   // 清單維持原狀，不是變成 0 筆

await reset();
await setValue(page, '#filter-checkOut', '2026-09-03');
await search();
r.check('只填退房日 → 提示補入住日與人數', await errors(),
  ['選了日期就要填入住日。', '查詢特定日期時請填寫入住人數。']);

await reset();
await setValue(page, '#filter-checkIn', '2026-09-01');
await setValue(page, '#filter-checkOut', '2026-09-03');
await search();
r.check('日期兩欄都填、人數留空 → 只缺人數', await errors(),
  ['查詢特定日期時請填寫入住人數。']);

// 補齊欄位時紅字要當場消失，不必再按一次搜尋
await setValue(page, '#filter-guests', '2');
await sleep(400);
r.check('補齊欄位後紅字立刻消失（沒有再按搜尋）', await errors(), []);

await search();
r.ok('三項填妥 → 正常出結果', await rooms() > 0);
r.ok('標題出現「已排除所選日期不可訂的房源」',
  (await text(page, '#main h2') ?? '').includes('已排除所選日期不可訂的房源'),
  await text(page, '#main h2'));

await reset();
await setValue(page, '#filter-guests', '0');
await search();
r.check('人數 0 給的是值不對的訊息', await errors(), ['入住人數需為大於 0 的整數。']);

// 這三欄是條件式必填，標籤寫「（必填）」會讓人以為不填就不能搜尋（FR-010）
await reset();
r.check('欄位標籤沒有「必填」字樣',
  await page.evaluate(() => [...document.querySelectorAll('.filter-bar label')]
    .map((l) => l.textContent.trim()).filter((t) => t.includes('必填'))), []);

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
await pick('features', ['親子友善']);
await search();
const kidFriendly = await page.evaluate(() =>
  [...document.querySelectorAll('.room-card__title')].map((t) => t.textContent.trim()));
// 用資料反查，而不是比對房名清單——依 FR-080，兩種模式的資料內容本來就不必一致
const shouldMatch = await page.evaluate(async () => {
  const repo = await import('/src/data/repository.js');
  return (await repo.getRooms({}))
    .filter((x) => (x.features ?? []).includes('親子友善'))
    .map((x) => x.name);
});
r.ok('房型特色篩選只留具備該特色的房源',
  kidFriendly.length > 0 && kidFriendly.every((n) => shouldMatch.includes(n)),
  `畫面 ${kidFriendly.length} 間、資料 ${shouldMatch.length} 間`);
r.ok('具備該特色的房源沒有被漏掉', kidFriendly.length === shouldMatch.length,
  `畫面 ${kidFriendly.join('、')} / 資料 ${shouldMatch.join('、')}`);

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

r.done(problems, consoleIssues);
await browser.close();

// =========================================================== 示範模式
/*
 * 「整理中」只能在示範模式驗：資料庫模式目前沒有任何整理中的房源
 * （房名帶「（整理中）」三個字的那間，房態其實是空房）。示範模式的種子有兩間，
 * 而這條看的是房態的呈現與排除規則，兩種模式的判定邏輯共用同一份 search.js。
 */
{
  const { browser: demoBrowser, page: demo, problems: demoProblems,
    consoleIssues: demoConsole } = await openPage({ demo: true });
  await goto(demo, '#/', 2600);

  const underMaintenance = await demo.evaluate(async () => {
    const repo = await import('/src/data/repository.js');
    return (await repo.getRooms({})).filter((x) => x.status === 'maintenance').map((x) => x.name);
  });
  r.ok('示範資料中有整理中的房源', underMaintenance.length > 0, underMaintenance.join('、'));

  const labelled = await demo.evaluate((names) => names.every((name) => {
    const card = [...document.querySelectorAll('.room-card')]
      .find((c) => c.querySelector('.room-card__title')?.textContent.trim() === name);
    return card?.textContent.includes('整理中') && card.classList.contains('room-card--unavailable');
  }), underMaintenance);
  r.ok('整理中的房源顯示整理中標籤', labelled);

  // 指定日期查詢時，整理中的房源不該出現在可訂結果裡
  await demo.evaluate(() => {
    const set = (id, v) => {
      const el = document.querySelector(id);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('#filter-checkIn', '2026-09-01');
    set('#filter-checkOut', '2026-09-03');
    set('#filter-guests', '2');
  });
  await demo.click('.filter-bar button[type="submit"]');
  await sleep(2400);

  const visible = await demo.evaluate(() =>
    [...document.querySelectorAll('.room-card__title')].map((t) => t.textContent.trim()));
  r.ok('整理中的房源不出現在可訂結果中',
    visible.length > 0 && underMaintenance.every((n) => !visible.includes(n)),
    `結果 ${visible.length} 間：${visible.join('、')}`);

  const summary = r.done(demoProblems, demoConsole);
  await demoBrowser.close();
  process.exit(summary.failed ? 1 : 0);
}
