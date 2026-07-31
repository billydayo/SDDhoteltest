/**
 * 登入與註冊頁（US2 / T042、T045、T046、T048）。
 *
 * FR-005：公開列出測試帳號。
 * FR-006：提醒勿使用其他網站的真實密碼。
 * FR-004：登入失敗訊息不得透露該電子郵件是否已註冊。
 * FR-009b：密碼至少 6 個字元。
 * FR-089：示範模式的 Google 按鈕呈現為停用並說明原因，不假造授權畫面。
 */

import { render, createPageHeader, toast } from '../app.js';
import {
  register, login, loginWithGoogle, isGoogleLoginAvailable,
  DEMO_ACCOUNTS, PASSWORD_WARNING, DEMO_LOGIN_NOTICE, takePostAuthRedirect
} from '../services/auth.js';
import { isDemoMode } from '../data/repository.js';
import { toUserMessage } from '../utils/errors.js';
import * as store from '../state/store.js';
import * as router from '../router.js';

let activeTab = 'login';

export async function renderLogin() {
  // 已登入者不需要看到登入頁
  if (store.isSignedIn()) {
    router.navigate('#/', { replace: true });
    return;
  }
  render(buildPage());
}

function buildPage() {
  const frag = document.createDocumentFragment();

  frag.append(createPageHeader(
    '登入 / 註冊',
    '訂房前需先登入。以下為展示用帳號，也可以自行註冊新帳號。'
  ));

  frag.append(buildWarnings());
  frag.append(buildDemoAccounts());
  frag.append(buildTabs());
  frag.append(activeTab === 'login' ? buildLoginForm() : buildRegisterForm());
  frag.append(buildGoogleSection());

  return frag;
}

// ---------------------------------------------------------------------------
// 警語（FR-006）
// ---------------------------------------------------------------------------

function buildWarnings() {
  const wrap = document.createElement('div');

  const warn = document.createElement('p');
  warn.className = 'simulated-badge';
  warn.style.display = 'block';
  warn.textContent = PASSWORD_WARNING;
  wrap.append(warn);

  // 示範模式的登入是模擬的，必須說清楚（憲章原則 VI）
  if (isDemoMode()) {
    const demo = document.createElement('p');
    demo.className = 'tag tag--warn';
    demo.style.display = 'block';
    demo.style.padding = 'var(--sp-2) var(--sp-3)';
    demo.textContent = DEMO_LOGIN_NOTICE;
    wrap.append(demo);
  }

  return wrap;
}

// ---------------------------------------------------------------------------
// 公開的測試帳號（FR-005）
// ---------------------------------------------------------------------------

function buildDemoAccounts() {
  const box = document.createElement('section');
  box.className = 'card';
  box.style.marginBottom = 'var(--sp-4)';

  const h2 = document.createElement('h2');
  h2.textContent = '展示用測試帳號';
  box.append(h2);

  const ul = document.createElement('ul');
  ul.style.listStyle = 'none';
  ul.style.padding = '0';
  ul.style.margin = '0';
  ul.style.display = 'grid';
  ul.style.gap = 'var(--sp-2)';

  DEMO_ACCOUNTS.forEach((account) => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.gap = 'var(--sp-2)';
    li.style.alignItems = 'center';
    li.style.flexWrap = 'wrap';

    const tag = document.createElement('span');
    tag.className = 'tag tag--neutral';
    tag.textContent = account.label;

    const text = document.createElement('code');
    text.textContent = `${account.email} / ${account.password}`;

    const fill = document.createElement('button');
    fill.type = 'button';
    fill.className = 'btn btn--ghost';
    fill.textContent = '填入';
    fill.addEventListener('click', () => {
      activeTab = 'login';
      render(buildPage());
      const form = document.getElementById('login-form');
      if (!form) return;
      form.elements.email.value = account.email;
      form.elements.password.value = account.password;
      form.elements.email.focus();
    });

    li.append(tag, text, fill);
    ul.append(li);
  });

  box.append(ul);
  return box;
}

// ---------------------------------------------------------------------------
// 登入 / 註冊切換
// ---------------------------------------------------------------------------

function buildTabs() {
  const nav = document.createElement('div');
  nav.className = 'type-tabs';
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', '登入或註冊');

  [['login', '登入'], ['register', '註冊新帳號']].forEach(([value, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(activeTab === value));
    btn.addEventListener('click', () => {
      activeTab = value;
      render(buildPage());
    });
    nav.append(btn);
  });

  return nav;
}

// ---------------------------------------------------------------------------
// 表單
// ---------------------------------------------------------------------------

