/**
 * 第三層：權限邊界（RLS、守門 trigger、稽核不可竄改）。
 *
 * 為什麼不用瀏覽器：這一層要驗的正是「繞過前端直接打資料庫」的情形。
 * Puppeteer 測得到畫面上按不到，測不到有人拿 anon key 自己發請求——
 * 而那才是 RLS 真正要擋的攻擊面。因此這裡直接打 PostgREST 與 Auth，
 * 不開瀏覽器，也不載入應用程式的任何一支模組。
 *
 * 對應：SC-008、SC-019、SC-026、SC-027、SC-029、FR-085、FR-118，
 * 以及 supabase/migrate-messages.sql 末端原本只能人工執行的驗證清單。
 *
 * ⚠️ 會在正式資料庫留下一筆紀錄。
 *    「偽造 sender_role」這一項必須真的插入成功才驗得到 trigger 有沒有蓋章，
 *    而 messages 依設計只增不刪（沒有 delete 政策，任何身分都刪不掉），
 *    所以每跑一次就會在示範會員的討論串多一則明確標示的測試訊息。
 *    不想留痕跡時設 SUNNY_RLS_SKIP_APPEND=1 略過該項。
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// 憑證：從專案的 src/config.js 讀，不另外維護一份
// ---------------------------------------------------------------------------

const configSource = fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'src', 'config.js'), 'utf8'
);
const pick = (key) => configSource.match(new RegExp(`${key}:\\s*'([^']*)'`))?.[1] ?? '';

const BASE = pick('SUPABASE_URL');
const ANON = pick('SUPABASE_ANON_KEY');

if (!BASE || !ANON) {
  console.log('src/config.js 沒有憑證（示範模式）——這一層測的是資料庫的權限邊界，跳過。');
  process.exit(0);
}

const SKIP_APPEND = process.env.SUNNY_RLS_SKIP_APPEND === '1';

// ---------------------------------------------------------------------------
// 最小 REST 客戶端
// ---------------------------------------------------------------------------

async function signIn(email, password) {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`登入 ${email} 失敗：${JSON.stringify(j)}`);
  return { jwt: j.access_token, uid: j.user.id };
}

/**
 * @param who   { jwt } 或 null（null = 匿名，只帶 anon key）
 * @returns {{ status:number, code:string|null, message:string, rows:any[]|null }}
 *          rows 只有在回應是陣列時才有值；PostgREST 的錯誤是物件。
 */
async function rest(who, pathname, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: ANON,
    Authorization: `Bearer ${who?.jwt ?? ANON}`
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${BASE}/rest/v1/${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });

  const raw = await res.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { /* 非 JSON 就保持 null */ }

  return {
    status: res.status,
    code: (parsed && !Array.isArray(parsed) && parsed.code) || null,
    message: (parsed && !Array.isArray(parsed) && (parsed.message ?? parsed.error_description)) || raw.slice(0, 200),
    rows: Array.isArray(parsed) ? parsed : null
  };
}

// ---------------------------------------------------------------------------
// 迷你斷言（與 e2e/harness.mjs 同一套輸出格式，方便一起讀）
// ---------------------------------------------------------------------------

const results = { passed: 0, failed: 0, skipped: 0 };

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results[ok ? 'passed' : 'failed'] += 1;
  console.log(`${ok ? '✅' : '❌'} ${label}`
    + (ok ? '' : `\n     預期 ${JSON.stringify(expected)}，實際 ${JSON.stringify(actual)}`));
}

function ok(label, condition, detail = '') {
  results[condition ? 'passed' : 'failed'] += 1;
  console.log(`${condition ? '✅' : '❌'} ${label}${condition ? '' : `  ${detail}`}`);
}

function skip(label, why) {
  results.skipped += 1;
  console.log(`⏭️  ${label} — ${why}`);
}

/**
 * 被 RLS 或守門 trigger 擋下：403/401，或 PostgREST 的 42501 / P0001。
 *
 * PGRST* 開頭的錯誤（欄位名打錯、資料表不存在之類）刻意**不算**擋下——
 * 那是這支測試自己寫錯了。放行的話，日後一次改欄位名就會讓底下一整批
 * 安全斷言默默變成假通過，比沒測還糟。
 */
