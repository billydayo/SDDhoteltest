/**
 * T125：後台佈局與十二個模組的導覽。
 *
 * ⚠️ **這個佈局不是安全邊界。** 它掛在 `RequireAdmin` 之下，而那個守衛只改變
 * 畫面呈現——真正的存取邊界在 FastAPI 的 `require_admin`（憲章原則 VI）。
 * 任何人改掉前端狀態或直接對 API 送請求都會落在後端那道上。
 *
 * ## 為什麼 `h1` 是「後台」而不是各模組的名稱
 *
 * 後台是**一個主控台的十二個區塊**，不是十二個彼此無關的頁面：導覽、身分、
 * 麵包屑都不隨模組改變。因此標題層級為「後台（h1）＞ 模組（h2）」，
 * 由各模組頁自行提供 h2。
 *
 * 分頁標題（`document.title`）則**必須**跟著模組走——瀏覽器分頁上只看得到
 * 那一行字，十二個分頁全都叫「後台」的話使用者無從分辨（憲章原則 V）。
 *
 * ## 導覽從哪裡來
 *
 * `modules.tsx` 的同一份陣列同時產生這裡的連結與 router.tsx 的路由。
 * 兩份分開維護時最常見的分歧是「路由存在但導覽沒有」，而那不會有任何錯誤。
 */
import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { panelClass } from '../../lib/surfaces'
import { ADMIN_MODULES } from './modules'

const BASE = '/admin'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'block rounded-xs px-gap-3 py-gap-2 text-small transition-colors',
    isActive
      ? 'bg-brand-soft text-brand-strong font-medium'
      : 'text-ink-muted hover:bg-surface-alt hover:text-ink',
  ].join(' ')

/** 目前落在哪一個模組。找不到時回索引頁——網址錯了也還有一個導覽可用。 */
function useCurrentModule() {
  const { pathname } = useLocation()
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length).replace(/^\//, '') : ''
  const segment = rest.split('/')[0] ?? ''
  return ADMIN_MODULES.find((m) => m.path === segment) ?? ADMIN_MODULES[0]
}

export function AdminLayout() {
  const current = useCurrentModule()
  const label = current?.label ?? '後台'

  // 分頁標題。**只在後台之內覆寫**——離開時還原，否則使用者回到前台後
  // 分頁上仍寫著「訂單管理」。
  useEffect(() => {
    const previous = document.title
    document.title = `${label} — 後台 — Sunny`
    return () => {
      document.title = previous
    }
  }, [label])

  return (
    <div className="grid gap-gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/*
        ⚠️ `min-w-0` 在這裡與在下方的 `<section>` 是**同一個理由，但更難發現**。

        `lg` 以下是單欄格線，而格線子項的預設 `min-width: auto` 讓這一格無法縮到
        比內容窄——內容是下面那排十二顆導覽膠囊，自然寬度約 490px。結果是
        `overflow-x-auto` 完全不生效：該捲的是那排膠囊，實際卻變成整頁橫捲。

        症狀只在 320px 與 375px 出現（T172 實測：後台十二個模組全中，前台 0），
        而開發時沒有人把視窗縮到那麼窄。
      */}
      <div className="min-w-0">
        {/* 標題層級與字級跟前台各頁一致（`text-h1`）——後台是同一個網站的
            一部分，不是另一個系統。導覽收在與前台同款的白底面板裡。 */}
        <h1 className="font-display text-h1 text-ink">後台</h1>
        <p className="mt-gap-1 text-small text-ink-muted">{current?.hint}</p>

        {/*
          `aria-label` 是必要的：頁首已經有一個 `nav`（主要導覽），
          兩個同名的地標對讀屏使用者等於沒有名字（憲章原則 V）。
        */}
        <nav aria-label="後台模組" className={`mt-gap-4 ${panelClass} p-gap-3`}>
          <ul className="flex gap-gap-1 overflow-x-auto pb-gap-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {ADMIN_MODULES.map((module) => (
              <li key={module.path} className="shrink-0 lg:shrink">
                {/*
                  `end` 只給索引頁。少了它，「營運總覽」在十二個模組底下
                  全部都會顯示為選中狀態——使用者永遠看不出自己在哪一頁。
                */}
                <NavLink
                  to={module.path ? `${BASE}/${module.path}` : BASE}
                  end={module.path === ''}
                  className={linkClass}
                  title={module.hint}
                >
                  {module.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/* `min-w-0`：格線子項的預設 `min-width: auto` 會讓寬表格把整個版面撐開，
          症狀是整頁出現橫向捲動而不是表格自己捲（T172a 的稽核項目）。 */}
      <section className="min-w-0">
        <Outlet />
      </section>
    </div>
  )
}
