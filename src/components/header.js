/**
 * 全站頁首：品牌、主導覽、帳號區。
 *
 * 導覽依角色顯示（訪客／會員／管理員）。這是使用者體驗，不是安全機制——
 * 實際的存取邊界由 router 的守衛與資料庫 RLS 執行（憲章原則 VI）。
 */

import * as store from '../state/store.js';
import { logout } from '../services/auth.js';

const GUEST_LINKS = [
  { href: '#/', label: '首頁' },
  { href: '#/risk-check', label: '安全檢測' }
];

const MEMBER_LINKS = [
  { href: '#/', label: '首頁' },
  { href: '#/favorites', label: '我的收藏' },
  { href: '#/orders', label: '我的訂單' },
  { href: '#/messages', label: '客服訊息' },
  { href: '#/risk-check', label: '安全檢測' }
];

const ADMIN_EXTRA = { href: '#/admin', label: '後台' };

export function renderHeader(container, currentPath = '#/') {
  if (!container) return;

  const role = store.currentRole();
  const profile = store.currentProfile();

  const links = role === 'guest' ? [...GUEST_LINKS] : [...MEMBER_LINKS];
  if (role === 'admin') links.push(ADMIN_EXTRA);

  const inner = document.createElement('div');
  inner.className = 'site-header__inner';

  // 品牌：logo 圖示 + 字標。圖示載不到時（離線／檔案遺失）把它移除，
  // 只留文字字標——頁首不能因為一張圖而變成空白（憲章「離線可用」條）。
  const brand = document.createElement('a');
  brand.className = 'site-header__brand';
  brand.href = '#/';

  const mark = document.createElement('img');
  mark.className = 'site-header__logo';
  mark.src = 'assets/logo-mark.png';
  mark.alt = '';           // 裝飾性：品牌名稱已在後面的文字節點
  mark.width = 256;
  mark.height = 256;
  mark.addEventListener('error', () => mark.remove(), { once: true });

  const brandText = document.createElement('span');
  brandText.textContent = 'Sunny 訂房平台';

  brand.append(mark, brandText);

  const nav = document.createElement('nav');
  nav.className = 'site-nav';
  nav.setAttribute('aria-label', '主要導覽');
  const ul = document.createElement('ul');
  links.forEach(({ href, label }) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (isCurrent(href, currentPath)) a.setAttribute('aria-current', 'page');
    li.append(a);
    ul.append(li);
  });
  nav.append(ul);

  const account = document.createElement('div');
  account.className = 'site-header__account';

  if (profile) {
    const name = document.createElement('span');
    name.textContent = profile.displayName || '會員';

    const settings = document.createElement('a');
    settings.className = 'btn btn--ghost';
    settings.href = '#/account';
    settings.textContent = '帳戶設定';

    const signOut = document.createElement('button');
    signOut.type = 'button';
    signOut.className = 'btn';
    signOut.textContent = '登出';
    signOut.addEventListener('click', async () => {
      await logout();
      window.location.hash = '#/';
    });

    account.append(name, settings, signOut);
  } else {
    const login = document.createElement('a');
    login.className = 'btn btn--primary';
    login.href = '#/login';
    login.textContent = '登入 / 註冊';
    account.append(login);
  }

  inner.append(brand, nav, account);
  container.replaceChildren(inner);
}

function isCurrent(href, currentPath) {
  if (href === '#/') return currentPath === '#/' || currentPath === '';
  return currentPath.startsWith(href);
}
