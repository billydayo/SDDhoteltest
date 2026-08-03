/**
 * 評論審核佇列（US7 / T080、T081）。
 *
 * 佇列顯示每則評論的自動審核初判與觸發的規則——管理員要看得到「為什麼」，
 * 而不是一個沒有來由的結論（FR-103b）。
 *
 * 覆寫自動判定與刪除已公開評論都會寫入稽核日誌（FR-103c、FR-114）。
 */

import { createPageHeader, toast, toastError } from '../app.js';
import { listReviews, moderateReview, deleteReview, replyToReview } from '../data/reviews.js';
import { listRooms } from '../data/rooms.js';
import { withAudit, ACTIONS } from '../services/audit.js';
import { autoModerationNotice } from '../components/simulated-badge.js';
import { ruleLabel } from '../services/moderation.js';
import { REVIEW_STATUS, reviewStatusLabel } from '../services/reviews.js';
import {
  createEmptyRow, actionButton, confirmAction, statusTag, buttonRow, selectField,
  createExportBar, openModal, textareaField, inlineError, showInlineError
} from '../components/admin-ui.js';
import { REVIEW_CATEGORIES } from '../data/vocabulary.js';
import { formatDateTime } from '../utils/dates.js';
import { toUserMessage } from '../utils/errors.js';

let statusFilter = 'pending';

export async function renderAdminReviews(panel, context) {
  const [reviews, rooms] = await Promise.all([
    listReviews(statusFilter ? { status: statusFilter } : {}),
    listRooms({})
  ]);
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('評論審核', '所有評論都需經人工複核後才會公開。'));

  // FR-103a：此機制為規則式，不得被描述為 AI
  frag.append(autoModerationNotice());
  frag.append(buildFilter(panel, context));

  if (!reviews.length) {
    frag.append(createEmptyRow(
      statusFilter === 'pending'
        ? '目前沒有待審核的評論。有新評論送出時會出現在這裡。'
        : '沒有符合此狀態的評論。'
    ));
    panel.replaceChildren(frag);
    return;
  }

  // 匯出跟著狀態篩選走，與畫面上看到的一致
  frag.append(createExportBar({
    label: '匯出評論',
    filename: 'sunny-reviews',
    auditTable: 'reviews',
    sheetName: '評論',
    columns: [
      { key: 'statusLabel', label: '狀態' },
      { key: 'roomName', label: '房源' },
      { key: 'rating', label: '評分' },
      { key: 'categoryLabel', label: '評論類型' },
      { key: 'comment', label: '內容' },
      { key: 'autoVerdictLabel', label: '自動初判' },
      { key: 'autoRulesLabel', label: '觸發規則' },
      { key: 'adminNote', label: '審核說明' },
      { key: 'createdAt', label: '送出時間' }
    ],
    notify: toast,
    getRows: () => reviews.map((r) => ({
      statusLabel: reviewStatusLabel(r.status),
      roomName: roomById.get(r.roomId)?.name ?? '（房源已下架）',
      rating: r.rating,
      categoryLabel: categoryLabel(r.category),
      comment: r.comment,
      autoVerdictLabel: r.autoVerdict === 'auto-reject' ? '建議退件'
        : r.autoVerdict === 'auto-pass' ? '未觸發退件規則' : '無紀錄',
      autoRulesLabel: (r.autoRules ?? []).map(ruleLabel).join('、'),
      adminNote: r.adminNote ?? '',
      createdAt: formatDateTime(r.createdAt)
    }))
  }));

  const list = document.createElement('ul');
  list.className = 'review-list';
  reviews.forEach((review) => list.append(buildReviewItem(review, roomById, panel, context)));
  frag.append(list);

  panel.replaceChildren(frag);
}

const reload = (panel, context) => renderAdminReviews(panel, context);

