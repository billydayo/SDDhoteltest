/**
 * 三步驟訂房表單（US3 / T051、T053、T058）。
 *
 * 步驟：填寫資訊 → 選擇付款方式 → 確認送出（FR-020）
 *
 * FR-021：步驟間可往返，已填內容必須保留。
 * spec US3 場景 13：任一步驟重新整理，行為必須可預期——本實作選擇
 *   「回到該步驟並保留已填內容」，狀態存在 sessionStorage。
 * FR-029：付款畫面必須明顯標示為虛擬支付，且沒有任何真實卡號欄位。
 */

import { PAYMENT_METHODS } from '../data/vocabulary.js';
import { simulatedPaymentNotice } from './simulated-badge.js';
import { quote, validateBookingForm, createBooking } from '../services/booking.js';
import { formatTWD } from '../utils/money.js';
import { formatDate, earliestCheckIn, validateStayRange } from '../utils/dates.js';
import { toUserMessage } from '../utils/errors.js';
import * as store from '../state/store.js';

const STEPS = ['填寫住客資訊', '選擇付款方式', '確認訂單'];

/**
 * @param {object} room
 * @param {{ onComplete: (order) => void }} options
 * @returns {HTMLElement}
 */
export function createBookingForm(room, { onComplete }) {
  const container = document.createElement('div');
  const state = loadState(room);

  const rerender = () => {
    container.replaceChildren(buildStepIndicator(state.step), buildStep(state, room, actions));
  };

  const actions = {
    goTo(step) {
      state.step = step;
      saveState(room, state);
      rerender();
    },
    update(patch) {
      Object.assign(state.form, patch);
      saveState(room, state);
    },
    reset() {
      clearState(room);
    },
    rerender,
    onComplete
  };

  rerender();
  return container;
}

// ---------------------------------------------------------------------------
// 狀態持久化（重新整理後回到原步驟）
// ---------------------------------------------------------------------------

const key = (room) => `sunny.booking.${room.id}`;

function loadState(room) {
  const filters = store.getSearchFilters();
  const profile = store.currentProfile();

  const fallback = {
    step: 0,
    form: {
      checkIn: filters.checkIn || '',
      checkOut: filters.checkOut || '',
      guestCount: filters.guests || '1',
      contactName: profile?.displayName ?? '',
      phone: profile?.phone ?? '',
      email: profile?.email ?? '',
      paymentMethod: ''
    }
  };

  try {
    const raw = window.sessionStorage.getItem(key(room));
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    return { step: saved.step ?? 0, form: { ...fallback.form, ...saved.form } };
  } catch {
    return fallback;
  }
}

function saveState(room, state) {
  try {
    window.sessionStorage.setItem(key(room), JSON.stringify(state));
  } catch {
    // 存不下就算了：使用者重新整理會回到第一步，這仍是可預期的行為
  }
}

function clearState(room) {
  try { window.sessionStorage.removeItem(key(room)); } catch { /* 同上 */ }
}

// ---------------------------------------------------------------------------
// 步驟指示
// ---------------------------------------------------------------------------

function buildStepIndicator(current) {
  const nav = document.createElement('ol');
  nav.className = 'type-tabs';
  nav.setAttribute('aria-label', '訂房步驟');
  nav.style.listStyle = 'none';
  nav.style.padding = '0';

  STEPS.forEach((label, index) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.style.padding = 'var(--sp-2) var(--sp-3)';
    span.style.borderRadius = 'var(--radius-sm)';
    span.style.fontSize = 'var(--f-small)';
    span.textContent = `${index + 1}. ${label}`;
    if (index === current) {
      span.style.background = 'var(--c-brand-soft)';
      span.style.color = 'var(--c-brand-strong)';
      span.style.fontWeight = '600';
      span.setAttribute('aria-current', 'step');
    } else {
      span.style.color = 'var(--c-text-muted)';
    }
    li.append(span);
    nav.append(li);
  });

  return nav;
}

function buildStep(state, room, actions) {
  if (state.step === 1) return buildPaymentStep(state, room, actions);
  if (state.step === 2) return buildConfirmStep(state, room, actions);
  return buildDetailsStep(state, room, actions);
}

// ---------------------------------------------------------------------------
// 第一步：住客資訊
// ---------------------------------------------------------------------------

