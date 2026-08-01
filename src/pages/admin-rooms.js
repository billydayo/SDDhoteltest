/**
 * 房源管理（US6 / T076）。
 *
 * FR-050：新增、編輯、刪除房源。
 * FR-051：調整房態。
 * FR-052：刪除仍有未來有效訂單的房源必須警告並二次確認。
 *
 * 每個變更都經 withAudit 包裝——改了卻沒留下紀錄是不被允許的（FR-114）。
 */

import { createPageHeader, toast, toastError } from '../app.js';
import {
  listRooms, createRoom, updateRoom, deleteRoom, setRoomStatus, getFutureOrdersForRoom,
  getOccupiedRoomIds, effectiveRoomStatus
} from '../data/rooms.js';
import { withAudit, ACTIONS, diffSummary } from '../services/audit.js';
import {
  createDataTable, createEmptyRow, textField, selectField, textareaField,
  checkboxGroup, actionButton, confirmAction, inlineError, showInlineError,
  statusTag, buttonRow, createExportButton, openModal
} from '../components/admin-ui.js';
import { createImageManager } from '../components/image-manager.js';
import { ROOM_TYPES, ROOM_STATUS, roomStatusLabel, typeLabel } from '../data/vocabulary.js';
import {
  getRoomVocabulary, saveRoomVocabulary, validateTerm, MAX_TERMS
} from '../data/room-vocabulary.js';
import { formatTWD } from '../utils/money.js';
import { formatDateRange, formatDate, addDays, isValidDateString } from '../utils/dates.js';
import { toUserMessage } from '../utils/errors.js';

/**
 * 可由管理員人工設定的房態。
 * 'booked' 不在其中——它由當日訂單推導，見 data/rooms.js 的 effectiveRoomStatus。
 */
const MANUAL_ROOM_STATUSES = ['available', 'maintenance'];

// 編輯中的房源改為參數傳遞，不再是模組層的狀態——
// 表單只存在於浮窗的生命週期內，用模組變數保存反而要處理它何時該被清掉。

let filters = { keyword: '', type: '', status: '', minPrice: '', maxPrice: '', date: '' };

const emptyFilters = () =>
  ({ keyword: '', type: '', status: '', minPrice: '', maxPrice: '', date: '' });

export async function renderAdminRooms(panel, context) {
  const [rooms, vocabulary] = await Promise.all([listRooms({}), getRoomVocabulary()]);

  // 房態逐日獨立：選了日期才知道哪些房「當天」被訂走。
  // 沒選日期時 occupied 為 null，房態退回房源本身的營運狀態。
  const occupied = filters.date
    ? await getOccupiedRoomIds(filters.date, addDays(filters.date, 1)).catch(() => null)
    : null;

  const filtered = applyFilters(rooms, occupied);

  const frag = document.createDocumentFragment();
  frag.append(createPageHeader('房源管理', roomsSummary(rooms.length)));
  frag.append(buildCreateBar(panel, context, vocabulary));
  frag.append(buildFilterForm(panel, context));
  frag.append(buildTable(filtered, rooms.length, occupied, panel, context, vocabulary));

  panel.replaceChildren(frag);
}

/**
 * 新增入口。表單本體改放浮窗，列表因此能待在第一屏——
 * 原本的做法是把整份表單常駐在頁首，光是設施與特色的勾選框就把清單推到摺線以下，
 * 而管理員進這一頁十次有九次是來看清單的。
 */
function buildCreateBar(panel, context, vocabulary) {
  const bar = document.createElement('div');
  bar.className = 'filter-bar__actions';
  bar.style.marginBottom = 'var(--sp-4)';

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn--primary';
  add.textContent = '新增房源';
  add.addEventListener('click', () => openRoomForm(panel, context, vocabulary));

  // 詞彙管理放在房源管理底下而非另開一頁：管理員是在填房源表單時
  // 才會發現「這個設施清單裡沒有」，入口就該在那個當下伸手可及的地方
  bar.append(add, actionButton('管理設施／特色', () => openVocabularyForm(panel, context)));
  return bar;
}

/**
 * 開啟新增／編輯浮窗。
 *
 * 未保存的上傳一律由浮窗的 onClose 清掉，不論使用者是按取消、按 ✕ 還是按 Esc——
 * 只掛在取消鈕上的話，按 Esc 就會在 storage 留下沒人引用的檔案（憲章「上傳」條）。
 */
