/**
 * 自動審核相關文案的對照（FR-069、FR-103a、FR-103b）。
 *
 * ⚠️ **本檔釘住的是「值」，不是「有沒有翻譯」。**
 *
 * `lookup()` 查不到時原樣回傳代碼，因此一份鍵全部寫錯的對照表在型別上、
 * 執行上都完全正常——畫面只是顯示 `auto-pass` 而不是「建議通過」。這正是
 * 這裡曾經發生過的事：型別寫成 `'pass' | 'reject' | 'review'`，而後端的值是
 * `'auto-pass'` / `'auto-reject'`（資料庫的 `reviews_auto_verdict_check`）。
 * 三個鍵沒有一個對得上，沒有任何錯誤，也沒有任何測試失敗。
 *
 * 因此下面刻意用**字串字面值**而非型別匯入來斷言：型別可以被一起改壞，
 * 字面值不會。這些字面值的來源是後端的：
 *
 * - `backend/src/sunny/models/review.py` 的 `VERDICT_PASS` / `VERDICT_REJECT`
 * - `backend/src/sunny/services/moderation.py` 的 `RULE_*`
 */
import { describe, expect, it } from 'vitest'

import { autoVerdictLabel, moderationRuleLabel } from './labels'

describe('自動審核的判定（FR-103a）', () => {
  it('後端實際回傳的兩個值都翻得出中文', () => {
    expect(autoVerdictLabel('auto-pass')).toBe('建議通過')
    expect(autoVerdictLabel('auto-reject')).toBe('建議駁回')
  })

  it('⚠️ 文案 MUST NOT 出現「AI」或「人工智慧」', () => {
    // FR-103a、憲章原則 VI：這是規則式引擎。稱它為 AI 是對使用者的不實陳述。
    for (const value of ['auto-pass', 'auto-reject']) {
      expect(autoVerdictLabel(value)).not.toMatch(/AI|人工智慧/i)
    }
  })
})

describe('觸發規則的中文說明（FR-069）', () => {
  const RULE_CODES = [
    'banned-word',
    'too-short',
    'rating-mismatch',
    'duplicate-content',
    'clean',
  ]

  it.each(RULE_CODES)('%s 有對應的中文，不會把代碼漏到畫面上', (code) => {
    const label = moderationRuleLabel(code)
    expect(label).not.toBe(code)
    expect(label).toMatch(/[一-鿿]/)
  })
})
