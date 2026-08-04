/**
 * T159：渠道比價（FR-108、FR-110 ~ FR-113）。
 *
 * ## 模擬標示有兩層，兩層都是必要的
 *
 * 1. **頁面頂端常駐**（FR-110）——正在看畫面的人一定讀得到，而且關不掉
 * 2. **每一列自己帶**（`simulated`／`simulatedNotice`，`schemas/channel.py`）
 *
 * 只有第一層的話，資料被匯出成檔案、被截圖、被轉寄給沒看過那塊提示的人之後
 * 就什麼標示都沒有了——收到的人會把這些數字當成真實的市場價格。
 *
 * ## 郵件範本 MUST 說清楚系統不會寄（FR-112）
 *
 * 後端的 `willSend` 恆為 false 並附一句 `notice`，畫面原樣顯示。範本刻意
 * **不含收件者信箱**：帶著收件者的範本會讓人以為只差按一下送出，然後他就
 * 等著對方回覆一封根本沒有寄出去的信。
 *
 * ## 價差的正負號
 *
 * `gap` = 官網價 − 平台售價。**正值代表對方賣得比我們便宜**，那才是預警
 * （FR-111）。反過來讀的話，賣得比我們貴的平台會被當成問題來處理。
 */
import { useCallback, useId, useState } from 'react'

import { api } from '../../api/client'
import type { ChannelComparison, ChannelFilters, ComplaintTemplate } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ExportButton } from '../../components/ExportButton'
import { LoadingState } from '../../components/LoadingState'
import { SimulatedBadge } from '../../components/SimulatedBadge'
import { useAsync } from '../../hooks/useAsync'
import { formatTimestamp } from '../../lib/dates'
import { messageFor } from '../../lib/errors'
import { formatTWD } from '../../lib/money'
import {
  Badge,
  buttonClass,
  ModuleHeading,
  Notice,
  primaryButtonClass,
  TableShell,
  Td,
  Th,
} from './ui'

const TABS: { value: 'alerts' | 'resolved' | 'all'; label: string }[] = [
  { value: 'alerts', label: '未處理' },
  { value: 'resolved', label: '已處理' },
  { value: 'all', label: '全部' },
]

function filtersFor(tab: 'alerts' | 'resolved' | 'all'): ChannelFilters {
  if (tab === 'alerts') return { resolved: false }
  if (tab === 'resolved') return { resolved: true }
  return {}
}

