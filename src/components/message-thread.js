/**
 * 對話串的呈現與輸入框。前台（會員）與後台（管理員）共用同一支。
 *
 * 兩邊看到的是同一段對話，只是立場相反：會員的訊息在自己這側靠右，
 * 管理員的靠左，反之亦然。把它做成一個參數而不是兩份幾乎相同的程式碼——
 * 兩份的話，日後改了氣泡樣式只改到其中一邊，是遲早的事。
 */

import { formatDateTime } from '../utils/dates.js';

/**
 * @param {object}   config
 * @param {object[]} config.messages   由舊到新
 * @param {'member'|'admin'} config.viewerRole 看的人是誰
 * @param {(body: string) => Promise<void>} config.onSend
 * @param {string}   [config.placeholder]
 * @param {string}   [config.emptyText]
 * @param {(m: object) => string} [config.senderLabel] 覆寫發話者標籤
 */
export function createMessageThread({
  messages, viewerRole, onSend,
  placeholder = '輸入訊息…',
  emptyText = '還沒有任何訊息。',
  senderLabel
}) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-thread';

  const list = document.createElement('div');
  list.className = 'msg-thread__list';
  list.setAttribute('role', 'log');
  list.setAttribute('aria-label', '對話內容');

  if (!messages.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = emptyText;
    list.append(empty);
  } else {
    messages.forEach((m) => list.append(buildBubble(m, viewerRole, senderLabel)));
  }

  const form = document.createElement('form');
  form.className = 'msg-thread__form';
  form.noValidate = true;

  const label = document.createElement('label');
  label.className = 'visually-hidden';
  label.htmlFor = 'msg-input';
  label.textContent = '訊息內容';

  const input = document.createElement('textarea');
  input.id = 'msg-input';
  input.rows = 3;
  input.maxLength = 2000;
  input.placeholder = placeholder;

  const error = document.createElement('p');
  error.className = 'field__error';
  error.hidden = true;
  error.setAttribute('role', 'alert');

  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'btn btn--primary';
  send.textContent = '送出';

  const hint = document.createElement('p');
  hint.className = 'field__hint';
  hint.textContent = '按 Ctrl + Enter 也可以送出。上限 2000 字。';

  form.append(label, input, error, hint, send);

  // Enter 換行、Ctrl/⌘ + Enter 送出：訊息常常要分段，Enter 直接送出很擾人
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    error.hidden = true;

    if (!body) {
      error.textContent = '請輸入訊息內容。';
      error.hidden = false;
      input.focus();
      return;
    }

    send.disabled = true;
    send.textContent = '送出中…';
    try {
      await onSend(body);
      input.value = '';
    } catch (err) {
      error.textContent = err?.message ?? '訊息未能送出，請稍後再試。';
      error.hidden = false;
    } finally {
      send.disabled = false;
      send.textContent = '送出';
    }
  });

  wrap.append(list, form);

  // 進來就看最新的一則。對話是由舊到新排的，不捲到底等於停在幾週前的對話。
  queueMicrotask(() => { list.scrollTop = list.scrollHeight; });

  return wrap;
}

function buildBubble(message, viewerRole, senderLabel) {
  const mine = message.senderRole === viewerRole;

  const row = document.createElement('div');
  row.className = `msg-bubble${mine ? ' msg-bubble--mine' : ''}`;

  const meta = document.createElement('p');
  meta.className = 'msg-bubble__meta';
  meta.textContent = [
    senderLabel?.(message) ?? (message.senderRole === 'admin' ? '客服人員' : '會員'),
    formatDateTime(message.createdAt)
  ].join('・');

  const body = document.createElement('p');
  body.className = 'msg-bubble__body';
  body.textContent = message.body;          // textContent：訊息是使用者輸入，不得當成 HTML

  row.append(meta, body);

  // 只在自己送出的訊息上標未讀——「對方還沒看到」是發話者才需要的資訊
  if (mine && !message.readAt) {
    const unread = document.createElement('span');
    unread.className = 'msg-bubble__unread';
    unread.textContent = '未讀';
    row.append(unread);
  }

  return row;
}
