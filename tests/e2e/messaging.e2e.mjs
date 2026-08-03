/**
 * 評論回覆（FR-103d）、會員／管理員私訊（FR-123 ~ FR-127），
 * 以及待付款訂單在列表上的取消入口（FR-035a）。
 *
 * 全程跑示範模式：這一支會真的送出訊息、真的公開一則回覆、真的取消訂單。
 * 私訊的權限邊界在資料庫模式是由 RLS 與 stamp_message_sender trigger 執行的，
 * 那一層由 supabase/migrations.sql 末端的驗證清單以 SQL 驗，
 * 不在這裡重複——瀏覽器測不到「繞過前端直接寫入」的情形。
 */

import { openPage, goto, login, sleep, createReporter } from './harness.mjs';

const r = createReporter('私訊與評論回覆');

const bubbles = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.msg-bubble__body')].map((b) => b.textContent.trim()));

async function send(page, text) {
  await page.evaluate((t) => {
    const input = document.querySelector('#msg-input');
    input.value = t;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.msg-thread__form').requestSubmit();
  }, text);
  await sleep(2600);
}

// ===========================================================================
// 會員端：客服訊息
// ===========================================================================
{
  const { browser, page, problems, consoleIssues } = await openPage({ demo: true, height: 1200 });
  await login(page, 'guest@sunny.com', 'guest123');
  await goto(page, '#/messages', 2800);

  r.ok('會員導覽有「客服訊息」', await page.evaluate(() =>
    [...document.querySelectorAll('header a')].some((a) => a.textContent.trim() === '客服訊息')));
  r.ok('種子對話載得出來', (await bubbles(page)).length >= 2);
  r.check('對話區自己捲動，不讓整頁跟著長',
    await page.evaluate(() => getComputedStyle(document.querySelector('.msg-thread__list')).overflowY),
    'auto');

  // 空訊息要擋下，而不是送出一則空白
  await page.evaluate(() => document.querySelector('.msg-thread__form').requestSubmit());
  await sleep(800);
  r.check('空訊息被擋下',
    await page.evaluate(() => {
      const e = document.querySelector('.msg-thread__form .field__error');
      return e && !e.hidden ? e.textContent.trim() : null;
    }),
    '請輸入訊息內容。');

  const before = (await bubbles(page)).length;
  await send(page, '請問可以加床嗎？');
  const after = await bubbles(page);
  r.check('送出後多一則', after.length, before + 1);
  r.check('內容正確', after[after.length - 1], '請問可以加床嗎？');
  r.ok('輸入框已清空',
    await page.evaluate(() => document.querySelector('#msg-input').value === ''));

  r.check('會員送出的訊息標記為 member',
    await page.evaluate(async () => {
      const repo = await import('/src/data/repository.js');
      const me = (await repo.getSession()).user;
      const all = await repo.getMessages(me.id);
      return all[all.length - 1].senderRole;
    }),
    'member');

  r.done(problems, consoleIssues);
  await browser.close();
}