// ---------------------------------------------------------------------------
// 申訴郵件範本
// ---------------------------------------------------------------------------
function ComplaintPanel({ row, onClose }: { row: ChannelComparison; onClose: () => void }) {
  const load = useCallback(
    (signal: AbortSignal) => api.admin.channelPrices.complaint(row.id, signal),
    [row.id],
  )
  const { status, data, error, reload } = useAsync<ComplaintTemplate>(load)
  const [copied, setCopied] = useState(false)
  const ids = useId()

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // 瀏覽器拒絕剪貼簿權限。文字就在畫面上，使用者仍然可以自己選取複製——
      // 因此這裡只是不顯示「已複製」，MUST NOT 讓整個面板看起來壞掉。
      setCopied(false)
    }
  }

  return (
    <section
      aria-label={`${row.channel} 的申訴信件範本`}
      className="mt-gap-4 rounded-base border border-line-strong bg-surface p-gap-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-gap-2">
        <h3 className="text-md text-ink">
          申訴信件範本｜{row.roomName}．{row.channel}
        </h3>
        <button type="button" onClick={onClose} className={buttonClass}>
          關閉
        </button>
      </div>

      {status === 'error' ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState label="產生範本…" />
      ) : (
        <>
          {/*
            ⚠️ FR-112：MUST 明確告知系統不會代為寄送。這句話來自後端的
            `notice` 欄位——那個承諾屬於系統行為，而系統行為的定義在後端。
            寫在前端文案裡的話，改掉它不需要動到任何後端程式。
          */}
          <p
            role="note"
            className="mt-gap-3 rounded-base border border-warn/30 bg-warn-soft px-gap-4 py-gap-3 text-small text-ink"
          >
            <span aria-hidden="true" className="mr-gap-2">
              ⚠
            </span>
            {data.notice}
          </p>

          <div className="mt-gap-3">
            <label htmlFor={`${ids}-subject`} className="block text-tiny text-ink-muted">
              主旨
            </label>
            <input
              id={`${ids}-subject`}
              readOnly
              value={data.subject}
              className="mt-gap-1 w-full rounded-xs border border-line-strong bg-surface-alt px-gap-3 py-gap-2 text-small"
            />
          </div>

          <div className="mt-gap-3">
            <label htmlFor={`${ids}-body`} className="block text-tiny text-ink-muted">
              內文
            </label>
            <textarea
              id={`${ids}-body`}
              readOnly
              rows={10}
              value={data.body}
              className="mt-gap-1 w-full rounded-xs border border-line-strong bg-surface-alt px-gap-3 py-gap-2 text-small"
            />
          </div>

          <div className="mt-gap-3 flex flex-wrap items-center gap-gap-2">
            {/*
              按鈕寫「複製」而不是「送出」。畫面上不該有任何一個看起來會把信
              寄出去的控制項——`willSend` 恆為 false，介面必須說同一件事。
            */}
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => {
                void copy(`${data.subject}\n\n${data.body}`)
              }}
            >
              複製到剪貼簿
            </button>
            {copied && <span className="text-small text-ok">已複製，請自行貼到您的信箱寄出。</span>}
          </div>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 頁面
// ---------------------------------------------------------------------------
export function Channel() {
  const [tab, setTab] = useState<'alerts' | 'resolved' | 'all'>('alerts')
  const [complaint, setComplaint] = useState<ChannelComparison | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const load = useCallback(
    (signal: AbortSignal) => api.admin.channelPrices.list(filtersFor(tab), signal),
    [tab],
  )
  const { status, data, error, reload } = useAsync<ChannelComparison[]>(load)

  /** 頁首提示優先用後端給的文案，兩邊才不會分歧。 */
  const notice = data?.[0]?.simulatedNotice

  async function setResolved(row: ChannelComparison, resolved: boolean) {
    setMessage(null)
    setFailure(null)
    try {
      await api.admin.channelPrices.setResolved(row.id, resolved)
      setMessage(
        resolved
          ? `已將「${row.roomName}．${row.channel}」標記為已處理。`
          : `已將「${row.roomName}．${row.channel}」改回未處理。`,
      )
      reload()
    } catch (cause) {
      setFailure(messageFor(cause).detail)
    }
  }

  return (
    <div>
      {/* ⚠️ 匯出的每一列都帶著模擬標記（`schemas/channel.py`）——檔案會被
          轉寄給沒看過下方那塊常駐提示的人。 */}
      <ModuleHeading
        title="渠道比價"
        actions={<ExportButton module="channel-prices" params={{}} />}
      />

      {/* ⚠️ FR-110：**常駐**。放在標題正下方、所有資料之前，而且沒有關閉鈕。 */}
      <div className="mt-gap-3">
        <SimulatedBadge {...(notice === undefined ? {} : { notice })} />
      </div>

      <div className="mt-gap-4 flex flex-wrap gap-gap-2" role="group" aria-label="依處理狀態篩選">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={tab === item.value}
            onClick={() => {
              setTab(item.value)
              setComplaint(null)
            }}
            className={
              tab === item.value
                ? 'rounded-pill bg-brand px-gap-4 py-gap-2 text-small text-ink-invert'
                : buttonClass
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {message !== null && <Notice tone="ok">{message}</Notice>}
      {failure !== null && <Notice tone="danger">{failure}</Notice>}

      {complaint !== null && (
        <ComplaintPanel
          row={complaint}
          onClose={() => {
            setComplaint(null)
          }}
        />
      )}

      {status === 'error' ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data === null ? (
        <LoadingState label="載入比價資料…" />
      ) : data.length === 0 ? (
        <EmptyState
          title={tab === 'alerts' ? '目前沒有未處理的賤賣預警' : '這個分頁沒有比價資料'}
          hint={
            tab === 'alerts'
              ? '當某個平台的售價低於官網價時，該筆會出現在這裡。這些數字為模擬資料，不來自任何外部平台。'
              : '換一個分頁看看。'
          }
        />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <Th>房源</Th>
              <Th>平台</Th>
              <Th align="right">官網價</Th>
              <Th align="right">平台售價</Th>
              <Th align="right">價差</Th>
              <Th>狀態</Th>
              <Th>擷取時間</Th>
              <Th>操作</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.id}>
                <Td>{row.roomName}</Td>
                <Td>
                  {row.channel}
                  {/* 每一列自己也帶標示——這一欄會跟著匯出的檔案一起走。 */}
                  <span className="ml-gap-2 align-middle">
                    <SimulatedBadge variant="inline" notice={row.simulatedNotice} />
                  </span>
                </Td>
                <Td align="right">{formatTWD(row.officialPrice)}</Td>
                <Td align="right">{formatTWD(row.channelPrice)}</Td>
                <Td align="right">
                  {/* 正值＝對方賣得比我們便宜。用文字說明而不是只給顏色——
                      色盲使用者看不出紅綠的差別（憲章原則 V）。 */}
                  <span className={row.underpriced ? 'text-danger' : 'text-ink-muted'}>
                    {formatTWD(Math.abs(row.gap))}（{row.gapPercent.toFixed(1)}%）
                  </span>
                  <span className="block text-tiny text-ink-muted">
                    {row.underpriced ? '對方較便宜' : '對方未低於官網價'}
                  </span>
                </Td>
                <Td>
                  {row.resolved ? (
                    <Badge tone="neutral">已處理</Badge>
                  ) : row.underpriced ? (
                    <Badge tone="danger">賤賣預警</Badge>
                  ) : (
                    <Badge tone="ok">正常</Badge>
                  )}
                </Td>
                <Td className="whitespace-nowrap">{formatTimestamp(row.capturedAt)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-gap-1">
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => {
                        setComplaint(row)
                      }}
                    >
                      申訴範本
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => {
                        void setResolved(row, !row.resolved)
                      }}
                    >
                      {row.resolved ? '改回未處理' : '標記已處理'}
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  )
}
