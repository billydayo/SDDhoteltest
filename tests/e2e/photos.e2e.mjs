/**
 * 房源照片管理（FR-050a–f、FR-014）與訂單管理的房源篩選。
 *
 * 這兩組是第 6 關通過之後才加進來的功能，人工驗收一直沒補。能機械判定的都收在
 * 這裡，剩下純粹靠眼睛的（拱形卡片好不好看、壓縮後畫質可不可接受）仍留給
 * browser-acceptance.md。
 *
 * 照片管理與訂單篩選跑**示範模式**：它們會真的改房源的 images、真的存檔，
 * 不該在正式資料上留下痕跡。
 *
 * 上傳邊界（FR-050e、FR-050f）跑**資料庫模式**，因為那三件事在示範模式下
 * 根本不存在——示範模式把圖存成 data URL，沒有 bucket、沒有 RLS，
 * 也就沒有孤兒檔可清。為了不動到正式房源，測試自己建一間臨時房源，結束後刪掉。
 */

import { openPage, goto, login, clickByText, sleep, createReporter } from './harness.mjs';
import { makeFixtures } from './fixtures.mjs';

const r = createReporter('房源照片與訂單篩選');
const { images: PHOTOS, notAnImage: NOT_IMAGE } = makeFixtures(10);

const TMP_ROOM = '__e2e 臨時房源（可刪）';

// --- 共用的頁面內查詢 -------------------------------------------------------

const tileCount = (page) => page.evaluate(() => document.querySelectorAll('.photo-tile').length);

const coverIndex = (page) => page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.photo-tile')];
  return tiles.findIndex((t) => t.querySelector('.photo-tile__badge')?.textContent.trim() === '封面');
});

const tileSrcs = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.photo-tile img')].map((i) => i.getAttribute('src')));

const inlineError = (page) => page.evaluate(() => {
  const el = document.querySelector('.photo-grid')?.parentElement?.querySelector('.field__error');
  return el && !el.hidden ? el.textContent.trim() : null;
});

const toasts = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()));

/**
 * 移除第 index 張照片。
 *
 * 一次只移一張並重新查詢——remove() 會 splice 後整個重畫，
 * 用同一份 NodeList 連點會點到已經被換掉的節點。
 */
async function removeTile(page, index = 0) {
  await page.evaluate((i) => {
    const tile = document.querySelectorAll('.photo-tile')[i];
    [...(tile?.querySelectorAll('button') ?? [])]
      .find((b) => b.title === '移除這張照片')?.click();
  }, index);
  await sleep(500);
}

async function removeAllTiles(page) {
  for (let guard = 0; guard < 20 && (await tileCount(page)) > 0; guard += 1) {
    await removeTile(page, 0);
  }
}

/** 訂單頁的表格標題。後台外框自己也有 h2，不能直接取第一個。 */
const ordersTitle = (page) => page.evaluate(() =>
  [...document.querySelectorAll('h2')]
    .map((h) => h.textContent.trim())
    .find((t) => t.startsWith('全部訂單') || t.startsWith('符合條件的訂單')) ?? '(找不到標題)');

