/**
 * 模擬功能的常駐標示（FR-110、憲章原則 VI）。
 *
 * 用於渠道比價與規則式評論審核這類「看起來像真的、其實是模擬」的模組。
 * 誠實標示的成本為零，誤解的成本很高——使用者若以為系統真的在監控 OTA 價格，
 * 可能會據此做營運決策。
 */

/**
 * @param {{title: string, body: string}} config
 * @returns {HTMLElement}
 */
export function createSimulatedBadge({ title, body }) {
  const box = document.createElement('div');
  box.className = 'simulated-badge';
  box.setAttribute('role', 'note');

  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '⚠';

  const text = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('span');
  p.textContent = body;
  text.append(strong, p);

  box.append(icon, text);
  return box;
}

/** 渠道比價模組的標示 */
export const channelPricingNotice = () => createSimulatedBadge({
  title: '模擬資料',
  body: '此模組不連線至任何外部訂房平台。以下價格為系統內建的示範資料，'
      + '用於展示價差偵測與申訴流程，並非真實擷取的 Agoda 或 Booking 售價。'
});

/** 評論自動審核的標示 */
export const autoModerationNotice = () => createSimulatedBadge({
  title: '自動審核（規則式）',
  body: '本系統以內建的規則引擎進行初步判定（不當字詞、長度、評分與內容矛盾等），'
      + '並非人工智慧判讀。所有判定都可由管理員複核與覆寫。'
});

/** 付款流程的標示（FR-029） */
export const simulatedPaymentNotice = () => createSimulatedBadge({
  title: '虛擬支付',
  body: '本頁的付款為模擬流程，不會產生任何實際交易，'
      + '也不會要求或儲存真實的信用卡號、有效期限、CVV 或銀行帳號。'
});
