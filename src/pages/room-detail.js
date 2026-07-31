/**
 * 房源詳情頁（US1 / T038、T039、T040）。
 *
 * FR-014：照片、設施、房型特色、描述、平均評分、已公開評論、房態，
 *         以及最新一次的房源品質檢測結果（尚未檢測時顯示文字而非 0 分）。
 * FR-017：已選日期時顯示夜數與總金額。
 * FR-019：未登入者點「立即訂房」導向登入頁。
 *
 * 評論的分類篩選與撰寫表單屬 US5（T065、T070）；訂房表單屬 US3。
 */

import { render, renderLoading, renderError, createEmptyState, toast } from '../app.js';
import { getRoom, formatRating, resolveImageUrl } from '../data/rooms.js';
import { listPublicReviews } from '../data/reviews.js';
import { getLatestRiskCheck } from '../data/risk-checks.js';
import { formatTWD, calculateTotal } from '../utils/money.js';
import { nightsBetween, formatDate, formatDateTime, validateStayRange } from '../utils/dates.js';
import { typeLabel, roomStatusLabel, ROOM_STATUS, REVIEW_CATEGORIES } from '../data/vocabulary.js';
import {
  eligibleOrdersForRoom, myReviewsForRoom, submitReview,
  REVIEW_STATUS, reviewStatusLabel
} from '../services/reviews.js';
import { autoModerationNotice } from '../components/simulated-badge.js';
import { createFavoriteButton } from '../components/favorite-button.js';
import { toUserMessage } from '../utils/errors.js';
import * as store from '../state/store.js';
import * as router from '../router.js';

/** 目前選取的評論類型篩選（'' 代表全部），換房源時重設 */
let activeCategory = '';
let lastRoomId = null;

const RISK_LEVELS = {
  low:    { label: '低風險', tone: 'ok' },
  medium: { label: '中風險', tone: 'warn' },
  high:   { label: '高風險', tone: 'danger' }
};

export async function renderRoomDetail(context) {
  const roomId = context.params.id;
  // 換房源時重設評論類型篩選，否則會沿用上一間的選擇而顯示「此類型沒有評論」
  if (roomId !== lastRoomId) {
    activeCategory = '';
    lastRoomId = roomId;
  }
  renderLoading('正在載入房源資料…');

  try {
    const room = await getRoom(roomId);
    if (!room) {
      render(createEmptyState({
        title: '查無此房源',
        body: '這個房源可能已被下架。',
        actionLabel: '回到房源列表',
        actionHref: '#/'
      }));
      return;
    }

    // 評論與檢測結果各自獨立載入：其中一項失敗不應該讓整頁掛掉，
    // 但也不能靜默當成「沒有資料」——會分別顯示載入失敗的說明。
    const [reviews, riskCheck, eligibleOrders, myReviews] = await Promise.all([
      listPublicReviews(roomId).catch((err) => ({ __error: err })),
      getLatestRiskCheck(roomId).catch((err) => ({ __error: err })),
      eligibleOrdersForRoom(roomId).catch(() => []),
      myReviewsForRoom(roomId).catch(() => [])
    ]);

    render(buildPage(room, { reviews, riskCheck, eligibleOrders, myReviews }, context));
  } catch (err) {
    renderError(err, { retry: () => renderRoomDetail(context) });
  }
}

function buildPage(room, data, context) {
  const frag = document.createDocumentFragment();

  const back = document.createElement('a');
  back.href = '#/';
  back.textContent = '← 回到房源列表';
  back.style.display = 'inline-block';
  back.style.marginBottom = 'var(--sp-3)';
  frag.append(back);

  const grid = document.createElement('div');
  grid.className = 'detail-grid';
  grid.append(buildMain(room, data, context), buildAside(room));
  frag.append(grid);

  return frag;
}

// ---------------------------------------------------------------------------
// 主欄
// ---------------------------------------------------------------------------

