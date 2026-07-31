/**
 * 照片風險評分（US9 / T088、T089）。
 *
 * ⚠️ 本模組**只做計算，不做儲存**。它不知道 Supabase 存在，也不碰任何
 *    localStorage。前台的安全檢測與後台的房源檢測共用這裡的分析，
 *    但只有後台路徑會再呼叫 risk-upload.js 把結果存起來
 *    （憲章原則 VI：兩條路徑的程式碼必須分離）。
 *
 * FR-068 的公式：
 *   亮度、雜亂度、對比各以 0–100 計分，100 表示表現較佳
 *   總風險 = 100 − (0.4 × 亮度 + 0.35 × 雜亂度 + 0.25 × 對比)
 *   0–34 低風險、35–59 中風險、60–100 高風險
 */

export const MAX_FILE_BYTES = 8 * 1024 * 1024;   // 8 MB
const SAMPLE_WIDTH = 240;                        // 縮圖後分析，避免大圖凍結畫面

export const RISK_LEVELS = Object.freeze({
  low:    { label: '低風險', tone: 'ok' },
  medium: { label: '中風險', tone: 'warn' },
  high:   { label: '高風險', tone: 'danger' }
});

export const riskLevelLabel = (value) => RISK_LEVELS[value]?.label ?? value;

/** 檔案驗證（FR-065）。回傳 null 代表通過。 */
export function validateImageFile(file) {
  if (!file) return '請選擇一張照片。';
  if (!file.type.startsWith('image/')) return '只接受圖片檔案（JPG、PNG、WebP 等）。';
  if (file.size > MAX_FILE_BYTES) {
    return `檔案大小上限為 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB，請改用較小的圖片。`;
  }
  return null;
}

/**
 * 分析一張圖片。
 *
 * @param {File|Blob} file
 * @returns {Promise<{brightness:number, clutter:number, contrast:number,
 *                    riskScore:number, riskLevel:string, suggestions:string[],
 *                    previewUrl:string, revoke:() => void}>}
 */
export async function analyzeImage(file) {
  const previewUrl = URL.createObjectURL(file);
  const revoke = () => URL.revokeObjectURL(previewUrl);

  try {
    const bitmap = await loadBitmap(previewUrl);
    // 讓出一次繪製機會，處理中狀態才來得及顯示（FR-067：畫面不得凍結）
    await nextFrame();

    const pixels = drawAndSample(bitmap);
    const metrics = computeMetrics(pixels);
    const riskScore = clamp(Math.round(
      100 - (0.4 * metrics.brightness + 0.35 * metrics.clutter + 0.25 * metrics.contrast)
    ), 0, 100);

    return {
      ...metrics,
      riskScore,
      riskLevel: toLevel(riskScore),
      suggestions: buildSuggestions(metrics),
      previewUrl,
      revoke
    };
  } catch (err) {
    revoke();
    throw err;
  }
}

function loadBitmap(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image-decode-failed'));
    img.src = url;
  });
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

function drawAndSample(img) {
  const scale = Math.min(1, SAMPLE_WIDTH / (img.naturalWidth || img.width || SAMPLE_WIDTH));
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}

function computeMetrics({ data, width, height }) {
  const luma = new Float32Array(width * height);
  let sum = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    // Rec. 601 灰階權重
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    luma[p] = y;
    sum += y;
  }

  const mean = sum / luma.length;

  let variance = 0;
  for (let p = 0; p < luma.length; p += 1) {
    const d = luma[p] - mean;
    variance += d * d;
  }
  const stdDev = Math.sqrt(variance / luma.length);

  // 邊緣密度：相鄰像素差異的平均，越高代表畫面越雜亂
  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const idx = y * width + x;
      edgeSum += Math.abs(luma[idx] - luma[idx - 1]) + Math.abs(luma[idx] - luma[idx - width]);
      edgeCount += 1;
    }
  }
  const edgeMean = edgeCount ? edgeSum / edgeCount : 0;

  return {
    brightness: scoreBrightness(mean),
    clutter: scoreClutter(edgeMean),
    contrast: scoreContrast(stdDev),
    raw: { mean: round1(mean), stdDev: round1(stdDev), edgeMean: round1(edgeMean) }
  };
}

/**
 * 亮度計分：太暗與過曝都扣分，理想區間約 105–165。
 * 房間照片偏暗是最常見的問題，因此偏暗的懲罰略重於偏亮。
 */
function scoreBrightness(mean) {
  const ideal = 135;
  const diff = Math.abs(mean - ideal);
  const penalty = mean < ideal ? diff * 1.15 : diff * 0.95;
  return clamp(Math.round(100 - penalty), 0, 100);
}

/** 雜亂度計分：邊緣密度越高分數越低。約 6 以下視為整潔，24 以上視為雜亂。 */
function scoreClutter(edgeMean) {
  const normalized = (edgeMean - 6) / (24 - 6);
  return clamp(Math.round(100 - normalized * 100), 0, 100);
}

/** 對比計分：標準差約 60 為理想，過低灰濛、過高死黑死白。 */
function scoreContrast(stdDev) {
  const ideal = 60;
  const diff = Math.abs(stdDev - ideal);
  return clamp(Math.round(100 - diff * 1.4), 0, 100);
}

function toLevel(riskScore) {
  if (riskScore <= 34) return 'low';
  if (riskScore <= 59) return 'medium';
  return 'high';
}

/** 針對不合格指標給具體且可執行的建議（FR-064） */
function buildSuggestions({ brightness, clutter, contrast, raw }) {
  const out = [];

  if (brightness < 60) {
    out.push(raw.mean < 135
      ? '照片偏暗，建議於白天自然光下重新拍攝，或開啟房內全部燈源後再拍。'
      : '照片偏亮甚至過曝，建議避開直射陽光，或拉上薄紗窗簾柔化光線。');
  } else if (brightness < 80) {
    out.push('亮度尚可，但仍有改善空間。拍攝時可再增加一盞補光。');
  }

  if (clutter < 60) {
    out.push('畫面偏雜亂，建議收起個人物品與電線，整理床鋪與桌面後再拍。');
  } else if (clutter < 80) {
    out.push('畫面大致整齊，可再減少畫面中的零散物件以提升質感。');
  }

  if (contrast < 60) {
    out.push(raw.stdDev < 60
      ? '對比不足，畫面偏灰。建議調整拍攝角度讓明暗層次更明顯。'
      : '對比過強，暗部與亮部細節可能流失。建議避免逆光拍攝。');
  }

  if (!out.length) {
    out.push('三項指標表現良好，照片品質足以呈現房源樣貌。');
  }
  return out;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round1 = (v) => Math.round(v * 10) / 10;
