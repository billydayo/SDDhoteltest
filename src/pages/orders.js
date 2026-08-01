/**
 * 我的訂單與訂單確認頁（US3 / T055、T057）。
 *
 * 本階段包含：訂單列表、訂單詳情、待付款倒數、完成模擬付款、逾期處理。
 * 退款申請表單與審核狀態追蹤屬 US4（T060–T064），屆時擴充本檔即可。
 */

import { render, renderLoading, renderError, createEmptyState, createPageHeader, toast, toastError } from '../app.js';
import { listOrders, getOrder, payOrder, remainingMs, isPaymentTimeout } from '../data/orders.js';
import { getRoom } from '../data/rooms.js';
import { createPaymentCountdown } from '../components/payment-countdown.js';
import { formatTWD } from '../utils/money.js';
import {
  formatDate, formatDateRange, formatDateTime, todayInTaipei, isSameOrBefore
} from '../utils/dates.js';
import { ORDER_STATUS, orderStatusLabel, PAYMENT_METHODS } from '../data/vocabulary.js';
import { toUserMessage, isAppError } from '../utils/errors.js';
import {
  quoteRefund, refundUnavailableReason, validateReason, submitRefundRequest,
  refundsForOrder, refundQuota, REFUND_POLICY, REFUND_STATUS, refundStatusLabel
} from '../services/refunds.js';
import * as router from '../router.js';

// ---------------------------------------------------------------------------
// 訂單列表
// ---------------------------------------------------------------------------

/**
 * 目前選取的狀態子分頁。'' 代表全部。
 *
 * 放在模組層而非區域變數：付款倒數結束、完成付款等動作都會重跑 renderOrders()，
 * 每次都跳回「全部」的話，使用者剛才篩到的分頁就沒了。
 */
let statusTab = '';

/**
 * 訂單在畫面上的實際狀態。
 *
 * 逾期未付款的訂單在資料上仍是 pending-payment（要等 sweepExpiredOrders 掃過才會
 * 真的變成 cancelled），但標籤已經顯示「已取消（逾期未付款）」。分頁必須跟著
 * 看得到的標籤走，否則使用者會在「待付款」裡看到一筆寫著已取消的訂單。
 */
const displayStatus = (order) => (isPaymentTimeout(order) ? 'cancelled' : order.status);

/** 取消與退款：已經沒有住宿權益的訂單，列表上以底色與其他筆區隔 */
const INACTIVE_STATUSES = ['cancelled', 'refunded'];

export async function renderOrders() {
  renderLoading('正在載入訂單…');
  try {
    const orders = await listOrders();
    if (!orders.length) {
      statusTab = '';
      render([
        createPageHeader('我的訂單'),
        createEmptyState({
          title: '還沒有任何訂單',
          body: '瀏覽房源並完成訂房後，訂單會顯示在這裡。',
          actionLabel: '前往瀏覽房源',
          actionHref: '#/'
        })
      ]);
      return;
    }

    // 一併取得房名，讓列表不必只顯示 ID
    const rooms = await Promise.all(orders.map((o) => getRoom(o.roomId).catch(() => null)));
    const roomById = new Map(rooms.filter(Boolean).map((r) => [r.id, r]));

    const shown = statusTab
      ? orders.filter((o) => displayStatus(o) === statusTab)
      : orders;

    const nodes = [
      createPageHeader('我的訂單', listSummary(orders.length, shown.length)),
      createStatusTabs(orders)
    ];

    nodes.push(shown.length
      ? buildOrderList(shown, roomById)
      : createEmptyState({
          title: `沒有${orderStatusLabel(statusTab)}的訂單`,
          body: '切換到其他分頁可以查看你的其他訂單。'
        }));

    render(nodes);
  } catch (err) {
    renderError(err, { retry: renderOrders });
  }
}

function listSummary(total, shown) {
  return statusTab
    ? `${orderStatusLabel(statusTab)} ${shown} 筆／全部 ${total} 筆，依入住日排序。`
    : `共 ${total} 筆，依入住日排序。`;
}

/**
 * 狀態子分頁。
 *
 * 每個分頁都帶筆數，且**沒有訂單的狀態不顯示**——一個永遠是空的分頁只是雜訊。
 * 但「全部」永遠在，使用者才有回得去的地方。
 */
