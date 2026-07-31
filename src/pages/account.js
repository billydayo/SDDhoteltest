/**
 * 帳戶設定頁（US2 / T049）。
 *
 * FR-007：會員可維護個人資料，變更必須即時反映於介面各處
 *         （顯示名稱改了，頁首要跟著變）。
 *
 * 電子郵件與密碼由認證服務保管，本頁不提供修改——變更信箱需要驗證流程，
 * 密碼重設需要寄信，兩者都不在本次範圍內（見 spec Assumptions）。
 */

import { render, createPageHeader, toast } from '../app.js';
import { updateOwnProfile, logout } from '../services/auth.js';
import { isDemoMode } from '../data/repository.js';
import { toUserMessage } from '../utils/errors.js';
import { validateDisplayName, validatePhone, isBlank } from '../utils/validation.js';
import { formatDateTime } from '../utils/dates.js';
import * as store from '../state/store.js';
import * as router from '../router.js';

export async function renderAccount() {
  const profile = store.currentProfile();
  if (!profile) {
    router.navigate('#/login', { replace: true });
    return;
  }
  render(buildPage(profile));
}

function buildPage(profile) {
  const frag = document.createDocumentFragment();

  frag.append(createPageHeader('帳戶設定', '維護你的個人資料。變更會立即反映在頁首與訂單資料中。'));
  frag.append(buildIdentityCard(profile));
  frag.append(buildProfileForm(profile));
  frag.append(buildSessionCard());

  return frag;
}

/** 唯讀的身分資訊 */
function buildIdentityCard(profile) {
  const box = document.createElement('section');
  box.className = 'card';
  box.style.marginBottom = 'var(--sp-4)';

  const h2 = document.createElement('h2');
  h2.textContent = '帳號資訊';
  box.append(h2);

  const dl = document.createElement('dl');
  dl.style.display = 'grid';
  dl.style.gridTemplateColumns = 'auto 1fr';
  dl.style.gap = 'var(--sp-2) var(--sp-4)';
  dl.style.margin = '0';

  const rows = [
    ['電子郵件', profile.email ?? '（未提供）'],
    ['角色', profile.role === 'admin' ? '管理員' : '會員'],
    ['註冊時間', formatDateTime(profile.createdAt)]
  ];

  rows.forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.style.color = 'var(--c-text-muted)';
    dt.style.fontSize = 'var(--f-small)';
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.style.margin = '0';
    dd.textContent = value;
    dl.append(dt, dd);
  });

  box.append(dl);

  const note = document.createElement('p');
  note.className = 'field__hint';
  note.style.marginTop = 'var(--sp-3)';
  note.style.marginBottom = '0';
  note.textContent = isDemoMode()
    ? '目前為示範模式，帳號資料僅保存在此瀏覽器。'
    : '電子郵件與密碼由認證服務保管，本頁不提供修改。';
  box.append(note);

  return box;
}

function buildProfileForm(profile) {
  const form = document.createElement('form');
  form.className = 'card';
  form.style.marginBottom = 'var(--sp-4)';
  form.noValidate = true;

  const h2 = document.createElement('h2');
  h2.textContent = '個人資料';

  const displayName = field({
    id: 'acc-name', name: 'displayName', label: '顯示名稱', type: 'text',
    value: profile.displayName ?? '', autocomplete: 'nickname'
  });
  const phone = field({
    id: 'acc-phone', name: 'phone', label: '聯絡電話', type: 'tel',
    value: profile.phone ?? '', autocomplete: 'tel',
    hint: '選填。訂房時會自動帶入，可於訂房表單再修改。'
  });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '儲存變更';

  form.append(h2, displayName.wrap, phone.wrap, submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors([displayName, phone]);

    const nameValue = form.elements.displayName.value;
    const phoneValue = form.elements.phone.value;

    const nameError = validateDisplayName(nameValue);
    // 電話為選填：留空放行，有填才檢查格式
    const phoneError = isBlank(phoneValue) ? null : validatePhone(phoneValue);

    if (nameError) showFieldError(displayName, nameError);
    if (phoneError) showFieldError(phone, phoneError);
    if (nameError || phoneError) return;

    submit.disabled = true;
    submit.textContent = '儲存中…';
    try {
      await updateOwnProfile({
        displayName: nameValue.trim(),
        phone: phoneValue.trim()
      });
      // updateOwnProfile 會更新 store，頁首因此同步（FR-007）
      toast('已儲存。', 'ok');
    } catch (err) {
      showFieldError(displayName, toUserMessage(err));
    } finally {
      submit.disabled = false;
      submit.textContent = '儲存變更';
    }
  });

  return form;
}

function buildSessionCard() {
  const box = document.createElement('section');
  box.className = 'card';

  const h2 = document.createElement('h2');
  h2.textContent = '登入狀態';

  const p = document.createElement('p');
  p.textContent = '登出後，需要登入才能存取的頁面將無法進入。';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--danger';
  btn.textContent = '登出';
  btn.addEventListener('click', async () => {
    await logout();
    toast('已登出。');
    router.navigate('#/', { replace: true });
  });

  box.append(h2, p, btn);
  return box;
}

// ---------------------------------------------------------------------------
// 共用欄位建構
// ---------------------------------------------------------------------------

function field({ id, name, label, type, value, autocomplete, hint }) {
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
  if (autocomplete) input.autocomplete = autocomplete;

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

function showFieldError(f, message) {
  f.error.textContent = message;
  f.error.hidden = false;
  f.input.setAttribute('aria-invalid', 'true');
}

function clearErrors(fields) {
  fields.forEach((f) => {
    f.error.hidden = true;
    f.error.textContent = '';
    f.input.removeAttribute('aria-invalid');
  });
}
