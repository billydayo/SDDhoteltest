/**
 * T140／T141：資料匯出（FR-058、FR-058a、FR-059、FR-060、SC-010、SC-033）。
 *
 * ## 匯出範圍 MUST 是該頁當前的篩選結果
 *
 * 因此本元件收的是**呼叫端正在用的那組篩選條件**，而不是自己去組一份。
 * **MUST NOT 另設一個獨立的「報表匯出」分頁**（FR-058）：那個分頁會有自己的
 * 一組篩選器，而使用者匯出的筆數會與他螢幕上看到的不同，且沒有任何錯誤訊息
 * （SC-033）。
 *
 * ## 0 筆時不產生檔案（FR-060、FR-058a）
 *
 * 後端在 0 筆時回 `hasData: false` 並附一句提示，**也不寫稽核紀錄**——沒有
 * 檔案離開系統，就沒有東西需要稽核。前端照做：顯示提示，不下載空檔案。
 * 一個只有表頭的檔案會被當成「資料掉了」而不是「本來就沒有資料」。
 *
 * ## xlsx 載不到時退回 CSV（FR-059、SC-010）
 *
 * ⚠️ **格式在請求之前就決定，並如實告訴後端。** 先試著載入試算表函式庫，
 * 成功才用 `xlsx` 去要資料，失敗就用 `csv`——因為稽核日誌記的是**實際離開
 * 系統的格式**（`schemas/export.py`）。先要 xlsx 再自己偷偷寫成 CSV 的話，
 * 日誌上會留下一筆與事實不符的紀錄。
 *
 * 退回時的說法分兩種，因為那是兩件事：
 *
 * - 瀏覽器回報離線 → 「目前離線，已改用 CSV 格式」
 * - 其他載入失敗   → 「試算表元件無法載入，已改用 CSV 格式」
 *
 * 一律說「目前離線」是不誠實的：使用者網路好好的卻被告知離線，他會去重開
 * 路由器，而問題不在那裡。無論哪一種，操作 **MUST NOT 中斷或無回應**。
 */
import { useState } from 'react'

import { api } from '../api/client'
import type { ExportFormat, ExportModule, ExportQuery, ExportSheet } from '../api/types'
import { messageFor } from '../lib/errors'

/** 檔名用的模組中文名。與後台導覽的用字一致。 */
const MODULE_LABEL: Record<ExportModule, string> = {
  rooms: '房源',
  orders: '訂單',
  users: '會員',
  reviews: '評論',
  refunds: '退款',
  'channel-prices': '渠道比價',
  'admin-logs': '操作日誌',
}

type XlsxModule = typeof import('../lib/xlsx')

/**
 * 試著載入 xlsx 產生器。載不到就回 `null`——**不丟例外**。
 *
 * 「chunk 抓不到」與「離線」在這裡是同一種結果（都退回 CSV），把它做成例外
 * 只會讓呼叫端多一個 try/catch，而那個 catch 遲早會把真正的錯誤也吞掉。
 *
 * ⚠️ 這裡 MUST 保持 `import()`。它讓 Vite 把產生器切成獨立 chunk，於是
 * 「元件載不到」是一件真的會發生的事（冷快取＋離線）——FR-059 與 SC-010 要求
 * 的退回路徑因此才測得到。改成靜態 import 的話，退回分支永遠不會被走到。
 */
async function loadSpreadsheetWriter(): Promise<XlsxModule | null> {
  // 離線時連試都不必試，省下一次必然失敗的往返。
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null
  try {
    return await import('../lib/xlsx')
  } catch {
    // chunk 抓不到、部署途中舊檔已被移除、瀏覽器擋下動態載入——結果都一樣。
    return null
  }
}

/**
 * 一格 CSV。
 *
 * ⚠️ 逗號、引號與換行都要處理，否則一個帶逗號的房名會把整列錯開，
 * 而錯開的那一列在 Excel 裡看起來像是資料本來就長那樣。
 *
 * 物件走 `JSON.stringify` 而不是 `String()`：後者會吐出 `[object Object]`，
 * 那正是稽核日誌的 `summary` 欄位會遇到的情況。
 */
