/**
 * 在無頭瀏覽器裡跑 tests/index.html 的單元測試，讓 `npm test` 一次涵蓋兩層。
 *
 * 單元測試本身不需要 Node（開瀏覽器就跑），這支只是把結果收進同一個出口，
 * 方便 CI 或發版前一次跑完。
 */

import { openPage, BASE, sleep, createReporter } from './harness.mjs';

const r = createReporter('單元測試（於瀏覽器內執行）');
const { browser, page, problems } = await openPage({ demo: true });

await page.goto(`${BASE}/tests/index.html`, { waitUntil: 'networkidle2' });
await sleep(2500);

const results = await page.evaluate(() => window.__TEST_RESULTS__ ?? null);

if (!results) {
  r.ok('測試頁有執行', false, '讀不到 window.__TEST_RESULTS__');
} else {
  r.ok(`通過 ${results.passed} 項`, results.failed === 0,
    results.failures.join('\n     '));
}

const summary = r.done(problems);
await browser.close();
process.exit(summary.failed ? 1 : 0);
