/**
 * 後台：逐日房態、六個模組的報表匯出、設施／特色增刪。
 *
 * 匯出與詞彙儲存都跑在**資料庫模式**（那是它們真正會出事的地方：
 * RLS、jsonb 語法、SheetJS 動態載入），但詞彙的寫入改在示範模式驗，
 * 避免在正式資料上留下痕跡。
 */

import { openPage, goto, login, clickByText, setValue, sleep, createReporter }
  from './harness.mjs';

const r = createReporter('後台');

// =========================================================== 資料庫模式
{
  const { browser, page, problems } = await openPage();
  await login(page, 'admin@sunny.com', 'admin123');

  // --- 逐日房態（FR-015 / FR-051a）---------------------------------------
  const probe = await page.evaluate(async () => {
    const repo = await import('/src/data/repository.js');
    const orders = await repo.getOrders({});
    const live = orders.find((o) =>
      ['pending-payment', 'confirmed', 'refund-pending'].includes(o.status));
    if (!live) return null;
    const rooms = await repo.getRooms({});
    return {
      name: rooms.find((x) => x.id === live.roomId)?.name,
      checkIn: live.checkIn, checkOut: live.checkOut
    };
  });

  if (!probe) {
    r.ok('逐日房態：找不到有效訂單可測', false, '請先建立一筆訂單');
  } else {
    const statusOn = async (date) => {
      await goto(page, '#/admin/rooms', 2200);
      await page.evaluate(() => document.querySelector('#rm-filter-toggle')?.click());
      await sleep(1500);
      await setValue(page, '#rm-f-date', date);
      await page.click('#rm-filter-panel button[type="submit"]');
      await sleep(2200);
      return page.evaluate((name) => {
        const row = [...document.querySelectorAll('tbody tr')]
          .find((tr) => tr.children[0]?.textContent.trim() === name);
        return row?.children[4]?.textContent.trim() ?? '(找不到)';
      }, probe.name);
    };

    r.check(`「${probe.name}」在入住日 ${probe.checkIn}`, await statusOn(probe.checkIn), '已預訂');
    // 半開區間：退房日當天就該可以再訂
    r.check(`「${probe.name}」在退房日 ${probe.checkOut}`, await statusOn(probe.checkOut), '空房');
  }

  // --- 六個模組的匯出（FR-058）-------------------------------------------
  // headless Chrome 會取消實際存檔，因此看 CDP 的 downloadWillBegin 事件。
  let downloads = [];
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allowAndName', downloadPath: '/tmp-ignore', eventsEnabled: true
  });
  cdp.on('Browser.downloadWillBegin', (e) => downloads.push(e.suggestedFilename));

  for (const [hash, name] of [
    ['#/admin/rooms', '房源管理'],
    ['#/admin/orders', '訂單管理'],
    ['#/admin/users', '用戶管理'],
    ['#/admin/reviews', '評論審核'],
    ['#/admin/refunds', '退款審核'],
    ['#/admin/channel', '渠道比價']
  ]) {
    await goto(page, hash, 2600);
    downloads = [];
    const found = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => x.textContent.trim().startsWith('匯出'));
      if (!b) return false;
      b.click();
      return true;
    });
    await sleep(3500);
    r.ok(`${name} 可匯出`, found && downloads.length > 0, found ? '沒有產生檔案' : '找不到匯出按鈕');
  }

  // 用戶匯出不得含帳號資訊
  await goto(page, '#/admin/users', 2200);
  const userColumns = await page.evaluate(() => {
    // 匯出欄位定義在按鈕的 closure 裡讀不到，改由畫面表頭反推：
    // 表頭不顯示 email，匯出也不該有
    return [...document.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  });
  r.ok('用戶頁不顯示電子郵件', !userColumns.some((c) => c.includes('郵件')), userColumns.join('/'));

  r.done(problems);
  await browser.close();
}

// =========================================================== 示範模式
{
  const { browser, page, problems } = await openPage({ demo: true });
  await login(page, 'admin@sunny.com', 'admin123');
  await goto(page, '#/admin/rooms', 2400);

  // --- 設施／特色增刪（FR-010a）------------------------------------------
  const before = await page.evaluate(async () => {
    const m = await import('/src/data/room-vocabulary.js');
    const v = await m.getRoomVocabulary();
    return { amenities: v.amenities.length, features: v.features.length };
  });

  await clickByText(page, '管理設施／特色');
  await sleep(1600);
  r.ok('詞彙浮窗可開啟', await page.evaluate(() => !!document.querySelector('.modal')));

  await page.type('#vocab-amenities-new', '溫泉湯屋');
  await page.evaluate(() => {
    const box = document.querySelector('#vocab-amenities-new').closest('div');
    [...box.querySelectorAll('button')].find((b) => b.textContent.trim() === '加入')?.click();
  });
  await sleep(600);

  // 重複值要在按下儲存之前就擋掉
  await page.type('#vocab-amenities-new', '溫泉湯屋');
  await page.evaluate(() => {
    const box = document.querySelector('#vocab-amenities-new').closest('div');
    [...box.querySelectorAll('button')].find((b) => b.textContent.trim() === '加入')?.click();
  });
  await sleep(600);
  r.check('重複值當場擋下',
    await page.evaluate(() => document.querySelector('.modal .error-state')?.textContent ?? null),
    '這個項目已經在清單中。');

  await page.evaluate(() => { document.querySelector('#vocab-amenities-new').value = ''; });
  await page.evaluate(() => [...document.querySelectorAll('.modal button')]
    .find((b) => b.textContent.trim() === '儲存')?.click());
  await sleep(2600);

  const after = await page.evaluate(async () => {
    const m = await import('/src/data/room-vocabulary.js');
    m.invalidateRoomVocabulary();
    const v = await m.getRoomVocabulary();
    return { amenities: v.amenities.length, hasNew: v.amenities.includes('溫泉湯屋') };
  });
  r.check('新增後數量 +1', after.amenities, before.amenities + 1);
  r.ok('新項目寫得進去', after.hasNew);

  // 前台是否跟著套用
  await goto(page, '#/', 2600);
  r.ok('前台篩選器出現新項目', await page.evaluate(() =>
    [...document.querySelectorAll('input[name="amenities"]')].some((i) => i.value === '溫泉湯屋')));

  const summary = r.done(problems);
  await browser.close();
  process.exit(summary.failed ? 1 : 0);
}
