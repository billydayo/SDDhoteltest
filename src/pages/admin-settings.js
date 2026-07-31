/**
 * 系統與參數設定（US12 / T108、T109）。
 *
 * FR-119：參數必須有範圍檢查，超出範圍必須被拒絕並顯示可接受範圍。
 * FR-101：變更不得回溯影響既有訂單已決定的到期時間。
 *
 * 範圍檢查在三個地方各做一次：HTML 的 min/max（即時提示）、
 * data/settings.js（業務規則）、資料庫 CHECK 約束（最終保證）。
 * 前兩者是體驗，最後一個才是保證。
 */

import { createPageHeader, toast } from '../app.js';
import { getSettings, updateSetting, SETTING_SPECS } from '../data/settings.js';
import { withAudit, ACTIONS } from '../services/audit.js';
import { textField, inlineError, showInlineError, buttonRow } from '../components/admin-ui.js';
import { toUserMessage } from '../utils/errors.js';
import * as store from '../state/store.js';

export async function renderAdminSettings(panel) {
  const settings = await getSettings();

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('系統與參數設定', '調整營運參數。變更會記錄於操作日誌。'));

  frag.append(buildPendingPaymentForm(settings, panel));
  frag.append(buildReadOnlyInfo());

  panel.replaceChildren(frag);
}

function buildPendingPaymentForm(settings, panel) {
  const spec = SETTING_SPECS.pending_payment_minutes;
  const current = Number(settings?.pending_payment_minutes ?? spec.fallback);

  const form = document.createElement('form');
  form.className = 'card';
  form.style.marginBottom = 'var(--sp-5)';
  form.noValidate = true;

  const h2 = document.createElement('h2');
  h2.textContent = '未付款訂單保留時間';
  form.append(h2);

  const desc = document.createElement('p');
  desc.textContent = '訂單建立後保留房間的時間。逾期未付款的訂單會自動取消，'
    + '該日期區間立即釋出給其他人預訂。';
  form.append(desc);

  const field = textField({
    id: 'set-hold', name: 'minutes', label: spec.label, type: 'number',
    value: String(current),
    attrs: { min: String(spec.min), max: String(spec.max), step: '5' },
    hint: `可接受範圍：${spec.min} 至 ${spec.max} 分鐘。變更只影響之後建立的新訂單，`
        + '既有訂單的到期時間不會被改動。'
  });

  const error = inlineError();

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '儲存';

  form.append(field.wrap, error, buttonRow(submit));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;

    const next = Number(field.input.value);
    if (next === current) {
      toast('數值未變更。');
      return;
    }

    submit.disabled = true;
    try {
      await withAudit(
        {
          action: ACTIONS.SETTING_UPDATE, targetTable: 'system_settings',
          targetId: 'pending_payment_minutes',
          summary: { pending_payment_minutes: { from: current, to: next } }
        },
        () => updateSetting('pending_payment_minutes', next)
      );
      store.setSettings(await getSettings());
      toast(`已更新，新訂單的保留時間為 ${next} 分鐘。`, 'ok');
      renderAdminSettings(panel);
    } catch (err) {
      // FR-119：超出範圍時顯示可接受的範圍，而非一句「儲存失敗」
      showInlineError(error, toUserMessage(err));
      submit.disabled = false;
    }
  });

  return form;
}

/** 不可從介面調整、但管理員應該知道的設定 */
function buildReadOnlyInfo() {
  const section = document.createElement('section');
  section.className = 'card';

  const h2 = document.createElement('h2');
  h2.textContent = '其他系統設定';
  section.append(h2);

  const dl = document.createElement('dl');
  dl.style.display = 'grid';
  dl.style.gridTemplateColumns = 'auto 1fr';
  dl.style.gap = 'var(--sp-2) var(--sp-4)';
  dl.style.margin = '0';

  [
    ['資料來源', store.getState().mode === 'demo' ? '瀏覽器 localStorage（示範模式）' : 'Supabase 雲端資料庫'],
    ['後台權限', '由資料庫的 Row Level Security 政策執行，不在此處調整'],
    ['退款級距', '7 天以上 100%、3–6 天 50%、1–2 天 20%、當日起不可退'],
    ['逾期判定方式', '查詢時判定，不使用背景排程'],
    ['評論審核', '規則式自動初判 + 管理員複核']
  ].forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.style.color = 'var(--c-text-muted)';
    dt.style.fontSize = 'var(--f-small)';
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.style.margin = '0';
    dd.textContent = value;
    dl.append(dt, dd);
  });

  section.append(dl);

  const note = document.createElement('p');
  note.className = 'field__hint';
  note.textContent = '退款級距與權限規則寫在程式碼與資料庫政策中，'
    + '調整需修改規格與 supabase/schema.sql，不開放從介面變更。';
  section.append(note);

  return section;
}
