/**
 * 房源檢測結果的儲存（US9 / T091、T092）。
 *
 * ⚠️⚠️ 這是本專案**唯一**會把圖片存出瀏覽器的模組，且僅供管理員對自家房源
 *       執行的檢測使用。
 *
 *       前台「安全檢測」頁 src/pages/risk-check.js **絕對不得 import 本模組**，
 *       那是使用者的私人照片，必須全程留在瀏覽器內（FR-086、憲章原則 VI）。
 *       任務 T116 會專門檢查這條 import 路徑不存在。
 *
 *       之所以拆成獨立檔案而不是在同一個函式加旗標：旗標會在某次重構中被設錯，
 *       而設錯的後果是把使用者的私人照片上傳到公開儲存空間。分離的模組
 *       則不可能被誤呼叫——前台頁面根本沒有引用它。
 */

import { saveRoomRiskCheck } from '../data/risk-checks.js';
import { isDemoMode } from '../data/repository.js';
import { appError } from '../utils/errors.js';

/** 儲存前必須讓管理員明確確認的文字（FR-105） */
export const PUBLIC_DISCLOSURE_NOTICE =
  '此圖將公開顯示於該房源的詳情頁，任何訪客都看得到。\n\n'
  + '請確認照片為飯店自有的房間照片，且不含可辨識的人物。\n\n'
  + '確定要儲存嗎？';

/**
 * 儲存房源檢測結果與受檢圖片。
 *
 * @param {{ roomId: string, file: File, metrics: object }} params
 */
export async function saveRoomCheck({ roomId, file, metrics }) {
  if (!roomId) throw appError('NOT_FOUND', '請先選擇要檢測的房源。');
  if (!file) throw appError('UNKNOWN', '請選擇一張照片。');

  const payload = {
    roomId,
    metrics: {
      brightness: metrics.brightness,
      clutter: metrics.clutter,
      contrast: metrics.contrast,
      riskScore: metrics.riskScore,
      riskLevel: metrics.riskLevel
    }
  };

  if (isDemoMode()) {
    // 示範模式沒有雲端儲存，改以 data URL 存在 localStorage。
    // 這仍然只發生在管理員的房源檢測路徑上。
    payload.imageDataUrl = await toDataUrl(file);
  } else {
    payload.imageBlob = file;
  }

  return saveRoomRiskCheck(payload);
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(appError('UNKNOWN', '讀取圖片失敗，請換一張再試。'));
    reader.readAsDataURL(file);
  });
}
