/**
 * 前台「安全檢測」（US9 / T087、T090）。
 *
 * ⚠️ 這條路徑處理的是**使用者的私人照片**。
 *
 *    照片全程留在瀏覽器記憶體內：以 Canvas 分析，以 object URL 預覽，
 *    離開頁面即釋放。它不會被上傳至任何服務，也不會被寫入任何資料表
 *    （FR-086、SC-030）。
 *
 *    因此本檔**刻意不 import**：
 *      - services/risk-upload.js（唯一會上傳圖片的模組）
 *      - data/risk-checks.js（房源檢測的資料層）
 *      - data/repository.js
 *    任務 T116 會檢查這幾條路徑不存在。新增功能時請維持這個界線。
 */

import { render, createPageHeader, createEmptyState } from '../app.js';
import {
  analyzeImage, validateImageFile, riskLevelLabel, RISK_LEVELS, MAX_FILE_BYTES
} from '../services/risk-score.js';

let currentResult = null;   // 保留 revoke() 以便換圖時釋放前一張

export async function renderRiskCheck() {
  releaseCurrent();

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader(
    '安全檢測',
    '上傳一張房間照片，系統會在你的瀏覽器內分析亮度、雜亂度與對比，並給出改善建議。'
  ));

  frag.append(buildPrivacyNotice());

  const resultBox = document.createElement('div');
  frag.append(buildUploadForm(resultBox), resultBox);

  render(frag);
}

/** 隱私聲明。這是本功能最重要的一句話，放在最上方。 */
function buildPrivacyNotice() {
  const box = document.createElement('div');
  box.className = 'simulated-badge';
  box.setAttribute('role', 'note');

  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '🔒';

  const text = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = '照片不會離開你的瀏覽器';
  const p = document.createElement('span');
  p.textContent = '分析全程在本機以 Canvas 完成，照片不會被上傳至任何伺服器，'
    + '也不會被保存。離開或重新整理此頁面後，照片與分析結果即消失。';
  text.append(strong, p);

  box.append(icon, text);
  return box;
}

function buildUploadForm(resultBox) {
  const form = document.createElement('form');
  form.className = 'card';
  form.noValidate = true;

  const wrap = document.createElement('div');
  wrap.className = 'field';

  const label = document.createElement('label');
  label.htmlFor = 'risk-file';
  label.textContent = '選擇房間照片';

  const input = document.createElement('input');
  input.type = 'file';
  input.id = 'risk-file';
  input.name = 'photo';
  input.accept = 'image/*';

  const hint = document.createElement('p');
  hint.className = 'field__hint';
  hint.textContent = `支援 JPG、PNG、WebP 等圖片格式，檔案上限 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB。`;

  const error = document.createElement('p');
  error.className = 'field__error';
  error.hidden = true;
  error.setAttribute('role', 'alert');

  wrap.append(label, input, hint, error);
  form.append(wrap);

  input.addEventListener('change', async () => {
    error.hidden = true;
    const file = input.files?.[0];
    if (!file) return;

    // FR-065：非圖片或超出大小限制時顯示明確錯誤，且不進行分析
    const fileError = validateImageFile(file);
    if (fileError) {
      error.textContent = fileError;
      error.hidden = false;
      resultBox.replaceChildren();
      input.value = '';
      return;
    }

    // FR-067：分析期間顯示處理中狀態，畫面不得凍結
    resultBox.replaceChildren(buildProcessing());

    try {
      // 連續上傳第二張時，先釋放前一張的資源，結果完全取代不殘留（US9 場景 6）
      releaseCurrent();
      const result = await analyzeImage(file);
      currentResult = result;
      resultBox.replaceChildren(buildResult(result));
    } catch {
      resultBox.replaceChildren(createEmptyState({
        title: '無法分析這張照片',
        body: '圖片可能已損毀或格式不受支援，請換一張再試。'
      }));
      input.value = '';
    }
  });

  return form;
}

function buildProcessing() {
  const p = document.createElement('p');
  p.className = 'loading-state';
  p.setAttribute('role', 'status');
  p.textContent = '分析中…';
  return p;
}

function buildResult(result) {
  const section = document.createElement('section');
  section.className = 'card';
  section.style.marginTop = 'var(--sp-4)';

  const h2 = document.createElement('h2');
  h2.textContent = '分析結果';
  section.append(h2);

  const img = document.createElement('img');
  img.src = result.previewUrl;
  img.alt = '你上傳的房間照片預覽';
  img.style.maxWidth = '360px';
  img.style.borderRadius = 'var(--radius)';
  img.style.marginBottom = 'var(--sp-3)';
  section.append(img);

  const level = document.createElement('p');
  const tone = RISK_LEVELS[result.riskLevel]?.tone ?? 'neutral';
  const badge = document.createElement('span');
  badge.className = `tag tag--${tone}`;
  badge.textContent = `${riskLevelLabel(result.riskLevel)}（風險評分 ${result.riskScore}）`;
  level.append(badge);
  section.append(level);

  const metrics = document.createElement('dl');
  metrics.className = 'risk-metrics';
  [
    ['亮度', result.brightness],
    ['雜亂度', result.clutter],
    ['對比', result.contrast]
  ].forEach(([label, value]) => {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    div.append(dt, dd);
    metrics.append(div);
  });
  section.append(metrics);

  const scale = document.createElement('p');
  scale.className = 'field__hint';
  scale.textContent = '三項指標皆為 0–100，數值越高代表該項表現越好；'
    + '總風險評分則相反，數值越高代表風險越高。';
  section.append(scale);

  const h3 = document.createElement('h3');
  h3.textContent = '改善建議';
  section.append(h3);

  const ul = document.createElement('ul');
  result.suggestions.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    ul.append(li);
  });
  section.append(ul);

  const disclaimer = document.createElement('p');
  disclaimer.className = 'field__hint';
  disclaimer.textContent = '本評分以基本影像統計為主，屬輔助參考，並非專業檢測。';
  section.append(disclaimer);

  return section;
}

function releaseCurrent() {
  currentResult?.revoke?.();
  currentResult = null;
}
