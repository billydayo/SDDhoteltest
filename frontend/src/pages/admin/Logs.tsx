/**
 * T164：操作日誌（FR-114 ~ FR-118）。
 *
 * ## 畫面上 MUST NOT 出現編輯或刪除入口
 *
 * 這不只是把按鈕拿掉：**API 上根本沒有那兩個端點**（`routers/admin_logs.py`
 * 只有 GET），而資料庫層另外 `REVOKE UPDATE, DELETE ON admin_logs`。
 * 三層都不提供，比「介面上藏起來」牢固得多——一個能被 API 直接改掉的日誌，
 * 不叫稽核紀錄。
 *
 * ## 日期以台北時區切日
 *
 * 含頭含尾。以 UTC 切會讓台北早上 8 點前的操作被歸到前一天，而業者查
 * 「今天做了什麼」時那幾筆會憑空消失（`repositories/admin_logs.py`）。
 *
 * ## `summary` 原樣顯示
 *
 * 內容由 `services/audit.py` 在寫入時把關，結構上不含密碼、秘鑰或真實個資
 * （FR-118）。前端不再過濾一次——兩份禁用清單會分歧，而分歧時較寬鬆的那一份
 * 會生效。
 */
import { useCallback, useId, useState } from 'react'

import { api } from '../../api/client'
import type { AdminLog, AdminLogFilters } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ExportButton } from '../../components/ExportButton'
import { LoadingState } from '../../components/LoadingState'
import { useAsync } from '../../hooks/useAsync'
import { formatTimestamp } from '../../lib/dates'
import {
  buttonClass,
  Field,
  FilterBar,
  inputClass,
  ModuleHeading,
  TableShell,
  Td,
  Th,
} from './ui'

const EMPTY: AdminLogFilters = {}

/** 後端 `MAX_ROWS`。超過時畫面 MUST 說出來，MUST NOT 讓人以為那就是全部。 */
const MAX_ROWS = 500

function Summary({ summary }: { summary: Record<string, unknown> }) {
  const entries = Object.entries(summary)
  if (entries.length === 0) return <span className="text-ink-muted">—</span>
  return (
    <dl className="grid gap-x-gap-2 text-tiny sm:grid-cols-[auto_1fr]">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-ink-muted">{key}</dt>
          <dd className="text-ink break-all">
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function Logs() {
  const [draft, setDraft] = useState<AdminLogFilters>(EMPTY)
  const [filters, setFilters] = useState<AdminLogFilters>(EMPTY)
  const ids = useId()

  const load = useCallback((signal: AbortSignal) => api.admin.logs.list(filters, signal), [filters])
  const { status, data, error, reload } = useAsync<AdminLog[]>(load)

  return (
    <div>
      {/* 匯出日誌本身也會產生一筆日誌（`services/export.py` 的 `record_export`）
          ——「誰把稽核紀錄帶出去了」同樣需要被記下來。 */}
      <ModuleHeading
        title="操作日誌"
        actions={
          <ExportButton
            module="admin-logs"
            params={{
              actorId: filters.actorId,
              action: filters.action,
              startDate: filters.startDate,
              endDate: filters.endDate,
            }}
          />
        }
      />

      {/* ⚠️ 這一句是功能說明，不是免責聲明。看到「為什麼不能刪掉這筆」的人
          需要在同一個畫面上讀到答案（SC-027）。 */}
      <p className="mt-gap-2 text-small text-ink-muted">
        本頁唯讀。日誌無法修改或刪除，還原示範資料時也會保留。
      </p>

      <FilterBar
        onReset={() => {
          setDraft(EMPTY)
          setFilters(EMPTY)
        }}
      >
        <Field
          label="動作類型"
          htmlFor={`${ids}-action`}
          className="min-w-48"
          hint="前綴比對，例如 room 或 review"
        >
          <input
            id={`${ids}-action`}
            value={draft.action ?? ''}
            onChange={(e) => {
              setDraft({ ...draft, action: e.target.value })
            }}
            className={inputClass}
          />
        </Field>
        <Field label="起始日期" htmlFor={`${ids}-start`} className="w-44">
          <input
            id={`${ids}-start`}
            type="date"
            value={draft.startDate ?? ''}
            onChange={(e) => {
              setDraft({ ...draft, startDate: e.target.value })
            }}
            className={inputClass}
          />
        </Field>
        <Field label="結束日期" htmlFor={`${ids}-end`} className="w-44" hint="含頭含尾，台北時區">
          <input
            id={`${ids}-end`}
            type="date"
            value={draft.endDate ?? ''}
            onChange={(e) => {
              setDraft({ ...draft, endDate: e.target.value })
            }}
            className={inputClass}
          />
        </Field>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            setFilters(draft)
          }}
        >
          查詢
        </button>
      </FilterBar>

      {status === 'error' ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data === null ? (
        <LoadingState label="載入操作日誌…" />
      ) : data.length === 0 ? (
        <EmptyState
          title="這段期間沒有操作紀錄"
          hint="放寬日期範圍或清除動作類型後再查一次。"
        />
      ) : (
        <>
          {data.length >= MAX_ROWS && (
            <p className="mt-gap-3 text-small text-warn">
              僅顯示最新的 {MAX_ROWS} 筆。請縮小日期範圍以查看更早的紀錄。
            </p>
          )}
          <TableShell>
            <thead>
              <tr>
                <Th>時間</Th>
                <Th>操作者</Th>
                <Th>動作</Th>
                <Th>對象</Th>
                <Th>摘要</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((log) => (
                <tr key={log.id}>
                  <Td className="whitespace-nowrap">{formatTimestamp(log.createdAt)}</Td>
                  {/* ⚠️ 只有顯示名稱，沒有電子郵件——那是個資，而日誌是所有
                      管理員都讀得到的（FR-118）。 */}
                  <Td>{log.actorName ?? '（已刪除的帳號）'}</Td>
                  <Td>
                    <span className="font-mono text-tiny">{log.action}</span>
                  </Td>
                  <Td>
                    <span className="text-tiny text-ink-muted">{log.targetTable}</span>
                    {log.targetId !== null && (
                      <span className="block font-mono text-tiny break-all">{log.targetId}</span>
                    )}
                  </Td>
                  <Td>
                    <Summary summary={log.summary} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </>
      )}
    </div>
  )
}
