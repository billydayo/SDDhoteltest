/**
 * 後台房源品質檢測（US9 / T091、T092、T093）。
 *
 * 與前台安全檢測的差別：這裡處理的是**飯店自有的房間照片**，檢測結果與圖片
 * 會公開顯示於房源詳情頁，因此需要儲存。儲存前必須明確告知管理員該圖將公開
 * （FR-105）。
 *
 * 分析邏輯與前台共用 services/risk-score.js；儲存則走 services/risk-upload.js，
 * 那是唯一會上傳圖片的模組。
 */

import { createPageHeader, toast } from '../app.js';
import { listRooms } from '../data/rooms.js';
import { listRiskChecks } from '../data/risk-checks.js';
import { saveRoomCheck, PUBLIC_DISCLOSURE_NOTICE } from '../services/risk-upload.js';
import {
  analyzeImage, validateImageFile, riskLevelLabel, RISK_LEVELS, MAX_FILE_BYTES
} from '../services/risk-score.js';
import { withAudit, ACTIONS } from '../services/audit.js';
import {
  createDataTable, createEmptyRow, selectField, inlineError, showInlineError,
  confirmAction, statusTag
} from '../components/admin-ui.js';
import { formatDateTime } from '../utils/dates.js';
import { toUserMessage } from '../utils/errors.js';

let pending = null;   // { file, result } 分析完成、等待儲存

export async function renderAdminRisk(panel, context) {
  const [rooms, checks] = await Promise.all([
    listRooms({}),
    listRiskChecks({}).catch(() => [])
  ]);

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader(
    '房源品質檢測',
    '為房源上傳照片並產生品質檢測結果，通過後會公開顯示於該房源的詳情頁。'
  ));

  frag.append(buildNotice());
  frag.append(buildForm(rooms, panel, context));
  frag.append(buildHistory(checks, rooms));

  panel.replaceChildren(frag);
}

const reload = (panel, context) => renderAdminRisk(panel, context);

function buildNotice() {
  const box = document.createElement('div');
  box.className = 'simulated-badge';
  box.setAttribute('role', 'note');

  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '👁';

  const text = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = '此處上傳的圖片會公開';
  const p = document.createElement('span');
  p.textContent = '與前台「安全檢測」不同，這裡儲存的照片會顯示在房源詳情頁供所有訪客瀏覽。'
    + '請只上傳飯店自有的房間照片，且不含可辨識的人物。';
  text.append(strong, p);

  box.append(icon, text);
  return box;
}

