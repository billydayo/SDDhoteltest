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
import { formatDateTime } from '../utils/dates.js';
import { toUserMessage } from '../utils/errors.js';

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
    id: 'ct-image', name: 'heroImage', label: '首頁主圖網址', value: content?.heroImage ?? '',
    hint: '相對路徑或完整網址。主圖的替代文字會依標題自動產生，因此標題不可留空。'
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
    const src = image.input.value.trim();
    previewImg.src = src;
    previewImg.hidden = !src;
  };
  image.input.addEventListener('input', syncPreview);
  previewImg.addEventListener('error', () => { previewNote.textContent = '預覽：圖片無法載入'; });
  previewImg.addEventListener('load', () => { previewNote.textContent = '預覽'; });
  syncPreview();

  const error = inlineError();

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '儲存並套用';

  form.append(title.wrap, subtitle.wrap, image.wrap, preview, error, buttonRow(submit));

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
