/**
 * 會員端訂單：狀態分頁、取消與退款的界線。
 *
 * 全程跑示範模式——這一支會真的取消訂單，不該動到正式資料。
 */

import { openPage, goto, login, sleep, createReporter } from './harness.mjs';

const r = createReporter('會員端訂單');
const { browser, page, problems, consoleIssues } = await openPage({ demo: true, height: 1400 });

await login(page, 'guest@sunny.com', 'guest123');
await goto(page, '#/orders', 3000);

// --- 狀態分頁 -------------------------------------------------------------

const tabs = await page.evaluate(() =>
  [...document.querySelectorAll('.type-tabs button')].map((b) => b.textContent.trim()));
r.ok('有狀態分頁', tabs.length > 1, tabs.join(' / '));
r.ok('第一個是「全部」', tabs[0]?.startsWith('全部'), tabs[0]);

// 各分頁筆數相加應等於全部
const counts = await page.evaluate(() =>
  [...document.querySelectorAll('.type-tabs button')].map((b) =>
    Number(b.querySelector('.type-tabs__count')?.textContent ?? 0)));
r.check('各分頁筆數相加等於全部',
  counts.slice(1).reduce((a, b) => a + b, 0), counts[0]);

// 取消／退款的卡片要有底色，用來與仍然有效的訂單區隔
const tinted = await page.evaluate(() =>
  [...document.querySelectorAll('.order-card--inactive')]
    .map((c) => c.querySelector('.tag')?.textContent.trim()));
r.ok('只有已取消與已退款加底色',
  tinted.every((t) => t.includes('已取消') || t.includes('已退款')), tinted.join('/'));

// --- 取消訂單（FR-035a）---------------------------------------------------

const ids = await page.evaluate(async () => {
  const repo = await import('/src/data/repository.js');
  const orders = await repo.getOrders({});
  return {
    pending: orders.find((o) => o.status === 'pending-payment')?.id ?? null,
    confirmed: orders.find((o) => o.status === 'confirmed')?.id ?? null
  };
});

if (!ids.confirmed) {
  r.ok('取消測試：找不到已確認訂單', false);
} else {
  await goto(page, `#/orders/${ids.confirmed}`, 2200);
  r.ok('已確認訂單沒有取消鈕（要走退款審核）', !(await hasCancel()));

  r.check('資料層擋下已確認訂單的取消',
    await page.evaluate(async (id) => {
      const m = await import('/src/data/orders.js');
      try { await m.cancelOrder(id); return '沒有被擋'; }
      catch (e) { return e.code ?? e.message; }
    }, ids.confirmed),
    'ORDER_NOT_CANCELLABLE');
}

if (!ids.pending) {
  r.ok('取消測試：找不到待付款訂單', false);
} else {
  await goto(page, `#/orders/${ids.pending}`, 2200);
  r.ok('待付款訂單有取消鈕', await hasCancel());

  // 使用者在二次確認選「否」：不該有任何變化
  await page.evaluate(() => { window.__confirmAnswer = false; });
  await clickCancel();
  await sleep(1500);
  r.check('選「否」時訂單不變',
    await status(ids.pending), 'pending-payment');

  // 選「是」
  await page.evaluate(() => { window.__confirmAnswer = true; });
  await clickCancel();
  await sleep(2800);

  r.ok('有二次確認且說明不可復原',
    (await page.evaluate(() => window.__confirmMessage ?? '')).includes('無法復原'));
  r.check('取消後狀態', await status(ids.pending), 'cancelled');
  r.check('取消原因與逾期取消分開',
    await page.evaluate(async (id) => {
      const m = await import('/src/data/orders.js');
      return (await m.getOrder(id)).cancelReason;
    }, ids.pending),
    'member-cancelled');

  r.check('房況已釋出',
    await page.evaluate(async (id) => {
      const repo = await import('/src/data/repository.js');
      const o = await repo.getOrderById(id);
      const occupied = await repo.getOccupiedRoomIds(o.checkIn, o.checkOut);
      return occupied.has(o.roomId) ? '仍佔用' : '已釋出';
    }, ids.pending),
    '已釋出');

  r.ok('取消後按鈕消失', !(await hasCancel()));
}

function hasCancel() {
  return page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '取消訂單'));
}
function clickCancel() {
  return page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消訂單')?.click());
}
function status(id) {
  return page.evaluate(async (orderId) => {
    const m = await import('/src/data/orders.js');
    return (await m.getOrder(orderId)).status;
  }, id);
}

const summary = r.done(problems, consoleIssues);
await browser.close();
process.exit(summary.failed ? 1 : 0);