function buildForm(rooms, panel, context) {
  const form = document.createElement('form');
  form.className = 'card';
  form.style.marginBottom = 'var(--sp-5)';
  form.noValidate = true;

  if (!rooms.length) {
    form.append(createEmptyRow('尚無房源，請先於房源管理新增。'));
    return form;
  }

  const room = selectField({
    id: 'risk-room', name: 'roomId', label: '選擇房源',
    options: rooms.map((r) => ({ value: r.id, label: r.name }))
  });

  const fileWrap = document.createElement('div');
  fileWrap.className = 'field';
  const fileLabel = document.createElement('label');
  fileLabel.htmlFor = 'risk-admin-file';
  fileLabel.textContent = '房間照片';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'risk-admin-file';
  fileInput.accept = 'image/*';
  const fileHint = document.createElement('p');
  fileHint.className = 'field__hint';
  fileHint.textContent = `檔案上限 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB。`;
  fileWrap.append(fileLabel, fileInput, fileHint);

  const error = inlineError();
  const resultBox = document.createElement('div');

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn--primary';
  save.textContent = '儲存檢測結果';
  save.disabled = true;

  form.append(room.wrap, fileWrap, error, resultBox, save);

  fileInput.addEventListener('change', async () => {
    error.hidden = true;
    save.disabled = true;
    releasePending();

    const file = fileInput.files?.[0];
    if (!file) { resultBox.replaceChildren(); return; }

    const fileError = validateImageFile(file);
    if (fileError) {
      showInlineError(error, fileError);
      resultBox.replaceChildren();
      fileInput.value = '';
      return;
    }

    const loading = document.createElement('p');
    loading.className = 'loading-state';
    loading.setAttribute('role', 'status');
    loading.textContent = '分析中…';
    resultBox.replaceChildren(loading);

    try {
      const result = await analyzeImage(file);
      pending = { file, result };
      resultBox.replaceChildren(buildPreview(result));
      save.disabled = false;
    } catch {
      showInlineError(error, '無法分析這張照片，請換一張再試。');
      resultBox.replaceChildren();
      fileInput.value = '';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pending) return;
    error.hidden = true;

    // FR-105：儲存前必須明確告知將公開顯示，並取得確認
    if (!confirmAction(PUBLIC_DISCLOSURE_NOTICE)) return;

    save.disabled = true;
    save.textContent = '儲存中…';
    try {
      const roomId = room.input.value;
      await withAudit(
        {
          action: ACTIONS.RISK_CHECK_SAVE, targetTable: 'room_risk_checks', targetId: roomId,
          summary: {
            roomId,
            riskScore: pending.result.riskScore,
            riskLevel: pending.result.riskLevel
          }
        },
        () => saveRoomCheck({ roomId, file: pending.file, metrics: pending.result })
      );
      toast('檢測結果已儲存，房源詳情頁已更新。', 'ok');
      releasePending();
      reload(panel, context);
    } catch (err) {
      showInlineError(error, toUserMessage(err));
      save.disabled = false;
      save.textContent = '儲存檢測結果';
    }
  });

  return form;
}

function buildPreview(result) {
  const box = document.createElement('div');
  box.className = 'risk-panel';
  box.style.marginBottom = 'var(--sp-3)';

  const img = document.createElement('img');
  img.src = result.previewUrl;
  img.alt = '待儲存的房間照片預覽';
  img.style.maxWidth = '320px';
  img.style.borderRadius = 'var(--radius)';

  const level = document.createElement('p');
  level.style.margin = '0';
  const tone = RISK_LEVELS[result.riskLevel]?.tone ?? 'neutral';
  level.append(statusTag(`${riskLevelLabel(result.riskLevel)}（風險評分 ${result.riskScore}）`, tone));

  const metrics = document.createElement('dl');
  metrics.className = 'risk-metrics';
  [['亮度', result.brightness], ['雜亂度', result.clutter], ['對比', result.contrast]]
    .forEach(([label, value]) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      div.append(dt, dd);
      metrics.append(div);
    });

  const ul = document.createElement('ul');
  result.suggestions.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    ul.append(li);
  });

  box.append(img, level, metrics, ul);
  return box;
}

function buildHistory(checks, rooms) {
  const section = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent = '已完成的檢測';
  section.append(h2);

  if (!checks.length) {
    section.append(createEmptyRow('尚未為任何房源完成檢測。'));
    return section;
  }

  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const rows = checks.map((check) => [
    roomById.get(check.roomId)?.name ?? '（房源已下架）',
    statusTag(riskLevelLabel(check.riskLevel), RISK_LEVELS[check.riskLevel]?.tone ?? 'neutral'),
    String(check.riskScore),
    String(check.brightness),
    String(check.clutter),
    String(check.contrast),
    formatDateTime(check.createdAt)
  ]);

  section.append(createDataTable(
    ['房源', '風險等級', '總分', '亮度', '雜亂度', '對比', '檢測時間'],
    rows
  ));

  const note = document.createElement('p');
  note.className = 'field__hint';
  note.textContent = '重新檢測同一房源時，舊的紀錄與圖片會被移除，詳情頁只顯示最新一次結果。';
  section.append(note);

  return section;
}

function releasePending() {
  pending?.result?.revoke?.();
  pending = null;
}