function buildFilter(panel, context) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = 'var(--sp-4)';

  const field = selectField({
    id: 'rev-status', name: 'status', label: '顯示狀態', value: statusFilter,
    options: [
      { value: 'pending', label: '待審核' },
      { value: 'approved', label: '已公開' },
      { value: 'rejected', label: '已駁回' },
      { value: '', label: '全部' }
    ]
  });
  field.input.addEventListener('change', () => {
    statusFilter = field.input.value;
    reload(panel, context);
  });

  wrap.append(field.wrap);
  return wrap;
}

function buildReviewItem(review, roomById, panel, context) {
  const li = document.createElement('li');
  li.className = 'review-item';

  const head = document.createElement('div');
  head.className = 'review-item__head';
  head.append(
    statusTag(reviewStatusLabel(review.status), REVIEW_STATUS[review.status]?.tone ?? 'neutral'),
    document.createTextNode(formatDateTime(review.createdAt))
  );
  li.append(head);

  const meta = document.createElement('p');
  meta.className = 'room-card__meta';
  meta.textContent = [
    roomById.get(review.roomId)?.name ?? '（房源已下架）',
    `★ ${review.rating}`,
    categoryLabel(review.category)
  ].join('・');
  li.append(meta);

  const body = document.createElement('p');
  body.style.margin = '0 0 var(--sp-2)';
  body.textContent = review.comment;
  li.append(body);

  li.append(buildAutoVerdict(review));

  if (review.adminNote) {
    const note = document.createElement('p');
    note.className = 'field__hint';
    note.textContent = `既有審核說明：${review.adminNote}`;
    li.append(note);
  }

  // 已有的業者回覆。審核說明是給作者看的內部說明，回覆是公開的，兩者不能混在一起
  if (review.adminReply) {
    const reply = document.createElement('div');
    reply.className = 'review-reply';

    const who = document.createElement('p');
    who.className = 'review-reply__meta';
    who.textContent = review.adminReplyAt
      ? `業者回覆・${formatDateTime(review.adminReplyAt)}`
      : '業者回覆';

    const text = document.createElement('p');
    text.className = 'review-reply__body';
    text.textContent = review.adminReply;

    reply.append(who, text);
    li.append(reply);
  }

  li.append(buildActions(review, panel, context));
  return li;
}

/**
 * 回覆評論（FR-103d）。
 *
 * 只有已公開的評論能回覆——待審核與已駁回的評論前台看不到，
 * 回了也沒有人讀得到，反而讓管理員以為已經對外說明過了。
 */
function openReplyForm(review, panel, context) {
  const form = document.createElement('form');
  form.className = 'card';
  form.noValidate = true;

  const intro = document.createElement('p');
  intro.className = 'field__hint';
  intro.textContent = '回覆會公開顯示在這則評論下方，所有訪客都看得到。'
    + '清空內容並儲存即可收回回覆。';

  const original = document.createElement('blockquote');
  original.className = 'review-quote';
  original.textContent = review.comment;

  const field = textareaField({
    id: 'rev-reply', name: 'reply', label: '回覆內容',
    value: review.adminReply ?? '', rows: 5,
    hint: '上限 1000 字。請避免寫出訂單編號、電話等可辨識個人的資訊。'
  });
  field.input.maxLength = 1000;

  const error = inlineError();

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '儲存回覆';

  const dialog = openModal({ title: '回覆評論', content: form });
  form.append(intro, original, field.wrap, error,
    buttonRow(submit, actionButton('取消', () => dialog.close())));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = field.input.value.trim();
    submit.disabled = true;

    try {
      await withAudit(
        {
          action: ACTIONS.REVIEW_REPLY, targetTable: 'reviews', targetId: review.id,
          // 只記長度不記內容：日誌所有管理員都看得到，回覆本身在前台已經公開，
          // 抄一份進日誌只是多一個要維護的副本
          summary: { roomId: review.roomId, 動作: body ? '回覆' : '收回回覆', 字數: body.length }
        },
        () => replyToReview(review.id, body)
      );
      toast(body ? '回覆已公開。' : '回覆已收回。', 'ok');
      dialog.close();
      reload(panel, context);
    } catch (err) {
      showInlineError(error, toUserMessage(err));
      submit.disabled = false;
    }
  });
}

