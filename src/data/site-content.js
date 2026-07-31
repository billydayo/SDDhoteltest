/** 網站內容資料模組（首頁標題、副標、主圖）。 */

import * as repo from './repository.js';

export const getSiteContent = () => repo.getSiteContent();
export const updateSiteContent = (patch) => repo.updateSiteContent(patch);
