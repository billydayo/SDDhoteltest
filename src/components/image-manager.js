/**
 * 房源照片管理器（後台）。
 *
 * 一間房可以有多張照片，來源可混用：
 *   ・本地上傳（壓縮後存入 room-photos bucket，示範模式存成 data URL）
 *   ・外部網址或專案內的相對路徑
 *
 * 第一張是封面——房源卡片與列表只顯示它，因此順序可調整。
 *
 * 這個元件只維護一份「待儲存的清單」，實際寫入 rooms.images 由表單送出時完成。
 * 上傳則是即時的：檔案一選就壓縮並送到 storage，否則表單要暫存 blob，
 * 送出失敗時還得回頭清理孤兒檔案。
 */

import { uploadRoomPhoto, deleteRoomPhoto } from '../data/rooms.js';
import { resolveImageUrl } from '../data/rooms.js';
import { compressImage, validateUpload, formatBytes } from '../utils/image.js';
import { isDemoMode } from '../data/repository.js';
import { toUserMessage } from '../utils/errors.js';
import { toast } from '../app.js';

export const MAX_PHOTOS = 8;

/**
 * @param {{ roomId: string|null, images: string[], onNotify?: Function }} config
 * @returns {{ element: HTMLElement, getImages: () => string[] }}
 */
export function createImageManager({ roomId, images = [], onNotify = toast }) {
  let list = [...images];
  // 本次工作階段新上傳、但表單尚未送出的檔案。取消編輯時要清掉，避免留下孤兒檔。
  const uploadedThisSession = new Set();

  const wrap = document.createElement('div');
  wrap.className = 'field';

  const label = document.createElement('label');
  label.textContent = '房源照片';
  label.htmlFor = 'rm-photo-file';

  const hint = document.createElement('p');
  hint.className = 'field__hint';
  hint.textContent = `最多 ${MAX_PHOTOS} 張。第一張為封面，會顯示在房源列表。`
    + '上傳的圖片會自動壓縮，不需要事先處理。';

  const grid = document.createElement('div');
  grid.className = 'photo-grid';

  const error = document.createElement('p');
  error.className = 'field__error';
  error.hidden = true;

  wrap.append(label, hint, grid, error, buildControls());
  paint();

  // -------------------------------------------------------------------------

  /**
   * 失敗訊息同時走行內錯誤與 toast。
   *
   * 只有行內那行紅字時，成功會跳 toast、失敗卻只在照片格下方多一行 --f-tiny 的字，
   * 而使用者的視線正停在畫面下方的「選擇檔案」按鈕上——驗收時就發生過
   * 「選了非圖片檔卻以為沒反應」。成敗兩條路的顯眼程度必須對等。
   */
  function fail(message) {
    error.textContent = message;
    error.hidden = false;
    onNotify(message, 'error');
  }

  function clearError() {
    error.hidden = true;
    error.textContent = '';
  }

  function paint() {
    grid.replaceChildren();

    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'photo-grid__empty';
      empty.textContent = '尚未加入照片。房源列表會顯示預設的佔位圖。';
      grid.append(empty);
      return;
    }

    list.forEach((ref, index) => grid.append(buildTile(ref, index)));
  }

  function buildTile(ref, index) {
    const tile = document.createElement('figure');
    tile.className = 'photo-tile';

    const img = document.createElement('img');
    img.src = resolveImageUrl(ref);
    img.alt = index === 0 ? '封面照片預覽' : `第 ${index + 1} 張照片預覽`;
    img.loading = 'lazy';
    tile.append(img);

    if (index === 0) {
      const badge = document.createElement('span');
      badge.className = 'photo-tile__badge';
      badge.textContent = '封面';
      tile.append(badge);
    }

    const actions = document.createElement('div');
    actions.className = 'photo-tile__actions';

    if (index > 0) {
      actions.append(iconButton('←', '往前移一位', () => {
        [list[index - 1], list[index]] = [list[index], list[index - 1]];
        clearError();
        paint();
      }));
    }
    if (index < list.length - 1) {
      actions.append(iconButton('→', '往後移一位', () => {
        [list[index], list[index + 1]] = [list[index + 1], list[index]];
        clearError();
        paint();
      }));
    }
    actions.append(iconButton('✕', '移除這張照片', () => remove(index), 'danger'));

    tile.append(actions);
    return tile;
  }

  async function remove(index) {
    const [ref] = list.splice(index, 1);
    clearError();
    paint();

    // 只刪本次上傳的檔案。既有的照片要等表單真的送出才刪，
    // 否則使用者按了取消編輯，檔案卻已經不見了。
    if (uploadedThisSession.has(ref)) {
      uploadedThisSession.delete(ref);
      try {
        await deleteRoomPhoto(ref);
      } catch {
        // 刪不掉只是留下一個沒被引用的檔案，不影響使用者流程
      }
    }
  }

  function buildControls() {
    const row = document.createElement('div');
    row.className = 'photo-controls';

    // --- 本地上傳 ---
    const fileWrap = document.createElement('div');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'rm-photo-file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));
    fileWrap.append(fileInput);

    // --- 網址 ---
    const urlWrap = document.createElement('div');
    urlWrap.className = 'photo-controls__url';

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.placeholder = '或貼上圖片網址';
    urlInput.setAttribute('aria-label', '以網址加入照片');

    const addUrl = document.createElement('button');
    addUrl.type = 'button';
    addUrl.className = 'btn';
    addUrl.textContent = '加入網址';
    addUrl.addEventListener('click', () => {
      const value = urlInput.value.trim();
      if (!value) return;
      if (list.length >= MAX_PHOTOS) return fail(`最多只能加入 ${MAX_PHOTOS} 張照片。`);
      if (list.includes(value)) return fail('這張照片已經在清單中。');

      list.push(value);
      urlInput.value = '';
      clearError();
      paint();
    });

    urlWrap.append(urlInput, addUrl);
    row.append(fileWrap, urlWrap);
    return row;
  }

  async function handleFiles(files) {
    clearError();
    if (!files.length) return;

    const room = roomId ?? 'pending';
    let added = 0;

    for (const file of files) {
      if (list.length >= MAX_PHOTOS) {
        fail(`最多只能加入 ${MAX_PHOTOS} 張照片，其餘已略過。`);
        break;
      }

      const invalid = validateUpload(file);
      if (invalid) { fail(invalid); continue; }

      try {
        const { blob } = await compressImage(file, { demo: isDemoMode() });
        const ref = await uploadRoomPhoto(room, blob);
        list.push(ref);
        uploadedThisSession.add(ref);
        added += 1;
        onNotify(`已加入「${file.name}」（壓縮後 ${formatBytes(blob.size)}）`, 'ok');
      } catch (err) {
        fail(toUserMessage(err));
      }
    }

    if (added) paint();
  }

  return {
    element: wrap,
    getImages: () => [...list],
    /** 取消編輯時呼叫：清掉本次上傳但未被保存的檔案 */
    discardUnsaved: async () => {
      for (const ref of uploadedThisSession) {
        try { await deleteRoomPhoto(ref); } catch { /* 同上，留下孤兒檔不影響流程 */ }
      }
      uploadedThisSession.clear();
    },
    /** 表單送出成功後呼叫：這些檔案已被房源引用，不再算是待清理 */
    commit: () => uploadedThisSession.clear()
  };
}

function iconButton(glyph, label, onClick, variant = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `photo-tile__btn${variant ? ` photo-tile__btn--${variant}` : ''}`;
  btn.textContent = glyph;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.addEventListener('click', onClick);
  return btn;
}