function createStatusTabs(orders) {
  const counts = new Map();
  orders.forEach((o) => {
    const s = displayStatus(o);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  });

  const nav = document.createElement('div');
  nav.className = 'type-tabs';
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', '訂單狀態分類');

  const tabs = [
    { value: '', label: '全部', count: orders.length },
    // 依 ORDER_STATUS 的順序排，而不是依資料出現的先後——
    // 分頁的位置必須固定，否則新增一筆訂單就會讓整排跳動
    ...Object.keys(ORDER_STATUS)
      .filter((s) => counts.has(s))
      .map((s) => ({ value: s, label: orderStatusLabel(s), count: counts.get(s) }))
  ];

  tabs.forEach(({ value, label, count }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(value === statusTab));
    btn.setAttribute('aria-label', `${label}，${count} 筆`);

    btn.append(document.createTextNode(label));
    const badge = document.createElement('span');
    badge.className = 'type-tabs__count';
    badge.textContent = String(count);
    badge.setAttribute('aria-hidden', 'true');   // 筆數已寫進 aria-label
    btn.append(badge);

    btn.addEventListener('click', () => {
      statusTab = value;
      renderOrders();
    });
    nav.append(btn);
  });

  return nav;
}

function buildOrderList(orders, roomById) {
  const ul = document.createElement('ul');
  ul.className = 'room-list';

  orders.forEach((order) => {
    const li = document.createElement('li');
    li.className = 'card order-card';

    // 已取消與已退款整張卡片加底色，掃過列表時一眼就能跳過它們
    if (INACTIVE_STATUSES.includes(displayStatus(order))) {
      li.classList.add('order-card--inactive');
    }

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.gap = 'var(--sp-2)';
    head.style.flexWrap = 'wrap';
    head.style.alignItems = 'center';

    const title = document.createElement('h3');
    title.style.margin = '0';
    const link = document.createElement('a');
    link.href = `#/orders/${order.id}`;
    link.textContent = roomById.get(order.roomId)?.name ?? '（房源已下架）';
    title.append(link);

    head.append(title, statusTag(order));

    const meta = document.createElement('p');
    meta.className = 'room-card__meta';
    meta.append(
      document.createTextNode(order.orderNo ?? order.id.slice(0, 8)),
      document.createTextNode(formatDateRange(order.checkIn, order.checkOut)),
      document.createTextNode(`${order.nights} 晚`),
      document.createTextNode(`${order.guestCount} 人`),
      document.createTextNode(formatTWD(order.totalAmount))
    );
    // 以分隔符號串接，避免文字全部黏在一起
    [...meta.childNodes].forEach((node, i) => {
      if (i > 0) meta.insertBefore(document.createTextNode('・'), node);
    });

    li.append(head, meta);

    if (order.status === 'pending-payment' && remainingMs(order) > 0) {
      li.append(createPaymentCountdown(order, renderOrders));
    }

    ul.append(li);
  });

  return ul;
}

function statusTag(order) {
  const span = document.createElement('span');
  const tone = ORDER_STATUS[order.status]?.tone ?? 'neutral';
  span.className = `tag tag--${tone}`;
  span.textContent = isPaymentTimeout(order)
    ? '已取消（逾期未付款）'
    : orderStatusLabel(order.status);
  return span;
}

// ---------------------------------------------------------------------------
// 訂單詳情 / 確認頁
// ---------------------------------------------------------------------------

export async function renderOrderDetail(context) {
  const orderId = context.params.id;
  renderLoading('正在載入訂單…');

  try {
    const order = await getOrder(orderId);
    // FR-034：他人的訂單一律回報查無此訂單，不透露它是否存在
    if (!order) {
      render(createEmptyState({
        title: '查無此訂單',
        body: '訂單不存在，或不屬於目前登入的帳號。',
        actionLabel: '回到我的訂單',
        actionHref: '#/orders'
      }));
      return;
    }

    const [room, refunds, quota] = await Promise.all([
      getRoom(order.roomId).catch(() => null),
      refundsForOrder(order.id).catch(() => []),
      refundQuota().catch(() => null)
    ]);
    render(buildDetail(order, room, refunds, quota, context));
  } catch (err) {
    renderError(err, { retry: () => renderOrderDetail(context) });
  }
}