const blocked = (r) => {
  if (String(r.code ?? '').startsWith('PGRST')) return false;
  return [401, 403].includes(r.status) || ['42501', 'P0001'].includes(r.code);
};

// ===========================================================================

console.log('\n=== 權限邊界（直接打資料庫，不經瀏覽器）===');

const admin = await signIn('admin@sunny.com', 'admin123');
const guest = await signIn('guest@sunny.com', 'guest123');
ok('管理員與示範會員都能登入', Boolean(admin.jwt && guest.jwt));

// ---------------------------------------------------------------------------
// 匿名可讀範圍（T011）
// ---------------------------------------------------------------------------

const ANON_READABLE = ['rooms', 'site_content', 'system_settings', 'room_risk_checks'];
const ANON_HIDDEN = ['orders', 'profiles', 'messages', 'admin_logs', 'favorites', 'refunds'];

for (const table of ANON_READABLE) {
  const r = await rest(null, `${table}?select=*&limit=1`);
  ok(`匿名可讀 ${table}`, r.status === 200 && (r.rows?.length ?? 0) > 0,
    `${r.status} ${r.message}`);
}
for (const table of ANON_HIDDEN) {
  const r = await rest(null, `${table}?select=*&limit=1`);
  // 讀不到可以是 403，也可以是「政策過濾成 0 筆」。兩者都算擋住了，
  // 但「200 且有資料」一定是漏的。
  ok(`匿名讀不到 ${table}`, blocked(r) || (r.rows?.length ?? 0) === 0,
    `${r.status} 回了 ${r.rows?.length} 筆`);
}

// 匿名看不到未公開的評論（SC-029）
{
  const anonRows = (await rest(null, 'reviews?select=id,status')).rows ?? [];
  const allRows = (await rest(admin, 'reviews?select=id,status')).rows ?? [];
  const pending = allRows.filter((x) => x.status !== 'approved');
  ok('資料庫裡確實有未公開的評論可供比對', pending.length > 0, `pending=${pending.length}`);
  check('匿名看不到任何未公開評論（SC-029）',
    anonRows.filter((x) => x.status !== 'approved').length, 0);
  check('匿名看到的筆數等於已公開的筆數',
    anonRows.length, allRows.filter((x) => x.status === 'approved').length);
}

// 匿名不得寫入
{
  const r = await rest(null, 'rooms', {
    method: 'POST',
    body: { name: '__anon 不該建得起來', type: 'single', max_guests: 1, nightly_price: 1 }
  });
  ok('匿名無法新增房源', blocked(r), `${r.status} ${r.code} ${r.message}`);
}

// ---------------------------------------------------------------------------
// 會員的邊界（SC-008、SC-019）
// ---------------------------------------------------------------------------

// 會員直接寫 rooms 要被 RLS 擋（SC-008）
{
  const r = await rest(guest, 'rooms', {
    method: 'POST',
    body: { name: '__member 不該建得起來', type: 'single', max_guests: 1, nightly_price: 1 }
  });
  ok('會員無法新增房源（SC-008）', blocked(r), `${r.status} ${r.code} ${r.message}`);

  const room = (await rest(null, 'rooms?select=id,nightly_price&limit=1')).rows?.[0];
  const upd = await rest(guest, `rooms?id=eq.${room.id}`, {
    method: 'PATCH', body: { nightly_price: 1 }, prefer: 'return=representation'
  });
  // 政策的 USING 讓那一列對會員不可見時，PostgREST 會回 200 + 0 筆，
  // 不是 403。要看有沒有改到東西，不能只看狀態碼。
  ok('會員無法改房價（SC-008）', blocked(upd) || upd.rows?.length === 0,
    `${upd.status} 改到 ${upd.rows?.length} 列`);

  // 萬一上面那一項失敗，代表房價真的被改成 1 了——那是正式資料，改回去。
  // 測試找到漏洞是它的職責，順手破壞資料不是。
  const nowPrice = (await rest(null, `rooms?select=nightly_price&id=eq.${room.id}`))
    .rows?.[0]?.nightly_price;
  if (nowPrice !== room.nightly_price) {
    await rest(admin, `rooms?id=eq.${room.id}`, {
      method: 'PATCH', body: { nightly_price: room.nightly_price }
    });
    const restored = (await rest(null, `rooms?select=nightly_price&id=eq.${room.id}`))
      .rows?.[0]?.nightly_price;
    ok(`房價已還原為 ${room.nightly_price}`, restored === room.nightly_price, `目前 ${restored}`);
  }
}