function openRoomForm(panel, context, vocabulary, room = null) {
  const photosRef = {};
  const dialog = openModal({
    title: room ? `編輯房源：${room.name}` : '新增房源',
    content: buildForm(panel, context, room, photosRef, () => dialog.close(), vocabulary),
    onClose: () => photosRef.current?.discardUnsaved()
  });
}

/**
 * 設施／房型特色的增刪（FR-010a）。
 *
 * 兩份清單同時編輯、一起儲存。分成兩個浮窗的話，管理員新增一個設施再新增一個特色
 * 就要開關兩次，而這兩件事幾乎總是一起做。
 */
function openVocabularyForm(panel, context) {
  const dialog = openModal({
    title: '管理設施／特色',
    content: buildVocabularyForm(panel, context, () => dialog.close())
  });
}

function buildVocabularyForm(panel, context, close) {
  const form = document.createElement('form');
  form.className = 'card';
  form.noValidate = true;

  const intro = document.createElement('p');
  intro.className = 'field__hint';
  intro.textContent = '這兩份清單同時決定前台搜尋列的篩選選項與房源表單的可勾選項目。'
    + `每份最多 ${MAX_TERMS} 項。`;
  form.append(intro);

  const error = inlineError();

  // 目前值先複製一份在本地改，按儲存才寫回——中途按取消不該留下任何痕跡
  const editors = {
    amenities: buildTermEditor('設施', 'amenities', error),
    features: buildTermEditor('房型特色', 'features', error)
  };

  form.append(editors.amenities.element, editors.features.element, error);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '儲存';
  form.append(buttonRow(submit, actionButton('取消', () => close())));

  getRoomVocabulary().then((vocab) => {
    editors.amenities.setTerms(vocab.amenities);
    editors.features.setTerms(vocab.features);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      // 兩份清單分開寫：system_settings 是一列一個 key，沒有跨列交易可用。
      // 先寫設施再寫特色，任一失敗都會讓錯誤浮上來，不會靜靜地只成功一半。
      await withAudit(
        {
          action: ACTIONS.SETTING_UPDATE, targetTable: 'system_settings',
          summary: {
            amenities: editors.amenities.getTerms().length,
            features: editors.features.getTerms().length
          }
        },
        async () => {
          await saveRoomVocabulary('amenities', editors.amenities.getTerms());
          await saveRoomVocabulary('features', editors.features.getTerms());
        }
      );
      toast('已儲存。前台篩選器與房源表單已套用新的清單。', 'ok');
      close();
      reload(panel, context);
    } catch (err) {
      showInlineError(error, toUserMessage(err));
      submit.disabled = false;
    }
  });

  return form;
}

/** 一份清單的編輯器：現有項目可逐一移除，下方一列可新增 */
function buildTermEditor(legendText, kind, error) {
  let terms = [];

  const fs = document.createElement('fieldset');
  fs.style.border = 'none';
  fs.style.padding = '0';
  fs.style.margin = '0 0 var(--sp-5)';

  const legend = document.createElement('legend');
  legend.textContent = legendText;
  fs.append(legend);

  const list = document.createElement('div');
  list.className = 'filter-group__options';
  fs.append(list);

  const addWrap = document.createElement('div');
  addWrap.style.display = 'flex';
  addWrap.style.gap = 'var(--sp-2)';
  addWrap.style.marginTop = 'var(--sp-3)';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = `vocab-${kind}-new`;
  input.setAttribute('aria-label', `新增${legendText}`);
  input.placeholder = `新增${legendText}…`;

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn';
  add.textContent = '加入';

  const commit = () => {
    const value = input.value.trim();
    const invalid = validateTerm(value, terms);
    if (invalid) { showInlineError(error, invalid); return; }
    error.hidden = true;
    terms = [...terms, value];
    input.value = '';
    paint();
    input.focus();
  };

  add.addEventListener('click', commit);
  // Enter 直接加入。不攔的話會觸發表單 submit，變成「打完字按 Enter 就整份存檔」
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
  });

  addWrap.append(input, add);
  fs.append(addWrap);

  function paint() {
    list.replaceChildren();
    if (!terms.length) {
      const empty = document.createElement('p');
      empty.className = 'field__hint';
      empty.textContent = '目前沒有任何項目。清單為空時，前台不會顯示這一組篩選。';
      list.append(empty);
      return;
    }
    terms.forEach((term, index) => {
      const chip = document.createElement('span');
      chip.className = 'check-chip';

      const label = document.createElement('span');
      label.textContent = term;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'photo-tile__btn photo-tile__btn--danger';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `移除${term}`);
      remove.title = `移除${term}`;
      remove.addEventListener('click', () => {
        terms = terms.filter((_, i) => i !== index);
        error.hidden = true;
        paint();
      });

      chip.append(label, remove);
      list.append(chip);
    });
  }

  paint();

  return {
    element: fs,
    getTerms: () => [...terms],
    setTerms: (next) => { terms = [...next]; paint(); }
  };
}

