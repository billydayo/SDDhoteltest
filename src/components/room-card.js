/**
 * 房源卡片（US1 / T034）。
 *
 * 憲章「視覺基調」：橫向卡片。窄螢幕由 CSS 改為直向堆疊。
 * FR-013：卡片必須顯示照片、房名、房型、每晚價格、人數上限與平均評分。
 *
 * 收藏星號（US10）在 __footer 內，未登入時會導向登入頁再回來。
 */

import { formatTWD, calculateTotal } from '../utils/money.js';
import { formatRating, primaryImage } from '../data/rooms.js';
import { typeLabel, roomStatusLabel, ROOM_STATUS } from '../data/vocabulary.js';
import { nightsBetween } from '../utils/dates.js';
import { createFavoriteButton } from './favorite-button.js';

/**
 * @param {object} room
 * @param {{ checkIn?: string, checkOut?: string, hideFavorite?: boolean }} [context]
 */
export function createRoomCard(room, context = {}) {
  const li = document.createElement('li');
  li.className = 'room-card';
  if (room.status !== 'available') li.classList.add('room-card--unavailable');

  li.append(buildMedia(room), buildBody(room, context));
  return li;
}

function buildMedia(room) {
  const media = document.createElement('div');
  media.className = 'room-card__media';

  const img = document.createElement('img');
  img.src = primaryImage(room) ?? 'assets/hero.svg';
  // 憲章原則 V：所有圖片必須有有意義的 alt
  img.alt = `${room.name}的房間照片`;
  img.loading = 'lazy';
  media.append(img);

  // 有多張照片時標示張數，讓使用者知道詳情頁還有得看
  const count = room.images?.length ?? 0;
  if (count > 1) {
    const badge = document.createElement('span');
    badge.className = 'room-card__photo-count';
    badge.textContent = `${count} 張照片`;
    media.append(badge);
  }

  return media;
}

function buildBody(room, context) {
  const body = document.createElement('div');
  body.className = 'room-card__body';

  const title = document.createElement('h3');
  title.className = 'room-card__title';
  const link = document.createElement('a');
  link.href = `#/rooms/${room.id}`;
  link.textContent = room.name;
  title.append(link);

  const meta = document.createElement('p');
  meta.className = 'room-card__meta';
  meta.append(
    tag(roomStatusLabel(room.status), ROOM_STATUS[room.status]?.tone ?? 'neutral'),
    text(typeLabel(room.type)),
    text(`可住 ${room.maxGuests} 人`),
    buildRating(room)
  );

  const price = document.createElement('p');
  price.className = 'room-card__price';
  price.append(document.createTextNode(formatTWD(room.nightlyPrice)));
  const unit = document.createElement('span');
  unit.textContent = ' / 晚';
  price.append(unit);

  const desc = document.createElement('p');
  desc.className = 'room-card__desc';
  desc.textContent = room.description;

  const tags = document.createElement('p');
  tags.className = 'room-card__tags';
  [...(room.features ?? []), ...(room.amenities ?? []).slice(0, 4)]
    .forEach((t) => tags.append(tag(t, 'neutral')));

  const footer = document.createElement('div');
  footer.className = 'room-card__footer';

  // 已選日期時直接顯示夜數與總金額（FR-017）
  const total = buildTotal(room, context);
  if (total) footer.append(total);

  if (!context.hideFavorite) footer.append(createFavoriteButton(room));

  const cta = document.createElement('a');
  cta.className = 'btn btn--primary';
  cta.href = `#/rooms/${room.id}`;
  cta.textContent = '查看詳情';
  footer.append(cta);

  body.append(title, meta, price, desc, tags, footer);
  return body;
}

function buildRating(room) {
  const rating = formatRating(room.averageRating);
  const span = document.createElement('span');
  if (rating.hasRating) {
    span.textContent = `★ ${rating.text}`;
    span.setAttribute('aria-label', `平均評分 ${rating.text} 分`);
  } else {
    // FR-047：無評論時顯示「尚無評分」而非 0 分
    span.textContent = rating.text;
  }
  return span;
}

function buildTotal(room, { checkIn, checkOut }) {
  if (!checkIn || !checkOut) return null;
  const nights = nightsBetween(checkIn, checkOut);
  if (nights <= 0) return null;

  const span = document.createElement('span');
  span.style.fontSize = 'var(--f-small)';
  span.style.color = 'var(--c-text-muted)';
  span.style.marginInlineEnd = 'auto';
  span.textContent = `${nights} 晚合計 ${formatTWD(calculateTotal(room.nightlyPrice, nights))}`;
  return span;
}

function tag(label, tone) {
  const span = document.createElement('span');
  span.className = `tag tag--${tone}`;
  span.textContent = label;
  return span;
}

function text(value) {
  return document.createTextNode(value);
}