function buildDetail(order, room, refunds, quota, context) {
  const frag = document.createDocumentFragment();

  const back = document.createElement('a');
  back.href = '#/orders';
  back.textContent = '← 回到我的訂單';
  back.style.display = 'inline-block';
  back.style.marginBottom = 'var(--sp-3)';
  frag.append(back);

  const isNew = order.status === 'pending-payment';
  frag.append(createPageHeader(
    isNew ? '訂單已建立' : '訂單詳情',
    `訂單編號 ${order.orderNo ?? order.id}`
  ));

  const card = document.createElement('section');
  card.className = 'card';

  const head = document.createElement('p');
  head.append(statusTag(order));
  card.append(head);

  card.append(buildSummary(order, room));

  if (order.status === 'pending-payment') {
    card.append(buildPaymentPanel(order, context));
  } else if (isPaymentTimeout(order)) {
    card.append(buildTimeoutPanel(order));
  }

  // US5 場景 1：入住結束後，從訂單進入撰寫評論
  const reviewEntry = buildReviewEntry(order);
  if (reviewEntry) card.append(reviewEntry);

  frag.append(card);

  // 退款區塊：申請紀錄在前，可申請時再顯示表單（US4）
  if (refunds.length) frag.append(buildRefundHistory(order, refunds));
  frag.append(buildRefundSection(order, quota, context));

  return frag;
}

// ---------------------------------------------------------------------------
// 退款（US4 / T061、T063）
// ---------------------------------------------------------------------------

/** 歷次申請與審核結果。駁回說明必須讓會員看得到（FR-039）。 */
function buildRefundHistory(order, refunds) {
  const section = document.createElement('section');
  section.className = 'card';
  section.style.marginTop = 'var(--sp-4)';

  const h2 = document.createElement('h2');
  h2.textContent = '退款申請紀錄';
  section.append(h2);

  /*
   * FR-039：退款遭駁回後訂單回到「已確認」，會員可再次申請。
   *
   * 但畫面上會同時出現「已確認」（訂單）與「退款已駁回」（申請）兩個標籤，
   * 使用者很容易誤以為訂單出了問題。這句話把兩者的關係講明白。
   */
  const latest = refunds[0];
  if (latest?.status === 'rejected' && order.status === 'confirmed') {
    const note = document.createElement('p');
    note.className = 'tag tag--info';
    note.style.display = 'block';
    note.style.padding = 'var(--sp-2) var(--sp-3)';
    note.style.marginBottom = 'var(--sp-3)';
    note.textContent = '退款申請未通過審核，你的訂單維持「已確認」狀態，'
      + '住宿權益不受影響。若仍需取消，可再次提出申請。';
    section.append(note);
  }

  const ul = document.createElement('ul');
  ul.className = 'review-list';

  refunds.forEach((refund) => {
    const li = document.createElement('li');
    li.className = 'review-item';

    const head = document.createElement('div');
    head.className = 'review-item__head';

    const status = document.createElement('span');
    const tone = REFUND_STATUS[refund.status]?.tone ?? 'neutral';
    status.className = `tag tag--${tone}`;
    // 加上「退款」前綴：這個標籤緊鄰訂單狀態標籤，兩者樣式相同，
    // 單寫「已駁回」會讓人分不清被駁回的是訂單還是退款申請。
    status.textContent = `退款${refundStatusLabel(refund.status)}`;

    const when = document.createElement('span');
    when.textContent = `申請於 ${formatDateTime(refund.createdAt)}`;

    head.append(status, when);
    li.append(head);

    const reason = document.createElement('p');
    reason.style.margin = '0 0 var(--sp-1)';
    reason.textContent = `退款原因：${refund.reason}`;
    li.append(reason);

    const amount = document.createElement('p');
    amount.className = 'field__hint';
    amount.style.margin = '0';
    amount.textContent = `退款金額：${formatTWD(refund.amount)}`;
    li.append(amount);

    if (refund.adminNote) {
      const note = document.createElement('p');
      note.className = 'field__hint';
      note.style.margin = 'var(--sp-1) 0 0';
      note.textContent = `管理員說明：${refund.adminNote}`;
      li.append(note);
    }

    if (refund.reviewedAt) {
      const reviewed = document.createElement('p');
      reviewed.className = 'field__hint';
      reviewed.style.margin = 'var(--sp-1) 0 0';
      reviewed.textContent = `審核於 ${formatDateTime(refund.reviewedAt)}`;
      li.append(reviewed);
    }

    ul.append(li);
  });

  section.append(ul);
  return section;
}

