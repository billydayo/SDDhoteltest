/**
 * 渠道比價與控價（US11 / T100、T102、T103、T104）。
 *
 * ⚠️ 整個模組建立在模擬資料之上。頁面頂端必須有常駐標示，
 *    讓管理員清楚知道系統並沒有真的在監控 Agoda 或 Booking（FR-110）。
 */

import { createPageHeader, toast, toastError } from '../app.js';
import { listRooms } from '../data/rooms.js';
import { loadComparison, undercutAlerts, markResolved, buildComplaintEmail }
  from '../services/channel.js';
import { withAudit, ACTIONS } from '../services/audit.js';
import { channelPricingNotice } from '../components/simulated-badge.js';
import {
  createDataTable, createEmptyRow, actionButton, statusTag, buttonRow, createExportBar
} from '../components/admin-ui.js';
import { formatTWD, formatPercent } from '../utils/money.js';
import { formatDateTime } from '../utils/dates.js';
import { toUserMessage } from '../utils/errors.js';

let showUnresolvedOnly = false;

export async function renderAdminChannel(panel, context) {
  const rooms = await listRooms({});
  const comparison = await loadComparison(rooms);
  const alerts = undercutAlerts(comparison);
  const visible = showUnresolvedOnly ? alerts : comparison;

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('渠道比價與控價', '監看自家房源在外部平台的售價，偵測低於官網的情形。'));

  // FR-110：模擬資料的常駐標示
  frag.append(channelPricingNotice());

  frag.append(buildSummary(comparison, alerts));
  frag.append(buildToggle(alerts.length, panel, context));

  if (!visible.length) {
    frag.append(createEmptyRow(
      showUnresolvedOnly
        ? '目前沒有未處理的賤賣預警。'
        : '尚無渠道價格資料。可執行 supabase/seed.sql 載入示範資料。'
    ));
    panel.replaceChildren(frag);
    return;
  }

  // 匯出跟著「只看未處理」的切換走，與畫面上看到的一致
  frag.append(createExportBar({
    label: showUnresolvedOnly ? '匯出未處理預警' : '匯出比價資料',
    filename: 'sunny-channel-prices',
    sheetName: '渠道比價',
    columns: [
      { key: 'roomName', label: '房源' },
      { key: 'channel', label: '平台' },
      { key: 'websitePrice', label: '官網價' },
      { key: 'channelPrice', label: '平台售價' },
      { key: 'gap', label: '價差' },
      { key: 'gapPercent', label: '價差比' },
      { key: 'statusLabel', label: '狀態' },
      { key: 'capturedAt', label: '擷取時間' }
    ],
    notify: toast,
    getRows: () => visible.map((r) => ({
      roomName: r.roomName,
      channel: r.channel,
      websitePrice: r.websitePrice,
      channelPrice: r.channelPrice,
      // 沒有價差時輸出空字串而非 0——0 會被讀成「剛好一樣」
      gap: r.isUndercut ? r.gap : '',
      gapPercent: r.isUndercut ? formatPercent(r.gapPercent) : '',
      statusLabel: !r.isUndercut ? '正常' : (r.resolved ? '已處理' : '賤賣預警'),
      capturedAt: formatDateTime(r.capturedAt)
    }))
  }));

  frag.append(buildTable(visible, panel, context));
  panel.replaceChildren(frag);
}

const reload = (panel, context) => renderAdminChannel(panel, context);