function buildDetailsStep(state, room, actions) {
  const form = document.createElement('form');
  form.className = 'card';
  form.noValidate = true;

  const h2 = document.createElement('h2');
  h2.textContent = '第 1 步：填寫住客與訂房資訊';
  form.append(h2, buildRoomSummary(room));

  const fields = {
    checkIn: field({ id: 'bk-checkin', name: 'checkIn', label: '入住日', type: 'date', value: state.form.checkIn, attrs: { min: earliestCheckIn() } }),
    checkOut: field({ id: 'bk-checkout', name: 'checkOut', label: '退房日', type: 'date', value: state.form.checkOut, attrs: { min: earliestCheckIn() } }),
    guestCount: field({ id: 'bk-guests', name: 'guestCount', label: '入住人數', type: 'number', value: state.form.guestCount, attrs: { min: '1', max: String(room.maxGuests), step: '1' }, hint: `此房源最多可住 ${room.maxGuests} 人。` }),
    contactName: field({ id: 'bk-name', name: 'contactName', label: '住客姓名', type: 'text', value: state.form.contactName, attrs: { autocomplete: 'name' } }),
    phone: field({ id: 'bk-phone', name: 'phone', label: '聯絡電話', type: 'tel', value: state.form.phone, attrs: { autocomplete: 'tel' } }),
    email: field({ id: 'bk-email', name: 'email', label: '電子郵件', type: 'email', value: state.form.email, attrs: { autocomplete: 'email' }, hint: '訂單確認資訊會顯示於畫面，本站不會寄送任何郵件。' })
  };

  const row = document.createElement('div');
  row.className = 'filter-bar__row';
  row.append(fields.checkIn.wrap, fields.checkOut.wrap, fields.guestCount.wrap);
  form.append(row);
  form.append(fields.contactName.wrap, fields.phone.wrap, fields.email.wrap);

  const priceHint = document.createElement('p');
  priceHint.className = 'field__hint';
  form.append(priceHint);

  const updatePrice = async () => {
    const checkIn = form.elements.checkIn.value;
    const checkOut = form.elements.checkOut.value;
    const result = await quote({ roomId: room.id, checkIn, checkOut });
    priceHint.textContent = result.error
      ? result.error
      : `${result.nights} 晚，總金額 ${formatTWD(result.totalAmount)}`;
  };
  form.addEventListener('change', updatePrice);
  updatePrice();

  const next = document.createElement('button');
  next.type = 'submit';
  next.className = 'btn btn--primary';
  next.textContent = '下一步：選擇付款方式';
  form.append(next);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearFieldErrors(fields);

    const values = readForm(form, ['checkIn', 'checkOut', 'guestCount', 'contactName', 'phone', 'email']);
    actions.update(values);

    // 付款方式在第二步才選，此處先跳過該項檢查
    const errors = validateBookingForm({ ...values, paymentMethod: 'placeholder' }, room);
    delete errors.paymentMethod;

    if (Object.keys(errors).length) {
      applyErrors(fields, errors);
      return;
    }
    actions.goTo(1);
  });

  return form;
}

// ---------------------------------------------------------------------------
// 第二步：付款方式（模擬）
// ---------------------------------------------------------------------------

function buildPaymentStep(state, room, actions) {
  const form = document.createElement('form');
  form.className = 'card';
  form.noValidate = true;

  const h2 = document.createElement('h2');
  h2.textContent = '第 2 步：選擇付款方式';
  form.append(h2);

  // FR-029：明顯標示為虛擬支付
  form.append(simulatedPaymentNotice());

  const fieldset = document.createElement('fieldset');
  fieldset.style.border = 'none';
  fieldset.style.padding = '0';
  fieldset.style.margin = '0 0 var(--sp-4)';

  const legend = document.createElement('legend');
  legend.style.fontWeight = '600';
  legend.style.fontSize = 'var(--f-small)';
  legend.style.marginBottom = 'var(--sp-2)';
  legend.textContent = '付款方式';
  fieldset.append(legend);

  PAYMENT_METHODS.forEach(({ value, label }, index) => {
    const id = `pay-${index}`;
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = 'var(--sp-2)';
    row.style.alignItems = 'center';
    row.style.marginBottom = 'var(--sp-2)';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'paymentMethod';
    input.id = id;
    input.value = value;
    input.checked = state.form.paymentMethod === value;

    const l = document.createElement('label');
    l.htmlFor = id;
    l.textContent = label;

    row.append(input, l);
    fieldset.append(row);
  });

  const error = document.createElement('p');
  error.className = 'field__error';
  error.hidden = true;
  fieldset.append(error);

  form.append(fieldset);
  form.append(buildNav(actions, 0, '下一步：確認訂單'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const selected = form.querySelector('input[name="paymentMethod"]:checked');
    if (!selected) {
      error.textContent = '請選擇一種付款方式。';
      error.hidden = false;
      return;
    }
    actions.update({ paymentMethod: selected.value });
    actions.goTo(2);
  });

  return form;
}

// ---------------------------------------------------------------------------
// 第三步：確認並送出
// ---------------------------------------------------------------------------