function buildRefundSection(order, quota, context) {
  const section = document.createElement('section');
  section.className = 'card';
  section.style.marginTop = 'var(--sp-4)';

  const h2 = document.createElement('h2');
  h2.textContent = '申請退款';
  section.append(h2);

  const blocked = refundUnavailableReason(order);
  if (blocked) {
    // FR-036：已有審核中的申請時，操作不可用並顯示目前進度
    const p = document.createElement('p');
    p.className = 'tag tag--neutral';
    p.style.display = 'inline-block';
    p.textContent = blocked;
    section.append(p);
    section.append(buildPolicyNote());
    return section;
  }

  // 額度用盡時才提及上限——平常不顯示剩餘次數，那不是使用者需要知道的資訊，
  // 顯示出來反而像在倒數，會影響他們判斷該不該申請。
  if (quota?.reached) {
    const p = document.createElement('p');
    p.className = 'tag tag--danger';
    p.style.display = 'inline-block';
    p.textContent = `退款申請已達上限 ${quota.limit} 筆，無法再提出新的申請。`;
    section.append(p);
    section.append(buildPolicyNote());
    return section;
  }

  const quote = quoteRefund(order);
  const form = document.createElement('form');
  form.noValidate = true;

  const summary = document.createElement('p');
  summary.textContent =
    `依退款政策，此訂單目前可退 ${quote.percent}%，金額 ${formatTWD(quote.amount)}。`;
  form.append(summary);

  // 原因欄位
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.htmlFor = 'refund-reason';
  label.textContent = '退款原因（必填）';
  const textarea = document.createElement('textarea');
  textarea.id = 'refund-reason';
  textarea.name = 'reason';
  textarea.rows = 3;
  textarea.setAttribute('aria-describedby', 'refund-reason-error');
  const error = document.createElement('p');
  error.className = 'field__error';
  error.id = 'refund-reason-error';
  error.hidden = true;
  wrap.append(label, textarea, error);
  form.append(wrap);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '送出退款申請';
  form.append(submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    textarea.removeAttribute('aria-invalid');

    const reasonError = validateReason(textarea.value);
    if (reasonError) {
      error.textContent = reasonError;
      error.hidden = false;
      textarea.setAttribute('aria-invalid', 'true');
      textarea.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = '送出中…';
    try {
      await submitRefundRequest(order, textarea.value);
      toast('退款申請已送出，狀態已轉為「退款審核中」。', 'ok');
      renderOrderDetail(context);
    } catch (err) {
      error.textContent = toUserMessage(err);
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = '送出退款申請';
    }
  });

  section.append(form);
  section.append(buildPolicyNote());
  return section;
}

/** 退款政策說明（FR-041） */
function buildPolicyNote() {
  const details = document.createElement('details');
  details.style.marginTop = 'var(--sp-4)';

  const summary = document.createElement('summary');
  summary.textContent = '退款政策';
  summary.style.cursor = 'pointer';
  summary.style.fontSize = 'var(--f-small)';
  details.append(summary);

  const ul = document.createElement('ul');
  ul.style.fontSize = 'var(--f-small)';
  ul.style.color = 'var(--c-text-muted)';
  ul.style.marginTop = 'var(--sp-2)';

  REFUND_POLICY.forEach(({ label, percent }) => {
    const li = document.createElement('li');
    li.textContent = `${label}：${percent === 0 ? '不可退款' : `退還 ${percent}%`}`;
    ul.append(li);
  });

  const note = document.createElement('p');
  note.className = 'field__hint';
  note.textContent = '退款為展示用模擬流程，不會產生任何實際金錢移轉。';

  details.append(ul, note);
  return details;
}

