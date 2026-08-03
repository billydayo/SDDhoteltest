/**
 * 找不到頁面（404）。
 *
 * 憲章「錯誤處理」條要求任何情況都不得只留一片空白，因此不存在的網址
 * 仍要走進一個真正的頁面，而不是讓路由靜靜地什麼都不做。
 *
 * 這支的前身是開發期的 placeholder.js——當時所有故事都還沒實作，
 * 它會告訴讀者「US1–US12 規劃於 Phase 4 之後、實作時請呼叫 repository.js」。
 * 那些話對開發者有用，對打錯網址的訪客卻是雜訊，甚至洩漏內部結構。
 * 功能全部完成後，這裡只需要做一件事：把人帶回找得到東西的地方。
 */

import { render, createPageHeader } from '../app.js';

export function renderNotFound() {
  const wrap = document.createElement('div');
  wrap.append(createPageHeader('找不到頁面', '你要找的頁面不存在，或網址已經變更。'));

  const box = document.createElement('div');
  box.className = 'empty-state';

  const hint = document.createElement('p');
  hint.textContent = '請確認網址是否正確，或從下方回到首頁重新瀏覽房源。';

  const actions = document.createElement('div');
  actions.className = 'filter-bar__actions';
  actions.style.justifyContent = 'center';

  const home = document.createElement('a');
  home.className = 'btn btn--primary';
  home.href = '#/';
  home.textContent = '回首頁';

  const orders = document.createElement('a');
  orders.className = 'btn';
  orders.href = '#/orders';
  orders.textContent = '我的訂單';

  actions.append(home, orders);
  box.append(hint, actions);
  wrap.append(box);
  render(wrap);
}