function buildLoginForm() {
  const form = document.createElement('form');
  form.id = 'login-form';
  form.className = 'card';
  form.noValidate = true;

  const h2 = document.createElement('h2');
  h2.textContent = '登入';

  const email = field({ id: 'login-email', name: 'email', label: '電子郵件', type: 'email', autocomplete: 'email' });
  const password = field({ id: 'login-password', name: 'password', label: '密碼', type: 'password', autocomplete: 'current-password' });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '登入';

  form.append(h2, email.wrap, password.wrap, submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors([email, password]);
    setBusy(submit, true, '登入中…');

    try {
      await login({
        email: form.elements.email.value,
        password: form.elements.password.value
      });
      toast('登入成功。', 'ok');
      goAfterAuth();
    } catch (err) {
      // FR-004：一律顯示同一則訊息，不透露該電子郵件是否存在。
      // 錯誤訊息掛在密碼欄位下方，而非個別欄位，避免暗示是哪一項錯了。
      showFormError(form, toUserMessage(err));
    } finally {
      setBusy(submit, false, '登入');
    }
  });

  return form;
}

function buildRegisterForm() {
  const form = document.createElement('form');
  form.id = 'register-form';
  form.className = 'card';
  form.noValidate = true;

  const h2 = document.createElement('h2');
  h2.textContent = '註冊新帳號';

  const displayName = field({ id: 'reg-name', name: 'displayName', label: '顯示名稱', type: 'text', autocomplete: 'nickname' });
  const email = field({ id: 'reg-email', name: 'email', label: '電子郵件', type: 'email', autocomplete: 'email' });
  const password = field({
    id: 'reg-password', name: 'password', label: '密碼', type: 'password',
    autocomplete: 'new-password', hint: '至少 6 個字元。請勿使用你在其他網站的真實密碼。'
  });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '註冊並登入';

  form.append(h2, displayName.wrap, email.wrap, password.wrap, submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors([displayName, email, password]);
    setBusy(submit, true, '註冊中…');

    try {
      await register({
        displayName: form.elements.displayName.value,
        email: form.elements.email.value,
        password: form.elements.password.value
      });
      toast('註冊成功，已為你登入。', 'ok');
      goAfterAuth();
    } catch (err) {
      // 註冊的錯誤可以指向具體欄位——這裡沒有帳號列舉的疑慮，
      // 因為「此電子郵件已被註冊」本來就是註冊流程必須告知的資訊（FR-002）。
      const details = err?.details ?? {};
      let matched = false;
      [['displayName', displayName], ['email', email], ['password', password]].forEach(([key, f]) => {
        if (details[key]) { showFieldError(f, details[key]); matched = true; }
      });
      if (!matched) {
        const message = toUserMessage(err);
        if (err?.code === 'EMAIL_TAKEN') showFieldError(email, message);
        else if (err?.code === 'WEAK_PASSWORD') showFieldError(password, message);
        else showFormError(form, message);
      }
      // FR-002：保留其他已填欄位，不清空表單
    } finally {
      setBusy(submit, false, '註冊並登入');
    }
  });

  return form;
}

// ---------------------------------------------------------------------------
// Google 登入（FR-087、FR-089）
// ---------------------------------------------------------------------------

function buildGoogleSection() {
  const box = document.createElement('section');
  box.className = 'card';
  box.style.marginTop = 'var(--sp-4)';

  const h2 = document.createElement('h2');
  h2.textContent = '使用第三方帳號';
  box.append(h2);

  const available = isGoogleLoginAvailable();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = '以 Google 帳號登入';

  if (!available) {
    // FR-089：停用並說明原因，不能點了沒反應，也不假造授權畫面
    btn.disabled = true;
    btn.setAttribute('aria-describedby', 'google-unavailable');
  } else {
    btn.addEventListener('click', async () => {
      setBusy(btn, true, '導向 Google…');
      try {
        const pending = router.takePendingRedirect();
        await loginWithGoogle(pending?.hash ?? '#/');
        // 成功時瀏覽器已離開本頁，不會執行到這裡
      } catch (err) {
        toast(toUserMessage(err), 'error');
        setBusy(btn, false, '以 Google 帳號登入');
      }
    });
  }

  box.append(btn);

  const note = document.createElement('p');
  note.id = 'google-unavailable';
  note.style.fontSize = 'var(--f-small)';
  note.style.color = 'var(--c-text-muted)';
  note.style.marginTop = 'var(--sp-2)';
  note.style.marginBottom = '0';
  note.textContent = available
    ? '登入後會回到你原本要前往的頁面。'
    : '此功能需要連線至資料庫，示範模式不支援。請於 src/config.js 填入 Supabase 憑證後再試。';
  box.append(note);

  return box;
}

// ---------------------------------------------------------------------------
// 共用
// ---------------------------------------------------------------------------

/** 登入成功後回到原本要去的地方（T040、T044） */
function goAfterAuth() {
  const stored = takePostAuthRedirect();
  const pending = router.takePendingRedirect();
  router.navigate(stored ?? pending?.hash ?? '#/', { replace: true });
}

function field({ id, name, label, type, autocomplete, hint }) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const l = document.createElement('label');
  l.htmlFor = id;
  l.textContent = label;

  const input = document.createElement('input');
  input.id = id;
  input.name = name;
  input.type = type;
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
  const formError = document.querySelector('.form-error');
  if (formError) formError.remove();
}

function showFormError(form, message) {
  let box = form.querySelector('.form-error');
  if (!box) {
    box = document.createElement('p');
    box.className = 'form-error error-state';
    box.setAttribute('role', 'alert');
    form.append(box);
  }
  box.textContent = message;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}
