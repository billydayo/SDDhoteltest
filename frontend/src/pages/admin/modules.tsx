/**
 * T125：後台十二個模組的**單一來源**。
 *
 * 導覽列（`AdminLayout`）與路由表（`router.tsx`）都由這一份陣列產生。
 *
 * ## 為什麼不各寫一份
 *
 * 兩份清單分開維護時，最常見的分歧是「路由存在但導覽沒有」——那個模組因此
 * 只有知道網址的人進得去，而且不會有任何錯誤。反過來的分歧則是導覽上有一個
 * 點了會掉到「找不到頁面」的連結。兩種都不會有測試失敗。
 *
 * 由同一份資料展開之後，這兩種分歧在結構上不可能發生。
 *
 * ## `element` 為什麼放在這裡
 *
 * 把它拆到 router.tsx 就等於又有了第二份清單。頁面尚未建立的模組可以先掛
 * `pages/Placeholder`，各自的任務只需要換掉這裡的一行——導覽與路由自動跟上。
 * 十二個模組現在都有真正的頁面了。
 */
import type { ReactNode } from 'react'

import { Channel } from './Channel'
import { Content } from './Content'
import { Dashboard } from './Dashboard'
import { Logs } from './Logs'
import { Messages } from './Messages'
import { Orders } from './Orders'
import { Refunds } from './Refunds'
import { Reviews } from './Reviews'
import { RoomRisk } from './RoomRisk'
import { Rooms } from './Rooms'
import { Settings } from './Settings'
import { Users } from './Users'

export interface AdminModule {
  /** 相對於 `/admin` 的路徑。空字串為索引頁。 */
  path: string
  /** 導覽上的名稱，同時也是各頁的標題（`document.title`）。 */
  label: string
  /** 導覽上的一行說明。滑鼠停留與讀屏都讀得到。 */
  hint: string
  element: ReactNode
}

export const ADMIN_MODULES: readonly AdminModule[] = [
  {
    path: '',
    label: '營運總覽',
    hint: '今日進出、房態與待處理事項',
    element: <Dashboard />,
  },
  {
    path: 'rooms',
    label: '房源管理',
    hint: '新增、編輯、房態與照片',
    element: <Rooms />,
  },
  {
    path: 'orders',
    label: '訂單管理',
    hint: '搜尋、狀態變更與營運指標',
    element: <Orders />,
  },
  {
    path: 'users',
    label: '會員管理',
    hint: '資料維護與權限升降',
    element: <Users />,
  },
  {
    path: 'reviews',
    label: '評論審核',
    hint: '通過、駁回與業者回覆',
    element: <Reviews />,
  },
  {
    path: 'refunds',
    label: '退款審核',
    hint: '核准或駁回退款申請',
    element: <Refunds />,
  },
  {
    path: 'content',
    label: '內容編輯',
    hint: '首頁標題、副標與主視覺',
    element: <Content />,
  },
  {
    path: 'room-risk',
    label: '房源品質檢測',
    hint: '分析房源照片並公開於詳情頁',
    element: <RoomRisk />,
  },
  {
    path: 'channel-prices',
    label: '渠道比價',
    hint: '平台售價比對與賤賣預警（模擬資料）',
    element: <Channel />,
  },
  {
    path: 'logs',
    label: '操作日誌',
    hint: '唯讀的稽核紀錄',
    element: <Logs />,
  },
  {
    path: 'settings',
    label: '系統參數',
    hint: '訂單保留時間與詞彙表',
    element: <Settings />,
  },
  {
    path: 'messages',
    label: '會員訊息',
    hint: '客服討論串與回覆',
    element: <Messages />,
  },
]
