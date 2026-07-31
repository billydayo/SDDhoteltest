/**
 * 應用程式容器：頁面掛載點、載入／錯誤狀態、提示訊息。
 *
 * 所有頁面都透過這裡渲染，因此載入中與錯誤處理只需實作一次
 * （FR-075：操作失敗必須顯示可理解的訊息，不得只留空白）。
 */

import { renderHeader } from './components/header.js';
import { renderModeBanner } from './components/demo-badge.js';
import { toUserMessage } from './utils/errors.js';
import { currentHash } from './router.js';
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
export function renderError(err, { retry } = {}) {
  const box = document.createElement('div');
  box.className = 'error-state';
  box.setAttribute('role', 'alert');

  const h = document.createElement('h2');
  h.textContent = '操作未能完成';
  const p = document.createElement('p');
  p.textContent = toUserMessage(err);
  box.append(h, p);

  if (retry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = '重新載入';
    btn.addEventListener('click', retry);
    box.append(btn);
  }
  render(box);
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

export function toast(message, tone = 'info') {
  if (!toastStack) {
    toastStack = document.createElement('div');
    toastStack.className = 'toast-stack';
    toastStack.setAttribute('aria-live', 'polite');
    document.body.append(toastStack);
  }
  const item = document.createElement('div');
  item.className = `toast${tone === 'error' ? ' toast--error' : tone === 'ok' ? ' toast--ok' : ''}`;
  item.textContent = message;
  toastStack.append(item);
  window.setTimeout(() => item.remove(), 5000);
}

export const toastError = (err) => toast(toUserMessage(err), 'error');
