/**
 * 應用進入點（T005）。
 *
 * 只做三件事：掛載、開啟 StrictMode、載入樣式。路由與版面屬於 `App.tsx`（T040）。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) {
  // index.html 少了 #root。與其讓 createRoot 拋一句看不懂的錯，不如講清楚。
  throw new Error('找不到 #root 掛載點，請確認 index.html 未被修改。')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