function buildSummary(comparison, alerts) {
  const grid = document.createElement('div');
  grid.className = 'stat-grid';

  [
    ['監看筆數', String(comparison.length)],
    ['賤賣預警', String(alerts.length)],
    ['最大價差', alerts.length ? formatTWD(Math.max(...alerts.map((a) => a.gap))) : null]
  ].forEach(([label, value]) => {
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    const l = document.createElement('div');
    l.className = 'stat-tile__label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'stat-tile__value';
    if (value === null) {
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

function buildToggle(alertCount, panel, context) {
  return buttonRow(actionButton(
    showUnresolvedOnly ? `顯示全部監看資料` : `只看未處理的預警（${alertCount}）`,
    () => {
      showUnresolvedOnly = !showUnresolvedOnly;
      reload(panel, context);
    }
  ));
}

function buildTable(rows, panel, context) {
  const section = document.createElement('section');

  const cells = rows.map((row) => [
    row.roomName,
    row.channel,
    formatTWD(row.websitePrice),
    formatTWD(row.channelPrice),
    row.isUndercut ? formatTWD(row.gap) : '—',
    row.isUndercut ? formatPercent(row.gapPercent) : '—',
    buildStatusCell(row),
    formatDateTime(row.capturedAt),
    buildActions(row, panel, context)
  ]);

  section.append(createDataTable(
    ['房源', '平台', '官網價', '平台售價', '價差', '價差比', '狀態', '擷取時間', '操作'],
    cells,
    // 未處理的賤賣列以底色標示，一眼看得出來
    { rowClass: (i) => (rows[i].isUndercut && !rows[i].resolved ? 'is-alert' : '') }
  ));

  return section;
}

function buildStatusCell(row) {
  if (!row.isUndercut) return statusTag('正常', 'ok');
  return row.resolved ? statusTag('已處理', 'neutral') : statusTag('賤賣預警', 'danger');
}

function buildActions(row, panel, context) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.gap = 'var(--sp-1)';

  if (!row.isUndercut) {
    const dash = document.createElement('span');
    dash.textContent = '—';
    wrap.append(dash);
    return wrap;
  }

  wrap.append(actionButton('產生申訴郵件', () => showEmailTemplate(row)));

  if (!row.resolved) {
    wrap.append(actionButton('標記已處理', async () => {
      try {
        await withAudit(
          {
            action: ACTIONS.CHANNEL_RESOLVE, targetTable: 'channel_prices', targetId: row.id,
            summary: { roomName: row.roomName, channel: row.channel, gap: row.gap }
          },
          () => markResolved(row.id)
        );
        toast('已標記為處理完成。', 'ok');
        reload(panel, context);
      } catch (err) {
        toastError(err);
      }
    }));
  }

  return wrap;
}

/**
 * 顯示可複製的郵件範本。
 *
 * FR-112：必須明確告知系統不會代為寄送。這一點刻意放在最上方而非小字，
 * 否則管理員會以為按了就寄出去了。
 */
function showEmailTemplate(row) {
  const { subject, body } = buildComplaintEmail(row);

  const dialog = document.createElement('dialog');
  dialog.style.maxWidth = '720px';
  dialog.style.width = '92vw';
  dialog.style.borderRadius = 'var(--radius)';
  dialog.style.border = '1px solid var(--c-border-strong)';
  dialog.style.padding = 'var(--sp-5)';

  const h2 = document.createElement('h2');
  h2.textContent = '申訴郵件範本';

  const warn = document.createElement('p');
  warn.className = 'simulated-badge';
  warn.style.display = 'block';
  warn.textContent = '系統不會代為寄送這封信。請複製以下內容，自行透過你的郵件軟體寄出。';

  const subjectLabel = document.createElement('p');
  subjectLabel.className = 'field__hint';
  subjectLabel.textContent = '主旨';

  const subjectBox = document.createElement('input');
  subjectBox.type = 'text';
  subjectBox.readOnly = true;
  subjectBox.value = subject;
  subjectBox.style.width = '100%';
  subjectBox.setAttribute('aria-label', '郵件主旨');

  const bodyLabel = document.createElement('p');
  bodyLabel.className = 'field__hint';
  bodyLabel.textContent = '內文';

  const bodyBox = document.createElement('textarea');
  bodyBox.readOnly = true;
  bodyBox.rows = 16;
  bodyBox.value = body;
  bodyBox.style.width = '100%';
  bodyBox.setAttribute('aria-label', '郵件內文');

  const copy = actionButton('複製內文', async () => {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      toast('已複製到剪貼簿。', 'ok');
    } catch {
      // 剪貼簿權限被拒時退回手動選取
      bodyBox.select();
      toast('無法自動複製，內容已選取，請按 Ctrl+C。');
    }
  }, 'primary');

  const close = actionButton('關閉', () => dialog.close());

  dialog.append(h2, warn, subjectLabel, subjectBox, bodyLabel, bodyBox, buttonRow(copy, close));
  dialog.addEventListener('close', () => dialog.remove());

  document.getElementById('modal-root')?.append(dialog);
  dialog.showModal();
}
