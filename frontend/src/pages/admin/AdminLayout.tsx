/**
 * T125：後台佈局與十二個模組的導覽。
 *
 * ## 十二個模組
 *
 * 模組清單見 spec.md 開頭的「後台模組數量」。與企劃書的三處出入都是刻意的：
 *
 * - **沒有「報表匯出」分頁**。匯出要匯的是「該頁當前的篩選結果」（FR-058），
 *   而獨立分頁取不到其他頁面的篩選條件。因此匯出鈕嵌在各資料頁面裡（T140）。
 *   ⚠️ 有人想「補上」這個模組時，補的會是一個只能匯出全表的按鈕——
 *   看起來功能更完整，實際上違反 FR-058 且 SC-033 會失敗。
 * - **多了「房源品質檢測」**：管理員要為房源產生公開的檢測結果，需要介面。
 * - **多了「會員訊息」**（2026-08-03 新增，FR-123 ~ FR-128）。
 *
 * ## 導覽只是導覽
 *
 * ⚠️ **這裡的十二個連結 MUST NOT 被當成權限控制。** 使用者看不看得到入口，
 * 與他呼不呼叫得動端點是兩回事——後者由 FastAPI 的 `require_admin` 決定
 * （憲章原則 VI）。`RequireAdmin` 守衛擋的是「畫面上不該出現的東西」。
 *
 * ## 尚未建立的模組
 *
 * 十二個模組分屬 US6 ~ US12，不會同時完成。未完成的一律指向 `Placeholder`
 * 並標明由哪個任務接手——**導覽從第一天就是完整的十二項**。少列幾項再回頭補，
 * 會讓「這個功能到底有沒有」變成要翻任務清單才答得出來的問題。
 */
import { NavLink, Outlet } from 'react-router-dom'

interface AdminModule {
  /** 相對於 `/admin` 的路徑；空字串為索引頁（儀表板）。 */
  path: string
  label: string
}

/**
 * 十二個模組，依「日常使用頻率」而非功能相似度排序。
 *
 * 儀表板打頭、房源與訂單次之——業者一天裡有九成的時間只用這三項。
 * 日誌與參數設定放最後：重要，但一週不見得會開一次。
 */
const ADMIN_MODULES: readonly AdminModule[] = [
  { path: '', label: '儀表板' },
  { path: 'rooms', label: '房源管理' },
  { path: 'orders', label: '訂單管理' },
  { path: 'users', label: '用戶管理' },
  { path: 'reviews', label: '評論審核' },
  { path: 'refunds', label: '退款審核' },
  { path: 'messages', label: '會員訊息' },
  { path: 'room-risk', label: '房源品質檢測' },
  { path: 'content', label: '內容編輯' },
  { path: 'channel', label: '渠道比價與控價' },
  { path: 'logs', label: '操作日誌' },
  { path: 'settings', label: '系統與參數設定' },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'block rounded-xs px-gap-3 py-gap-2 text-small whitespace-nowrap transition-colors',
    isActive
      ? 'bg-brand-soft font-medium text-brand-strong'
      : 'text-ink-muted hover:bg-surface-alt hover:text-ink',
  ].join(' ')

export function AdminLayout() {
  return (
    <div className="flex flex-col gap-gap-5 lg:flex-row lg:gap-gap-6">
      {/*
        側欄。窄螢幕時改為頂端的橫向捲動列——十二個項目在手機上直排會把
        內容推到第一屏之外，使用者每次進後台都要先捲過一整排導覽（SC-012）。
      */}
      <nav
        aria-label="後台模組"
        className="shrink-0 overflow-x-auto border-b border-line-soft pb-gap-2 lg:w-56 lg:overflow-visible lg:border-r lg:border-b-0 lg:pr-gap-4 lg:pb-0"
      >
        <ul className="flex gap-gap-1 lg:flex-col">
          {ADMIN_MODULES.map((mod) => (
            <li key={mod.path}>
              <NavLink
                to={mod.path === '' ? '/admin' : `/admin/${mod.path}`}
                // `end` 只給索引頁：否則 `/admin` 在任何子頁面上都會維持選取態，
                // 使用者會同時看到兩個「目前所在」的標示。
                end={mod.path === ''}
                className={linkClass}
              >
                {mod.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* `min-w-0`：沒有它，子頁面裡的寬表格會把 flex 項目撐開而超出視窗，
          `TableScroll` 的橫向捲動就失效了（flex 項目的最小寬度預設是內容寬度）。 */}
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}

/**
 * 後台頁面的共用標題列。
 *
 * 每個模組都有「標題 + 一句說明 + 右上角的操作」這個形狀。抽出來不是為了
 * 省行數，而是為了讓十二個模組的標題不會各長各的——後台頁面是同一個人在
 * 同一次工作階段裡連續切換的，版面每頁不同會讓他每次都要重新找東西。
 */
export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-gap-5 flex flex-wrap items-start justify-between gap-gap-3">
      <div>
        <h1 className="font-display text-h2 text-ink">{title}</h1>
        {description && <p className="mt-gap-1 text-small text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-gap-2">{actions}</div>}
    </div>
  )
}