/** 自動審核初判與觸發的規則（可解釋，供管理員判斷） */
function buildAutoVerdict(review) {
  const box = document.createElement('div');
  box.style.background = 'var(--c-surface-alt)';
  box.style.borderRadius = 'var(--radius-sm)';
  box.style.padding = 'var(--sp-2) var(--sp-3)';
  box.style.marginBottom = 'var(--sp-2)';
  box.style.fontSize = 'var(--f-small)';

  const verdict = document.createElement('p');
  verdict.style.margin = '0 0 var(--sp-1)';
  const label = review.autoVerdict === 'auto-reject'
    ? '自動審核初判：建議退件'
    : review.autoVerdict === 'auto-pass'
      ? '自動審核初判：未觸發退件規則'
      : '自動審核初判：無紀錄';
  verdict.append(statusTag(label, review.autoVerdict === 'auto-reject' ? 'danger' : 'ok'));
  box.append(verdict);

  const rules = review.autoRules ?? [];
  const detail = document.createElement('p');
  detail.style.margin = '0';
  detail.style.color = 'var(--c-text-muted)';
  detail.textContent = rules.length
    ? `觸發規則：${rules.map(ruleLabel).join('、')}`
    : '未觸發任何規則。';
  box.append(detail);

  return box;
}

function buildActions(review, panel, context) {
  const approve = actionButton('通過並公開', () => moderate(review, 'approved', panel, context));
  const reject = actionButton('駁回', () => moderate(review, 'rejected', panel, context), 'danger');

  const remove = actionButton('刪除評論', async () => {
    if (!confirmAction('確定要刪除這則評論嗎？此操作無法復原，房源平均評分會重新計算。')) return;
    try {
      await withAudit(
        {
          action: ACTIONS.REVIEW_DELETE, targetTable: 'reviews', targetId: review.id,
          summary: { roomId: review.roomId, rating: review.rating }
        },
        () => deleteReview(review.id)
      );
      toast('評論已刪除。', 'ok');
      reload(panel, context);
    } catch (err) {
      toastError(err);
    }
  }, 'danger');

  // 已是該狀態的按鈕不需要再出現
  const buttons = [];
  if (review.status !== 'approved') buttons.push(approve);
  if (review.status !== 'rejected') buttons.push(reject);

  // 回覆只對已公開的評論開放：其餘狀態前台看不到，回了也沒人讀得到
  if (review.status === 'approved') {
    buttons.push(actionButton(
      review.adminReply ? '編輯回覆' : '回覆評論',
      () => openReplyForm(review, panel, context)
    ));
  }

  buttons.push(remove);

  return buttonRow(...buttons);
}

async function moderate(review, decision, panel, context) {
  const isOverride = review.autoVerdict === 'auto-reject' && decision === 'approved';

  const note = window.prompt(
    decision === 'rejected'
      ? '駁回說明（會顯示給評論作者，可留空）'
      : '審核備註（可留空）',
    ''
  );
  if (note === null) return;   // 使用者按取消

  try {
    await withAudit(
      {
        // 覆寫自動判定要記成獨立的動作類型，日誌才看得出來人推翻了機器
        action: isOverride ? ACTIONS.REVIEW_OVERRIDE
          : decision === 'approved' ? ACTIONS.REVIEW_APPROVE : ACTIONS.REVIEW_REJECT,
        targetTable: 'reviews',
        targetId: review.id,
        summary: {
          status: { from: review.status, to: decision },
          autoVerdict: review.autoVerdict,
          autoRules: review.autoRules,
          overridden: isOverride
        }
      },
      () => moderateReview(review.id, decision, note.trim() || null)
    );
    toast(decision === 'approved' ? '評論已公開。' : '評論已駁回。', 'ok');
    reload(panel, context);
  } catch (err) {
    toastError(err);
  }
}

function categoryLabel(value) {
  return REVIEW_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