function roomsSummary(total) {
  return filters.date
    ? `共 ${total} 間房源。房態為 ${formatDate(filters.date)} 當天的狀態。`
    : `共 ${total} 間房源。選擇日期可查看該日的實際房態。`;
}

// ---------------------------------------------------------------------------
// 篩選
//
// 在已取得的清單上做，不再打一次資料庫——房源數量是幾十筆的量級，
// 本地過濾比往返一趟快，也讓匯出能直接沿用同一份結果。
// ---------------------------------------------------------------------------

function applyFilters(rooms, occupied) {
  return rooms.filter((room) => {
    if (filters.keyword) {
      // 關鍵字同時涵蓋房名、描述、設施與特色，省下另外一組勾選框
      const haystack = [
        room.name, room.description,
        ...(room.amenities ?? []), ...(room.features ?? [])
      ].join(' ').toLowerCase();
      if (!haystack.includes(filters.keyword.trim().toLowerCase())) return false;
    }
    if (filters.type && room.type !== filters.type) return false;
    // 比對推導後的房態，否則選了日期再篩「已預訂」永遠是空的
    if (filters.status && effectiveRoomStatus(room, occupied) !== filters.status) return false;

    const min = Number(filters.minPrice);
    const max = Number(filters.maxPrice);
    if (filters.minPrice && Number.isFinite(min) && room.nightlyPrice < min) return false;
    if (filters.maxPrice && Number.isFinite(max) && room.nightlyPrice > max) return false;

    return true;
  });
}

const hasFilters = () => Object.values(filters).some((v) => v !== '');

function buildFilterForm(panel, context) {
  const form = document.createElement('form');
  form.className = 'filter-bar';
  form.noValidate = true;

  const keyword = textField({
    id: 'rm-f-kw', name: 'keyword', label: '關鍵字', value: filters.keyword,
    attrs: { placeholder: '房名、描述、設施或特色' }
  });
  const type = selectField({
    id: 'rm-f-type', name: 'type', label: '房型', value: filters.type,
    options: [{ value: '', label: '全部房型' },
      ...ROOM_TYPES.map((t) => ({ value: t.value, label: t.label }))]
  });
  // 日期在房態之前：先決定看哪一天，房態才有意義
  const date = textField({
    id: 'rm-f-date', name: 'date', label: '日期', type: 'date', value: filters.date,
    attrs: { 'aria-describedby': 'rm-f-date-hint' }
  });
  const dateHint = document.createElement('p');
  dateHint.id = 'rm-f-date-hint';
  dateHint.className = 'field__hint';
  dateHint.textContent = '房態逐日獨立：8/1 已預訂不代表 8/2 也已預訂。';
  date.wrap.append(dateHint);

  const status = selectField({
    id: 'rm-f-status', name: 'status', label: '房態', value: filters.status,
    options: [{ value: '', label: '全部房態' },
      ...Object.keys(ROOM_STATUS).map((s) => ({ value: s, label: roomStatusLabel(s) }))]
  });
  const minPrice = textField({
    id: 'rm-f-min', name: 'minPrice', label: '價格下限', type: 'number', value: filters.minPrice,
    attrs: { min: '0', step: '1', inputmode: 'numeric', class: 'no-spin' }
  });
  const maxPrice = textField({
    id: 'rm-f-max', name: 'maxPrice', label: '價格上限', type: 'number', value: filters.maxPrice,
    attrs: { min: '0', step: '1', inputmode: 'numeric', class: 'no-spin' }
  });

  const row = document.createElement('div');
  row.className = 'filter-bar__row';
  row.append(keyword.wrap, type.wrap, date.wrap, status.wrap, minPrice.wrap, maxPrice.wrap);
  form.append(row);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = '篩選';

  const clear = actionButton('清除條件', () => {
    filters = emptyFilters();
    reload(panel, context);
  });

  form.append(buttonRow(submit, clear));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const min = Number(minPrice.input.value);
    const max = Number(maxPrice.input.value);

    // 上下限寫反時直接說明，而不是回傳一個空清單讓人以為沒有房源
    if (minPrice.input.value && maxPrice.input.value && min > max) {
      toast('價格下限不可大於上限。', 'error');
      return;
    }

    // 日期打錯就直說。若放行，推導出的房態會全部退回營運狀態，
    // 畫面看起來正常但答案是錯的——那比報錯難查得多。
    if (date.input.value && !isValidDateString(date.input.value)) {
      toast('日期格式不正確，請重新選擇。', 'error');
      return;
    }

    // 篩「已預訂」卻沒指定日期是問不出答案的：已預訂本來就綁日期
    if (status.input.value === 'booked' && !date.input.value) {
      toast('請先選擇日期，才能查詢當天的已預訂房源。', 'error');
      return;
    }

    filters = {
      keyword: keyword.input.value,
      type: type.input.value,
      status: status.input.value,
      minPrice: minPrice.input.value,
      maxPrice: maxPrice.input.value,
      date: date.input.value
    };
    reload(panel, context);
  });

  return form;
}