// 會員讀不到別人的訂單（SC-019）
{
  const all = (await rest(admin, 'orders?select=id,user_id')).rows ?? [];
  const mine = all.filter((o) => o.user_id === guest.uid);
  const others = all.filter((o) => o.user_id !== guest.uid);
  ok('資料庫裡同時有自己的與別人的訂單', mine.length > 0 && others.length > 0,
    `自己 ${mine.length} / 別人 ${others.length}`);

  const visible = (await rest(guest, 'orders?select=id,user_id')).rows ?? [];
  check('會員只看得到自己的訂單', visible.filter((o) => o.user_id !== guest.uid).length, 0);
  check('會員看得到自己全部的訂單', visible.length, mine.length);

  // 指名別人的訂單 ID 也拿不到（SC-019 的原話）
  const byId = await rest(guest, `orders?select=id&id=eq.${others[0].id}`);
  check('指名別人的訂單 ID 仍讀不到（SC-019）', byId.rows?.length ?? -1, 0);

  // 也不能改別人的訂單
  const hijack = await rest(guest, `orders?id=eq.${others[0].id}`, {
    method: 'PATCH', body: { status: 'cancelled' }, prefer: 'return=representation'
  });
  ok('會員無法取消別人的訂單', blocked(hijack) || hijack.rows?.length === 0,
    `${hijack.status} 改到 ${hijack.rows?.length} 列`);
}

// 會員讀不到別人的收藏
{
  const all = (await rest(admin, 'favorites?select=id,user_id')).rows ?? [];
  const others = all.filter((f) => f.user_id !== guest.uid);
  const visible = (await rest(guest, 'favorites?select=id,user_id')).rows ?? [];
  if (!others.length) {
    skip('會員讀不到別人的收藏', '目前沒有其他會員的收藏可比對');
  } else {
    check('會員只看得到自己的收藏',
      visible.filter((f) => f.user_id !== guest.uid).length, 0);
  }
}

// 自行升權要被 trigger 擋（FR-085 的另一面）
{
  const before = (await rest(guest, `profiles?select=role&id=eq.${guest.uid}`)).rows?.[0]?.role;
  const r = await rest(guest, `profiles?id=eq.${guest.uid}`, {
    method: 'PATCH', body: { role: 'admin' }, prefer: 'return=representation'
  });
  const after = (await rest(guest, `profiles?select=role&id=eq.${guest.uid}`)).rows?.[0]?.role;
  ok('會員無法把自己改成管理員', blocked(r) || after === before,
    `${r.status} ${r.code}；改前 ${before} 改後 ${after}`);
  check('角色維持 member', after, 'member');
}

// ---------------------------------------------------------------------------
// 稽核日誌不可竄改（SC-027）——連管理員也不行
// ---------------------------------------------------------------------------

