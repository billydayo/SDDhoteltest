/**
 * 內容編輯（US8 / T085）。
 *
 * FR-061：編輯首頁標題、副標與主圖，儲存後即時套用至前台。
 * 主圖必須有有意義的替代文字——這由首頁以標題組出，因此標題不可留空。
 */

import { createPageHeader, toast } from '../app.js';
import { getSiteContent, updateSiteContent } from '../data/site-content.js';
import { invalidateSiteContent } from './home.js';
import { withAudit, ACTIONS, diffSummary } from '../services/audit.js';
import { textField, inlineError, showInlineError, buttonRow } from '../components/admin-ui.js';
import { uploadRoomPhoto, deleteRoomPhoto, resolveImageUrl } from '../data/rooms.js';
import { compressImage, validateUpload, formatBytes } from '../utils/image.js';
import { isDemoMode } from '../data/repository.js';
import { formatDateTime } from '../utils/dates.js';
import { toUserMessage } from '../utils/errors.js';

/**
 * 主視覺上傳的存放路徑。
 *
 * 沿用房源照片的 room-photos bucket，只是換一個資料夾——那個 bucket 的
 * RLS 已經是「公開讀取、僅管理員可寫入」，正好是主視覺要的權限。
 * 為此另開一個 bucket 得再寫一份一模一樣的政策，多一份會走樣的東西。
 */
const HERO_FOLDER = 'site';

export async function renderAdminContent(panel) {
  const content = await getSiteContent();

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('內容編輯', '修改首頁主視覺區塊，儲存後前台立即套用。'));

  const form = document.createElement('form');
  form.className = 'card';
  form.noValidate = true;

  const title = textField({
    id: 'ct-title', name: 'heroTitle', label: '首頁標題', value: content?.heroTitle ?? ''
  });
  const subtitle = textField({
    id: 'ct-subtitle', name: 'heroSubtitle', label: '首頁副標', value: content?.heroSubtitle ?? ''
  });
  const image = textField({
    id: 'ct-image', name: 'heroImage', label: '首頁主圖', value: content?.heroImage ?? '',
    hint: '可貼上完整網址或專案內的相對路徑，也可用下方的按鈕從本機上傳。'
      + '主圖的替代文字會依標題自動產生，因此標題不可留空。'
  });

  const error = inlineError();

  /*
   * 本次上傳但尚未儲存的檔案。
   *
   * 憲章「上傳」條：沒有被任何資料列引用的檔案 MUST 被清除。因此
   *   ・再上傳一張 → 先刪掉上一張
   *   ・儲存成功   → 檔案已被 site_content 引用，不再算暫存
   *   ・離開此頁   → 刪掉（掛在 hashchange，見下方）
   */
  let pendingUpload = null;

  const discardPending = async () => {
    if (!pendingUpload) return;
    const ref = pendingUpload;
    pendingUpload = null;
    try { await deleteRoomPhoto(ref); } catch { /* 留下孤兒檔不影響使用者流程 */ }
  };

  const onLeave = () => { discardPending(); };
  window.addEventListener('hashchange', onLeave, { once: true });

  const upload = buildUploadRow({
    onPicked: async (file) => {
      error.hidden = true;
      const invalid = validateUpload(file);
      if (invalid) {
        showInlineError(error, invalid);
        toast(invalid, 'error');
        return;
      }
      upload.setBusy(true);
      try {
        const { blob } = await compressImage(file, { demo: isDemoMode() });
        const ref = await uploadRoomPhoto(HERO_FOLDER, blob);
        await discardPending();          // 換圖時把上一張暫存刪掉
        pendingUpload = ref;
        image.input.value = ref;
        syncPreview();
        toast(`已上傳「${file.name}」（壓縮後 ${formatBytes(blob.size)}），請按儲存套用。`, 'ok');
      } catch (err) {
        showInlineError(error, toUserMessage(err));
      } finally {
        upload.setBusy(false);
      }
    }
  });

  const preview = document.createElement('div');
  preview.className = 'card';
  preview.style.marginTop = 'var(--sp-3)';
  const previewImg = document.createElement('img');
  previewImg.alt = '首頁主圖預覽';
  previewImg.style.maxWidth = '320px';
  previewImg.style.borderRadius = 'var(--radius)';
  const previewNote = document.createElement('p');
  previewNote.className = 'field__hint';
  previewNote.textContent = '預覽';
  preview.append(previewNote, previewImg);

  const syncPreview = () => {
    const raw = image.input.value.trim();
    // 上傳回來的是 storage:<path>，要先轉成可直接放進 src 的網址才畫得出來
    const src = raw ? (resolveImageUrl(raw) ?? raw) : '';
    previewImg.src = src;
    previewImg.hidden = !src;
  };
  image.input.addEventListener('input', syncPreview);
  previewImg.addEventListener('error', () => { previewNote.textContent = '預覽：圖片無法載入'; });
  previewImg.addEventListener('load', () => { previewNote.textContent = '預覽'; });
  syncPreview();

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '儲存並套用';

  form.append(title.wrap, subtitle.wrap, image.wrap, upload.element, preview, error,
    buttonRow(submit));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;

    const patch = {
      heroTitle: title.input.value.trim(),
      heroSubtitle: subtitle.input.value.trim(),
      heroImage: image.input.value.trim()
    };

    if (!patch.heroTitle) return showInlineError(error, '首頁標題不可留空。');

    submit.disabled = true;
    try {
      await withAudit(
        {
          action: ACTIONS.CONTENT_UPDATE, targetTable: 'site_content',
          summary: diffSummary(
            {
              heroTitle: content?.heroTitle,
              heroSubtitle: content?.heroSubtitle,
              heroImage: content?.heroImage
            },
            patch
          )
        },
        () => updateSiteContent(patch)
      );
      // 存成功後這張圖已被 site_content 引用，不再是待清理的暫存檔
      pendingUpload = null;
      window.removeEventListener('hashchange', onLeave);
      // 首頁有快取網站內容，儲存後要讓它重新取得（FR-061 即時套用）
      invalidateSiteContent();
      toast('已儲存，前台首頁已套用新內容。', 'ok');
      renderAdminContent(panel);
    } catch (err) {
      showInlineError(error, toUserMessage(err));
      submit.disabled = false;
    }
  });

  frag.append(form);

  if (content?.updatedAt) {
    const meta = document.createElement('p');
    meta.className = 'field__hint';
    meta.textContent = `最後更新：${formatDateTime(content.updatedAt)}`;
    frag.append(meta);
  }

  panel.replaceChildren(frag);
}

/** 本機上傳列。回傳 element 與一個切換忙碌狀態的函式。 */
function buildUploadRow({ onPicked }) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const label = document.createElement('label');
  label.htmlFor = 'ct-image-file';
  label.textContent = '從本機上傳';

  const input = document.createElement('input');
  input.type = 'file';
  input.id = 'ct-image-file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    // 選完就把 input 清空，否則選同一個檔案第二次不會觸發 change
    input.value = '';
    if (file) onPicked(file);
  });

  const hint = document.createElement('p');
  hint.className = 'field__hint';
  hint.textContent = '上傳後會自動壓縮並填入上方欄位，仍需按「儲存並套用」才會生效。';

  wrap.append(label, input, hint);

  return {
    element: wrap,
    setBusy: (busy) => {
      input.disabled = busy;
      hint.textContent = busy
        ? '上傳中…'
        : '上傳後會自動壓縮並填入上方欄位，仍需按「儲存並套用」才會生效。';
    }
  };
}
