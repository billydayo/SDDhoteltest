/**
 * 管理員操作日誌（US12 / T106、T107）。
 *
 * FR-115：每筆含操作者、時間、動作類型、對象與變更摘要。
 * FR-116：僅可新增。本頁**刻意沒有**編輯或刪除功能——資料庫端也沒有對應的
 *         RLS 政策且已 REVOKE，因此即使繞過前端也改不了（SC-027）。
 * FR-118：日誌不含密碼、金鑰或真實個資，過濾在 services/audit.js 寫入時完成。
 */

import { createPageHeader } from '../app.js';
import { listAdminLogs } from '../data/admin-logs.js';
import { listProfiles } from '../data/profiles.js';
import { ACTION_LABELS, actionLabel } from '../services/audit.js';
import {
  createDataTable, createEmptyRow, selectField, textField, actionButton, buttonRow
} from '../components/admin-ui.js';
import { formatDateTime } from '../utils/dates.js';

let filters = { actorId: '', action: '', from: '', to: '' };

export async function renderAdminLogs(panel, context) {
  const [logs, profiles] = await Promise.all([
    listAdminLogs(buildQuery()),
    listProfiles().catch(() => [])
  ]);

  const nameById = new Map(profiles.map((p) => [p.id, p.displayName || p.id.slice(0, 8)]));

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('操作日誌', '後台所有變更操作的稽核紀錄，僅可新增，不可修改或刪除。'));
  frag.append(buildFilterForm(profiles, panel, context));

  if (!logs.length) {
    frag.append(createEmptyRow(
      hasFilters() ? '沒有符合條件的紀錄。' : '尚無操作紀錄。管理員做出任何變更後就會出現在這裡。'
    ));
    panel.replaceChildren(frag);
    return;
  }

  const rows = logs.map((log) => [
    formatDateTime(log.createdAt),
    nameById.get(log.actorId) ?? log.actorId.slice(0, 8),
    actionLabel(log.action),
    log.targetTable,
    log.targetId ? String(log.targetId).slice(0, 8) : '—',
    buildSummaryCell(log.summary)
  ]);

  frag.append(createDataTable(
    ['時間', '操作者', '動作', '對象資料表', '對象', '變更摘要'],
    rows
  ));

  const note = document.createElement('p');
  note.className = 'field__hint';
  note.textContent = `顯示最近 ${logs.length} 筆。日誌無法被任何角色修改或刪除，包含管理員本人。`;
  frag.append(note);

  panel.replaceChildren(frag);
}

const reload = (panel, context) => renderAdminLogs(panel, context);

function buildQuery() {
  const query = {};
  if (filters.actorId) query.actorId = filters.actorId;
  if (filters.action) query.action = filters.action;
  // 日期轉為當日起訖的時間戳，讓「同一天」也涵蓋得到
  if (filters.from) query.from = `${filters.from}T00:00:00.000Z`;
  if (filters.to) query.to = `${filters.to}T23:59:59.999Z`;
  return query;
}

const hasFilters = () => Object.values(filters).some(Boolean);

function buildFilterForm(profiles, panel, context) {
  const form = document.createElement('form');
  form.className = 'filter-bar';
  form.noValidate = true;

  const actor = selectField({
    id: 'log-actor', name: 'actorId', label: '操作者', value: filters.actorId,
    options: [
      { value: '', label: '全部' },
      ...profiles.map((p) => ({ value: p.id, label: p.displayName || p.id.slice(0, 8) }))
    ]
  });

  const action = selectField({
    id: 'log-action', name: 'action', label: '動作類型', value: filters.action,
    options: [
      { value: '', label: '全部' },
      ...Object.keys(ACTION_LABELS).map((key) => ({ value: key, label: ACTION_LABELS[key] }))
    ]
  });

  const from = textField({ id: 'log-from', name: 'from', label: '起始日', type: 'date', value: filters.from });
  const to = textField({ id: 'log-to', name: 'to', label: '結束日', type: 'date', value: filters.to });

  const row = document.createElement('div');
  row.className = 'filter-bar__row';
  row.append(actor.wrap, action.wrap, from.wrap, to.wrap);
  form.append(row);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '篩選';

  const clear = actionButton('清除條件', () => {
    filters = { actorId: '', action: '', from: '', to: '' };
    reload(panel, context);
  });

  form.append(buttonRow(submit, clear));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    filters = {
      actorId: actor.input.value,
      action: action.input.value,
      from: from.input.value,
      to: to.input.value
    };
    reload(panel, context);
  });

  return form;
}

/** 變更摘要：欄位 → 新舊值。內容較長時收在 <details> 裡，表格才不會爆開。 */
function buildSummaryCell(summary) {
  const entries = Object.entries(summary ?? {});
  if (!entries.length) {
    const span = document.createElement('span');
    span.textContent = '—';
    return span;
  }

  const details = document.createElement('details');
  const summaryEl = document.createElement('summary');
  summaryEl.textContent = `${entries.length} 項變更`;
  summaryEl.style.cursor = 'pointer';
  details.append(summaryEl);

  const ul = document.createElement('ul');
  ul.style.margin = 'var(--sp-2) 0 0';
  ul.style.paddingInlineStart = 'var(--sp-4)';

  entries.forEach(([key, value]) => {
    const li = document.createElement('li');
    li.style.whiteSpace = 'normal';
    li.textContent = isFromTo(value)
      ? `${key}：${describe(value.from)} → ${describe(value.to)}`
      : `${key}：${describe(value)}`;
    ul.append(li);
  });

  details.append(ul);
  return details;
}

const isFromTo = (v) => v && typeof v === 'object' && !Array.isArray(v) && ('from' in v || 'to' in v);

function describe(value) {
  if (value === null || value === undefined || value === '') return '（空）';
  if (Array.isArray(value)) return value.length ? value.join('、') : '（空）';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
