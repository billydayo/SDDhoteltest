/**
 * 管理員操作日誌（US12 / T106、T107）。
 *
 * FR-115：每筆含操作者、時間、動作類型、對象與變更摘要。
 * FR-116：僅可新增。本頁**刻意沒有**編輯或刪除功能——資料庫端也沒有對應的
 *         RLS 政策且已 REVOKE，因此即使繞過前端也改不了（SC-027）。
 * FR-118：日誌不含密碼、金鑰或真實個資，過濾在 services/audit.js 寫入時完成。
 */

import { createPageHeader, toast } from '../app.js';
import { listAdminLogs } from '../data/admin-logs.js';
import { listProfiles } from '../data/profiles.js';
import { ACTION_LABELS, actionLabel } from '../services/audit.js';
import {
  createDataTable, createEmptyRow, selectField, textField, actionButton, buttonRow,
  createExportButton
} from '../components/admin-ui.js';
import { formatDateTime } from '../utils/dates.js';

let filters = { actorId: '', action: '', from: '', to: '' };

/**
 * 匯出欄位。與畫面上的表格同構，差別只在「變更摘要」——
 * 表格用 <details> 收合，試算表沒有收合的概念，改成一行一項的純文字。
 */
const LOG_EXPORT_COLUMNS = [
  { key: 'createdAt', label: '時間' },
  { key: 'actorName', label: '操作者' },
  { key: 'actorId', label: '操作者 ID' },
  { key: 'actionLabel', label: '動作' },
  { key: 'targetTable', label: '對象資料表' },
  { key: 'targetId', label: '對象 ID' },
  { key: 'summaryText', label: '變更摘要' }
];

export async function renderAdminLogs(panel, context) {
  const [logs, profiles] = await Promise.all([
    listAdminLogs(buildQuery()),
    listProfiles().catch(() => [])
  ]);

  const nameById = new Map(profiles.map((p) => [p.id, p.displayName || p.id.slice(0, 8)]));

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('操作日誌', '後台所有變更操作的稽核紀錄，僅可新增，不可修改或刪除。'));
  frag.append(buildFilterForm(profiles, panel, context));
  frag.append(buildTableHead(logs, nameById));

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

/**
 * 標題列與匯出按鈕（FR-058）。
 *
 * 匯出的是**目前篩選結果**，與其他模組一致——查稽核紀錄時幾乎都先縮到
 * 某個人或某段時間，能把那一份帶走才有意義。
 *
 * 匯出日誌這件事本身也會寫進日誌。乍看像遞迴，但正是這裡最需要的：
 * 稽核紀錄被帶離系統是所有匯出裡最敏感的一種，不留痕跡說不過去。
 * 那筆新紀錄要重新整理才會出現，因為它是在檔案產生之後才寫入的。
 */
function buildTableHead(logs, nameById) {
  const head = document.createElement('div');
  head.style.display = 'flex';
  head.style.justifyContent = 'space-between';
  head.style.alignItems = 'center';
  head.style.gap = 'var(--sp-3)';
  head.style.flexWrap = 'wrap';
  head.style.marginBottom = 'var(--sp-4)';

  const h2 = document.createElement('h2');
  h2.style.margin = '0';
  h2.textContent = hasFilters()
    ? `符合條件的紀錄（${logs.length}）`
    : `操作紀錄（${logs.length}）`;

  head.append(h2, createExportButton({
    label: hasFilters() ? '匯出目前結果' : '匯出日誌',
    filename: 'sunny-admin-logs',
    auditTable: 'admin_logs',
    sheetName: '操作日誌',
    columns: LOG_EXPORT_COLUMNS,
    notify: toast,
    getRows: () => logs.map((log) => ({
      createdAt: formatDateTime(log.createdAt),
      actorName: nameById.get(log.actorId) ?? log.actorId.slice(0, 8),
      actorId: log.actorId,
      actionLabel: actionLabel(log.action),
      targetTable: log.targetTable,
      targetId: log.targetId ?? '',
      summaryText: summaryText(log.summary)
    })),
    // 只記「篩了什麼」，不記篩出來的內容——摘要本身也會進日誌（FR-118）
    auditContext: () => (hasFilters() ? { 篩選條件: filterDescription() } : {})
  }));

  return head;
}

/** 匯出時記錄用的條件描述。操作者只記 ID，不把姓名抄進日誌。 */
function filterDescription() {
  const parts = [];
  if (filters.actorId) parts.push(`操作者=${filters.actorId.slice(0, 8)}`);
  if (filters.action) parts.push(`動作=${actionLabel(filters.action)}`);
  if (filters.from) parts.push(`起=${filters.from}`);
  if (filters.to) parts.push(`訖=${filters.to}`);
  return parts.join('、');
}

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

/**
 * 同一份摘要的純文字版，給匯出用。
 *
 * 與 buildSummaryCell 共用 isFromTo / describe，兩邊的寫法才不會漂開——
 * 匯出的檔案跟畫面對不起來時，沒人分得出是哪一邊錯了。
 */
function summaryText(summary) {
  const entries = Object.entries(summary ?? {});
  if (!entries.length) return '';
  return entries
    .map(([key, value]) => (isFromTo(value)
      ? `${key}：${describe(value.from)} → ${describe(value.to)}`
      : `${key}：${describe(value)}`))
    .join('\n');
}

const isFromTo = (v) => v && typeof v === 'object' && !Array.isArray(v) && ('from' in v || 'to' in v);

function describe(value) {
  if (value === null || value === undefined || value === '') return '（空）';
  if (Array.isArray(value)) return value.length ? value.join('、') : '（空）';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
