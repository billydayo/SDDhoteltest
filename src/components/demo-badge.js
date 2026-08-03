/**
 * 示範模式的常駐標示（FR-079）。
 *
 * 憲章「模式標示」條：處於示範模式時，介面必須有持續可見的標示，
 * 讓使用者知道資料只存在本機瀏覽器。這不是可有可無的提示——
 * 使用者若以為資料在雲端，換裝置後會發現訂單消失。
 */

import { getBootInfo, isDemoMode } from '../data/repository.js';

export function renderModeBanner(container) {
  if (!container) return;
  container.replaceChildren();

  if (!isDemoMode()) return;

  const info = getBootInfo();
  const banner = document.createElement('div');
  banner.className = 'mode-banner mode-banner--demo';

  const strong = document.createElement('strong');
  strong.textContent = '示範模式：';
  banner.append(strong, document.createTextNode(`${info.reason ?? ''}功能完整，且不會連線至任何伺服器。`));

  // 無痕模式等情境下連 localStorage 都不可用——這必須說清楚，
  // 否則使用者會以為資料有存下來（FR-074）
  if (info.storageAvailable === false) {
    const warn = document.createElement('div');
    warn.textContent = '此瀏覽器無法使用本機儲存空間，重新整理後資料會消失。';
    banner.append(warn);
  }

  container.append(banner);
}
