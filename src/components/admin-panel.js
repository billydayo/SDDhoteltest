/**
 * 後台版面骨架與十二個模組的導覽（T032；2026-08-03 新增「會員訊息」）。
 *
 * 企劃書稱「九大模組」但實際列出十一項，本專案以十一項為準
 * （見 spec.md「後台模組數量」）。
 */

import * as store from '../state/store.js';

/**
 * 後台模組。route 對應 router.js 的路徑。
 *
 * 「報表匯出」刻意不是獨立分頁——匯出按鈕改為嵌在各資料頁面內。
 * spec US8 場景 1 要的是「位於訂單管理且有篩選結果時匯出目前結果」，
 * 獨立分頁拿不到別頁的篩選條件，只能匯出全部，反而做不到規格要求的事。
 */
export const ADMIN_MODULES = Object.freeze([
  { route: '#/admin',           label: '儀表板',        story: 'US6' },
  { route: '#/admin/rooms',     label: '房源管理',      story: 'US6' },
  { route: '#/admin/orders',    label: '訂單管理',      story: 'US6' },
  { route: '#/admin/users',     label: '用戶管理',      story: 'US6' },
  { route: '#/admin/reviews',   label: '評論審核',      story: 'US7' },
  { route: '#/admin/messages',  label: '會員訊息',      story: 'US13' },
  { route: '#/admin/refunds',   label: '退款審核',      story: 'US7' },
  { route: '#/admin/content',   label: '內容編輯',      story: 'US8' },
  { route: '#/admin/risk',      label: '房源品質檢測',  story: 'US9' },
  { route: '#/admin/channel',   label: '渠道比價與控價', story: 'US11', simulated: true },
  { route: '#/admin/logs',      label: '操作日誌',      story: 'US12' },
  { route: '#/admin/settings',  label: '系統與參數設定', story: 'US12' }
]);

/**
 * 建立後台版面。回傳可放入內容的 panel 元素。
 *
 * @param {string} currentRoute
 * @returns {{ layout: HTMLElement, panel: HTMLElement }}
 */
export function createAdminLayout(currentRoute) {
  const layout = document.createElement('div');
  layout.className = 'admin-layout';

  const nav = document.createElement('nav');
  nav.className = 'admin-nav';
  nav.setAttribute('aria-label', '後台模組');

  const heading = document.createElement('h2');
  heading.textContent = '後台模組';
  nav.append(heading);

  const ul = document.createElement('ul');
  ADMIN_MODULES.forEach((mod) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = mod.route;
    a.textContent = mod.label;
    if (mod.simulated) {
      const tag = document.createElement('span');
      tag.className = 'tag tag--warn';
      tag.textContent = '模擬';
      tag.style.marginInlineStart = 'var(--sp-2)';
      a.append(tag);
    }
    if (isCurrent(mod.route, currentRoute)) a.setAttribute('aria-current', 'page');
    li.append(a);
    ul.append(li);
  });
  nav.append(ul);

  const panel = document.createElement('section');
  panel.className = 'admin-panel';

  layout.append(nav, panel);
  return { layout, panel };
}

/**
 * 後台頁面的存取守衛。
 *
 * 前端檢查只是體驗——即使被繞過，資料庫 RLS 仍會擋下實際的讀寫
 * （憲章原則 VI）。
 */
export function guardAdminAccess() {
  if (!store.isSignedIn()) {
    return { allowed: false, redirect: '#/login', message: '請先登入後再進入後台。' };
  }
  if (!store.isAdmin()) {
    return { allowed: false, redirect: '#/', message: '你沒有權限存取後台頁面。' };
  }
  return { allowed: true };
}

function isCurrent(route, currentRoute) {
  if (route === '#/admin') return currentRoute === '#/admin';
  return currentRoute.startsWith(route);
}
