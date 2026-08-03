/**
 * 圖片壓縮工具。
 *
 * 上傳前一律在瀏覽器內縮圖與轉檔，理由有三：
 *   1. 手機拍的照片動輒 4000px、5 MB，原檔上傳既慢又佔空間
 *   2. 憲章「資源」條要求圖片經過壓縮
 *   3. 示範模式把圖片存成 data URL 放進 localStorage，配額只有幾 MB，
 *      不壓縮的話兩張照片就爆掉
 *
 * 壓縮全程用 Canvas 在本機完成，不需要任何外部服務。
 */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;   // 原始檔上限 10 MB

/** 房源展示照片：長邊上限與 JPEG 品質 */
const ROOM_PHOTO = { maxEdge: 1600, quality: 0.82 };

/** 示範模式壓得更兇——data URL 要塞進 localStorage 的幾 MB 配額 */
const ROOM_PHOTO_DEMO = { maxEdge: 900, quality: 0.68 };

/** 檔案驗證。回傳 null 代表通過。 */
export function validateUpload(file) {
  if (!file) return '請選擇一張圖片。';
  if (!file.type.startsWith('image/')) return '只接受圖片檔案（JPG、PNG、WebP 等）。';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `檔案大小上限為 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB，請改用較小的圖片。`;
  }
  return null;
}

/**
 * 壓縮成 JPEG。
 *
 * @param {File|Blob} file
 * @param {{ demo?: boolean }} [options] demo 模式壓得更小
 * @returns {Promise<{ blob: Blob, dataUrl: string, width: number, height: number }>}
 */
export async function compressImage(file, { demo = false } = {}) {
  const preset = demo ? ROOM_PHOTO_DEMO : ROOM_PHOTO;
  const url = URL.createObjectURL(file);

  try {
    const img = await loadImage(url);

    const scale = Math.min(1, preset.maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    // 白底：PNG 的透明區域轉成 JPEG 後預設會變黑
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', preset.quality);
    });
    if (!blob) throw new Error('canvas-toblob-failed');

    return { blob, dataUrl: canvas.toDataURL('image/jpeg', preset.quality), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image-decode-failed'));
    img.src = url;
  });
}

/** 供介面顯示檔案大小 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
