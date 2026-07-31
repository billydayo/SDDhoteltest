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
import { getRoom, formatRating } from '../data/rooms.js';
import { listPublicReviews } from '../data/reviews.js';
import { getLatestRiskCheck } from '../data/risk-checks.js';
import { formatTWD, calculateTotal } from '../utils/money.js';
import { nightsBetween, formatDate, formatDateTime, validateStayRange } from '../utils/dates.js';
import { typeLabel, roomStatusLabel, ROOM_STATUS, REVIEW_CATEGORIES } from '../data/vocabulary.js';
import * as store from '../state/store.js';
import * as router from '../router.js';

const RISK_LEVELS = {
  low:    { label: '低風險', tone: 'ok' },
  medium: { label: '中風險', tone: 'warn' },
  high:   { label: '高風險', tone: 'danger' }
};

export async function renderRoomDetail(context) {
  const roomId = context.params.id;
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
    const [reviews, riskCheck] = await Promise.all([
      listPublicReviews(roomId).catch((err) => ({ __error: err })),
      getLatestRiskCheck(roomId).catch((err) => ({ __error: err }))
    ]);

    render(buildPage(room, reviews, riskCheck));
  } catch (err) {
    renderError(err, { retry: () => renderRoomDetail(context) });
  }
}

function buildPage(room, reviews, riskCheck) {
  const frag = document.createDocumentFragment();

  const back = document.createElement('a');
  back.href = '#/';
  back.textContent = '← 回到房源列表';
  back.style.display = 'inline-block';
  back.style.marginBottom = 'var(--sp-3)';
  frag.append(back);

  const grid = document.createElement('div');
  grid.className = 'detail-grid';
  grid.append(buildMain(room, reviews, riskCheck), buildAside(room));
  frag.append(grid);

  return frag;
}

// ---------------------------------------------------------------------------
// 主欄
// ---------------------------------------------------------------------------

function buildMain(room, reviews, riskCheck) {
  const main = document.createElement('div');

  const gallery = document.createElement('div');
  gallery.className = 'detail-gallery';
  const img = document.createElement('img');
  img.src = room.images?.[0] ?? 'assets/hero.svg';
  img.alt = `${room.name}的房間照片`;
  gallery.append(img);

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
  main.append(buildReviewSection(reviews));

  return main;
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

  if (!reviews.length) {
    const p = document.createElement('p');
    p.style.color = 'var(--c-text-muted)';
    p.textContent = '尚無評論。此房源還沒有通過審核的住客評論。';
    section.append(p);
    return section;
  }

  const ul = document.createElement('ul');
  ul.className = 'review-list';
  reviews.forEach((review) => {
    const li = document.createElement('li');
    li.className = 'review-item';

    const head = document.createElement('div');
    head.className = 'review-item__head';
    const rating = document.createElement('span');
    rating.textContent = `★ ${review.rating}`;
    rating.setAttribute('aria-label', `評分 ${review.rating} 分`);
    const category = document.createElement('span');
    category.textContent = categoryLabel(review.category);
    head.append(rating, category);

    const body = document.createElement('p');
    body.style.margin = '0';
    body.textContent = review.comment;

    li.append(head, body);
    ul.append(li);
  });

  section.append(ul);
  return section;
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

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className = 'btn btn--primary';
  cta.style.width = '100%';
  cta.textContent = '立即訂房';

  cta.addEventListener('click', () => {
    // FR-019：未登入者導向登入頁，登入後回到這裡（T040）
    if (!store.isSignedIn()) {
      router.setPendingRedirect(`#/rooms/${room.id}`);
      toast('請先登入或註冊後再進行訂房。');
      router.navigate('#/login');
      return;
    }

    const dateError = validateStayRange(filters.checkIn, filters.checkOut);
    if (dateError) {
      toast(dateError, 'error');
      return;
    }

    // 三步驟訂房表單屬 US3（Phase 6）
    toast('訂房流程將於 User Story 3 實作。');
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