/** 開啟房源清單中第一列（或指定房名）的編輯浮窗 */
async function openEditForm(page, roomName = null) {
  await goto(page, '#/admin/rooms', 2400);

  if (roomName) {
    await page.evaluate(() => document.querySelector('#rm-filter-toggle')?.click());
    await sleep(1200);
    // 篩選條件是模組層狀態，會跨次帶回來。不先清空的話第二次會變成關鍵字接關鍵字。
    await page.evaluate(() => {
      const el = document.querySelector('#rm-f-kw');
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.type('#rm-f-kw', roomName);
    await page.click('#rm-filter-panel button[type="submit"]');
    await sleep(2200);
  }

  const opened = await page.evaluate(() => {
    const row = document.querySelector('tbody tr');
    const btn = [...(row?.querySelectorAll('button') ?? [])]
      .find((b) => b.textContent.trim() === '編輯');
    if (!btn) return null;
    btn.click();
    return row.children[0]?.textContent.trim() ?? '';
  });
  await sleep(1800);
  return opened;
}

async function addByUrl(page, url) {
  await page.evaluate((u) => {
    const input = document.querySelector('.photo-controls__url input');
    input.value = u;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.photo-controls__url button')]
      .find((b) => b.textContent.trim() === '加入網址')?.click();
  }, url);
  await sleep(500);
}

/**
 * 選檔上傳。
 *
 * expect 是預期新增的張數，預設等於檔案數；等縮圖真的出現才往下走。
 * 固定秒數在資料庫模式會 flaky——那裡是真的在把檔案傳上 storage，
 * 慢一秒就會變成「存檔時 images 還是空的」這種假失敗。
 */
async function upload(page, files, { expect = files.length } = {}) {
  const before = await tileCount(page);
  const input = await page.$('#rm-photo-file');
  if (!input) throw new Error('找不到 #rm-photo-file——編輯浮窗沒開起來');
  await input.uploadFile(...files);

  if (expect > 0) {
    await page.waitForFunction(
      (n) => document.querySelectorAll('.photo-tile').length >= n,
      { timeout: 30000 }, before + expect
    ).catch(() => { /* 逾時就讓後面的斷言去報告實際張數 */ });
  } else {
    await sleep(1500);       // 預期不會增加，只能等它處理完
  }
  await sleep(400);
}

const clickModal = (page, label) => page.evaluate((t) => {
  const btn = [...document.querySelectorAll('.modal button, form.card button')]
    .find((b) => b.textContent.trim() === t);
  if (!btn) return false;
  btn.click();
  return true;
}, label);

// ===========================================================================
// 示範模式：照片管理 12 項 + 訂單的房源篩選 4 項
// ===========================================================================
{
  const { browser, page, problems } = await openPage({ demo: true });
  await login(page, 'admin@sunny.com', 'admin123');

  // --- 照片管理區與封面標示 -------------------------------------------------
  const roomName = await openEditForm(page);
  r.ok('編輯浮窗可開啟', Boolean(roomName), '找不到編輯按鈕');
  r.ok('看得到照片管理區', await page.evaluate(() => !!document.querySelector('.photo-grid')));

  const seeded = await tileCount(page);
  r.ok('既有的種子圖已列出', seeded > 0, `目前 ${seeded} 張`);
  r.check('第一張標示為封面', await coverIndex(page), 0);

  // --- 本地上傳（FR-050b、FR-050c）------------------------------------------
  await upload(page, [PHOTOS[0]]);
  r.check('上傳一張後縮圖 +1', await tileCount(page), seeded + 1);
  r.ok('提示壓縮後的大小',
    (await toasts(page)).some((t) => t.includes('壓縮後') && /\d/.test(t)),
    (await toasts(page)).join(' / '));

  // --- 一次選多個檔 ---------------------------------------------------------
  const beforeMulti = await tileCount(page);
  await upload(page, [PHOTOS[1], PHOTOS[2]]);
  r.check('一次選多個檔全部加入', await tileCount(page), beforeMulti + 2);

  // --- 貼網址（FR-050b）----------------------------------------------------
  const beforeUrl = await tileCount(page);
  await addByUrl(page, 'assets/rooms/star-view.svg');
  r.check('貼網址也能加入', await tileCount(page), beforeUrl + 1);
  r.ok('網址與上傳的照片混用',
    (await tileSrcs(page)).some((s) => s.startsWith('data:'))
    && (await tileSrcs(page)).some((s) => s.includes('star-view.svg')));

  // --- 排序與封面（FR-050d）------------------------------------------------
  const beforeMove = await tileSrcs(page);
  await page.evaluate(() => {
    const tile = document.querySelectorAll('.photo-tile')[0];
    [...tile.querySelectorAll('button')].find((b) => b.title === '往後移一位')?.click();
  });
  await sleep(500);
  const afterMove = await tileSrcs(page);
  r.check('→ 交換前兩張', afterMove.slice(0, 2), [beforeMove[1], beforeMove[0]]);
  r.check('封面標示跟著移動到新的第一張', await coverIndex(page), 0);
  r.ok('原本的封面已不是封面', afterMove[0] !== beforeMove[0]);

  await page.evaluate(() => {
    const tile = document.querySelectorAll('.photo-tile')[1];
    [...tile.querySelectorAll('button')].find((b) => b.title === '往前移一位')?.click();
  });
  await sleep(500);
  r.check('← 換回原本的順序', (await tileSrcs(page)).slice(0, 2), beforeMove.slice(0, 2));

  // --- 移除（✕）------------------------------------------------------------
  const beforeRemove = await tileCount(page);
  await removeTile(page, 0);
  r.check('✕ 移除後從清單消失', await tileCount(page), beforeRemove - 1);

  // --- 上限 8 張（FR-050a）-------------------------------------------------
  while ((await tileCount(page)) < 8) {
    await addByUrl(page, `assets/rooms/double-${'abc'[(await tileCount(page)) % 3]}.svg?n=${await tileCount(page)}`);
  }
  await addByUrl(page, 'assets/rooms/suite-a.svg?overflow=1');
  r.check('第 9 張被擋下', await tileCount(page), 8);
  r.ok('顯示 8 張上限的訊息',
    (await inlineError(page) ?? '').includes('最多只能加入 8 張照片'),
    await inlineError(page));

  // --- 非圖片檔 -------------------------------------------------------------
  await removeTile(page, 0);
  const beforeBad = await tileCount(page);
  await upload(page, [NOT_IMAGE], { expect: 0 });
  r.check('非圖片檔不會被加入', await tileCount(page), beforeBad);
  r.ok('非圖片檔給明確錯誤',
    (await inlineError(page) ?? '').includes('只接受圖片檔案'),
    await inlineError(page));

  // --- 存成兩張已知的照片，驗證前台 ----------------------------------------
  await removeAllTiles(page);
  await addByUrl(page, 'assets/rooms/star-view.svg');
  await addByUrl(page, 'assets/rooms/garden-view.svg');
  r.check('存檔前剩下兩張', await tileCount(page), 2);

  await clickModal(page, '儲存變更');
  await sleep(2600);

  await goto(page, '#/', 2600);
  const card = await page.evaluate((name) => {
    const el = [...document.querySelectorAll('.room-card')]
      .find((c) => c.textContent.includes(name));
    if (!el) return null;
    return {
      cover: el.querySelector('img')?.getAttribute('src') ?? '',
      badge: el.querySelector('.room-card__photo-count')?.textContent.trim() ?? null
    };
  }, roomName);
  r.ok('卡片顯示封面那一張', card?.cover.includes('star-view.svg'), card?.cover);
  r.check('卡片出現張數角標', card?.badge, '2 張照片');

  // --- 詳情頁的縮圖列（FR-014）---------------------------------------------
  await page.evaluate((name) => {
    [...document.querySelectorAll('.room-card')]
      .find((c) => c.textContent.includes(name))
      ?.querySelector('a, button')?.click();
  }, roomName);
  await sleep(2600);

  const gallery = await page.evaluate(() => ({
    thumbs: document.querySelectorAll('.detail-gallery__thumb').length,
    main: document.querySelector('.detail-gallery__main')?.getAttribute('src') ?? ''
  }));
  r.check('詳情頁有兩張縮圖', gallery.thumbs, 2);

  await page.evaluate(() => document.querySelectorAll('.detail-gallery__thumb')[1]?.click());
  await sleep(600);
  const switched = await page.evaluate(() =>
    document.querySelector('.detail-gallery__main')?.getAttribute('src') ?? '');
  r.ok('點縮圖可切換主圖', switched !== gallery.main && switched.includes('garden-view.svg'), switched);

  // --- 只有一張時不顯示縮圖列 ----------------------------------------------
  await openEditForm(page);
  await removeTile(page, 1);
  await clickModal(page, '儲存變更');
  await sleep(2600);

  await goto(page, '#/', 2400);
  await page.evaluate((name) => {
    [...document.querySelectorAll('.room-card')]
      .find((c) => c.textContent.includes(name))
      ?.querySelector('a, button')?.click();
  }, roomName);
  await sleep(2600);
  r.check('單張照片不顯示縮圖列',
    await page.evaluate(() => document.querySelectorAll('.detail-gallery__thumbs').length), 0);

  // --- 全部移除後回到佔位圖 -------------------------------------------------
  await openEditForm(page);
  await removeAllTiles(page);
  r.ok('清空後顯示空狀態說明',
    await page.evaluate(() => !!document.querySelector('.photo-grid__empty')));
  await clickModal(page, '儲存變更');
  await sleep(2600);

  await goto(page, '#/', 2600);
  const fallback = await page.evaluate((name) => {
    const img = [...document.querySelectorAll('.room-card')]
      .find((c) => c.textContent.includes(name))?.querySelector('img');
    return img ? { src: img.getAttribute('src'), w: img.naturalWidth } : null;
  }, roomName);
  r.ok('沒有照片時用佔位圖', fallback?.src.includes('room-fallback.svg'), fallback?.src);
  r.ok('佔位圖真的載得出來（不是破圖）', (fallback?.w ?? 0) > 0, `naturalWidth=${fallback?.w}`);

  // =========================================================================
  // 訂單管理的房源篩選
  // =========================================================================
  await goto(page, '#/admin/orders', 2600);

  const totalTitle = await ordersTitle(page);
  r.ok('未篩選時標題是「全部訂單（M）」', /^全部訂單（\d+）$/.test(totalTitle), totalTitle);

  const target = await page.evaluate(() => {
    const names = [...document.querySelectorAll('tbody tr')].map((tr) => tr.children[1]?.textContent.trim());
    const counts = new Map();
    names.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
    // 挑一間「有訂單但不是全部」的房，篩選才驗得出差異
    const pick = [...counts.entries()].find(([, c]) => c < names.length);
    return pick ? { name: pick[0], count: pick[1], total: names.length } : null;
  });

  if (!target) {
    r.ok('訂單房源篩選：資料不足以驗證', false, '示範資料中所有訂單都屬於同一房源');
  } else {
    await page.evaluate((name) => {
      const sel = document.querySelector('#ord-room');
      const opt = [...sel.options].find((o) => o.textContent.trim() === name);
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, target.name);
    await page.evaluate(() => document.querySelector('.filter-bar button[type="submit"]')?.click());
    await sleep(2400);

    const filtered = await page.evaluate(() =>
      [...document.querySelectorAll('tbody tr')].map((tr) => tr.children[1]?.textContent.trim()));
    r.ok('依房源篩選後只剩該房源的訂單',
      filtered.length > 0 && filtered.every((n) => n === target.name),
      `${filtered.length} 筆：${[...new Set(filtered)].join('、')}`);

    const filteredTitle = await ordersTitle(page);
    r.ok('有篩選時標題是「符合條件的訂單（N / M）」',
      new RegExp(`^符合條件的訂單（${filtered.length} / ${target.total}）$`).test(filteredTitle),
      filteredTitle);

    // 日期區間寫反 → 說明，而不是空清單
    await page.evaluate(() => {
      const set = (id, v) => {
        const el = document.querySelector(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('#ord-from', '2026-09-30');
      set('#ord-to', '2026-09-01');
      document.querySelector('.filter-bar button[type="submit"]')?.click();
    });
    await sleep(1200);
    r.ok('入住日起始晚於結束時給說明',
      (await toasts(page)).some((t) => t.includes('入住日的起始不可晚於結束')),
      (await toasts(page)).join(' / '));
    r.ok('且不是回傳空清單',
      await page.evaluate(() => document.querySelectorAll('tbody tr').length > 0));

    // 清除條件要一併清掉房源選擇
    await clickByText(page, '清除條件');
    await sleep(2400);
    r.check('清除條件後房源回到「全部房源」',
      await page.evaluate(() => document.querySelector('#ord-room')?.value ?? '(找不到)'), '');
    r.ok('清除後標題回到「全部訂單（M）」',
      /^全部訂單（\d+）$/.test(await ordersTitle(page)));
  }

  r.done(problems);
  await browser.close();
}

// ===========================================================================
// 資料庫模式：上傳邊界（FR-050e、FR-050f）
// ===========================================================================
{
  const { browser, page, problems } = await openPage();
  await login(page, 'admin@sunny.com', 'admin123');

  // 自己建一間臨時房源，全程不碰正式房源的照片
  const roomId = await page.evaluate(async (name) => {
    const repo = await import('/src/data/repository.js');
    const room = await repo.createRoom({
      name, type: 'double', maxGuests: 2, nightlyPrice: 1000,
      status: 'maintenance', description: 'e2e 測試用，可安全刪除',
      images: [], amenities: [], features: []
    });
    return room.id;
  }, TMP_ROOM);
  r.ok('臨時房源已建立', Boolean(roomId), String(roomId));

  /** 這個 storage ref 目前在雲端還在不在 */
  const exists = (ref) => page.evaluate(async (value) => {
    const repo = await import('/src/data/repository.js');
    const url = repo.resolveRoomPhotoUrl(value);
    if (!url) return false;
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
    return res.ok;
  }, ref);

  const currentRefs = (page) => page.evaluate(async (id) => {
    const repo = await import('/src/data/repository.js');
    const room = await repo.getRoomById(id);
    return room?.images ?? [];
  }, roomId);

  // --- 先存一張「既有照片」 -------------------------------------------------
  r.check('編輯的是臨時房源', await openEditForm(page, TMP_ROOM), TMP_ROOM);
  await upload(page, [PHOTOS[3]]);
  r.check('上傳後浮窗裡有一張照片', await tileCount(page), 1);
  r.ok('找得到「儲存變更」按鈕', await clickModal(page, '儲存變更'),
    await page.evaluate(() => [...document.querySelectorAll('form.card button')].map((b) => b.textContent.trim()).join('/')));
  await sleep(3000);

  const saved = (await currentRefs(page))[0];
  r.ok('照片已存成房源的既有照片', Boolean(saved) && String(saved).startsWith('storage:'), String(saved));
  r.ok('檔案確實在 storage 中', await exists(saved));

  // --- 移除既有照片後按取消 → 檔案不能被刪（FR-050f）-----------------------
  r.ok('臨時房源的編輯浮窗可開啟（移除既有照片）',
    Boolean(await openEditForm(page, TMP_ROOM)), '關鍵字篩選沒找到臨時房源');
  await removeTile(page, 0);
  await clickModal(page, '取消編輯');
  await sleep(2400);

  r.ok('移除既有照片後取消編輯，檔案仍在', await exists(saved));
  r.check('房源的照片清單也沒被改動', await currentRefs(page), [saved]);

  // --- 上傳新照片後按取消 → 孤兒檔要被清掉（FR-050f）----------------------
  await openEditForm(page, TMP_ROOM);
  const before = await currentRefs(page);
  await upload(page, [PHOTOS[4]]);
  const orphan = await page.evaluate(() => {
    // 新上傳的那張是清單中最後一個，且不在原本的 images 裡
    const imgs = [...document.querySelectorAll('.photo-tile img')];
    return imgs[imgs.length - 1]?.getAttribute('src') ?? null;
  });
  r.ok('新照片已上傳到雲端', Boolean(orphan) && orphan.includes('/room-photos/'), String(orphan));

  await clickModal(page, '取消編輯');
  await sleep(3000);

  const orphanGone = !orphan ? false : await page.evaluate(async (url) => {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
    return !res.ok;
  }, orphan);
  r.ok('取消編輯後未保存的上傳已被清除', orphanGone, String(orphan));
  r.check('原本的照片不受影響', await currentRefs(page), before);

  await browser.close();

  // --- 會員不得直接寫入 room-photos（FR-050e）------------------------------
  const guest = await openPage();
  await login(guest.page, 'guest@sunny.com', 'guest123');
  const denied = await guest.page.evaluate(async () => {
    const repo = await import('/src/data/repository.js');
    try {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
      await repo.uploadRoomPhoto('probe', blob);
      return { blocked: false, message: '(上傳成功了)' };
    } catch (err) {
      return { blocked: true, message: err?.message ?? String(err) };
    }
  });
  r.ok('會員直接上傳 room-photos 被擋下', denied.blocked, denied.message);
  await guest.browser.close();

  // --- 收尾：刪掉臨時房源與它的照片 ----------------------------------------
  const cleanup = await openPage();
  await login(cleanup.page, 'admin@sunny.com', 'admin123');
  // 全部同名的都刪——測試中途失敗過的話會留下不只一間
  const removed = await cleanup.page.evaluate(async (name) => {
    const repo = await import('/src/data/repository.js');
    const rooms = await repo.getRooms({});
    const targets = rooms.filter((x) => x.name === name);
    for (const room of targets) {
      for (const ref of room.images ?? []) {
        try { await repo.deleteRoomPhoto(ref); } catch { /* 檔案已不在就算了 */ }
      }
      await repo.deleteRoom(room.id);
    }
    return targets.length;
  }, TMP_ROOM);
  r.ok('臨時房源已清除', removed >= 1, `刪除 ${removed} 間`);
  await cleanup.browser.close();

  const summary = r.done(problems);
  process.exit(summary.failed ? 1 : 0);
}