function buildMain(room, data, context) {
  const { reviews, riskCheck, eligibleOrders, myReviews } = data;
  const main = document.createElement('div');

  const gallery = buildGallery(room);

  const h1 = document.createElement('h1');
  h1.textContent = room.name;

  const specs = document.createElement('ul');
  specs.className = 'spec-list';
  specs.append(
    specItem(roomStatusLabel(room.status), ROOM_STATUS[room.status]?.tone ?? 'neutral'),
    specItem(typeLabel(room.type), 'neutral'),
    specItem(`最多 ${room.maxGuests} 人`, 'neutral'),
    specItem(ratingText(room), 'info')
  );

  const desc = document.createElement('p');
  desc.textContent = room.description;

  main.append(gallery, h1, specs, desc);
  main.append(buildChipSection('設施', room.amenities));
  main.append(buildChipSection('房型特色', room.features));
  main.append(buildRiskSection(riskCheck));
  main.append(buildMyReviewStatus(myReviews));
  main.append(buildReviewSection(reviews));
  main.append(buildReviewForm(room, eligibleOrders, context));

  return main;
}

/**
 * 相簿：一張主圖加上可點選的縮圖列。
 *
 * 只有一張照片時不顯示縮圖列——一排只有一格的縮圖看起來像壞掉。
 */
function buildGallery(room) {
  const wrap = document.createElement('div');
  wrap.className = 'detail-gallery';

  const images = (room.images ?? []).map(resolveImageUrl).filter(Boolean);
  const sources = images.length ? images : ['assets/hero.svg'];

  const main = document.createElement('img');
  main.className = 'detail-gallery__main';
  main.src = sources[0];
  main.alt = `${room.name}的房間照片`;
  wrap.append(main);

  if (sources.length < 2) return wrap;

  const thumbs = document.createElement('div');
  thumbs.className = 'detail-gallery__thumbs';
  thumbs.setAttribute('role', 'group');
  thumbs.setAttribute('aria-label', `${room.name}的照片選擇`);

  sources.forEach((src, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'detail-gallery__thumb';
    btn.setAttribute('aria-label', `檢視第 ${index + 1} 張照片`);
    btn.setAttribute('aria-pressed', String(index === 0));

    const img = document.createElement('img');
    img.src = src;
    img.alt = '';                 // 裝飾性：主圖已有完整說明
    img.loading = 'lazy';
    btn.append(img);

    btn.addEventListener('click', () => {
      main.src = src;
      main.alt = `${room.name}的房間照片，第 ${index + 1} 張`;
      [...thumbs.children].forEach((el, i) => el.setAttribute('aria-pressed', String(i === index)));
    });

    thumbs.append(btn);
  });

  wrap.append(thumbs);
  return wrap;
}

function ratingText(room) {
  const rating = formatRating(room.averageRating);
  return rating.hasRating ? `平均評分 ${rating.text}` : rating.text;
}

function specItem(label, tone) {
  const li = document.createElement('li');
  const span = document.createElement('span');
  span.className = `tag tag--${tone}`;
  span.textContent = label;
  li.append(span);
  return li;
}

function buildChipSection(title, values = []) {
  const section = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent = title;
  section.append(h2);

  if (!values.length) {
    const p = document.createElement('p');
    p.style.color = 'var(--c-text-muted)';
    p.textContent = `此房源尚未登錄${title}資訊。`;
    section.append(p);
    return section;
  }

  const ul = document.createElement('ul');
  ul.className = 'spec-list';
  values.forEach((v) => ul.append(specItem(v, 'neutral')));
  section.append(ul);
  return section;
}

// ---------------------------------------------------------------------------
// 房源品質檢測（FR-106）
// ---------------------------------------------------------------------------

function buildRiskSection(riskCheck) {
  const section = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent = '房源品質檢測';
  section.append(h2);

  if (riskCheck?.__error) {
    section.append(sectionNotice('目前無法載入檢測結果，請稍後再試。'));
    return section;
  }

  // FR-106：尚未檢測時顯示文字，不顯示 0 分也不留空白區塊
  if (!riskCheck) {
    const p = document.createElement('p');
    p.style.color = 'var(--c-text-muted)';
    p.textContent = '尚未檢測。此房源尚未由管理員執行房間照片的品質檢測。';
    section.append(p);
    return section;
  }

  const panel = document.createElement('div');
  panel.className = 'risk-panel';

  const head = document.createElement('p');
  const level = RISK_LEVELS[riskCheck.riskLevel] ?? { label: riskCheck.riskLevel, tone: 'neutral' };
  const badge = document.createElement('span');
  badge.className = `tag tag--${level.tone}`;
  badge.textContent = level.label;
  head.append(badge, document.createTextNode(` 檢測日期：${formatDateTime(riskCheck.createdAt)}`));

  const metrics = document.createElement('dl');
  metrics.className = 'risk-metrics';
  [
    ['亮度', riskCheck.brightness],
    ['雜亂度', riskCheck.clutter],
    ['對比', riskCheck.contrast]
  ].forEach(([label, value]) => {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    div.append(dt, dd);
    metrics.append(div);
  });

  panel.append(head, metrics);

  const src = riskCheck.imageUrl ?? riskCheck.imagePath;
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '房源品質檢測的受檢照片';
    img.loading = 'lazy';
    img.style.borderRadius = 'var(--radius)';
    img.style.maxWidth = '360px';
    panel.append(img);
  }

  section.append(panel);
  return section;
}