const reload = (panel, context) => renderAdminRooms(panel, context);

// ---------------------------------------------------------------------------
// 新增 / 編輯表單
// ---------------------------------------------------------------------------

function buildForm(panel, context, room, photosRef, close, vocabulary) {
  // 標題由浮窗的 __head 提供，表單自己不再放一個 h2，否則畫面上會出現兩行一樣的字
  const form = document.createElement('form');
  form.className = 'card';
  form.noValidate = true;

  const name = textField({ id: 'rm-name', name: 'name', label: '房名', value: room?.name ?? '' });
  const type = selectField({
    id: 'rm-type', name: 'type', label: '房型', value: room?.type ?? 'double',
    options: ROOM_TYPES.map((t) => ({ value: t.value, label: t.label }))
  });
  const maxGuests = textField({
    id: 'rm-guests', name: 'maxGuests', label: '人數上限', type: 'number',
    value: room?.maxGuests ?? 2, attrs: { min: '1', step: '1' }
  });
  const price = textField({
    id: 'rm-price', name: 'nightlyPrice', label: '每晚價格（新臺幣）', type: 'number',
    value: room?.nightlyPrice ?? 2000,
    // step 為 1：價格可以是任意正整數，不該被限制成 100 的倍數
    attrs: { min: '1', step: '1', inputmode: 'numeric', class: 'no-spin' }
  });
  // 只提供可人工設定的兩種。「已預訂」由訂單推導，手動設了也會被下一筆訂單的
  // 實際狀況推翻，而且沒有任何機制在退房後把它改回來——留著只會讓房間永久下架。
  const status = selectField({
    id: 'rm-status', name: 'status', label: '房態',
    value: room?.status === 'maintenance' ? 'maintenance' : 'available',
    options: MANUAL_ROOM_STATUSES.map((s) => ({ value: s, label: roomStatusLabel(s) })),
    hint: '「整理中」會被排除於可訂清單之外。'
      + '「已預訂」由當日訂單自動判定，不需要也無法在此設定。'
  });
  const description = textareaField({
    id: 'rm-desc', name: 'description', label: '房源描述', value: room?.description ?? ''
  });

  // 多張照片：可本地上傳，也可貼網址；第一張為封面
  const photos = createImageManager({
    roomId: room?.id ?? null,
    images: room?.images ?? []
  });
  // 交給浮窗，讓它在任何關閉途徑後都能清掉未保存的上傳
  photosRef.current = photos;

  const row = document.createElement('div');
  row.className = 'filter-bar__row';
  row.append(name.wrap, type.wrap, maxGuests.wrap, price.wrap, status.wrap);
  form.append(row, photos.element, description.wrap);

  const amenities = checkboxGroup({
    name: 'amenities', legend: '設施', options: vocabulary.amenities, selected: room?.amenities ?? []
  });
  const features = checkboxGroup({
    name: 'features', legend: '房型特色', options: vocabulary.features, selected: room?.features ?? []
  });
  form.append(amenities, features);

  const error = inlineError();
  form.append(error);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn--primary';
  submit.textContent = room ? '儲存變更' : '新增房源';

  // 未保存的上傳由浮窗的 onClose 統一清掉，這裡只要關窗即可
  const cancel = actionButton(room ? '取消編輯' : '取消', () => close());

  form.append(buttonRow(submit, cancel));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;

    const input = {
      name: name.input.value.trim(),
      type: type.input.value,
      maxGuests: Number(maxGuests.input.value),
      nightlyPrice: Number(price.input.value),
      status: status.input.value,
      description: description.input.value.trim(),
      images: photos.getImages(),
      amenities: [...form.querySelectorAll('input[name="amenities"]:checked')].map((i) => i.value),
      features: [...form.querySelectorAll('input[name="features"]:checked')].map((i) => i.value)
    };

    if (!input.name) return showInlineError(error, '請填寫房名。');
    if (!Number.isInteger(input.maxGuests) || input.maxGuests < 1) {
      return showInlineError(error, '人數上限需為大於 0 的整數。');
    }
    if (!Number.isInteger(input.nightlyPrice) || input.nightlyPrice < 1) {
      return showInlineError(error, '每晚價格需為大於 0 的整數。');
    }

    submit.disabled = true;
    try {
      if (room) {
        await withAudit(
          {
            action: ACTIONS.ROOM_UPDATE, targetTable: 'rooms', targetId: room.id,
            summary: diffSummary(room, input)
          },
          () => updateRoom(room.id, input)
        );
        toast('房源已更新。', 'ok');
      } else {
        await withAudit(
          { action: ACTIONS.ROOM_CREATE, targetTable: 'rooms', summary: { name: input.name } },
          () => createRoom(input)
        );
        toast('房源已新增。', 'ok');
      }
      // 儲存成功後這些照片已被房源引用，不再是待清理的暫存檔。
      // 必須在關窗之前 commit——onClose 會呼叫 discardUnsaved，
      // 沒先 commit 的話剛存好的照片會被當成孤兒檔刪掉。
      photos.commit();
      close();
      reload(panel, context);
    } catch (err) {
      showInlineError(error, toUserMessage(err));
      submit.disabled = false;
    }
  });

  return form;
}