/**
 * ⚠️ `JSON.stringify` 的型別宣告是回 string，但傳進 symbol 或 function 時它
 * 實際上會回 undefined。接成 `unknown` 再自己檢查一次——照著型別寫
 * `?? ''` 的話編譯器會判定那個判斷永遠不成立，而那一格最後會印出 "undefined"。
 */
function stringifyOrEmpty(value: unknown): string {
  const json: unknown = JSON.stringify(value)
  return typeof json === 'string' ? json : ''
}

function csvCell(value: unknown): string {
  let text: string
  if (value === null || value === undefined) text = ''
  else if (typeof value === 'string') text = value
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value)
  else text = stringifyOrEmpty(value)

  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * UTF-8 的位元組順序記號。
 *
 * ⚠️ 少了它，Excel 會用系統編碼讀 CSV，中文全部變成亂碼——而使用者會回報
 * 「匯出的檔案壞了」。寫成跳脫序列而不是直接貼一個看不見的字元：後者在編輯器
 * 裡沒有任何痕跡，任何一次「清理空白」的重構都會把它刪掉。
 */
const BOM = '\uFEFF'

function toCsv(sheet: ExportSheet): Blob {
  const header = sheet.columns.map((column) => csvCell(column.label)).join(',')
  const body = sheet.rows.map((row) =>
    sheet.columns.map((column) => csvCell(row[column.key])).join(','),
  )
  return new Blob([BOM + [header, ...body].join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  })
}

function toXlsx(writer: XlsxModule, sheet: ExportSheet): Blob {
  // 欄位順序直接沿用後端給的 `columns`，xlsx 與 CSV 因此必定一致——
  // 兩邊各自排一次的話，對照兩份匯出檔的人會以為資料對不起來。
  return writer.buildXlsx({
    sheetName: MODULE_LABEL[sheet.module],
    columns: sheet.columns.map((column) => ({ key: column.key, label: column.label })),
    rows: sheet.rows,
  })
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // 立刻釋放。不釋放的話整份資料會留在記憶體裡直到分頁關閉，
  // 而匯出幾百筆訂單的人通常會連續匯出好幾次。
  URL.revokeObjectURL(url)
}

function stamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}

interface ExportButtonProps {
  module: ExportModule
  /** ⚠️ **MUST 是該頁當前的篩選條件**，不是另一組（FR-058、SC-033）。 */
  params: ExportQuery
}

export function ExportButton({ module, params }: ExportButtonProps) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  async function run() {
    setBusy(true)
    setNotice(null)
    setFailed(false)
    try {
      const writer = await loadSpreadsheetWriter()
      const format: ExportFormat = writer === null ? 'csv' : 'xlsx'

      const sheet = await api.admin.exports.get(module, format, params)

      // FR-060／FR-058a：0 筆時提示，**不產生檔案**。
      if (!sheet.hasData) {
        setNotice(sheet.message ?? '目前的篩選條件沒有任何資料，未產生檔案。')
        return
      }

      const filename = `${MODULE_LABEL[module]}-${stamp()}.${format}`
      download(writer === null ? toCsv(sheet) : toXlsx(writer, sheet), filename)

      if (writer === null) {
        // FR-059／SC-010：說法要對得上實際狀況。
        setNotice(
          typeof navigator !== 'undefined' && !navigator.onLine
            ? `目前離線，已改用 CSV 格式匯出 ${String(sheet.rowCount)} 筆。`
            : `試算表元件無法載入，已改用 CSV 格式匯出 ${String(sheet.rowCount)} 筆。`,
        )
      } else {
        setNotice(`已匯出 ${String(sheet.rowCount)} 筆。`)
      }
    } catch (cause) {
      // ⚠️ MUST NOT 中斷或無回應（FR-059）。失敗也要說一句話。
      setFailed(true)
      setNotice(messageFor(cause).detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void run()
        }}
        className="rounded-pill border border-line-strong px-gap-4 py-gap-2 text-small text-ink-muted transition-colors hover:border-brand hover:text-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? '匯出中…' : '匯出目前結果'}
      </button>
      {notice !== null && (
        <span
          role="status"
          className={`mt-gap-1 text-tiny ${failed ? 'text-danger' : 'text-ink-muted'}`}
        >
          {notice}
        </span>
      )}
    </span>
  )
}
