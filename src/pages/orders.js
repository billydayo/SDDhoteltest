/**
 * 我的訂單與訂單確認頁（US3 / T055、T057）。
 *
 * 本階段包含：訂單列表、訂單詳情、待付款倒數、完成模擬付款、逾期處理。
 * 退款申請表單與審核狀態追蹤屬 US4（T060–T064），屆時擴充本檔即可。
 */

import { render, renderLoading, renderError, createEmptyState, createPageHeader, toast } from '../app.js';
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
  refundsForOrder, REFUND_POLICY, REFUND_STATUS, refundStatusLabel
} from '../services/refunds.js';
import * as router from '../router.js';

// ---------------------------------------------------------------------------
// 訂單列表
// ---------------------------------------------------------------------------

export async function renderOrders() {
  renderLoading('正在載入訂單…');
  try {
    const orders = await listOrders();
    if (!orders.length) {
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

    render([
      createPageHeader('我的訂單', `共 ${orders.length} 筆，依入住日排序。`),
      buildOrderList(orders, roomById)
    ]);
  } catch (err) {
    renderError(err, { retry: renderOrders });
  }
}

function buildOrderList(orders, roomById) {
  const ul = document.createElement('ul');
  ul.className = 'room-list';

  orders.forEach((order) => {
    const li = document.createElement('li');
    li.className = 'card';

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

    const [room, refunds] = await Promise.all([
      getRoom(order.roomId).catch(() => null),
      refundsForOrder(order.id).catch(() => [])
    ]);
    render(buildDetail(order, room, refunds, context));
  } catch (err) {
    renderError(err, { retry: () => renderOrderDetail(context) });
  }
}

function buildDetail(order, room, refunds, context) {
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
  if (refunds.length) frag.append(buildRefundHistory(refunds));
  frag.append(buildRefundSection(order, refunds, context));

  return frag;
}

// ---------------------------------------------------------------------------
// 退款（US4 / T061、T063）
// ---------------------------------------------------------------------------

/** 歷次申請與審核結果。駁回說明必須讓會員看得到（FR-039）。 */
function buildRefundHistory(refunds) {
  const section = document.createElement('section');
  section.className = 'card';
  section.style.marginTop = 'var(--sp-4)';

  const h2 = document.createElement('h2');
  h2.textContent = '退款申請紀錄';
  section.append(h2);

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
    status.textContent = refundStatusLabel(refund.status);

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

function buildRefundSection(order, refunds, context) {
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
        toast(toUserMessage(err), 'error');
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