// ---------------------------------------------------------------------------
// 房源清單
// ---------------------------------------------------------------------------

const ROOM_EXPORT_COLUMNS = [
  { key: 'name', label: '房名' },
  { key: 'typeLabel', label: '房型' },
  { key: 'maxGuests', label: '人數上限' },
  { key: 'nightlyPrice', label: '每晚價格' },
  { key: 'statusLabel', label: '房態' },
  { key: 'ratingText', label: '平均評分' },
  { key: 'amenities', label: '設施' },
  { key: 'features', label: '房型特色' }
];

function buildTable(rooms, totalCount, occupied, panel, context, vocabulary) {
  const section = document.createElement('section');

  const head = document.createElement('div');
  head.style.display = 'flex';
  head.style.justifyContent = 'space-between';
  head.style.alignItems = 'center';
  head.style.gap = 'var(--sp-3)';
  head.style.flexWrap = 'wrap';

  const h2 = document.createElement('h2');
  h2.style.margin = '0';
  // 有篩選時同時顯示符合筆數與總數，才看得出來是不是條件下得太窄
  h2.textContent = hasFilters()
    ? `房源清單（${rooms.length} / ${totalCount}）`
    : '房源清單';

  // 匯出跟著篩選走，與訂單管理一致（FR-058、SC-033）
  head.append(h2, createExportButton({
    label: hasFilters() ? '匯出目前結果' : '匯出房源',
    filename: 'sunny-rooms',
    sheetName: '房源',
    columns: ROOM_EXPORT_COLUMNS,
    notify: toast,
    getRows: () => rooms.map((r) => ({
      ...r,
      typeLabel: typeLabel(r.type),
      // 匯出與畫面看到的房態必須是同一個，否則對帳時會各說各話
      statusLabel: roomStatusLabel(effectiveRoomStatus(r, occupied)),
      // 尚無評分時輸出文字而非 0，與畫面一致（FR-047）
      ratingText: r.averageRating === null ? '尚無評分' : String(r.averageRating)
    }))
  }));
  section.append(head);

  if (!rooms.length) {
    section.append(createEmptyRow(
      hasFilters()
        ? '沒有符合條件的房源。請調整或清除篩選條件後再試。'
        : '尚無房源，請由上方表單新增。'
    ));
    return section;
  }

  const rows = rooms.map((room) => {
    const status = effectiveRoomStatus(room, occupied);
    return [
      room.name,
      typeLabel(room.type),
      `${room.maxGuests} 人`,
      formatTWD(room.nightlyPrice),
      statusTag(roomStatusLabel(status), ROOM_STATUS[status]?.tone ?? 'neutral'),
      room.averageRating === null ? '尚無評分' : String(room.averageRating),
      buildRowActions(room, panel, context, vocabulary)
    ];
  });

  section.append(createDataTable(
    [
      '房名', '房型', '人數', '價格',
      filters.date ? `房態（${formatDate(filters.date)}）` : '房態',
      '評分', '操作'
    ],
    rows
  ));
  return section;
}

