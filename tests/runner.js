/**
 * 極簡測試執行器。
 *
 * 沒有依賴、沒有建置步驟——開啟 tests/index.html 就跑（憲章「關於自動化測試」）。
 * 刻意不引入 Jest／Vitest 之類的框架：這一層要測的是純函式與資料層，
 * 需要的功能就是「跑一組函式、比對值、把結果印出來」，不到一百行。
 *
 * 執行結果同時寫進 DOM 與 window.__TEST_RESULTS__，
 * 後者讓 E2E 那一層能在無頭瀏覽器裡直接讀取，不必解析畫面。
 */

const suites = [];
let current = null;

export function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

export function it(name, fn) {
  if (!current) throw new Error('it() 必須寫在 describe() 之內');
  current.tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// 斷言
//
// 訊息一律包含「預期」與「實際」。只寫「斷言失敗」的測試，出錯時還要再回去
// 加 console.log 才知道發生什麼事，等於沒省到時間。
// ---------------------------------------------------------------------------

export const expect = (actual) => ({
  toBe(expected) {
    if (!Object.is(actual, expected)) {
      throw new Error(`預期 ${format(expected)}，實際 ${format(actual)}`);
    }
  },
  toEqual(expected) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`預期 ${b}，實際 ${a}`);
  },
  toContain(item) {
    if (!Array.isArray(actual) && typeof actual !== 'string') {
      throw new Error(`toContain 只能用於陣列或字串，實際 ${format(actual)}`);
    }
    if (!actual.includes(item)) {
      throw new Error(`預期包含 ${format(item)}，實際 ${format(actual)}`);
    }
  },
  notToContain(item) {
    if (actual.includes(item)) {
      throw new Error(`預期不包含 ${format(item)}，實際 ${format(actual)}`);
    }
  },
  toBeNull() {
    if (actual !== null) throw new Error(`預期 null，實際 ${format(actual)}`);
  },
  toBeTruthy() {
    if (!actual) throw new Error(`預期為真值，實際 ${format(actual)}`);
  },
  toBeFalsy() {
    if (actual) throw new Error(`預期為假值，實際 ${format(actual)}`);
  },
  async toReject(code) {
    try {
      await actual;
    } catch (err) {
      if (code && err.code !== code) {
        throw new Error(`預期錯誤碼 ${code}，實際 ${err.code ?? err.message}`);
      }
      return;
    }
    throw new Error(`預期會拋出錯誤${code ? `（${code}）` : ''}，但順利完成了`);
  }
});

const format = (v) =>
  typeof v === 'string' ? `「${v}」` : JSON.stringify(v) ?? String(v);

// ---------------------------------------------------------------------------
// 執行
// ---------------------------------------------------------------------------

export async function run(root) {
  const results = { passed: 0, failed: 0, failures: [] };

  for (const suite of suites) {
    const section = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = suite.name;
    section.append(h2);

    for (const test of suite.tests) {
      const line = document.createElement('div');
      line.className = 'case';
      try {
        await test.fn();
        results.passed += 1;
        line.classList.add('pass');
        line.textContent = `✅ ${test.name}`;
      } catch (err) {
        results.failed += 1;
        results.failures.push(`${suite.name} › ${test.name}：${err.message}`);
        line.classList.add('fail');
        line.textContent = `❌ ${test.name} — ${err.message}`;
      }
      section.append(line);
    }
    root.append(section);
  }

  const summary = document.createElement('p');
  summary.className = `summary ${results.failed ? 'fail' : 'pass'}`;
  summary.textContent = results.failed
    ? `${results.failed} 項失敗 / 共 ${results.passed + results.failed} 項`
    : `全部通過（${results.passed} 項）`;
  root.prepend(summary);

  // E2E 那一層讀這個，不必解析畫面
  window.__TEST_RESULTS__ = results;
  return results;
}
