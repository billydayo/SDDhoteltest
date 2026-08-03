/** 評論資料模組。 */

import * as repo from './repository.js';

export const listReviews = (filters) => repo.getReviews(filters);
export const submitReview = (input) => repo.submitReview(input);
export const moderateReview = (id, decision, note) => repo.moderateReview(id, decision, note);
export const deleteReview = (id) => repo.deleteReview(id);

/** 業者回覆一則評論（FR-103d）。傳空字串等於收回回覆。 */
export const replyToReview = (id, body) => repo.replyToReview(id, body);

/** 前台只顯示已通過審核的評論（FR-045、FR-046） */
export const listPublicReviews = (roomId) => repo.getReviews({ roomId, status: 'approved' });

export const listPendingReviews = () => repo.getReviews({ status: 'pending' });