// ---------------------------------------------------------------------------
// 評論（僅顯示已通過審核者，FR-046）
// ---------------------------------------------------------------------------

function buildReviewSection(reviews) {
  const section = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent = '住客評論';
  section.append(h2);

  if (reviews?.__error) {
    section.append(sectionNotice('目前無法載入評論，請稍後再試。'));
    return section;
  }

  // FR-047 對應：尚無通過審核的評論時顯示空狀態
  if (!reviews.length) {
    const p = document.createElement('p');
    p.style.color = 'var(--c-text-muted)';
    p.textContent = '尚無評論。此房源還沒有通過審核的住客評論。';
    section.append(p);
    return section;
  }

  // FR-048：依評論類型篩選，並顯示該篩選下的則數
  const listWrap = document.createElement('div');
  const tabs = buildCategoryTabs(reviews, (category) => {
    listWrap.replaceChildren(buildReviewList(reviews, category));
  });

  listWrap.append(buildReviewList(reviews, activeCategory));
  section.append(tabs, listWrap);
  return section;
}


function buildCategoryTabs(reviews, onSelect) {
  const nav = document.createElement('div');
  nav.className = 'type-tabs';
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', '評論類型篩選');

  const counts = new Map();
  reviews.forEach((r) => counts.set(r.category, (counts.get(r.category) ?? 0) + 1));

  const options = [
    { value: '', label: '全部', count: reviews.length },
    ...REVIEW_CATEGORIES
      .filter((c) => counts.has(c.value))
      .map((c) => ({ value: c.value, label: c.label, count: counts.get(c.value) }))
  ];

  options.forEach(({ value, label, count }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${label}（${count}）`;
    btn.setAttribute('aria-pressed', String(value === activeCategory));
    btn.addEventListener('click', () => {
      activeCategory = value;
      // 重新標記按鈕狀態，避免整頁重繪
      [...nav.children].forEach((b, i) => {
        b.setAttribute('aria-pressed', String(options[i].value === activeCategory));
      });
      onSelect(value);
    });
    nav.append(btn);
  });

  return nav;
}

function buildReviewList(reviews, category) {
  const filtered = category ? reviews.filter((r) => r.category === category) : reviews;

  if (!filtered.length) {
    const p = document.createElement('p');
    p.style.color = 'var(--c-text-muted)';
    p.textContent = '此類型目前沒有評論。';
    return p;
  }

  const ul = document.createElement('ul');
  ul.className = 'review-list';

  filtered.forEach((review) => {
    const li = document.createElement('li');
    li.className = 'review-item';

    const head = document.createElement('div');
    head.className = 'review-item__head';
    const rating = document.createElement('span');
    rating.textContent = `★ ${review.rating}`;
    rating.setAttribute('aria-label', `評分 ${review.rating} 分`);
    const meta = document.createElement('span');
    meta.textContent = `${categoryLabel(review.category)}・${formatDateTime(review.createdAt)}`;
    head.append(rating, meta);

    const body = document.createElement('p');
    body.style.margin = '0';
    body.textContent = review.comment;

    li.append(head, body);
    ul.append(li);
  });

  return ul;
}

// ---------------------------------------------------------------------------
// 我送出的評論（含尚未公開者）
// ---------------------------------------------------------------------------

/** FR-045 / 場景 4：讓作者看得到自己評論的審核狀態與駁回說明 */
function buildMyReviewStatus(myReviews) {
  const section = document.createElement('section');
  if (!myReviews?.length) return section;

  const h2 = document.createElement('h2');
  h2.textContent = '我對此房源的評論';
  section.append(h2);

  const ul = document.createElement('ul');
  ul.className = 'review-list';

  myReviews.forEach((review) => {
    const li = document.createElement('li');
    li.className = 'review-item';

    const head = document.createElement('div');
    head.className = 'review-item__head';

    const status = document.createElement('span');
    const tone = REVIEW_STATUS[review.status]?.tone ?? 'neutral';
    status.className = `tag tag--${tone}`;
    status.textContent = reviewStatusLabel(review.status);

    const when = document.createElement('span');
    when.textContent = formatDateTime(review.createdAt);
    head.append(status, when);

    const body = document.createElement('p');
    body.style.margin = '0 0 var(--sp-1)';
    body.textContent = review.comment;

    li.append(head, body);

    if (review.status === 'pending') {
      const note = document.createElement('p');
      note.className = 'field__hint';
      note.style.margin = '0';
      note.textContent = '評論已送出，待管理員審核後公開。';
      li.append(note);
    }

    if (review.adminNote) {
      const note = document.createElement('p');
      note.className = 'field__hint';
      note.style.margin = '0';
      note.textContent = `管理員說明：${review.adminNote}`;
      li.append(note);
    }

    ul.append(li);
  });

  section.append(ul);
  return section;
}

// ---------------------------------------------------------------------------
// 撰寫評論（US5 / T065、T071）
// ---------------------------------------------------------------------------

function buildReviewForm(room, eligibleOrders, context) {
  const section = document.createElement('section');

  // FR-042：沒有已完成入住的訂單就不顯示表單
  if (!eligibleOrders?.length) return section;

  const h2 = document.createElement('h2');
  h2.textContent = '撰寫評論';
  section.append(h2);

  const form = document.createElement('form');
  form.className = 'card';
  form.noValidate = true;

  // 多筆符合資格的訂單時讓使用者選（FR-043：一筆訂單一則評論）
  const orderField = document.createElement('div');
  orderField.className = 'field';
  const orderLabel = document.createElement('label');
  orderLabel.htmlFor = 'review-order';
  orderLabel.textContent = '對應訂單';
  const orderSelect = document.createElement('select');
  orderSelect.id = 'review-order';
  orderSelect.name = 'orderId';
  eligibleOrders.forEach((order) => {
    const opt = document.createElement('option');
    opt.value = order.id;
    opt.textContent = `${order.orderNo ?? order.id.slice(0, 8)}（${formatDate(order.checkIn)}–${formatDate(order.checkOut)}）`;
    orderSelect.append(opt);
  });
  orderField.append(orderLabel, orderSelect);

  const ratingField = selectField('評分', 'rating', 'review-rating',
    [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} 分` })));

  const categoryField = selectField('評論類型', 'category', 'review-category',
    REVIEW_CATEGORIES.map((c) => ({ value: c.value, label: c.label })));

  const commentWrap = document.createElement('div');
  commentWrap.className = 'field';
  const commentLabel = document.createElement('label');
  commentLabel.htmlFor = 'review-comment';
  commentLabel.textContent = '評論內容';
  const textarea = document.createElement('textarea');
  textarea.id = 'review-comment';
  textarea.name = 'comment';
  textarea.rows = 4;
  const commentHint = document.createElement('p');
  commentHint.className = 'field__hint';
  commentHint.textContent = '至少 10 個字。請勿填寫聯絡方式或外部連結，那會被自動退件。';
  commentWrap.append(commentLabel, textarea, commentHint);

  const error = document.createElement('p');
  error.className = 'field__error';
  error.hidden = true;
  error.setAttribute('role', 'alert');

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '送出評論';

  form.append(orderField, ratingField, categoryField, commentWrap, error, submit);

  // FR-103a / T071：明確標示為規則式，不得稱為 AI
  form.append(autoModerationNotice());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = '送出中…';

    try {
      const { verdict } = await submitReview({
        orderId: form.elements.orderId.value,
        rating: form.elements.rating.value,
        category: form.elements.category.value,
        comment: form.elements.comment.value
      });
      toast(`評論已送出，待管理員審核後公開。${verdict.explanation}`, 'ok');
      renderRoomDetail(context);
    } catch (err) {
      error.textContent = toUserMessage(err);
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = '送出評論';
    }
  });

  section.append(form);
  return section;
}

