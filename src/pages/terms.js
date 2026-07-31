/**
 * 服務條款與隱私聲明（T112 / FR-121、FR-122）。
 *
 * 這頁的重點不是法律文字，而是**誠實說明這是什麼**：
 * 不提供真實住宿、不進行真實交易、不蒐集真實個資。
 * 一個展示專案若讓人誤以為是真的訂房網站，才是真正的風險。
 */

import { render, createPageHeader } from '../app.js';
import { isDemoMode } from '../data/repository.js';

export async function renderTerms() {
  const frag = document.createDocumentFragment();

  frag.append(createPageHeader(
    '服務條款與隱私聲明',
    '請在使用本站前閱讀以下說明。'
  ));

  frag.append(buildHighlight());
  frag.append(section('一、本站的性質', [
    '本站為教學與展示用途的原型專案，用於驗證訂房流程與後台管理介面的設計。',
    '本站不是真實的訂房服務，不隸屬於任何實際存在的飯店，也不提供任何住宿。',
    '站上的房源名稱、照片、價格、評論與訂單資料皆為虛構的示範內容。'
  ]));

  frag.append(section('二、訂房與付款', [
    '站上的「訂房」不會為你保留任何真實房間，「付款」不會產生任何實際交易。',
    '付款方式（LINE Pay、信用卡、銀行轉帳）僅為介面上的模擬選項，'
      + '本站不串接任何金流服務，也不會要求或儲存真實的信用卡號、有效期限、CVV 或銀行帳號。',
    '「退款」僅變更訂單狀態，不涉及任何金錢移轉。'
  ]));

  frag.append(section('三、帳號與個人資料', [
    '請勿使用你在其他網站的真實密碼註冊本站帳號。',
    '請勿填寫真實的身分證字號、金融資訊或其他敏感個人資料。',
    '訂房表單中的姓名、電話與電子郵件僅用於展示訂單內容，本站不會寄送任何郵件或簡訊。',
    '若你以 Google 帳號登入，本站僅取得電子郵件與顯示名稱，用於識別你的帳號。'
  ]));

  frag.append(section('四、照片與影像處理', [
    '前台「安全檢測」上傳的照片全程在你的瀏覽器內以 Canvas 分析，'
      + '不會被傳送至任何伺服器，也不會被保存。離開頁面後即消失。',
    '房源詳情頁上顯示的品質檢測圖，是由管理員針對飯店自有房間上傳的公開展示內容，'
      + '與前台的安全檢測是兩條各自獨立的功能。'
  ]));

  frag.append(section('五、模擬功能的說明', [
    '「渠道比價與控價」模組中的外部平台售價為系統內建的示範資料。'
      + '本站不會擷取、也不曾連線至 Agoda、Booking 或任何訂房平台。',
    '評論的自動審核為瀏覽器內的規則式判定（不當字詞、長度、內容矛盾等），'
      + '並非人工智慧判讀。所有自動判定都可由管理員複核與覆寫。'
  ]));

  frag.append(section('六、資料保存', [
    isDemoMode()
      ? '本站目前以示範模式運作，你的所有資料僅保存在這台裝置的瀏覽器中。'
        + '清除瀏覽器資料或更換裝置後，資料即消失。'
      : '本站目前連線至雲端資料庫，你的帳號、訂單與評論會保存在該資料庫中，'
        + '可跨裝置存取。存取權限由資料庫的安全政策限制，你無法讀取其他使用者的資料。',
    '由於本站為展示專案，恕不保證資料的長期保存，且維護者可能隨時重置示範資料。'
  ]));

  frag.append(section('七、免責', [
    '本站的拍照風險評分以基本影像統計為主，屬輔助參考，並非專業檢測。',
    '本站不對任何因使用本站而產生的決策或損失負責。'
  ]));

  render(frag);
}

function buildHighlight() {
  const box = document.createElement('div');
  box.className = 'simulated-badge';
  box.setAttribute('role', 'note');

  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '⚠';

  const text = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = '這是展示用專案，不是真實的訂房服務';
  const p = document.createElement('span');
  p.textContent = '本站不提供真實住宿、不進行真實交易、不蒐集真實個人資料。'
    + '請勿輸入你的真實密碼或金融資訊。';
  text.append(strong, p);

  box.append(icon, text);
  return box;
}

function section(title, paragraphs) {
  const el = document.createElement('section');

  const h2 = document.createElement('h2');
  h2.textContent = title;
  el.append(h2);

  paragraphs.forEach((text) => {
    const p = document.createElement('p');
    p.textContent = text;
    el.append(p);
  });

  return el;
}