function buildConfirmStep(state, room, actions) {
  const form = document.createElement('form');
  form.className = 'card';
  form.noValidate = true;

  const h2 = document.createElement('h2');
  h2.textContent = '第 3 步：確認訂單內容';
  form.append(h2);

  const { checkIn, checkOut, guestCount, contactName, phone, email, paymentMethod } = state.form;
  const dateError = validateStayRange(checkIn, checkOut);

  if (dateError) {
    const warn = document.createElement('p');
    warn.className = 'error-state';
    warn.textContent = dateError;
    form.append(warn, buildNav(actions, 0, null));
    return form;
  }

  const summary = document.createElement('dl');
  summary.style.display = 'grid';
  summary.style.gridTemplateColumns = 'auto 1fr';
  summary.style.gap = 'var(--sp-2) var(--sp-4)';

  const paymentLabel = PAYMENT_METHODS.find((p) => p.value === paymentMethod)?.label ?? paymentMethod;

  form.append(summary);

  // 金額以伺服器規則重算，不採用畫面上的快取值
  quote({ roomId: room.id, checkIn, checkOut }).then((result) => {
    [
      ['房源', room.name],
      ['入住', formatDate(checkIn)],
      ['退房', formatDate(checkOut)],
      ['夜數', `${result.nights} 晚`],
      ['入住人數', `${guestCount} 人`],
      ['住客姓名', contactName],
      ['聯絡電話', phone],
      ['電子郵件', email],
      ['付款方式', `${paymentLabel}（模擬）`],
      ['總金額', formatTWD(result.totalAmount)]
    ].forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.style.color = 'var(--c-text-muted)';
      dt.style.fontSize = 'var(--f-small)';
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.style.margin = '0';
      dd.textContent = value;
      summary.append(dt, dd);
    });
  });

  const note = document.createElement('p');
  note.className = 'field__hint';
  note.textContent = '送出後訂單狀態為「待付款」，系統會保留房間一段時間，逾期未付款將自動取消並釋出。';
  form.append(note);

  const formError = document.createElement('p');
  formError.className = 'error-state';
  formError.hidden = true;
  formError.setAttribute('role', 'alert');
  form.append(formError);

  const nav = buildNav(actions, 1, '送出訂單');
  form.append(nav);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.hidden = true;

    const submit = nav.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = '送出中…';

    try {
      const { order } = await createBooking({ roomId: room.id, ...state.form });
      actions.reset();
      actions.onComplete(order);
    } catch (err) {
      // FR-025 / T058：房況衝突時保留已填內容，讓使用者可以改日期重試，
      // 不清空表單也不把人踢回第一步
      formError.textContent = toUserMessage(err);
      formError.hidden = false;
      submit.disabled = false;
      submit.textContent = '送出訂單';
    }
  });

  return form;
}

// ---------------------------------------------------------------------------
// 共用
// ---------------------------------------------------------------------------

function buildNav(actions, backStep, submitLabel) {
  const nav = document.createElement('div');
  nav.className = 'filter-bar__actions';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn';
  back.textContent = '上一步';
  back.addEventListener('click', () => actions.goTo(backStep));
  nav.append(back);

  if (submitLabel) {
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn--primary';
    submit.textContent = submitLabel;
    nav.append(submit);
  }

  return nav;
}

function buildRoomSummary(room) {
  const p = document.createElement('p');
  p.className = 'room-card__meta';
  p.style.marginBottom = 'var(--sp-4)';
  p.textContent = `${room.name}・${formatTWD(room.nightlyPrice)} / 晚・最多 ${room.maxGuests} 人`;
  return p;
}

function readForm(form, names) {
  const out = {};
  names.forEach((n) => { out[n] = form.elements[n].value; });
  return out;
}

function field({ id, name, label, type, value, attrs = {}, hint }) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const l = document.createElement('label');
  l.htmlFor = id;
  l.textContent = label;

  const input = document.createElement('input');
  input.id = id;
  input.name = name;
  input.type = type;
  input.value = value ?? '';
  Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));

  const describedBy = [];
  let hintEl = null;
  if (hint) {
    hintEl = document.createElement('p');
    hintEl.className = 'field__hint';
    hintEl.id = `${id}-hint`;
    hintEl.textContent = hint;
    describedBy.push(hintEl.id);
  }

  const error = document.createElement('p');
  error.className = 'field__error';
  error.id = `${id}-error`;
  error.hidden = true;
  describedBy.push(error.id);
  input.setAttribute('aria-describedby', describedBy.join(' '));

  wrap.append(l, input);
  if (hintEl) wrap.append(hintEl);
  wrap.append(error);

  return { wrap, input, error };
}

function applyErrors(fields, errors) {
  Object.entries(errors).forEach(([key2, message]) => {
    // 日期相關的錯誤沒有專屬欄位，掛到入住日下方
    const target = fields[key2] ?? (key2 === 'dates' ? fields.checkIn : null);
    if (!target) return;
    target.error.textContent = message;
    target.error.hidden = false;
    target.input.setAttribute('aria-invalid', 'true');
  });
}

function clearFieldErrors(fields) {
  Object.values(fields).forEach((f) => {
    f.error.hidden = true;
    f.error.textContent = '';
    f.input.removeAttribute('aria-invalid');
  });
}
