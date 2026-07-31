/**
 * 房源管理（US6 / T076）。
 *
 * FR-050：新增、編輯、刪除房源。
 * FR-051：調整房態。
 * FR-052：刪除仍有未來有效訂單的房源必須警告並二次確認。
 *
 * 每個變更都經 withAudit 包裝——改了卻沒留下紀錄是不被允許的（FR-114）。
 */

import { createPageHeader, toast } from '../app.js';
import {
  listRooms, createRoom, updateRoom, deleteRoom, setRoomStatus, getFutureOrdersForRoom
} from '../data/rooms.js';
import { withAudit, ACTIONS, diffSummary } from '../services/audit.js';
import {
  createDataTable, createEmptyRow, textField, selectField, textareaField,
  checkboxGroup, actionButton, confirmAction, inlineError, showInlineError,
  statusTag, buttonRow
} from '../components/admin-ui.js';
import { AMENITIES, ROOM_FEATURES, ROOM_TYPES, ROOM_STATUS, roomStatusLabel, typeLabel }
  from '../data/vocabulary.js';
import { formatTWD } from '../utils/money.js';
import { formatDateRange } from '../utils/dates.js';
import { toUserMessage } from '../utils/errors.js';

let editing = null;   // 目前編輯中的房源，null 代表新增模式

export async function renderAdminRooms(panel, context) {
  const rooms = await listRooms({});

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('房源管理', `共 ${rooms.length} 間房源。`));
  frag.append(buildForm(panel, context));
  frag.append(buildTable(rooms, panel, context));

  panel.replaceChildren(frag);
}

const reload = (panel, context) => renderAdminRooms(panel, context);

// ---------------------------------------------------------------------------
// 新增 / 編輯表單
// ---------------------------------------------------------------------------

function buildForm(panel, context) {
  const form = document.createElement('form');
  form.className = 'card';
  form.style.marginBottom = 'var(--sp-5)';
  form.noValidate = true;

  const h2 = document.createElement('h2');
  h2.textContent = editing ? `編輯房源：${editing.name}` : '新增房源';
  form.append(h2);

  const name = textField({ id: 'rm-name', name: 'name', label: '房名', value: editing?.name ?? '' });
  const type = selectField({
    id: 'rm-type', name: 'type', label: '房型', value: editing?.type ?? 'double',
    options: ROOM_TYPES.map((t) => ({ value: t.value, label: t.label }))
  });
  const maxGuests = textField({
    id: 'rm-guests', name: 'maxGuests', label: '人數上限', type: 'number',
    value: editing?.maxGuests ?? 2, attrs: { min: '1', step: '1' }
  });
  const price = textField({
    id: 'rm-price', name: 'nightlyPrice', label: '每晚價格（新臺幣）', type: 'number',
    value: editing?.nightlyPrice ?? 2000, attrs: { min: '1', step: '100' }
  });
  const status = selectField({
    id: 'rm-status', name: 'status', label: '房態', value: editing?.status ?? 'available',
    options: Object.keys(ROOM_STATUS).map((s) => ({ value: s, label: roomStatusLabel(s) })),
    hint: '「整理中」與「已預訂」都會被排除於可訂清單之外。'
  });
  const image = textField({
    id: 'rm-image', name: 'image', label: '照片網址', value: editing?.images?.[0] ?? '',
    hint: '相對路徑或完整網址，例如 assets/rooms/double-a.svg'
  });
  const description = textareaField({
    id: 'rm-desc', name: 'description', label: '房源描述', value: editing?.description ?? ''
  });

  const row = document.createElement('div');
  row.className = 'filter-bar__row';
  row.append(name.wrap, type.wrap, maxGuests.wrap, price.wrap, status.wrap);
  form.append(row, image.wrap, description.wrap);

  const amenities = checkboxGroup({
    name: 'amenities', legend: '設施', options: AMENITIES, selected: editing?.amenities ?? []
  });
  const features = checkboxGroup({
    name: 'features', legend: '房型特色', options: ROOM_FEATURES, selected: editing?.features ?? []
  });
  form.append(amenities, features);

  const error = inlineError();
  form.append(error);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = editing ? '儲存變更' : '新增房源';

  const cancel = editing
    ? actionButton('取消編輯', () => { editing = null; reload(panel, context); })
    : null;

  form.append(buttonRow(submit, cancel));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;

    const input = {
      name: name.input.value.trim(),
      type: type.input.value,
      maxGuests: Number(maxGuests.input.value),
      nightlyPrice: Number(price.input.value),
      status: status.input.value,
      description: description.input.value.trim(),
      images: image.input.value.trim() ? [image.input.value.trim()] : [],
      amenities: [...form.querySelectorAll('input[name="amenities"]:checked')].map((i) => i.value),
      features: [...form.querySelectorAll('input[name="features"]:checked')].map((i) => i.value)
    };

    if (!input.name) return showInlineError(error, '請填寫房名。');
    if (!Number.isInteger(input.maxGuests) || input.maxGuests < 1) {
      return showInlineError(error, '人數上限需為大於 0 的整數。');
    }
    if (!Number.isInteger(input.nightlyPrice) || input.nightlyPrice < 1) {
      return showInlineError(error, '每晚價格需為大於 0 的整數。');
    }

    submit.disabled = true;
    try {
      if (editing) {
        await withAudit(
          {
            action: ACTIONS.ROOM_UPDATE, targetTable: 'rooms', targetId: editing.id,
            summary: diffSummary(editing, input)
          },
          () => updateRoom(editing.id, input)
        );
        toast('房源已更新。', 'ok');
        editing = null;
      } else {
        await withAudit(
          { action: ACTIONS.ROOM_CREATE, targetTable: 'rooms', summary: { name: input.name } },
          () => createRoom(input)
        );
        toast('房源已新增。', 'ok');
      }
      reload(panel, context);
    } catch (err) {
      showInlineError(error, toUserMessage(err));
      submit.disabled = false;
    }
  });

  return form;
}

