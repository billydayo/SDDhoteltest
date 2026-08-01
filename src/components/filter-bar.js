/**
 * 搜尋列與篩選器（US1 / T035、T037）。
 *
 * FR-010：關鍵字、入住日、退房日、入住人數、價格上限、設施條件、房型特色，
 *         七項可組合使用；設施與特色為多選且採 AND 邏輯。
 *         必須顯示目前生效的條件並提供一鍵清除。
 *
 * FR-012：房型頁籤切換不得清除其他篩選條件——因此頁籤只改 `type`，
 *         其餘欄位原封不動。
 */

import { AMENITIES, ROOM_FEATURES, ROOM_TYPES } from '../data/vocabulary.js';
import { SORT_OPTIONS, describeActiveFilters } from '../services/search.js';
import * as store from '../state/store.js';
import { earliestCheckIn } from '../utils/dates.js';

/**
 * @param {(patch: object) => void} onChange 條件變更時呼叫，由呼叫端重新查詢
 */
export function createFilterBar(onChange) {
  const filters = store.getSearchFilters();

  const form = document.createElement('form');
  form.className = 'filter-bar';
  form.setAttribute('aria-label', '房源搜尋與篩選');
  // 關閉原生驗證，改由 services/search.js 產生繁體中文訊息（FR-069、FR-075）。
  // 否則輸入 0 只會跳出瀏覽器內建的英文提示。
  form.noValidate = true;

  const main = buildMainRow(filters);

  form.append(main.row);
  form.append(buildCheckGroup('設施條件', 'amenities', AMENITIES, filters.amenities));
  form.append(buildCheckGroup('房型特色', 'features', ROOM_FEATURES, filters.features));
  form.append(buildActions(onChange));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateRequired(main.fields)) return;
    onChange(readForm(form));
  });

  return form;
}

/**
 * 按下「搜尋」時的必填檢查。
 *
 * 只在送出時檢查，不在頁面載入時檢查——首頁一進來就滿版紅字會嚇到人，
 * 而且此時使用者根本還沒做任何事。房型頁籤與「清除全部條件」也不走這裡：
 * 前者依 FR-012 只改房型、不得動到其他條件，後者的用途正是把欄位清空。
 *
 * @returns {boolean} 全部通過才回傳 true
 */
function validateRequired(fields) {
  const checks = [
    { field: fields.checkIn, message: '請選擇入住日。' },
    { field: fields.checkOut, message: '請選擇退房日。' },
    { field: fields.guests, message: '請填寫入住人數。' }
  ];

  let firstInvalid = null;

  checks.forEach(({ field, message }) => {
    const value = field.input.value.trim();
    let error = value ? null : message;

    // 人數填了但填成 0 或負數時，「請填寫」是答非所問，要講清楚哪裡不對
    if (!error && field.input.name === 'guests') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) error = '入住人數需為大於 0 的整數。';
    }

    setFieldError(field, error);
    if (error && !firstInvalid) firstInvalid = field;
  });

  // 把焦點送到第一個有問題的欄位，使用者才不必自己找紅字在哪
  firstInvalid?.input.focus();
  return !firstInvalid;
}

function setFieldError(field, message) {
  field.error.textContent = message ?? '';
  field.error.hidden = !message;
  if (message) field.input.setAttribute('aria-invalid', 'true');
  else field.input.removeAttribute('aria-invalid');
}

function buildMainRow(filters) {
  const row = document.createElement('div');
  row.className = 'filter-bar__row';

  const fields = {
    keyword: field('關鍵字', 'keyword', 'text', filters.keyword, { placeholder: '房名或描述' }),
    checkIn: field('入住日', 'checkIn', 'date', filters.checkIn,
      { min: earliestCheckIn() }, { required: true }),
    checkOut: field('退房日', 'checkOut', 'date', filters.checkOut,
      { min: earliestCheckIn() }, { required: true }),
    guests: field('入住人數', 'guests', 'number', filters.guests,
      { min: '1', step: '1' }, { required: true }),
    // step 必須是 1：若設成 100，瀏覽器只接受 1、101、201…，
    // 使用者輸入 2500 會被原生驗證擋下而送不出表單。
    priceCap: field('每晚價格上限', 'priceCap', 'number', filters.priceCap, {
      min: '1', step: '1', inputmode: 'numeric', placeholder: '例如 3000', class: 'no-spin'
    }),
    sort: selectField('排序', 'sort', SORT_OPTIONS, filters.sort)
  };

  Object.values(fields).forEach((f) => row.append(f.wrap));
  return { row, fields };
}

