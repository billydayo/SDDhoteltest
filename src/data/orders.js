/** 訂單資料模組。 */

import * as repo from './repository.js';

export const listOrders = (filters) => repo.getOrders(filters);
export const getOrder = (id) => repo.getOrderById(id);
export const createOrder = (input) => repo.createOrder(input);
export const payOrder = (id) => repo.payOrder(id);
export const cancelOrder = (id) => repo.cancelOrder(id);
export const updateOrderStatus = (id, status, extra) => repo.updateOrderStatus(id, status, extra);
export const getOrderStats = () => repo.getOrderStats();

/** 待付款訂單的剩餘毫秒數。已逾期回傳 0。 */
export function remainingMs(order) {
  if (!order || order.status !== 'pending-payment' || !order.expiresAt) return 0;
  return Math.max(0, Date.parse(order.expiresAt) - Date.now());
}

export function isExpired(order) {
  return order?.status === 'pending-payment' && remainingMs(order) === 0;
}

/** 逾期未付款而取消的訂單，顯示上要與管理員手動取消區分開來 */
export function isPaymentTimeout(order) {
  return order?.status === 'cancelled' && order?.cancelReason === 'payment-timeout';
}
