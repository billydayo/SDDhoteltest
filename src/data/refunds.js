/** 退款申請資料模組。 */

import * as repo from './repository.js';

export const listRefunds = (filters) => repo.getRefunds(filters);
export const requestRefund = (input) => repo.requestRefund(input);
export const moderateRefund = (id, decision, note) => repo.moderateRefund(id, decision, note);
export const listPendingRefunds = () => repo.getRefunds({ status: 'pending' });