function field(label, name, type, value, attrs = {}, { required = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const id = `filter-${name}`;
  const l = document.createElement('label');
  l.htmlFor = id;
  l.textContent = required ? `${label}（必填）` : label;

  const input = document.createElement('input');
  input.id = id;
  input.name = name;
  input.type = type;
  input.value = value ?? '';
  Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));

  // 錯誤訊息一律建好但預設隱藏。等出錯才插進 DOM 的話，
  // aria-describedby 指向的節點在那之前並不存在，輔助技術讀不到。
  const error = document.createElement('p');
  error.className = 'field__error';
  error.id = `${id}-error`;
  error.hidden = true;
  error.setAttribute('role', 'alert');

  if (required) {
    input.setAttribute('aria-required', 'true');
    input.setAttribute('aria-describedby', error.id);
    // 填好就把紅字收掉，不必等到再按一次搜尋
    input.addEventListener('input', () => {
      if (input.value.trim()) setFieldError({ input, error }, null);
    });
  }

  wrap.append(l, input, error);
  return { wrap, input, error };
}

function selectField(label, name, options, value) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const id = `filter-${name}`;
  const l = document.createElement('label');
  l.htmlFor = id;
  l.textContent = label;

  const select = document.createElement('select');
  select.id = id;
  select.name = name;
  options.forEach((opt) => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    select.append(o);
  });

  wrap.append(l, select);
  // 與 field() 的形狀一致，buildMainRow 才能一律用 f.wrap 取用
  return { wrap, input: select };
}

/** 多選群組。以 fieldset + legend 提供正確的語意分組。 */
function buildCheckGroup(legendText, name, options, selected = []) {
  const fs = document.createElement('fieldset');
  fs.className = 'filter-group';
  fs.style.border = 'none';
  fs.style.padding = '0';
  fs.style.margin = 'var(--sp-4) 0 0';

  const legend = document.createElement('legend');
  legend.textContent = `${legendText}（可複選，須全部符合）`;
  fs.append(legend);

  const box = document.createElement('div');
  box.className = 'filter-group__options';

  options.forEach((value, index) => {
    const id = `${name}-${index}`;
    const chip = document.createElement('span');
    chip.className = 'check-chip';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.name = name;
    input.value = value;
    input.checked = selected.includes(value);

    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = value;

    chip.append(input, label);
    box.append(chip);
  });

  fs.append(box);
  return fs;
}

function buildActions(onChange) {
  const actions = document.createElement('div');
  actions.className = 'filter-bar__actions';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '搜尋';

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn';
  clear.textContent = '清除全部條件';
  clear.addEventListener('click', () => {
    store.clearSearchFilters();
    onChange(null);
  });

  actions.append(submit, clear);
  return actions;
}

function normalizeChecklist(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
  )];
}

function readForm(form) {
  const data = new FormData(form);
  return {
    keyword: (data.get('keyword') ?? '').toString().trim(),
    checkIn: (data.get('checkIn') ?? '').toString(),
    checkOut: (data.get('checkOut') ?? '').toString(),
    guests: (data.get('guests') ?? '').toString(),
    priceCap: (data.get('priceCap') ?? '').toString(),
    sort: (data.get('sort') ?? '').toString(),
    amenities: normalizeChecklist(data.getAll('amenities')),
    features: normalizeChecklist(data.getAll('features'))
  };
}

// ---------------------------------------------------------------------------
// 房型頁籤（FR-012）
// ---------------------------------------------------------------------------

export function createTypeTabs(currentType, onSelect) {
  const nav = document.createElement('div');
  nav.className = 'type-tabs';
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', '房型分類');

  const tabs = [{ value: '', label: '全部房型' }, ...ROOM_TYPES];
  tabs.forEach(({ value, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(value === (currentType ?? '')));
    // 只改 type，其他條件保持不變（FR-012）
    btn.addEventListener('click', () => onSelect(value));
    nav.append(btn);
  });

  return nav;
}

// ---------------------------------------------------------------------------
// 目前生效的條件（FR-010）
// ---------------------------------------------------------------------------

export function createActiveFilters(filters, onRemove) {
  const chips = describeActiveFilters(filters);
  if (!chips.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'active-filters';

  const label = document.createElement('span');
  label.className = 'active-filters__label';
  label.textContent = `已套用 ${chips.length} 項條件：`;
  wrap.append(label);

  chips.forEach(({ key, label: text }) => {
    const chip = document.createElement('span');
    chip.className = 'filter-chip';
    chip.append(document.createTextNode(text));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `移除條件：${text}`);
    remove.addEventListener('click', () => onRemove(key));

    chip.append(remove);
    wrap.append(chip);
  });

  return wrap;
}

/** 把「移除某條件」轉成 store 的更新內容 */
export function removalPatch(key, filters) {
  if (key === 'dates') return { checkIn: '', checkOut: '' };
  if (key.startsWith('amenity:')) {
    const value = key.slice('amenity:'.length);
    return { amenities: filters.amenities.filter((a) => a !== value) };
  }
  if (key.startsWith('feature:')) {
    const value = key.slice('feature:'.length);
    return { features: filters.features.filter((f) => f !== value) };
  }
  return { [key]: '' };
}
