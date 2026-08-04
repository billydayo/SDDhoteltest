/**
 * Google 登入的回程落點（FR-087）。
 *
 * 後端完成 code 交換後，把瀏覽器導到 `/auth/callback#accessToken=...`。
 * 這一頁把 token 收下、換成身分、再把使用者送去他本來要去的地方。
 *
 * ## ⚠️ 讀完 MUST 立刻把片段從網址列抹掉
 *
 * 片段不會被送到伺服器（不進 access log、不進 `Referer`），但它**會留在瀏覽器
 * 歷史紀錄裡**。留著的話，使用者按上一頁會回到一個網址列上寫著自己 token 的
 * 頁面，而那台電腦可能不是他一個人的。
 *
 * `history.replaceState` 是就地換掉目前這一筆，不會多產生一筆歷史。
 *
 * ## MUST NOT 自己解 token
 *
 * 拿到 token 之後要問一次 `/me` 才知道現在是誰。JWT 的 payload 沒有經過任何
 * 驗證，而且使用者可能在簽發之後被降權——照 payload 顯示會讓一個已經不是
 * 管理員的人看到後台入口。
 */
import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { LoadingState } from '../components/LoadingState'
import { useAuth } from '../state/AuthContext'

interface HashPayload {
  token: string | null
  error: string | null
}

function readHash(hash: string): HashPayload {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  return { token: params.get('accessToken'), error: params.get('error') }
}

export function AuthCallback() {
  const location = useLocation()
  const { adoptToken } = useAuth()

  /**
   * 片段只讀一次。
   *
   * ⚠️ 用 ref 而不是每次繪製重讀：下面的 effect 會把網址列抹掉，之後再讀就是
   * 空的。React 嚴格模式在開發時會把 effect 跑兩次，第二次讀到空片段就會誤判
   * 成「沒有 token」而把使用者退回登入頁——**只在開發環境發生**，正式站上
   * 看起來完全正常。
   */
  const payloadRef = useRef<HashPayload | null>(null)
  payloadRef.current ??= readHash(location.hash)
  const payload = payloadRef.current

  /** 交換結果。`null` = 還在處理；`{ok:true}` = 成功；否則帶失敗代碼。 */
  type Outcome = { ok: true } | { ok: false; code: string } | null

  const [outcome, setOutcome] = useState<Outcome>(
    payload.token ? null : { ok: false, code: payload.error ?? 'GOOGLE_NO_TOKEN' },
  )

  useEffect(() => {
    // ⚠️ 先抹掉網址列裡的 token，再做其他事。中間任何一步失敗，
    // 歷史紀錄裡都已經是乾淨的。
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)

    const token = payload.token
    if (!token) return

    let cancelled = false
    adoptToken(token)
      .then(() => {
        if (!cancelled) setOutcome({ ok: true })
      })
      .catch(() => {
        // token 換不到身分，代表它其實不管用（`adoptToken` 已經清掉它）
        if (!cancelled) setOutcome({ ok: false, code: 'GOOGLE_TOKEN_REJECTED' })
      })
    return () => {
      cancelled = true
    }
  }, [payload, adoptToken])

  if (outcome?.ok === true) return <Navigate to="/" replace />
  if (outcome) {
    // 交回登入頁，由 GoogleButton 依代碼顯示對應說明（FR-090）
    return <Navigate to={`/login#error=${encodeURIComponent(outcome.code)}`} replace />
  }

  return <LoadingState label="正在完成 Google 登入…" />
}
