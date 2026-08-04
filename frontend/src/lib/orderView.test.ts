/**
 * T104 的顯示層規則（FR-039、FR-036b、FR-036c）。
 *
 * 這些判斷的每一種錯法都不會拋錯，只會讓標籤出現在錯誤的訂單上——而使用者
 * 看到「退款已駁回」時的第一反應是「我的訂房沒了嗎」。因此逐條釘死。
 */
import { describe, expect, it } from 'vitest'

import type { MyRefund, Order } from '../api/types'
import {
  MAX_REFUNDS_PER_USER,
  REFUND_REJECTED_TAB,
  canRequestRefund,
  displayStatusOf,
  isRefundQuotaFull,
  latestRefundByOrder,
  refundQuotaUsed,
} from './orderView'

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    orderNo: 'SN20260804001',
    roomId: 'room-1',
    checkIn: '2026-09-01',
    checkOut: '2026-09-03',
    nights: 2,
    guestCount: 2,
    contactName: '王小明',
    phone: '0912345678',
    email: 'guest@example.com',
    paymentMethod: 'LINE Pay',
    totalAmount: 6400,
    status: 'confirmed',
    expiresAt: '2099-01-01T00:00:00Z',
    cancelReason: null,
    createdAt: '2026-08-04T00:00:00Z',
    ...overrides,
  }
}

function refund(overrides: Partial<MyRefund> = {}): MyRefund {
  return {
    id: 'refund-1',
    orderId: 'order-1',
    orderNo: 'SN20260804001',
    checkIn: '2026-09-01',
    checkOut: '2026-09-03',
    reason: '行程有變。',
    amount: 6400,
    status: 'pending',
    adminNote: null,
    createdAt: '2026-08-05T00:00:00Z',
    reviewedAt: null,
    ...overrides,
  }
}

describe('最新一次的申請（FR-039）', () => {
  it('同一張訂單有多筆時，取 createdAt 最新的那一筆', () => {
    const map = latestRefundByOrder([
      refund({ id: 'old', status: 'rejected', createdAt: '2026-08-05T00:00:00Z' }),
      refund({ id: 'new', status: 'approved', createdAt: '2026-08-09T00:00:00Z' }),
    ])
    expect(map.get('order-1')?.id).toBe('new')
  })

  it('⚠️ 不依賴後端送來的順序', () => {
    // 後端目前由新到舊，但那是實作細節。哪天改成由舊到新，這個判斷不該跟著反過來
    const ascending = latestRefundByOrder([
      refund({ id: 'old', createdAt: '2026-08-05T00:00:00Z' }),
      refund({ id: 'new', createdAt: '2026-08-09T00:00:00Z' }),
    ])
    const descending = latestRefundByOrder([
      refund({ id: 'new', createdAt: '2026-08-09T00:00:00Z' }),
      refund({ id: 'old', createdAt: '2026-08-05T00:00:00Z' }),
    ])
    expect(ascending.get('order-1')?.id).toBe('new')
    expect(descending.get('order-1')?.id).toBe('new')
  })

  it('不同訂單的申請彼此獨立', () => {
    const map = latestRefundByOrder([
      refund({ id: 'a', orderId: 'order-1' }),
      refund({ id: 'b', orderId: 'order-2' }),
    ])
    expect(map.get('order-1')?.id).toBe('a')
    expect(map.get('order-2')?.id).toBe('b')
  })
})

describe('「退款已駁回」標籤（FR-039）', () => {
  it('最新一次遭駁回且訂單仍為 confirmed 時顯示', () => {
    expect(displayStatusOf(order(), refund({ status: 'rejected' }))).toBe(REFUND_REJECTED_TAB)
  })

  it('⚠️ 「曾被駁回」但最新一次是審核中 → MUST NOT 顯示駁回', () => {
    // 以「曾被駁回」判定的話，這張訂單會永遠帶著駁回標籤
    expect(displayStatusOf(order(), refund({ status: 'pending' }))).toBe('confirmed')
  })

  it('⚠️ 最新一次已核准 → MUST NOT 顯示駁回', () => {
    expect(displayStatusOf(order(), refund({ status: 'approved' }))).toBe('confirmed')
  })

  it('訂單已變成 refunded 時，舊的駁回紀錄不再影響顯示', () => {
    expect(displayStatusOf(order({ status: 'refunded' }), refund({ status: 'rejected' }))).toBe(
      'refunded',
    )
  })

  it('待付款、退款審核中等狀態一律照自己的狀態顯示', () => {
    expect(displayStatusOf(order({ status: 'pending-payment' }), null)).toBe('pending-payment')
    expect(displayStatusOf(order({ status: 'refund-pending' }), refund())).toBe('refund-pending')
  })

  it('沒有任何退款申請時就是訂單自己的狀態', () => {
    expect(displayStatusOf(order(), null)).toBe('confirmed')
  })

  it('⚠️ 分頁鍵刻意不像資料庫狀態值', () => {
    // 加一個 `refund-rejected` 進 OrderStatus 會讓後台把它列為可指派的狀態
    expect(REFUND_REJECTED_TAB).not.toMatch(/^[a-z-]+$/)
    expect(REFUND_REJECTED_TAB.startsWith('display:')).toBe(true)
  })
})

describe('退款額度（FR-036b、SC-031）', () => {
  it('審核中與已核准佔用額度', () => {
    expect(
      refundQuotaUsed([refund({ status: 'pending' }), refund({ status: 'approved' })]),
    ).toBe(2)
  })

  it('⚠️ 被駁回的 MUST NOT 佔用額度', () => {
    const rejectedFive = Array.from({ length: MAX_REFUNDS_PER_USER }, (_, i) =>
      refund({ id: `r${String(i)}`, status: 'rejected' }),
    )
    expect(refundQuotaUsed(rejectedFive)).toBe(0)
    // 被駁回 5 次的會員，畫面上 MUST NOT 說他已達上限——後端還讓他申請，
    // 而兩邊說法不一致時使用者相信的是畫面
    expect(isRefundQuotaFull(rejectedFive)).toBe(false)
  })

  it('剛好 5 筆佔用時視為已達上限', () => {
    const five = Array.from({ length: MAX_REFUNDS_PER_USER }, (_, i) =>
      refund({ id: `r${String(i)}`, status: 'pending' }),
    )
    expect(isRefundQuotaFull(five)).toBe(true)
    expect(isRefundQuotaFull(five.slice(1))).toBe(false)
  })

  it('沒有任何申請時不算已達上限', () => {
    expect(isRefundQuotaFull([])).toBe(false)
  })
})

describe('能否申請退款（FR-035）', () => {
  const today = '2026-08-04'

  it('已確認且入住日尚未到來', () => {
    expect(canRequestRefund(order({ checkIn: '2026-08-05' }), today)).toBe(true)
  })

  it('⚠️ 入住當日不可申請——金額為 0 與「尚未到來」是兩件事', () => {
    expect(canRequestRefund(order({ checkIn: today }), today)).toBe(false)
  })

  it('入住日已過不可申請', () => {
    expect(canRequestRefund(order({ checkIn: '2026-08-01' }), today)).toBe(false)
  })

  it('待付款的訂單不走退款——直接取消即可', () => {
    expect(canRequestRefund(order({ status: 'pending-payment', checkIn: '2026-09-01' }), today)).toBe(
      false,
    )
  })

  it('已在審核中、已退款、已取消一律不可再申請', () => {
    for (const status of ['refund-pending', 'refunded', 'cancelled', 'completed'] as const) {
      expect(canRequestRefund(order({ status, checkIn: '2026-09-01' }), today)).toBe(false)
    }
  })
})
