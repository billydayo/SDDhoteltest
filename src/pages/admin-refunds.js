/**
 * 退款審核佇列（US7 / T082）。
 *
 * FR-057：核准或駁回，結果即時反映至會員端。
 * FR-038：核准後訂單標記為已退款，並立即釋回該房源該區間。
 * FR-039：駁回後訂單回到「已確認」，會員可再次申請。
 *
 * 狀態連動由 adapter 的 moderateRefund 一併處理，因此這裡只負責決策與紀錄。
 */

import { createPageHeader, toast, toastError } from '../app.js';
import { listRefunds, moderateRefund } from '../data/refunds.js';
import { listOrders } from '../data/orders.js';
import { listRooms } from '../data/rooms.js';
import { withAudit, ACTIONS } from '../services/audit.js';
import { REFUND_STATUS, refundStatusLabel, REFUND_POLICY } from '../services/refunds.js';
import {
  createEmptyRow, actionButton, statusTag, buttonRow, selectField
} from '../components/admin-ui.js';
import { formatTWD } from '../utils/money.js';
import { formatDateRange, formatDateTime, daysUntil } from '../utils/dates.js';
import { toUserMessage } from '../utils/errors.js';

let statusFilter = 'pending';

export async function renderAdminRefunds(panel, context) {
  const [refunds, orders, rooms] = await Promise.all([
    listRefunds(statusFilter ? { status: statusFilter } : {}),
    listOrders(),
    listRooms({})
  ]);

  const orderById = new Map(orders.map((o) => [o.id, o]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('退款審核', '核准後訂單將標記為已退款，該日期區間立即釋出。'));
  frag.append(buildPolicyNote());
  frag.append(buildFilter(panel, context));

  if (!refunds.length) {
    frag.append(createEmptyRow(
      statusFilter === 'pending'
        ? '目前沒有待審核的退款申請。'
        : '沒有符合此狀態的退款申請。'
    ));
    panel.replaceChildren(frag);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'review-list';
  refunds.forEach((refund) => {
    list.append(buildRefundItem(refund, orderById, roomById, panel, context));
  });
  frag.append(list);

  panel.replaceChildren(frag);
}

const reload = (panel, context) => renderAdminRefunds(panel, context);

function buildPolicyNote() {
  const p = document.createElement('p');
  p.className = 'field__hint';
  p.textContent = '退款級距：'
    + REFUND_POLICY.map((r) => `${r.label} ${r.percent === 0 ? '不可退' : `${r.percent}%`}`).join('、')
    + '。退款為模擬流程，不會產生實際金錢移轉。';
  return p;
}

function buildFilter(panel, context) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = 'var(--sp-4)';

  const field = selectField({
    id: 'ref-status', name: 'status', label: '顯示狀態', value: statusFilter,
    options: [
      { value: 'pending', label: '待審核' },
      { value: 'approved', label: '已核准' },
      { value: 'rejected', label: '已駁回' },
      { value: '', label: '全部' }
    ]
  });
  field.input.addEventListener('change', () => {
    statusFilter = field.input.value;
    reload(panel, context);
  });

  wrap.append(field.wrap);
  return wrap;
}

function buildRefundItem(refund, orderById, roomById, panel, context) {
  const li = document.createElement('li');
  li.className = 'review-item';

  const order = orderById.get(refund.orderId);
  const room = order ? roomById.get(order.roomId) : null;

  const head = document.createElement('div');
  head.className = 'review-item__head';
  head.append(
    statusTag(refundStatusLabel(refund.status), REFUND_STATUS[refund.status]?.tone ?? 'neutral'),
    document.createTextNode(`申請於 ${formatDateTime(refund.createdAt)}`)
  );
  li.append(head);

  const meta = document.createElement('p');
  meta.className = 'room-card__meta';
  meta.textContent = [
    order?.orderNo ?? refund.orderId.slice(0, 8),
    room?.name ?? '（房源已下架）',
    order ? formatDateRange(order.checkIn, order.checkOut) : '—',
    order ? `原價 ${formatTWD(order.totalAmount)}` : '—'
  ].join('・');
  li.append(meta);

  // 退費明細：讓管理員看得到金額怎麼算出來的
  const detail = document.createElement('p');
  detail.style.margin = '0 0 var(--sp-2)';
  const days = order ? daysUntil(order.checkIn) : null;
  detail.textContent = order
    ? `申請退款金額 ${formatTWD(refund.amount)}（距入住日 ${days} 天，依級距計算）`
    : `申請退款金額 ${formatTWD(refund.amount)}`;
  li.append(detail);

  const reason = document.createElement('p');
  reason.style.margin = '0 0 var(--sp-2)';
  reason.textContent = `退款原因：${refund.reason}`;
  li.append(reason);

  if (refund.adminNote) {
    const note = document.createElement('p');
    note.className = 'field__hint';
    note.textContent = `審核說明：${refund.adminNote}`;
    li.append(note);
  }

  if (refund.status === 'pending') {
    li.append(buttonRow(
      actionButton('核准退款', () => moderate(refund, 'approved', panel, context)),
      actionButton('駁回', () => moderate(refund, 'rejected', panel, context), 'danger')
    ));
  }

  return li;
}

async function moderate(refund, decision, panel, context) {
  const note = window.prompt(
    decision === 'rejected'
      ? '駁回說明（會顯示給申請人，建議填寫）'
      : '核准備註（可留空）',
    ''
  );
  if (note === null) return;

  try {
    await withAudit(
      {
        action: decision === 'approved' ? ACTIONS.REFUND_APPROVE : ACTIONS.REFUND_REJECT,
        targetTable: 'refunds',
        targetId: refund.id,
        summary: {
          orderId: refund.orderId,
          amount: refund.amount,
          status: { from: refund.status, to: decision }
        }
      },
      () => moderateRefund(refund.id, decision, note.trim() || null)
    );
    toast(
      decision === 'approved'
        ? '已核准退款，訂單標記為已退款，日期區間已釋出。'
        : '已駁回，訂單回到「已確認」，會員可再次申請。',
      'ok'
    );
    reload(panel, context);
  } catch (err) {
    toastError(err);
  }
}
