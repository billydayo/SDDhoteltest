/**
 * 應用程式容器：頁面掛載點、載入／錯誤狀態、提示訊息。
 *
 * 所有頁面都透過這裡渲染，因此載入中與錯誤處理只需實作一次
 * （FR-075：操作失敗必須顯示可理解的訊息，不得只留空白）。
 */

import { renderHeader } from './components/header.js';
import { renderModeBanner } from './components/demo-badge.js';
import { toUserMessage, isAppError } from './utils/errors.js';
import { currentHash, navigate, setPendingRedirect } from './router.js';
import * as store from './state/store.js';

const el = {
  banner: () => document.getElementById('mode-banner'),
  header: () => document.getElementById('site-header'),
  main:   () => document.getElementById('main')
};

let toastStack = null;

export function initShell() {
  renderModeBanner(el.banner());
  renderHeader(el.header(), currentHash());

  // 登入狀態改變時同步頁首（顯示名稱、後台入口）
  store.subscribe((_state, reason) => {
    if (reason === 'session') renderHeader(el.header(), currentHash());
  });
}

export function refreshHeader() {
  renderHeader(el.header(), currentHash());
}

/** 將元素或元素陣列渲染到主內容區 */
export function render(content) {
  const main = el.main();
  if (!main) return;
  main.replaceChildren(...[content].flat().filter(Boolean));
  main.scrollTop = 0;
}

export function renderLoading(message = '載入中…') {
  const p = document.createElement('p');
  p.className = 'loading-state';
  p.setAttribute('role', 'status');
  p.textContent = message;
  render(p);
}

/**
 * 錯誤畫面。永遠顯示可理解的訊息，不顯示原始技術錯誤。
 * 開發時的細節走 console.debug，不干擾使用者，也不算 console 錯誤。
 */
/**
 * 錯誤區塊本身。與 renderError 的差別只在於「放在哪裡」——
 * 整頁失敗時取代 #main，區域性失敗時由呼叫端嵌進版面的某一段，
 * 讓使用者原本填好的表單留在畫面上。兩者外觀必須一致，因此共用這支。
 */
export function createErrorState(err, { retry } = {}) {
  const box = document.createElement('div');
  box.className = 'error-state';
  box.setAttribute('role', 'alert');

  const expired = isAppError(err, 'SESSION_EXPIRED');

  const h = document.createElement('h2');
  h.textContent = expired ? '登入已逾時' : '操作未能完成';
  const p = document.createElement('p');
  p.textContent = toUserMessage(err);
  box.append(h, p);

  // FR-009d：工作階段失效時必須「明確告知**並引導**重新登入」。
  // 只顯示訊息不夠——使用者還得自己找到登入頁，而且登入後會回到首頁而非原本的位置。
  if (expired) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--primary';
    btn.textContent = '重新登入';
    btn.addEventListener('click', () => {
      setPendingRedirect(currentHash());   // 登入後回到剛才的頁面
      navigate('#/login');
    });
    box.append(btn);
  } else if (retry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = '重新載入';
    btn.addEventListener('click', retry);
    box.append(btn);
  }
  return box;
}

export function renderError(err, { retry } = {}) {
  render(createErrorState(err, { retry }));
}

/** 頁面級的空狀態（FR-018） */
export function createEmptyState({ title, body, actionLabel, actionHref }) {
  const box = document.createElement('div');
  box.className = 'empty-state';

  const h = document.createElement('h2');
  h.textContent = title;
  box.append(h);

  if (body) {
    const p = document.createElement('p');
    p.textContent = body;
    box.append(p);
  }
  if (actionLabel && actionHref) {
    const a = document.createElement('a');
    a.className = 'btn btn--primary';
    a.href = actionHref;
    a.textContent = actionLabel;
    box.append(a);
  }
  return box;
}

export function createPageHeader(title, description) {
  const header = document.createElement('header');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = title;
  header.append(h1);
  if (description) {
    const p = document.createElement('p');
    p.textContent = description;
    header.append(p);
  }
  return header;
}

// ---------------------------------------------------------------------------
// 提示訊息
// ---------------------------------------------------------------------------

/**
 * 提示訊息的容器要掛在哪裡。
 *
 * 後台浮窗是原生 `<dialog>` + `showModal()`，它渲染在瀏覽器的 **top layer**——
 * 那一層在所有 z-index 之上，`.toast-stack` 設到 z-index: 9999 也一樣會被蓋住。
 * 驗收時「上傳非圖片檔看不到錯誤提示」就是這樣來的：toast 有產生、文字也對，
 * 只是整個被浮窗擋在後面。
 *
 * 解法是把容器掛進當下開著的浮窗裡——同在 top layer，就不會被它蓋住。
 * 沒有浮窗時回到 body。容器是 position: fixed，掛在哪都定位在視窗上，
 * 位置不會因此跑掉。
 */
function toastHost() {
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  return dialogs[dialogs.length - 1] ?? document.body;
}

export function toast(message, tone = 'info') {
  if (!toastStack) {
    toastStack = document.createElement('div');
    toastStack.className = 'toast-stack';
    toastStack.setAttribute('aria-live', 'polite');
  }

  // 每次都重新確認該掛在哪：浮窗可能在上一則提示之後才開啟或關閉
  const host = toastHost();
  if (toastStack.parentElement !== host) host.append(toastStack);

  const item = document.createElement('div');
  item.className = `toast${tone === 'error' ? ' toast--error' : tone === 'ok' ? ' toast--ok' : ''}`;
  item.textContent = message;
  toastStack.append(item);
  window.setTimeout(() => item.remove(), 5000);
}

/**
 * 浮窗關閉前呼叫，把提示容器接回 body。
 *
 * 「房源已更新」這類提示是在關窗**之前**發出的，若容器還掛在浮窗裡，
 * `dialog.remove()` 會把它一起帶走，使用者根本來不及看到。
 */
export function releaseToastsFrom(node) {
  if (toastStack && node.contains(toastStack)) document.body.append(toastStack);
}

/**
 * 錯誤提示的統一入口。
 *
 * 除了顯示訊息，工作階段失效時還會把使用者帶回登入頁並記住原本的位置（FR-009d）。
 * 動作按鈕的錯誤處理一律走這裡，不要各自呼叫 toast()，否則這段引導會被繞過。
 */
export function toastError(err) {
  toast(toUserMessage(err), 'error');

  if (isAppError(err, 'SESSION_EXPIRED')) {
    setPendingRedirect(currentHash());
    navigate('#/login');
  }
}
