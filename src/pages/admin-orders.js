/**
 * 訂單管理與營運指標（US6 / T074、T077）。
 *
 * FR-053：依訂單編號、狀態、日期區間搜尋與篩選。
 * FR-054：變更訂單狀態，結果反映至會員端。
 *
 * 統計區塊的分母為 0 時顯示破折號，不做除以零的計算（T075）。
 */

import { createPageHeader, toast, toastError } from '../app.js';
import { listOrders, updateOrderStatus, getOrderStats, isPaymentTimeout } from '../data/orders.js';
import { listRooms } from '../data/rooms.js';
import { withAudit, ACTIONS } from '../services/audit.js';
import {
  createDataTable, createEmptyRow, textField, selectField, actionButton, buttonRow,
  statusTag, createExportButton
} from '../components/admin-ui.js';
import { ORDER_STATUS, orderStatusLabel } from '../data/vocabulary.js';
import { formatTWD, formatPercent } from '../utils/money.js';
import { formatDateRange, formatDateTime } from '../utils/dates.js';
import { toUserMessage } from '../utils/errors.js';

let filters = { orderNo: '', roomId: '', status: '', from: '', to: '' };

const ORDER_EXPORT_COLUMNS = [
  { key: 'orderNo', label: '訂單編號' },
  { key: 'roomName', label: '房源' },
  { key: 'contactName', label: '訂房人' },
  { key: 'phone', label: '聯絡電話' },
  { key: 'email', label: '電子郵件' },
  { key: 'checkIn', label: '入住日' },
  { key: 'checkOut', label: '退房日' },
  { key: 'nights', label: '夜數' },
  { key: 'guestCount', label: '入住人數' },
  { key: 'totalAmount', label: '金額' },
  { key: 'paymentMethod', label: '付款方式' },
  { key: 'statusLabel', label: '狀態' },
  { key: 'createdAt', label: '建立時間' }
];

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
  frag.append(buildFilterForm(rooms, panel, context));
  frag.append(buildTable(filtered, orders.length, roomById, panel, context));

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
    if (filters.roomId && o.roomId !== filters.roomId) return false;
    if (filters.status && o.status !== filters.status) return false;
    // 以入住日落在區間內為準
    if (filters.from && o.checkIn < filters.from) return false;
    if (filters.to && o.checkIn > filters.to) return false;
    return true;
  });
}

const hasFilters = () => Object.values(filters).some((v) => v !== '');

function buildFilterForm(rooms, panel, context) {
  const form = document.createElement('form');
  form.className = 'filter-bar';
  form.noValidate = true;

  const orderNo = textField({ id: 'ord-no', name: 'orderNo', label: '訂單編號', value: filters.orderNo });

  // 依房源篩選：查某間房的所有訂單，是排查房況爭議時最常用的入口
  const room = selectField({
    id: 'ord-room', name: 'roomId', label: '房源', value: filters.roomId,
    options: [
      { value: '', label: '全部房源' },
      ...[...rooms]
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
        .map((r) => ({ value: r.id, label: r.name }))
    ]
  });

  const status = selectField({
    id: 'ord-status', name: 'status', label: '狀態', value: filters.status,
    options: [{ value: '', label: '全部狀態' },
      ...Object.keys(ORDER_STATUS).map((s) => ({ value: s, label: orderStatusLabel(s) }))]
  });
  const from = textField({ id: 'ord-from', name: 'from', label: '入住日起', type: 'date', value: filters.from });
  const to = textField({ id: 'ord-to', name: 'to', label: '入住日迄', type: 'date', value: filters.to });

  const row = document.createElement('div');
  row.className = 'filter-bar__row';
  row.append(orderNo.wrap, room.wrap, status.wrap, from.wrap, to.wrap);
  form.append(row);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '篩選';

  const clear = actionButton('清除條件', () => {
    filters = { orderNo: '', roomId: '', status: '', from: '', to: '' };
    reload(panel, context);
  });

  form.append(buttonRow(submit, clear));

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    // 日期區間寫反時直接說明，而不是回傳空清單讓人以為沒有訂單
    if (from.input.value && to.input.value && from.input.value > to.input.value) {
      toast('入住日的起始不可晚於結束。', 'error');
      return;
    }

    filters = {
      orderNo: orderNo.input.value,
      roomId: room.input.value,
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

function buildTable(orders, totalCount, roomById, panel, context) {
  const section = document.createElement('section');

  const head = document.createElement('div');
  head.style.display = 'flex';
  head.style.justifyContent = 'space-between';
  head.style.alignItems = 'center';
  head.style.gap = 'var(--sp-3)';
  head.style.flexWrap = 'wrap';

  const h2 = document.createElement('h2');
  h2.style.margin = '0';
  // 有篩選時同時顯示符合筆數與總數，才看得出條件是不是下得太窄
  h2.textContent = hasFilters()
    ? `符合條件的訂單（${orders.length} / ${totalCount}）`
    : `全部訂單（${orders.length}）`;

  // FR-058 / US8 場景 1：匯出「目前篩選結果」，而非全部訂單
  head.append(h2, createExportButton({
    label: hasFilters() ? '匯出目前結果' : '匯出訂單',
    filename: 'sunny-orders',
    auditTable: 'orders',
    sheetName: '訂單',
    columns: ORDER_EXPORT_COLUMNS,
    notify: toast,
    getRows: () => orders.map((o) => ({
      ...o,
      roomName: roomById.get(o.roomId)?.name ?? '（已下架）',
      statusLabel: isPaymentTimeout(o) ? '已取消（逾期未付款）' : orderStatusLabel(o.status)
    }))
  }));
  section.append(head);

  if (!orders.length) {
    section.append(createEmptyRow(
      hasFilters()
        ? '沒有符合條件的訂單。請調整或清除篩選條件後再試。'
        : '目前沒有任何訂單。'
    ));
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
      toastError(err);
      select.value = order.status;
    }
  });

  return select;
}
