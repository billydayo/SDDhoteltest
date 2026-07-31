/**
 * 後台共用的介面零件。
 *
 * 十一個模組都在做「一張表格 + 幾個篩選 + 一些動作按鈕」，
 * 把這些收在同一處，樣式與鍵盤行為才不會各寫各的。
 */

/**
 * 資料表。寬內容在自己的容器內捲動，不讓整頁橫向捲動（憲章原則 V）。
 *
 * @param {string[]} headers
 * @param {Array<Array<string|Node>>} rows
 * @param {{ rowClass?: (index: number) => string }} [options]
 */
export function createDataTable(headers, rows, options = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'data-table-wrap';

  const table = document.createElement('table');
  table.className = 'data-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach((h) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    headRow.append(th);
  });
  thead.append(headRow);

  const tbody = document.createElement('tbody');
  rows.forEach((cells, index) => {
    const tr = document.createElement('tr');
    const cls = options.rowClass?.(index);
    if (cls) tr.className = cls;
    cells.forEach((cell) => {
      const td = document.createElement('td');
      if (cell instanceof Node) td.append(cell);
      else td.textContent = cell ?? '—';
      tr.append(td);
    });
    tbody.append(tr);
  });

  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

export function createEmptyRow(message) {
  const p = document.createElement('p');
  p.className = 'empty-state';
  p.textContent = message;
  return p;
}

/** 文字／數字／日期欄位 */
export function textField({ id, name, label, type = 'text', value = '', hint, attrs = {} }) {
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

  wrap.append(l, input);
  if (hint) {
    const h = document.createElement('p');
    h.className = 'field__hint';
    h.textContent = hint;
    wrap.append(h);
  }
  return { wrap, input };
}

export function selectField({ id, name, label, value = '', options, hint }) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

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
  if (hint) {
    const h = document.createElement('p');
    h.className = 'field__hint';
    h.textContent = hint;
    wrap.append(h);
  }
  return { wrap, input: select };
}

export function textareaField({ id, name, label, value = '', rows = 3, hint }) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const l = document.createElement('label');
  l.htmlFor = id;
  l.textContent = label;

  const input = document.createElement('textarea');
  input.id = id;
  input.name = name;
  input.rows = rows;
  input.value = value ?? '';

  wrap.append(l, input);
  if (hint) {
    const h = document.createElement('p');
    h.className = 'field__hint';
    h.textContent = hint;
    wrap.append(h);
  }
  return { wrap, input };
}

/** 多選核取群組（設施、房型特色） */
export function checkboxGroup({ name, legend, options, selected = [] }) {
  const fs = document.createElement('fieldset');
  fs.className = 'filter-group';
  fs.style.border = 'none';
  fs.style.padding = '0';

  const lg = document.createElement('legend');
  lg.textContent = legend;
  fs.append(lg);

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

export function actionButton(label, onClick, variant = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn${variant ? ` btn--${variant}` : ''}`;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * 二次確認。用於刪除房源這類不可逆操作（FR-052）。
 * 以原生 confirm 實作：零依賴、鍵盤可操作、且不會有自製對話框的焦點陷阱問題。
 */
export function confirmAction(message) {
  return window.confirm(message);
}

export function inlineError() {
  const p = document.createElement('p');
  p.className = 'error-state';
  p.hidden = true;
  p.setAttribute('role', 'alert');
  return p;
}

export function showInlineError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

export function statusTag(label, tone = 'neutral') {
  const span = document.createElement('span');
  span.className = `tag tag--${tone}`;
  span.textContent = label;
  return span;
}

export function buttonRow(...buttons) {
  const row = document.createElement('div');
  row.className = 'filter-bar__actions';
  buttons.filter(Boolean).forEach((b) => row.append(b));
  return row;
}

/**
 * 匯出按鈕（US8 / FR-058、FR-059、FR-060）。
 *
 * 刻意做成可放在任一後台模組的零件，而不是獨立的「報表匯出」分頁——
 * spec US8 場景 1 描述的是「管理員位於**訂單管理**且有篩選結果，點選匯出，
 * 下載包含**目前篩選結果**的檔案」。匯出必須貼著資料所在的頁面，
 * 才能拿得到當下的篩選條件；獨立分頁只能匯出全部，反而做不到規格要的事。
 *
 * @param {object}   config
 * @param {string}   config.label     按鈕文字
 * @param {string}   config.filename  不含副檔名
 * @param {string}   config.sheetName 工作表名稱
 * @param {Array<{key: string, label: string}>} config.columns
 * @param {() => object[]} config.getRows 取得當下要匯出的資料列
 * @param {(message: string, tone?: string) => void} config.notify
 */
export function createExportButton({ label = '匯出報表', filename, sheetName, columns, getRows, notify }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = label;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '匯出中…';
    try {
      // 動態載入：SheetJS 接近 1 MB，沒按匯出的人不該付這個成本
      const { exportRows } = await import('../services/export.js');
      const result = await exportRows({
        filename, sheetName, columns, rows: getRows()
      });
      notify(result.message, result.format === 'none' ? 'error' : 'ok');
    } catch {
      notify('匯出未能完成，請稍後再試。', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  return btn;
}
