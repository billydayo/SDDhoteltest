import { Link } from 'react-router-dom'
import { primaryButtonClass } from '../lib/surfaces'

/**
 * 找不到頁面。
 *
 * 給一條回得去的路。純粹的「404」對使用者沒有幫助——他不知道自己該做什麼，
 * 而多數人此刻只是打錯了網址或點到過期的連結。
 */
export function NotFound() {
  return (
    <section className="mx-auto max-w-md py-gap-8 text-center">
      <h1 className="font-display text-h1 text-ink">找不到這個頁面</h1>
      <p className="mt-gap-3 text-ink-muted">網址可能有誤，或這個頁面已經移除。</p>
      <Link
        to="/"
        className={`mt-gap-5 inline-block ${primaryButtonClass}`}
      >
        回到房源列表
      </Link>
    </section>
  )
}

/**
 * 已登入但權限不足。
 *
 * ⚠️ **與 404 分開，也與登入頁分開。** 已經登入的人被丟回登入頁只會困惑——
 * 他明明登入了。這裡要說的是「你登入了，但這個功能不歸你用」。
 */
export function Forbidden() {
  return (
    <section className="mx-auto max-w-md py-gap-8 text-center">
      <h1 className="font-display text-h1 text-ink">沒有存取權限</h1>
      <p className="mt-gap-3 text-ink-muted">此功能僅限管理員使用。</p>
      <Link
        to="/"
        className={`mt-gap-5 inline-block ${primaryButtonClass}`}
      >
        回到房源列表
      </Link>
    </section>
  )
}