function buildSummary(order, room) {
  const dl = document.createElement('dl');
  dl.style.display = 'grid';
  dl.style.gridTemplateColumns = 'auto 1fr';
  dl.style.gap = 'var(--sp-2) var(--sp-4)';
  dl.style.margin = 'var(--sp-3) 0';

  const paymentLabel = PAYMENT_METHODS.find((p) => p.value === order.paymentMethod)?.label
    ?? order.paymentMethod;

  [
    ['房源', room?.name ?? '（房源已下架）'],
    ['入住', formatDate(order.checkIn)],
    ['退房', formatDate(order.checkOut)],
    ['夜數', `${order.nights} 晚`],
    ['入住人數', `${order.guestCount} 人`],
    ['住客姓名', order.contactName],
    ['聯絡電話', order.phone],
    ['電子郵件', order.email ?? '—'],
    ['付款方式', `${paymentLabel}（模擬）`],
    ['總金額', formatTWD(order.totalAmount)],
    ['建立時間', formatDateTime(order.createdAt)]
  ].forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.style.color = 'var(--c-text-muted)';
    dt.style.fontSize = 'var(--f-small)';
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.style.margin = '0';
    dd.textContent = value;
    dl.append(dt, dd);
  });

  return dl;
}

/** 待付款：倒數 + 完成模擬付款（FR-102、FR-096） */
function buildPaymentPanel(order, context) {
  const panel = document.createElement('div');

  const countdown = createPaymentCountdown(order, () => renderOrderDetail(context));
  panel.append(countdown);

  const notice = document.createElement('p');
  notice.className = 'field__hint';
  notice.textContent = '這是模擬付款，按下按鈕即視為付款完成，不會產生任何實際交易。';

  const pay = document.createElement('button');
  pay.type = 'button';
  pay.className = 'btn btn--primary';
  pay.style.display = 'block';
  pay.textContent = '完成付款';

  const error = document.createElement('p');
  error.className = 'error-state';
  error.hidden = true;
  error.setAttribute('role', 'alert');

  pay.addEventListener('click', async () => {
    pay.disabled = true;
    pay.textContent = '處理中…';
    error.hidden = true;

    try {
      await payOrder(order.id);
      toast('付款完成，訂單已確認。', 'ok');
      renderOrderDetail(context);
    } catch (err) {
      // FR-100 / T057：逾期的訂單不得復活，並提供重新訂房的入口
      if (isAppError(err, 'ORDER_EXPIRED')) {
        renderOrderDetail(context);
        toastError(err);
        return;
      }
      error.textContent = toUserMessage(err);
      error.hidden = false;
      pay.disabled = false;
      pay.textContent = '完成付款';
    }
  });

  panel.append(notice, pay, error);
  return panel;
}

/**
 * 撰寫評論的入口（US5 場景 1）。
 *
 * 表單本身在房源詳情頁，因為評論要和該房源的其他評論一起呈現；
 * 但使用者的心智路徑是「我住過這一筆 → 我想評論」，所以入口必須在訂單這裡。
 *
 * 是否真的還能評論（有沒有寫過、資格是否符合）由詳情頁判定，
 * 這裡只負責在合理時機把人帶過去，避免為了顯示一顆按鈕多打一次評論查詢。
 */
function buildReviewEntry(order) {
  const canReview = ['confirmed', 'completed'].includes(order.status)
    && isSameOrBefore(order.checkOut, todayInTaipei());
  if (!canReview) return null;

  const wrap = document.createElement('div');
  wrap.style.marginTop = 'var(--sp-4)';
  wrap.style.paddingTop = 'var(--sp-4)';
  wrap.style.borderTop = '1px solid var(--c-border-soft)';

  const p = document.createElement('p');
  p.className = 'field__hint';
  p.textContent = '入住已結束，歡迎分享你的住宿體驗。評論送出後需經審核才會公開。';

  const link = document.createElement('a');
  link.className = 'btn btn--primary';
  link.href = `#/rooms/${order.roomId}`;
  link.textContent = '撰寫評論';

  wrap.append(p, link);
  return wrap;
}

/** 逾期取消：說明原因並提供重新訂房入口（T057） */
function buildTimeoutPanel(order) {
  const panel = document.createElement('div');

  const p = document.createElement('p');
  p.className = 'tag tag--danger';
  p.style.display = 'inline-block';
  p.textContent = '此訂單因逾期未付款而自動取消，該日期區間已釋出給其他人預訂。';

  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'btn btn--primary';
  again.style.display = 'block';
  again.style.marginTop = 'var(--sp-3)';
  again.textContent = '重新訂房';
  again.addEventListener('click', () => router.navigate(`#/booking/${order.roomId}`));

  panel.append(p, again);
  return panel;
}
