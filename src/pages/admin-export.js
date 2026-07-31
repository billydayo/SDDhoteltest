/**
 * 報表匯出（US8 / T084）。
 *
 * 匯出訂單或房源。離線或元件載不到時自動退回 CSV 並明確告知（FR-059）。
 */

import { createPageHeader, toast } from '../app.js';
import { listOrders } from '../data/orders.js';
import { listRooms } from '../data/rooms.js';
import { exportRows } from '../services/export.js';
import { actionButton, buttonRow, createEmptyRow } from '../components/admin-ui.js';
import { orderStatusLabel, typeLabel, roomStatusLabel } from '../data/vocabulary.js';
import { toUserMessage } from '../utils/errors.js';

const ORDER_COLUMNS = [
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

const ROOM_COLUMNS = [
  { key: 'name', label: '房名' },
  { key: 'typeLabel', label: '房型' },
  { key: 'maxGuests', label: '人數上限' },
  { key: 'nightlyPrice', label: '每晚價格' },
  { key: 'statusLabel', label: '房態' },
  { key: 'ratingText', label: '平均評分' },
  { key: 'amenities', label: '設施' },
  { key: 'features', label: '房型特色' }
];

export async function renderAdminExport(panel) {
  const [orders, rooms] = await Promise.all([listOrders(), listRooms({})]);
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('報表匯出', '匯出為 Excel；離線或元件無法載入時自動改用 CSV。'));

  const summary = document.createElement('p');
  summary.className = 'field__hint';
  summary.textContent = `目前可匯出：訂單 ${orders.length} 筆、房源 ${rooms.length} 筆。`;
  frag.append(summary);

  const orderButton = actionButton('匯出訂單報表', async () => {
    await runExport(orderButton, '匯出訂單報表', {
      filename: 'sunny-orders',
      sheetName: '訂單',
      columns: ORDER_COLUMNS,
      rows: orders.map((o) => ({
        ...o,
        roomName: roomById.get(o.roomId)?.name ?? '（已下架）',
        statusLabel: orderStatusLabel(o.status)
      }))
    });
  }, 'primary');

  const roomButton = actionButton('匯出房源報表', async () => {
    await runExport(roomButton, '匯出房源報表', {
      filename: 'sunny-rooms',
      sheetName: '房源',
      columns: ROOM_COLUMNS,
      rows: rooms.map((r) => ({
        ...r,
        typeLabel: typeLabel(r.type),
        statusLabel: roomStatusLabel(r.status),
        // 尚無評分時輸出文字而非 0，與畫面一致（FR-047）
        ratingText: r.averageRating === null ? '尚無評分' : String(r.averageRating)
      }))
    });
  }, 'primary');

  frag.append(buttonRow(orderButton, roomButton));

  if (!orders.length && !rooms.length) {
    frag.append(createEmptyRow('目前沒有任何資料可匯出。'));
  }

  const note = document.createElement('p');
  note.className = 'field__hint';
  note.textContent = 'CSV 檔含 UTF-8 BOM，在 Excel 開啟時中文不會變成亂碼。';
  frag.append(note);

  panel.replaceChildren(frag);
}

async function runExport(button, label, config) {
  button.disabled = true;
  button.textContent = '匯出中…';
  try {
    const result = await exportRows(config);
    toast(result.message, result.format === 'none' ? 'error' : 'ok');
  } catch (err) {
    toast(toUserMessage(err), 'error');
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}
