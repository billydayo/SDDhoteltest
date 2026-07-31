/**
 * 訂單管理與營運指標（US6 / T074、T077）。
 *
 * FR-053：依訂單編號、狀態、日期區間搜尋與篩選。
 * FR-054：變更訂單狀態，結果反映至會員端。
 *
 * 統計區塊的分母為 0 時顯示破折號，不做除以零的計算（T075）。
 */

import { createPageHeader, toast } from '../app.js';
import { listOrders, updateOrderStatus, getOrderStats, isPaymentTimeout } from '../data/orders.js';
import { listRooms } from '../data/rooms.js';
import { withAudit, ACTIONS } from '../services/audit.js';
import {
  createDataTable, createEmptyRow, textField, selectField, actionButton, buttonRow, statusTag
} from '../components/admin-ui.js';
import { ORDER_STATUS, orderStatusLabel } from '../data/vocabulary.js';
import { formatTWD, formatPercent } from '../utils/money.js';
import { formatDateRange, formatDateTime } from '../utils/dates.js';
import { toUserMessage } from '../utils/errors.js';

let filters = { orderNo: '', status: '', from: '', to: '' };

export async function renderAdminOrders(panel, context) {
  const [orders, rooms, stats] = await Promise.all([
    listOrders(),
    listRooms({}),
    getOrderStats().catch(() => null)
  ]);

  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const filtered = applyFilters(orders);

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('訂單管理', `全站共 ${orders.length} 筆訂單。`));
  frag.append(buildStats(stats));
  frag.append(buildFilterForm(panel, context));
  frag.append(buildTable(filtered, roomById, panel, context));

  panel.replaceChildren(frag);
}

const reload = (panel, context) => renderAdminOrders(panel, context);

// ---------------------------------------------------------------------------
// 營運指標（FR-049 群組）
// ---------------------------------------------------------------------------

function buildStats(stats) {
  const grid = document.createElement('div');
  grid.className = 'stat-grid';

  const entries = [
    ['訂單總數', stats ? String(stats.totalOrders) : null],
    ['總下單數', stats ? String(stats.totalPlaced) : null],
    ['已付款訂單數', stats ? String(stats.paidOrders) : null],
    ['未付款取消訂單數', stats ? String(stats.unpaidCancelled) : null],
    ['成交率', stats && stats.conversionRate !== null
      ? formatPercent(Math.round(stats.conversionRate * 1000) / 10) : null],
    ['總營業額', stats ? formatTWD(stats.revenue) : null],
    ['平均客單價', stats && stats.averageOrderValue !== null
      ? formatTWD(stats.averageOrderValue) : null]
  ];

  entries.forEach(([label, value]) => {
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    const l = document.createElement('div');
    l.className = 'stat-tile__label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'stat-tile__value';
    if (value === null || value === undefined) {
      v.classList.add('stat-tile__value--empty');
      v.textContent = '—';
    } else {
      v.textContent = value;
    }
    tile.append(l, v);
    grid.append(tile);
  });

  return grid;
}

// ---------------------------------------------------------------------------
// 篩選
// ---------------------------------------------------------------------------

function applyFilters(orders) {
  return orders.filter((o) => {
    if (filters.orderNo) {
      const needle = filters.orderNo.trim().toLowerCase();
      const haystack = `${o.orderNo ?? ''} ${o.id}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (filters.status && o.status !== filters.status) return false;
    // 以入住日落在區間內為準
    if (filters.from && o.checkIn < filters.from) return false;
    if (filters.to && o.checkIn > filters.to) return false;
    return true;
  });
}

function buildFilterForm(panel, context) {
  const form = document.createElement('form');
  form.className = 'filter-bar';
  form.noValidate = true;

  const orderNo = textField({ id: 'ord-no', name: 'orderNo', label: '訂單編號', value: filters.orderNo });
  const status = selectField({
    id: 'ord-status', name: 'status', label: '狀態', value: filters.status,
    options: [{ value: '', label: '全部狀態' },
      ...Object.keys(ORDER_STATUS).map((s) => ({ value: s, label: orderStatusLabel(s) }))]
  });
  const from = textField({ id: 'ord-from', name: 'from', label: '入住日起', type: 'date', value: filters.from });
  const to = textField({ id: 'ord-to', name: 'to', label: '入住日迄', type: 'date', value: filters.to });

  const row = document.createElement('div');
  row.className = 'filter-bar__row';
  row.append(orderNo.wrap, status.wrap, from.wrap, to.wrap);
  form.append(row);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '篩選';

  const clear = actionButton('清除條件', () => {
    filters = { orderNo: '', status: '', from: '', to: '' };
    reload(panel, context);
  });

  form.append(buttonRow(submit, clear));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    filters = {
      orderNo: orderNo.input.value,
      status: status.input.value,
      from: from.input.value,
      to: to.input.value
    };
    reload(panel, context);
  });

  return form;
}

// ---------------------------------------------------------------------------
// 訂單表格
// ---------------------------------------------------------------------------

function buildTable(orders, roomById, panel, context) {
  const section = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent = `符合條件的訂單（${orders.length}）`;
  section.append(h2);

  if (!orders.length) {
    section.append(createEmptyRow('沒有符合條件的訂單。請調整篩選條件後再試。'));
    return section;
  }

  const rows = orders.map((order) => [
    order.orderNo ?? order.id.slice(0, 8),
    roomById.get(order.roomId)?.name ?? '（已下架）',
    order.contactName,
    formatDateRange(order.checkIn, order.checkOut),
    `${order.nights} 晚`,
    formatTWD(order.totalAmount),
    statusTag(
      isPaymentTimeout(order) ? '已取消（逾期）' : orderStatusLabel(order.status),
      ORDER_STATUS[order.status]?.tone ?? 'neutral'
    ),
    formatDateTime(order.createdAt),
    buildStatusEditor(order, panel, context)
  ]);

  section.append(createDataTable(
    ['訂單編號', '房源', '訂房人', '日期', '夜數', '金額', '狀態', '建立時間', '變更狀態'],
    rows
  ));
  return section;
}

function buildStatusEditor(order, panel, context) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', `變更訂單 ${order.orderNo ?? order.id} 的狀態`);

  Object.keys(ORDER_STATUS).forEach((value) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = orderStatusLabel(value);
    if (value === order.status) opt.selected = true;
    select.append(opt);
  });

  select.addEventListener('change', async () => {
    const next = select.value;
    if (next === order.status) return;

    try {
      await withAudit(
        {
          action: ACTIONS.ORDER_STATUS, targetTable: 'orders', targetId: order.id,
          summary: { status: { from: order.status, to: next } }
        },
        () => updateOrderStatus(order.id, next)
      );
      toast('訂單狀態已更新。', 'ok');
      reload(panel, context);
    } catch (err) {
      toast(toUserMessage(err), 'error');
      select.value = order.status;
    }
  });

  return select;
}
