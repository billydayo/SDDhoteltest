/**
 * 私訊的資料模組（FR-123 ~ FR-127）。
 *
 * 討論串以會員為單位：一位會員只有一串，管理員不是討論串的一端而是可以進入
 * 任何一串的角色。所以這裡沒有 recipient，也沒有「指派給哪位客服」——
 * 換人接手不必轉交，是這個設計要達成的事（FR-127）。
 *
 * 與其他實體模組一樣，只轉呼叫 repository，不自己決定資料存在哪。
 */

import * as repo from './repository.js';

/** 某位會員的完整對話，由舊到新 */
export const listMessages = (threadUserId) => repo.getMessages(threadUserId);

/** 後台用的討論串清單：每位會員一列，含最後一則訊息與未讀數 */
export const listThreads = () => repo.getMessageThreads();

/**
 * 送出訊息。
 * 會員省略 threadUserId 即為自己那一串；管理員必須指名要回哪一串。
 */
export const sendMessage = (input) => repo.sendMessage(input);

/** 把對方送來、自己還沒讀的標為已讀 */
export const markRead = (threadUserId, readerRole) =>
  repo.markMessagesRead(threadUserId, readerRole);