function buildRowActions(room, panel, context, vocabulary) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.gap = 'var(--sp-1)';

  // 表單開在浮窗裡，因此不必再重繪整頁、也不必把畫面捲回頂端
  wrap.append(actionButton('編輯', () => openRoomForm(panel, context, vocabulary, room)));

  // 房態快速切換（FR-051）
  const nextStatus = room.status === 'maintenance' ? 'available' : 'maintenance';
  wrap.append(actionButton(
    nextStatus === 'maintenance' ? '設為整理中' : '設為空房',
    async () => {
      try {
        await withAudit(
          {
            action: ACTIONS.ROOM_STATUS, targetTable: 'rooms', targetId: room.id,
            summary: { status: { from: room.status, to: nextStatus } }
          },
          () => setRoomStatus(room.id, nextStatus)
        );
        toast('房態已更新。', 'ok');
        reload(panel, context);
      } catch (err) {
        toastError(err);
      }
    }
  ));

  wrap.append(actionButton('刪除', () => handleDelete(room, panel, context), 'danger'));
  return wrap;
}

/** FR-052：仍有未來有效訂單時警告並列出受影響訂單，需二次確認 */
async function handleDelete(room, panel, context) {
  let futureOrders = [];
  try {
    futureOrders = await getFutureOrdersForRoom(room.id);
  } catch {
    // 查不到受影響訂單時仍要求確認，但要說明無法確認影響範圍
    futureOrders = null;
  }

  let message;
  if (futureOrders === null) {
    message = `無法確認「${room.name}」是否有未來訂單。仍要刪除嗎？此操作無法復原。`;
  } else if (futureOrders.length) {
    const list = futureOrders
      .slice(0, 5)
      .map((o) => `・${o.orderNo ?? o.id.slice(0, 8)}　${formatDateRange(o.checkIn, o.checkOut)}`)
      .join('\n');
    const more = futureOrders.length > 5 ? `\n…等共 ${futureOrders.length} 筆` : '';
    message = `「${room.name}」仍有 ${futureOrders.length} 筆未來的有效訂單：\n\n${list}${more}\n\n刪除後這些訂單將失去對應房源。確定要刪除嗎？`;
  } else {
    message = `確定要刪除「${room.name}」嗎？此操作無法復原。`;
  }

  if (!confirmAction(message)) return;

  try {
    await withAudit(
      {
        action: ACTIONS.ROOM_DELETE, targetTable: 'rooms', targetId: room.id,
        summary: { name: room.name, affectedOrders: futureOrders?.length ?? null }
      },
      () => deleteRoom(room.id)
    );
    toast('房源已刪除。', 'ok');
    // 不必再清編輯狀態：表單在浮窗裡，開著的時候背景列表是 inert，按不到刪除
    reload(panel, context);
  } catch (err) {
    toastError(err);
  }
}
