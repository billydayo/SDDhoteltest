/**
 * 後台分派中樞與儀表板（US6 / T073、T074、T075）。
 *
 * 所有 `#/admin/*` 路由都進到這裡：先過守衛、建版面，再把面板交給對應模組。
 * 這樣十一個模組共用同一套權限檢查與導覽，不會有哪個模組忘了擋。
 */

import { render, renderLoading, renderError, createPageHeader, toast } from '../app.js';
import { createAdminLayout, guardAdminAccess } from '../components/admin-panel.js';
import { getOrderStats } from '../data/orders.js';
import { listRooms } from '../data/rooms.js';
import { listPendingReviews } from '../data/reviews.js';
import { listPendingRefunds } from '../data/refunds.js';
import { listUnresolvedAlerts } from '../data/channel-prices.js';
import { formatTWD, formatPercent } from '../utils/money.js';
import { ROOM_STATUS, roomStatusLabel } from '../data/vocabulary.js';
import * as router from '../router.js';

import { renderAdminRooms } from './admin-rooms.js';
import { renderAdminOrders } from './admin-orders.js';
import { renderAdminUsers } from './admin-users.js';
import { renderAdminReviews } from './admin-reviews.js';
import { renderAdminRefunds } from './admin-refunds.js';
import { renderAdminContent } from './admin-content.js';
import { renderAdminRisk } from './admin-risk.js';
import { renderAdminChannel } from './admin-channel.js';
import { renderAdminLogs } from './admin-logs.js';
import { renderAdminSettings } from './admin-settings.js';

const MODULES = {
  '#/admin':          renderDashboard,
  '#/admin/rooms':    renderAdminRooms,
  '#/admin/orders':   renderAdminOrders,
  '#/admin/users':    renderAdminUsers,
  '#/admin/reviews':  renderAdminReviews,
  '#/admin/refunds':  renderAdminRefunds,
  '#/admin/content':  renderAdminContent,
  '#/admin/risk':     renderAdminRisk,
  '#/admin/channel':  renderAdminChannel,
  '#/admin/logs':     renderAdminLogs,
  '#/admin/settings': renderAdminSettings
};

export async function renderAdmin(context) {
  // 前端守衛只影響畫面；真正的存取邊界是資料庫 RLS（憲章原則 VI）
  const guard = guardAdminAccess();
  if (!guard.allowed) {
    toast(guard.message, 'error');
    router.navigate(guard.redirect, { replace: true });
    return;
  }

  const { layout, panel } = createAdminLayout(context.path);
  render(layout);

  const module = MODULES[context.path] ?? renderDashboard;
  const loading = document.createElement('p');
  loading.className = 'loading-state';
  loading.textContent = '載入中…';
  panel.append(loading);

  try {
    await module(panel, context);
  } catch (err) {
    panel.replaceChildren();
    const box = document.createElement('div');
    box.className = 'error-state';
    box.setAttribute('role', 'alert');
    box.textContent = '此模組載入失敗，請稍後再試。';
    panel.append(box);
    renderError(err, { retry: () => renderAdmin(context) });
  }
}

// ---------------------------------------------------------------------------
// 儀表板
// ---------------------------------------------------------------------------

async function renderDashboard(panel) {
  const [stats, rooms, pendingReviews, pendingRefunds, alerts] = await Promise.all([
    getOrderStats().catch(() => null),
    listRooms({}).catch(() => []),
    listPendingReviews().catch(() => []),
    listPendingRefunds().catch(() => []),
    listUnresolvedAlerts().catch(() => [])
  ]);

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('儀表板', '營運總覽。'));

  frag.append(buildStatGrid([
    ['總訂單數', stats ? String(stats.totalOrders) : null],
    ['已付款訂單', stats ? String(stats.paidOrders) : null],
    ['未付款取消', stats ? String(stats.unpaidCancelled) : null],
    ['成交率', stats && stats.conversionRate !== null
      ? formatPercent(Math.round(stats.conversionRate * 1000) / 10) : null],
    ['總營業額', stats ? formatTWD(stats.revenue) : null],
    ['平均客單價', stats?.averageOrderValue !== null && stats?.averageOrderValue !== undefined
      ? formatTWD(stats.averageOrderValue) : null]
  ]));

  frag.append(buildRoomStatusSummary(rooms));

  frag.append(buildStatGrid([
    ['待審核評論', String(pendingReviews.length)],
    ['待審核退款', String(pendingRefunds.length)],
    // 賤賣預警：外部售價低於官網價且尚未處理的筆數（FR-111）
    ['未處理渠道預警', String(countUndercuts(alerts, rooms))]
  ]));

  panel.replaceChildren(frag);
}

/**
 * 統計磚。值為 null 時顯示破折號——沒有訂單時不該顯示 0 或做除以零的計算
 * （US6 場景 3 / T075）。
 */
function buildStatGrid(entries) {
  const grid = document.createElement('div');
  grid.className = 'stat-grid';

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

function buildRoomStatusSummary(rooms) {
  const section = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent = '房源狀態';
  section.append(h2);

  const counts = new Map();
  rooms.forEach((r) => counts.set(r.status, (counts.get(r.status) ?? 0) + 1));

  const p = document.createElement('p');
  Object.keys(ROOM_STATUS).forEach((status) => {
    const tag = document.createElement('span');
    tag.className = `tag tag--${ROOM_STATUS[status].tone}`;
    tag.style.marginInlineEnd = 'var(--sp-2)';
    tag.textContent = `${roomStatusLabel(status)} ${counts.get(status) ?? 0}`;
    p.append(tag);
  });
  section.append(p);

  return section;
}

function countUndercuts(alerts, rooms) {
  const priceById = new Map(rooms.map((r) => [r.id, r.nightlyPrice]));
  return alerts.filter((a) => {
    const website = priceById.get(a.roomId);
    return website !== undefined && a.channelPrice < website;
  }).length;
}
