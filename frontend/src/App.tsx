/**
 * T040：應用外殼。
 *
 * 只負責把三層包起來，順序有意義：
 *
 *   BrowserRouter → AuthProvider → AppRoutes
 *
 * `AuthProvider` 在 Router **之內**，因為登出後要能導覽；`AppRoutes` 在
 * `AuthProvider` 之內，因為守衛要讀登入狀態。反過來包會在執行期才炸，
 * 而錯誤訊息（`useNavigate() may be used only in the context of a Router`）
 * 看不出真正的原因是包裹順序。
 */
import { BrowserRouter } from 'react-router-dom'

import { AppRoutes } from './router'
import { AuthProvider } from './state/AuthContext'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
