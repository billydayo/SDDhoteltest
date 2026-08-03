/**
 * 客服訊息（會員端，FR-123 ~ FR-126）。
 *
 * 會員只有一串對話，對象是「客服」而不是某一位管理員——所以這一頁沒有
 * 收件匣、沒有選擇對象，進來就是那一串。
 */

import { render, renderLoading, renderError, createPageHeader, toastError } from '../app.js';
import { listMessages, sendMessage, markRead } from '../data/messages.js';
import { createMessageThread } from '../components/message-thread.js';
import * as store from '../state/store.js';

export async function renderMessages(context) {
  renderLoading('正在載入訊息…');

  const user = store.currentProfile();
  if (!user) {
    // 路由守衛已擋過未登入，這裡是防呆：沒有使用者就沒有討論串可讀
    renderError(new Error('請先登入。'));
    return;
  }

  try {
    const messages = await listMessages(user.id);

    // 讀到就算已讀。管理員那邊的未讀數會跟著歸零，不必再按一次「標為已讀」。
    if (messages.some((m) => m.senderRole === 'admin' && !m.readAt)) {
      await markRead(user.id, 'member').catch(() => { /* 標記失敗不影響閱讀 */ });
    }

    render([
      createPageHeader(
        '客服訊息',
        '有訂房、房況或退款上的問題都可以在這裡留言。'
        + '訊息由客服團隊共同處理，任何一位同仁都看得到，不必等特定的人回覆。'
      ),
      createMessageThread({
        messages,
        viewerRole: 'member',
        emptyText: '還沒有任何訊息。有任何問題都可以從下方留言給我們。',
        placeholder: '想詢問什麼呢？',
        senderLabel: (m) => (m.senderRole === 'admin' ? '客服人員' : '我'),
        onSend: async (body) => {
          try {
            await sendMessage({ body });
            await renderMessages(context);
          } catch (err) {
            toastError(err);
            throw err;                    // 讓輸入框保留內容，使用者不必重打
          }
        }
      })
    ]);
  } catch (err) {
    renderError(err, { retry: () => renderMessages(context) });
  }
}
