/**
 * 待付款訂單的剩餘時間倒數（US3 / T056、FR-102）。
 *
 * 倒數只是提示。真正的到期判定在資料庫：`expires_at` 加上
 * `expire_stale_orders()`，以及 `guard_order_transition` trigger。
 * 因此本元件的計時器就算因分頁休眠而不準，也不會影響正確性——
 * 使用者按下付款時仍會被伺服器擋下（FR-100）。
 */

import { remainingMs } from '../data/orders.js';
import { formatRemaining } from '../utils/dates.js';

/**
 * @param {object} order
 * @param {() => void} [onExpire] 倒數歸零時呼叫一次
 * @returns {HTMLElement}
 */
export function createPaymentCountdown(order, onExpire) {
  const el = document.createElement('p');
  el.className = 'tag tag--warn';
  el.style.display = 'inline-block';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');

  let fired = false;
  let timer = null;

  const stop = () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  const tick = () => {
    // 元素已被移出畫面（換頁）時自行收尾，避免計時器留在背景空轉
    if (!el.isConnected) {
      stop();
      return;
    }

    const left = remainingMs(order);
    if (left <= 0) {
      el.textContent = '保留時間已過，此訂單已取消。';
      el.className = 'tag tag--danger';
      stop();
      if (!fired) {
        fired = true;
        onExpire?.();
      }
      return;
    }
    el.textContent = `請於 ${formatRemaining(left)} 內完成付款`;
  };

  tick();
  timer = window.setInterval(tick, 1000);

  return el;
}