// ---------------------------------------------------------------------------
// 房源清單
// ---------------------------------------------------------------------------

function buildTable(rooms, panel, context) {
  const section = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent = '房源清單';
  section.append(h2);

  if (!rooms.length) {
    section.append(createEmptyRow('尚無房源，請由上方表單新增。'));
    return section;
  }

  const rows = rooms.map((room) => [
    room.name,
    typeLabel(room.type),
    `${room.maxGuests} 人`,
    formatTWD(room.nightlyPrice),
    statusTag(roomStatusLabel(room.status), ROOM_STATUS[room.status]?.tone ?? 'neutral'),
    room.averageRating === null ? '尚無評分' : String(room.averageRating),
    buildRowActions(room, panel, context)
  ]);

  section.append(createDataTable(
    ['房名', '房型', '人數', '價格', '房態', '評分', '操作'],
    rows
  ));
  return section;
}

function buildRowActions(room, panel, context) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.gap = 'var(--sp-1)';

  wrap.append(actionButton('編輯', () => {
    editing = room;
    reload(panel, context);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  // 房態快速切換（FR-051）
  const nextStatus = room.status === 'maintenance' ? 'available' : 'maintenance';
  wrap.append(actionButton(
    nextStatus === 'maintenance' ? '設為整理中' : '設為空房',
    async () => {
      try {
        await withAudit(
          {
            action: ACTIONS.ROOM_STATUS, targetTable: 'rooms', targetId: room.id,
            summary: { status: { from: room.status, to: nextStatus } }
          },
          () => setRoomStatus(room.id, nextStatus)
        );
        toast('房態已更新。', 'ok');
        reload(panel, context);
      } catch (err) {
        toast(toUserMessage(err), 'error');
      }
    }
  ));

  wrap.append(actionButton('刪除', () => handleDelete(room, panel, context), 'danger'));
  return wrap;
}

/** FR-052：仍有未來有效訂單時警告並列出受影響訂單，需二次確認 */
async function handleDelete(room, panel, context) {
  let futureOrders = [];
  try {
    futureOrders = await getFutureOrdersForRoom(room.id);
  } catch {
    // 查不到受影響訂單時仍要求確認，但要說明無法確認影響範圍
    futureOrders = null;
  }

  let message;
  if (futureOrders === null) {
    message = `無法確認「${room.name}」是否有未來訂單。仍要刪除嗎？此操作無法復原。`;
  } else if (futureOrders.length) {
    const list = futureOrders
      .slice(0, 5)
      .map((o) => `・${o.orderNo ?? o.id.slice(0, 8)}　${formatDateRange(o.checkIn, o.checkOut)}`)
      .join('\n');
    const more = futureOrders.length > 5 ? `\n…等共 ${futureOrders.length} 筆` : '';
    message = `「${room.name}」仍有 ${futureOrders.length} 筆未來的有效訂單：\n\n${list}${more}\n\n刪除後這些訂單將失去對應房源。確定要刪除嗎？`;
  } else {
    message = `確定要刪除「${room.name}」嗎？此操作無法復原。`;
  }

  if (!confirmAction(message)) return;

  try {
    await withAudit(
      {
        action: ACTIONS.ROOM_DELETE, targetTable: 'rooms', targetId: room.id,
        summary: { name: room.name, affectedOrders: futureOrders?.length ?? null }
      },
      () => deleteRoom(room.id)
    );
    toast('房源已刪除。', 'ok');
    if (editing?.id === room.id) editing = null;
    reload(panel, context);
  } catch (err) {
    toast(toUserMessage(err), 'error');
  }
}
