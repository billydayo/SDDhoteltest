/**
 * 訂房流程頁（US3）。
 *
 * 薄殼：載入房源、擋掉不可訂的情況，其餘交給 booking-form 元件。
 * 未登入者由 router 的守衛擋在前面（FR-019）。
 */

import { render, renderLoading, renderError, createEmptyState, createPageHeader, toast } from '../app.js';
import { getRoom } from '../data/rooms.js';
import { createBookingForm } from '../components/booking-form.js';
import { roomStatusLabel } from '../data/vocabulary.js';
import * as router from '../router.js';

export async function renderBooking(context) {
  const roomId = context.params.id;
  renderLoading('正在載入訂房資料…');

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

    // 憲章原則 IV：整理中與已預訂一律不可訂
    if (room.status !== 'available') {
      render(createEmptyState({
        title: '此房源目前無法預訂',
        body: `房態為「${roomStatusLabel(room.status)}」。`,
        actionLabel: '回到房源詳情',
        actionHref: `#/rooms/${room.id}`
      }));
      return;
    }

    const frag = document.createDocumentFragment();

    const back = document.createElement('a');
    back.href = `#/rooms/${room.id}`;
    back.textContent = '← 回到房源詳情';
    back.style.display = 'inline-block';
    back.style.marginBottom = 'var(--sp-3)';

    frag.append(back);
    frag.append(createPageHeader('訂房', `${room.name}・三步驟完成預訂`));
    frag.append(createBookingForm(room, {
      onComplete: (order) => {
        toast('訂單已建立，請於保留時間內完成付款。', 'ok');
        router.navigate(`#/orders/${order.id}`);
      }
    }));

    render(frag);
  } catch (err) {
    renderError(err, { retry: () => renderBooking(context) });
  }
}
