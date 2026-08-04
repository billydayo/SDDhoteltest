/**
 * 應用外殼（骨架版）。
 *
 * ⚠️ **這是 T005 的最小可跑版本，會被 T040 的路由表取代。**
 * 現在只確認堆疊（React + Tailwind token + TypeScript strict）真的能跑起來。
 */
export default function App() {
  return (
    <main className="mx-auto max-w-(--container-measure) px-gap-5 py-gap-8">
      <h1 className="font-display text-h1 text-ink">Sunny 訂房平台</h1>
      <p className="mt-gap-3 text-ink-muted">
        前端骨架已就緒。頁面與路由由後續任務建立。
      </p>
      <p className="mt-gap-5">
        <span className="rounded-pill bg-brand px-gap-4 py-gap-2 text-ink-invert">
          品牌色 #7A6132，白字對比 5.9:1
        </span>
      </p>
    </main>
  )
}