function selectField(label, name, id, options) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const l = document.createElement('label');
  l.htmlFor = id;
  l.textContent = label;

  const select = document.createElement('select');
  select.id = id;
  select.name = name;
  options.forEach(({ value, label: text }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    select.append(opt);
  });

  wrap.append(l, select);
  return wrap;
}

function categoryLabel(value) {
  return REVIEW_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

function sectionNotice(message) {
  const p = document.createElement('p');
  p.className = 'tag tag--warn';
  p.textContent = message;
  return p;
}

// ---------------------------------------------------------------------------
// 側欄：價格與訂房入口
// ---------------------------------------------------------------------------

function buildAside(room) {
  const aside = document.createElement('aside');
  aside.className = 'detail-aside';

  const card = document.createElement('div');
  card.className = 'card';

  const price = document.createElement('p');
  price.className = 'room-card__price';
  price.append(document.createTextNode(formatTWD(room.nightlyPrice)));
  const unit = document.createElement('span');
  unit.textContent = ' / 晚';
  price.append(unit);
  card.append(price);

  const filters = store.getSearchFilters();
  card.append(buildPriceSummary(room, filters));
  card.append(buildCta(room, filters));

  aside.append(card);
  return aside;
}

/** FR-017：已選日期時顯示夜數與總金額 */
function buildPriceSummary(room, filters) {
  const wrap = document.createElement('div');
  wrap.className = 'price-summary';

  const dateError = filters.checkIn && filters.checkOut
    ? validateStayRange(filters.checkIn, filters.checkOut)
    : null;

  if (!filters.checkIn || !filters.checkOut || dateError) {
    const hint = document.createElement('p');
    hint.style.fontSize = 'var(--f-small)';
    hint.style.color = 'var(--c-text-muted)';
    hint.style.margin = '0';
    hint.textContent = dateError
      ? dateError
      : '在首頁選擇入住與退房日期後，這裡會顯示夜數與總金額。';
    wrap.append(hint);
    return wrap;
  }

  const nights = nightsBetween(filters.checkIn, filters.checkOut);
  const total = calculateTotal(room.nightlyPrice, nights);

  wrap.append(
    summaryRow('入住', formatDate(filters.checkIn)),
    summaryRow('退房', formatDate(filters.checkOut)),
    summaryRow(`${formatTWD(room.nightlyPrice)} × ${nights} 晚`, formatTWD(total))
  );

  const totalRow = document.createElement('div');
  totalRow.className = 'price-summary__total';
  const label = document.createElement('span');
  label.textContent = '總金額';
  const value = document.createElement('span');
  value.textContent = formatTWD(total);
  totalRow.append(label, value);
  wrap.append(totalRow);

  return wrap;
}

function summaryRow(label, value) {
  const row = document.createElement('div');
  row.className = 'price-summary__row';
  const l = document.createElement('span');
  l.textContent = label;
  const v = document.createElement('span');
  v.textContent = value;
  row.append(l, v);
  return row;
}

function buildCta(room, filters) {
  const wrap = document.createElement('div');

  // 憲章原則 IV：整理中與已預訂一律不可訂
  if (room.status !== 'available') {
    const notice = document.createElement('p');
    notice.className = 'tag tag--warn';
    notice.textContent = `此房源目前為「${roomStatusLabel(room.status)}」，暫時無法預訂。`;
    wrap.append(notice);
    return wrap;
  }

  wrap.append(createFavoriteButton(room));

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'btn btn--primary';
  cta.style.width = '100%';
  cta.style.marginTop = 'var(--sp-2)';
  cta.textContent = '立即訂房';

  cta.addEventListener('click', () => {
    // FR-019：未登入者導向登入頁，登入後回到這裡（T040）
    if (!store.isSignedIn()) {
      router.setPendingRedirect(`#/rooms/${room.id}`);
      toast('請先登入或註冊後再進行訂房。');
      router.navigate('#/login');
      return;
    }

    // 日期可在訂房表單第一步補填或修正，因此這裡不擋——只在已選且無效時提醒
    if (filters.checkIn && filters.checkOut) {
      const dateError = validateStayRange(filters.checkIn, filters.checkOut);
      if (dateError) toast(dateError, 'error');
    }
    router.navigate(`#/booking/${room.id}`);
  });

  wrap.append(cta);

  const note = document.createElement('p');
  note.style.fontSize = 'var(--f-tiny)';
  note.style.color = 'var(--c-text-muted)';
  note.style.marginTop = 'var(--sp-2)';
  note.style.marginBottom = '0';
  note.textContent = '本站為展示用專案，付款為模擬流程，不會產生任何實際交易。';
  wrap.append(note);

  return wrap;
}
