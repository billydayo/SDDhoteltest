/**
 * 會員訊息（後台，FR-123 ~ FR-127）。
 *
 * 所有管理員看到的是同一個收件匣：任何一位都讀得到全部討論串、都能回覆，
 * 而且看得出上一則是哪一位同仁回的（FR-127）。刻意不做「指派給某人」——
 * 那會讓被指派的人休假時整串沒人回，而這裡真正要解決的是「不漏接」。
 *
 * 每一次回覆都寫入操作日誌：訊息本身不可竄改，但「誰在什麼時候回了哪一串」
 * 仍應該有一份獨立於訊息表的紀錄（FR-114）。
 */

import { createPageHeader, toast, toastError } from '../app.js';
import { listThreads, listMessages, sendMessage, markRead } from '../data/messages.js';
import { listProfiles } from '../data/profiles.js';
import { withAudit, ACTIONS } from '../services/audit.js';
import { createMessageThread } from '../components/message-thread.js';
import { createEmptyRow, actionButton, statusTag, createExportBar } from '../components/admin-ui.js';
import { formatDateTime } from '../utils/dates.js';

/** 目前開啟的討論串（會員 id）。null = 顯示清單。 */
let openThread = null;

export async function renderAdminMessages(panel, context) {
  const [threads, profiles] = await Promise.all([
    listThreads(),
    listProfiles().catch(() => [])
  ]);
  const byId = new Map(profiles.map((p) => [p.id, p]));

  panel.replaceChildren(openThread
    ? await buildThreadView(openThread, byId, panel, context)
    : buildThreadList(threads, byId, panel, context));
}

const reload = (panel, context) => renderAdminMessages(panel, context);

/** 顯示名稱。查不到 profile 時退回截短的 id，而不是一片空白 */
const nameOf = (byId, userId) =>
  byId.get(userId)?.displayName ?? `（已刪除的帳號 ${String(userId).slice(0, 8)}）`;

function buildThreadList(threads, byId, panel, context) {
  const frag = document.createDocumentFragment();

  const unreadTotal = threads.reduce((n, t) => n + t.unread, 0);
  frag.append(createPageHeader(
    '會員訊息',
    unreadTotal
      ? `共 ${threads.length} 個討論串，其中 ${unreadTotal} 則尚未有人讀取。`
      : `共 ${threads.length} 個討論串，目前沒有未讀訊息。`
  ));

  if (!threads.length) {
    frag.append(createEmptyRow('目前沒有任何會員訊息。會員從「客服訊息」留言後會出現在這裡。'));
    return frag;
  }

  frag.append(createExportBar({
    label: '匯出訊息紀錄',
    filename: 'sunny-messages',
    auditTable: 'messages',
    sheetName: '會員訊息',
    columns: [
      { key: 'member', label: '會員' },
      { key: 'total', label: '訊息數' },
      { key: 'unread', label: '未讀' },
      { key: 'lastSender', label: '最後發話' },
      { key: 'lastAt', label: '最後更新' }
    ],
    notify: toast,
    // 匯出的是討論串摘要而非逐則內容：對話內容屬於會員與客服之間，
    // 落成檔案四處流傳不符合 FR-118 的精神
    getRows: () => threads.map((t) => ({
      member: nameOf(byId, t.userId),
      total: t.total,
      unread: t.unread,
      lastSender: t.lastMessage.senderRole === 'admin' ? '客服' : '會員',
      lastAt: formatDateTime(t.lastMessage.createdAt)
    }))
  }));

  const list = document.createElement('ul');
  list.className = 'review-list';

  threads.forEach((thread) => {
    const li = document.createElement('li');
    li.className = 'review-item';

    const head = document.createElement('div');
    head.className = 'review-item__head';
    head.append(
      statusTag(nameOf(byId, thread.userId), 'neutral'),
      document.createTextNode(formatDateTime(thread.lastMessage.createdAt))
    );
    if (thread.unread) head.append(statusTag(`${thread.unread} 則未讀`, 'danger'));
    li.append(head);

    const preview = document.createElement('p');
    preview.style.margin = '0 0 var(--sp-2)';
    preview.textContent = `${thread.lastMessage.senderRole === 'admin' ? '客服：' : '會員：'}`
      + truncate(thread.lastMessage.body, 80);
    li.append(preview);

    li.append(actionButton('開啟對話', () => {
      openThread = thread.userId;
      reload(panel, context);
    }));

    list.append(li);
  });

  frag.append(list);
  return frag;
}

async function buildThreadView(userId, byId, panel, context) {
  const messages = await listMessages(userId);

  // 開啟即視為已讀。要管理員再按一次「標為已讀」只會讓未讀數失真。
  if (messages.some((m) => m.senderRole === 'member' && !m.readAt)) {
    await markRead(userId, 'admin').catch(() => { /* 標記失敗不影響閱讀 */ });
  }

  const frag = document.createDocumentFragment();

  frag.append(actionButton('← 回到訊息清單', () => {
    openThread = null;
    reload(panel, context);
  }));

  frag.append(createPageHeader(
    `與 ${nameOf(byId, userId)} 的對話`,
    '這一串所有管理員都看得到，回覆會顯示為「客服人員」。'
  ));

  frag.append(createMessageThread({
    messages,
    viewerRole: 'admin',
    emptyText: '這位會員還沒有留言。',
    placeholder: '輸入回覆…',
    // 管理員之間要看得出是誰回的，前台的會員則一律只看到「客服人員」
    senderLabel: (m) => (m.senderRole === 'admin'
      ? `客服・${nameOf(byId, m.senderId)}`
      : nameOf(byId, m.senderId)),
    onSend: async (body) => {
      try {
        await withAudit(
          {
            action: ACTIONS.MESSAGE_SEND, targetTable: 'messages', targetId: userId,
            // 不記內容：訊息本身已經存在 messages 表且不可竄改，
            // 抄一份到所有管理員都看得到的日誌只是多一個外洩點（FR-118）
            summary: { 討論串: nameOf(byId, userId), 字數: body.length }
          },
          () => sendMessage({ threadUserId: userId, body })
        );
        await reload(panel, context);
      } catch (err) {
        toastError(err);
        throw err;                      // 讓輸入框保留內容，使用者不必重打
      }
    }
  }));

  return frag;
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);