// ===========================================================================
// 管理員端：會員訊息 + 評論回覆
// ===========================================================================
{
  const { browser, page, problems, consoleIssues } = await openPage({ demo: true, height: 1200 });
  await login(page, 'admin@sunny.com', 'admin123');

  // --- 討論串清單 ---------------------------------------------------------
  await goto(page, '#/admin/messages', 2800);
  r.ok('後台導覽有「會員訊息」', await page.evaluate(() =>
    [...document.querySelectorAll('a')].some((a) => a.textContent.trim() === '會員訊息')));
  r.ok('看得到討論串', await page.evaluate(() =>
    document.querySelectorAll('.review-item').length > 0));

  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => b.textContent.trim() === '開啟對話')?.click());
  await sleep(2600);

  r.ok('對話標題含會員名稱',
    (await page.evaluate(() => document.querySelector('.page-header h1')?.textContent ?? ''))
      .includes('示範會員'));
  r.ok('管理員之間看得出是哪一位同仁回的（FR-127）',
    await page.evaluate(() => [...document.querySelectorAll('.msg-bubble__meta')]
      .some((m) => m.textContent.includes('客服・系統管理員'))));

  const beforeReply = (await bubbles(page)).length;
  await send(page, '可以的，加床每晚 500 元，請於入住前告知。');
  r.check('回覆後多一則', (await bubbles(page)).length, beforeReply + 1);

  r.check('管理員送出的訊息標記為 admin',
    await page.evaluate(async () => {
      const repo = await import('/src/data/repository.js');
      const threads = await repo.getMessageThreads();
      const all = await repo.getMessages(threads[0].userId);
      return all[all.length - 1].senderRole;
    }),
    'admin');

  r.check('回覆寫入操作日誌（FR-114）',
    await page.evaluate(async () => {
      const repo = await import('/src/data/repository.js');
      const logs = await repo.getAdminLogs({});
      return logs.filter((l) => l.action === 'message.send').length > 0;
    }),
    true);
  r.ok('日誌不含訊息內容（FR-118）',
    await page.evaluate(async () => {
      const repo = await import('/src/data/repository.js');
      const logs = await repo.getAdminLogs({});
      return logs.filter((l) => l.action === 'message.send')
        .every((l) => !JSON.stringify(l.summary).includes('加床'));
    }));

  // 讀過之後，該討論串不該再顯示未讀
  await goto(page, '#/admin/messages', 2600);
  r.check('開啟過的討論串未讀數歸零',
    await page.evaluate(async () => {
      const repo = await import('/src/data/repository.js');
      return (await repo.getMessageThreads())[0].unread;
    }),
    0);

  // --- 評論回覆（FR-103d）-------------------------------------------------
  await goto(page, '#/admin/reviews', 2600);
  await page.evaluate(() => {
    const sel = document.querySelector('#rev-status');
    sel.value = 'approved';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(2600);

  r.ok('已公開的評論有回覆鈕', await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '回覆評論')));

  await page.evaluate(() => {
    const sel = document.querySelector('#rev-status');
    sel.value = 'pending';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(2600);
  const pendingCount = await page.evaluate(() => document.querySelectorAll('.review-item').length);
  r.ok('待審核的評論沒有回覆鈕（前台看不到，回了沒人讀得到）',
    pendingCount === 0 || !(await page.evaluate(() =>
      [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '回覆評論'))));

  await page.evaluate(() => {
    const sel = document.querySelector('#rev-status');
    sel.value = 'approved';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(2600);
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => b.textContent.trim() === '回覆評論')?.click());
  await sleep(1600);

  r.ok('回覆表單引用了原始評論', await page.evaluate(() =>
    !!document.querySelector('.review-quote')?.textContent.trim()));

  const REPLY = '感謝您的回饋！我們已請房務加強夜間巡查。';
  await page.evaluate((text) => {
    const t = document.querySelector('#rev-reply');
    t.value = text;
    t.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.modal form').requestSubmit();
  }, REPLY);
  await sleep(2800);

  r.check('後台顯示回覆',
    await page.evaluate(() => document.querySelector('.review-reply__body')?.textContent.trim()),
    REPLY);
  r.ok('按鈕改為「編輯回覆」', await page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '編輯回覆')));
  r.check('回覆寫入操作日誌',
    await page.evaluate(async () => {
      const repo = await import('/src/data/repository.js');
      return (await repo.getAdminLogs({})).some((l) => l.action === 'review.reply');
    }),
    true);

  // 前台要看得到同一則回覆
  const roomId = await page.evaluate(async () => {
    const repo = await import('/src/data/repository.js');
    return (await repo.getReviews({ status: 'approved' })).find((x) => x.adminReply)?.roomId ?? null;
  });
  await goto(page, `#/rooms/${roomId}`, 2800);
  r.check('前台詳情頁公開顯示業者回覆',
    await page.evaluate(() => document.querySelector('.review-reply__body')?.textContent.trim()),
    REPLY);

  // 清空即收回
  await goto(page, '#/admin/reviews', 2600);
  await page.evaluate(() => {
    const sel = document.querySelector('#rev-status');
    sel.value = 'approved';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(2600);
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => b.textContent.trim() === '編輯回覆')?.click());
  await sleep(1600);
  await page.evaluate(() => {
    const t = document.querySelector('#rev-reply');
    t.value = '';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.modal form').requestSubmit();
  });
  await sleep(2800);
  r.check('清空內容即收回回覆',
    await page.evaluate(() => document.querySelectorAll('.review-reply').length), 0);

  r.done(problems, consoleIssues);
  await browser.close();
}

// ===========================================================================
// 待付款訂單的取消入口（FR-035a）
// ===========================================================================
{
  const { browser, page, problems, consoleIssues } = await openPage({ demo: true, height: 1200 });
  await login(page, 'guest@sunny.com', 'guest123');
  await goto(page, '#/orders', 3000);

  const pending = await page.evaluate(async () => {
    const repo = await import('/src/data/repository.js');
    return (await repo.getOrders({})).find((o) => o.status === 'pending-payment')?.id ?? null;
  });

  if (!pending) {
    r.ok('取消入口：示範資料沒有待付款訂單', false);
  } else {
    const actions = await page.evaluate((id) => {
      const card = [...document.querySelectorAll('.order-card')]
        .find((c) => c.querySelector(`a[href^="#/orders/${id}"]`));
      return card ? [...card.querySelectorAll('a')].map((a) => a.textContent.trim()) : null;
    }, pending);
    r.ok('列表上的待付款訂單有「取消訂單」入口',
      actions?.includes('取消訂單'), JSON.stringify(actions));
    r.ok('同一張卡片也有「前往付款」', actions?.includes('前往付款'));

    // 入口帶著 action=cancel，詳情頁應把焦點送到取消鈕上
    await goto(page, `#/orders/${pending}?action=cancel`, 2800);
    r.check('取消入口進來時焦點落在取消鈕',
      await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null),
      '取消訂單');
  }

  const summary = r.done(problems, consoleIssues);
  await browser.close();
  process.exit(summary.failed ? 1 : 0);
}
