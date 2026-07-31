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
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onChange(readForm(form));
  });

  form.append(buildMainRow(filters));
  form.append(buildCheckGroup('設施條件', 'amenities', AMENITIES, filters.amenities));
  form.append(buildCheckGroup('房型特色', 'features', ROOM_FEATURES, filters.features));
  form.append(buildActions(onChange));

  return form;
}

function buildMainRow(filters) {
  const row = document.createElement('div');
  row.className = 'filter-bar__row';

  row.append(
    field('關鍵字', 'keyword', 'text', filters.keyword, { placeholder: '房名或描述' }),
    field('入住日', 'checkIn', 'date', filters.checkIn, { min: earliestCheckIn() }),
    field('退房日', 'checkOut', 'date', filters.checkOut, { min: earliestCheckIn() }),
    field('入住人數', 'guests', 'number', filters.guests, { min: '1', step: '1' }),
    field('每晚價格上限', 'priceCap', 'number', filters.priceCap, { min: '1', step: '100' }),
    selectField('排序', 'sort', SORT_OPTIONS, filters.sort)
  );
  return row;
}

function field(label, name, type, value, attrs = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const id = `filter-${name}`;
  const l = document.createElement('label');
  l.htmlFor = id;
  l.textContent = label;

  const input = document.createElement('input');
  input.id = id;
  input.name = name;
  input.type = type;
  input.value = value ?? '';
  Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));

  wrap.append(l, input);
  return wrap;
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
  return wrap;
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

function readForm(form) {
  const data = new FormData(form);
  return {
    keyword: (data.get('keyword') ?? '').toString().trim(),
    checkIn: (data.get('checkIn') ?? '').toString(),
    checkOut: (data.get('checkOut') ?? '').toString(),
    guests: (data.get('guests') ?? '').toString(),
    priceCap: (data.get('priceCap') ?? '').toString(),
    sort: (data.get('sort') ?? '').toString(),
    amenities: data.getAll('amenities').map(String),
    features: data.getAll('features').map(String)
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
