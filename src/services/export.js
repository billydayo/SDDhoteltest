/**
 * 報表匯出（US8 / T084）。
 *
 * FR-058：匯出為 Excel（.xlsx）。
 * FR-059：匯出元件無法使用或離線時自動改用 CSV 並告知使用者，不得中斷或無回應。
 * FR-060：0 筆時提示無資料可匯出，且不產生空檔案。
 *
 * SheetJS 以動態載入取得，**只在使用者按下匯出時才下載**。
 *
 * 憲章原本禁止示範模式發出任何網路請求，該限制已於 2026-07-31 解除；
 * 但延後載入仍然保留——它是將近 1 MB 的函式庫，而絕大多數使用者從不匯出報表。
 * 沒有理由讓每個人為了一個少用的功能付出載入成本。
 */

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

let sheetJsPromise = null;

/** 載入 SheetJS。失敗時回傳 null，由呼叫端退回 CSV。 */
async function loadSheetJS() {
  if (window.XLSX) return window.XLSX;
  if (!navigator.onLine) return null;

  if (!sheetJsPromise) {
    sheetJsPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = SHEETJS_URL;
      script.async = true;
      script.onload = () => resolve(window.XLSX ?? null);
      script.onerror = () => {
        // 下次再試一次，不要因為一次失敗就永久停用 xlsx
        sheetJsPromise = null;
        resolve(null);
      };
      document.head.append(script);
    });
  }
  return sheetJsPromise;
}

/**
 * 匯出資料。
 *
 * @param {{ filename: string, sheetName?: string, columns: Array<{key: string, label: string}>, rows: object[] }} config
 * @returns {Promise<{ format: 'xlsx'|'csv'|'none', message: string }>}
 */
export async function exportRows({ filename, sheetName = '報表', columns, rows }) {
  // FR-060：0 筆時不產生空檔案
  if (!rows.length) {
    return { format: 'none', message: '目前沒有可匯出的資料。請調整篩選條件後再試。' };
  }

  const header = columns.map((c) => c.label);
  const body = rows.map((row) => columns.map((c) => formatCell(row[c.key])));

  const xlsx = await loadSheetJS();

  if (xlsx) {
    try {
      const sheet = xlsx.utils.aoa_to_sheet([header, ...body]);
      const book = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(book, sheet, sheetName);
      xlsx.writeFile(book, `${filename}.xlsx`);
      return { format: 'xlsx', message: `已匯出 ${rows.length} 筆資料（Excel）。` };
    } catch {
      // 產檔失敗同樣退回 CSV，而不是讓使用者卡住
    }
  }

  downloadCsv(`${filename}.csv`, [header, ...body]);
  return {
    format: 'csv',
    message: navigator.onLine
      ? `匯出元件無法載入，已改用 CSV 格式（${rows.length} 筆）。`
      : `目前離線，已改用 CSV 格式（${rows.length} 筆）。`
  };
}

function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * 產生 CSV 並觸發下載。
 *
 * 加上 UTF-8 BOM：沒有 BOM 的話，Excel 在中文 Windows 上會以 ANSI 開啟，
 * 中文全部變亂碼——這是最常見的「匯出檔打不開」抱怨來源。
 */
function downloadCsv(filename, matrix) {
  const csv = matrix.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // 立即撤銷會讓部分瀏覽器來不及下載，延後釋放
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
