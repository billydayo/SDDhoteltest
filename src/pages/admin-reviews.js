/**
 * 評論審核佇列（US7 / T080、T081）。
 *
 * 佇列顯示每則評論的自動審核初判與觸發的規則——管理員要看得到「為什麼」，
 * 而不是一個沒有來由的結論（FR-103b）。
 *
 * 覆寫自動判定與刪除已公開評論都會寫入稽核日誌（FR-103c、FR-114）。
 */

import { createPageHeader, toast } from '../app.js';
import { listReviews, moderateReview, deleteReview } from '../data/reviews.js';
import { listRooms } from '../data/rooms.js';
import { withAudit, ACTIONS } from '../services/audit.js';
import { autoModerationNotice } from '../components/simulated-badge.js';
import { ruleLabel } from '../services/moderation.js';
import { REVIEW_STATUS, reviewStatusLabel } from '../services/reviews.js';
import {
  createEmptyRow, actionButton, confirmAction, statusTag, buttonRow, selectField
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

  li.append(buildActions(review, panel, context));
  return li;
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
      toast(toUserMessage(err), 'error');
    }
  }, 'danger');

  // 已是該狀態的按鈕不需要再出現
  const buttons = [];
  if (review.status !== 'approved') buttons.push(approve);
  if (review.status !== 'rejected') buttons.push(reject);
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
    toast(toUserMessage(err), 'error');
  }
}

function categoryLabel(value) {
  return REVIEW_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