{
  const log = (await rest(admin, 'admin_logs?select=id,action&limit=1')).rows?.[0];
  ok('讀得到稽核日誌', Boolean(log), '日誌是空的，下面幾項會失去意義');

  const upd = await rest(admin, `admin_logs?id=eq.${log.id}`, {
    method: 'PATCH', body: { action: 'tampered' }, prefer: 'return=representation'
  });
  ok('管理員也不能修改稽核日誌（SC-027）', blocked(upd),
    `${upd.status} ${upd.code} ${upd.message}`);

  const del = await rest(admin, `admin_logs?id=eq.${log.id}`, { method: 'DELETE' });
  ok('管理員也不能刪除稽核日誌（SC-027）', blocked(del),
    `${del.status} ${del.code} ${del.message}`);

  const still = await rest(admin, `admin_logs?select=action&id=eq.${log.id}`);
  check('那一筆日誌原封不動', still.rows?.[0]?.action, log.action);

  const guestRead = await rest(guest, 'admin_logs?select=id&limit=1');
  ok('會員讀不到稽核日誌', blocked(guestRead) || guestRead.rows?.length === 0,
    `${guestRead.status} ${guestRead.rows?.length} 筆`);
}

// 日誌不得含密碼、金鑰或真實個資（SC-026、FR-118）
{
  const rows = (await rest(admin, 'admin_logs?select=*&order=created_at.desc&limit=200')).rows ?? [];
  const dump = JSON.stringify(rows);
  const leaks = [
    ['password', /"?password"?\s*[:=]/i],
    ['service_role', /service_role/i],
    ['JWT', /eyJ[A-Za-z0-9_-]{20,}\./],
    ['anon key', new RegExp(ANON.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))]
  ];
  for (const [name, re] of leaks) {
    ok(`日誌不含 ${name}（SC-026／FR-118）`, !re.test(dump));
  }
  ok(`已掃過 ${rows.length} 筆日誌`, rows.length > 0);
}

// ---------------------------------------------------------------------------
// 私訊（migrate-messages.sql 末端的清單）
// ---------------------------------------------------------------------------

{
  const all = (await rest(admin, 'messages?select=id,thread_user_id,sender_role,body')).rows ?? [];
  ok('管理員讀得到討論串', all.length > 0, `${all.length} 則`);

  const foreign = all.filter((m) => m.thread_user_id !== guest.uid);
  const guestVisible = (await rest(guest, 'messages?select=id,thread_user_id')).rows ?? [];
  check('會員只看得到自己的討論串',
    guestVisible.filter((m) => m.thread_user_id !== guest.uid).length, 0);

  if (foreign.length) {
    const byId = await rest(guest, `messages?select=id&id=eq.${foreign[0].id}`);
    check('指名別人的訊息 ID 仍讀不到', byId.rows?.length ?? -1, 0);
    const byThread = await rest(guest,
      `messages?select=id&thread_user_id=eq.${foreign[0].thread_user_id}`);
    check('指名別人的討論串仍讀不到', byThread.rows?.length ?? -1, 0);
  } else {
    skip('讀不到別人的討論串', '目前沒有其他人的討論串可比對');
  }

  // 把訊息掛到別人的討論串 → 被 RLS 擋
  const intrude = await rest(guest, 'messages', {
    method: 'POST',
    body: { thread_user_id: admin.uid, body: '__不該進得去' },
    prefer: 'return=representation'
  });
  ok('會員無法把訊息塞進別人的討論串', blocked(intrude),
    `${intrude.status} ${intrude.code} ${intrude.message}`);

  // 訊息送出後不可修改、不可刪除
  if (all.length) {
    const target = all[0];
    const edit = await rest(admin, `messages?id=eq.${target.id}`, {
      method: 'PATCH', body: { body: '__被改掉了' }, prefer: 'return=representation'
    });
    const nowBody = (await rest(admin, `messages?select=body&id=eq.${target.id}`)).rows?.[0]?.body;
    ok('訊息送出後不可修改', blocked(edit) || nowBody === target.body,
      `${edit.status} ${edit.code} ${edit.message}`);
    check('內容確實沒被改動', nowBody, target.body);

    const del = await rest(admin, `messages?id=eq.${target.id}`, { method: 'DELETE' });
    const stillThere = (await rest(admin, `messages?select=id&id=eq.${target.id}`)).rows?.length;
    ok('訊息不可刪除（沒有 delete 政策）', blocked(del) || stillThere === 1,
      `${del.status} ${del.code}`);
  }

  // 偽造 sender_role → 由 stamp_message_sender trigger 蓋回真實身分
  if (SKIP_APPEND) {
    skip('偽造 sender_role 會被蓋回 member', 'SUNNY_RLS_SKIP_APPEND=1（該項會永久新增一則訊息）');
  } else {
    const forged = await rest(guest, 'messages', {
      method: 'POST',
      body: {
        thread_user_id: guest.uid,
        sender_role: 'admin',                     // ← 這就是要被擋掉的偽造
        body: '[自動測試] 權限邊界驗證，可忽略。'
      },
      prefer: 'return=representation'
    });
    ok('會員可在自己的討論串發言', forged.status === 201,
      `${forged.status} ${forged.code} ${forged.message}`);
    check('偽造的 sender_role 被蓋回 member', forged.rows?.[0]?.sender_role, 'member');
  }
}

