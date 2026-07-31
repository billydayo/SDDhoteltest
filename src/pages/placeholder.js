/**
 * 尚未實作的頁面。
 *
 * Phase 1 與 Phase 3（基礎建設）已完成，使用者故事 US1–US12 屬 Phase 4 之後。
 * 這些頁面刻意顯示「尚未實作」而不是空白或壞掉的畫面——
 * 憲章「錯誤處理」條要求任何情況都不得只留一片空白。
 *
 * 實作某個故事時，把對應的 page 檔案換成真正的內容即可，路由不需改動。
 */

import { render, createPageHeader } from '../app.js';

export function renderPlaceholder({ title, story, taskRange, description }) {
  const wrap = document.createElement('div');
  wrap.append(createPageHeader(title, description));

  const box = document.createElement('div');
  box.className = 'empty-state';

  const h = document.createElement('h2');
  h.textContent = '此頁面尚未實作';
  const p = document.createElement('p');
  p.textContent = `${story} 規劃於 ${taskRange}，目前已完成的是專案骨架與雙軌資料層（Phase 1 與 Phase 3）。`;
  const p2 = document.createElement('p');
  p2.textContent = '資料層已可運作，實作時直接呼叫 src/data/repository.js 即可，不需要區分示範模式或資料庫模式。';

  box.append(h, p, p2);
  wrap.append(box);
  render(wrap);
}

/** 產生一個 placeholder 頁面處理器 */
export const placeholderPage = (config) => () => renderPlaceholder(config);