// ---------------------------------------------------------------------------
// 評論回覆：只有管理員回得了，且由伺服器蓋章
// ---------------------------------------------------------------------------

{
  const approved = (await rest(admin,
    'reviews?select=id,status,admin_reply,admin_reply_at,admin_reply_by&status=eq.approved')).rows ?? [];
  const target = approved.find((x) => !x.admin_reply);

  if (!target) {
    skip('評論回覆的邊界', '找不到尚未回覆的已公開評論');
  } else {
    // 會員寫 admin_reply：政策的 USING 只給管理員，因此那一列對會員不可見。
    // PostgREST 回的是 204／影響 0 列，不是 42501——要看資料有沒有變。
    const sneak = await rest(guest, `reviews?id=eq.${target.id}`, {
      method: 'PATCH', body: { admin_reply: '__會員偽裝業者回覆' },
      prefer: 'return=representation'
    });
    const afterSneak = (await rest(admin,
      `reviews?select=admin_reply&id=eq.${target.id}`)).rows?.[0]?.admin_reply;
    ok('會員寫不進業者回覆（要看資料，不能只看狀態碼）',
      blocked(sneak) || sneak.rows?.length === 0, `${sneak.status} 改到 ${sneak.rows?.length} 列`);
    check('評論的回覆欄位沒被動過', afterSneak, null);

    // 超長回覆被 check 約束擋下
    const tooLong = await rest(admin, `reviews?id=eq.${target.id}`, {
      method: 'PATCH', body: { admin_reply: 'あ'.repeat(1001) }, prefer: 'return=representation'
    });
    ok('回覆超過 1000 字被擋下', tooLong.status >= 400,
      `${tooLong.status} ${tooLong.code} ${tooLong.message}`);

    // 管理員正常回覆 → 時間與作者由伺服器蓋章
    const reply = await rest(admin, `reviews?id=eq.${target.id}`, {
      method: 'PATCH',
      body: { admin_reply: '[自動測試] 感謝您的回饋。', admin_reply_by: guest.uid },
      prefer: 'return=representation'
    });
    const row = reply.rows?.[0];
    ok('管理員回覆成功', reply.status === 200 && Boolean(row?.admin_reply),
      `${reply.status} ${reply.code} ${reply.message}`);
    ok('回覆時間由伺服器蓋章', Boolean(row?.admin_reply_at), String(row?.admin_reply_at));
    check('回覆作者被蓋成實際操作者，不是送上來的值', row?.admin_reply_by, admin.uid);

    // 復原：清空回覆，連帶清掉蓋章
    const undo = await rest(admin, `reviews?id=eq.${target.id}`, {
      method: 'PATCH', body: { admin_reply: null }, prefer: 'return=representation'
    });
    check('清空後回覆為 null（收回回覆）', undo.rows?.[0]?.admin_reply, null);
    check('清空後回覆時間也一起清掉', undo.rows?.[0]?.admin_reply_at, null);
  }
}

// ---------------------------------------------------------------------------

console.log(`--- 通過 ${results.passed} / 失敗 ${results.failed}`
  + (results.skipped ? ` / 略過 ${results.skipped}` : '') + ' ---');
process.exit(results.failed ? 1 : 0);
