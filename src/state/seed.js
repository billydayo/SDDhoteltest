/**
 * 示範模式的初始種子資料。
 *
 * 房源內容必須與 supabase/seed.sql 保持一致，兩種模式才會呈現相同的畫面。
 * 修改房源時請同時更新兩處。
 *
 * ⚠️ 本檔的 users 陣列含明文 password 欄位。這是**示範模式專屬**的模擬登入，
 *    介面上必須標示為模擬（憲章原則 VI）。Supabase 模式沒有這個陣列，
 *    密碼一律由 Supabase Auth 雜湊保管，應用資料表不存在密碼欄位。
 */

/**
 * 提高版本號會讓既有使用者的 localStorage 在下次載入時重建為新的種子資料。
 * 新增房源或示範訂單後務必遞增，否則舊資料不會更新。
 */
export const SEED_VERSION = 4;

const ROOM_IDS = {
  singleA: '11111111-1111-4111-8111-000000000001',
  singleB: '11111111-1111-4111-8111-000000000002',
  doubleA: '11111111-1111-4111-8111-000000000003',
  doubleB: '11111111-1111-4111-8111-000000000004',
  doubleC: '11111111-1111-4111-8111-000000000005',
  twinA:   '11111111-1111-4111-8111-000000000006',
  twinB:   '11111111-1111-4111-8111-000000000007',
  family:  '11111111-1111-4111-8111-000000000008',
  suiteA:  '11111111-1111-4111-8111-000000000009',
  suiteB:  '11111111-1111-4111-8111-000000000010',
  waDouble:   '11111111-1111-4111-8111-000000000011',
  waTwin:     '11111111-1111-4111-8111-000000000012',
  starView:   '11111111-1111-4111-8111-000000000013',
  gardenView: '11111111-1111-4111-8111-000000000014',
  bizSingle:  '11111111-1111-4111-8111-000000000015',
  bizDouble:  '11111111-1111-4111-8111-000000000016',
  kidsFamily: '11111111-1111-4111-8111-000000000017',
  accessible: '11111111-1111-4111-8111-000000000018',
  execSuite:  '11111111-1111-4111-8111-000000000019',
  honeymoon:  '11111111-1111-4111-8111-000000000020'
};

export const SITE_CONTENT_ID = '00000000-0000-0000-0000-000000000001';

export const DEMO_ACCOUNTS = Object.freeze([
  { email: 'guest@sunny.com', password: 'guest123', role: 'member', displayName: '示範會員' },
  { email: 'admin@sunny.com', password: 'admin123', role: 'admin',  displayName: '系統管理員' }
]);

function buildUsers() {
  return [
    {
      id: '22222222-2222-4222-8222-000000000001',
      email: 'guest@sunny.com',
      password: 'guest123',          // 示範模式專屬，見檔頭警語
      role: 'member',
      displayName: '示範會員',
      phone: '0900-000-000',
      createdAt: '2026-07-01T09:00:00.000Z'
    },
    {
      id: '22222222-2222-4222-8222-000000000002',
      email: 'admin@sunny.com',
      password: 'admin123',
      role: 'admin',
      displayName: '系統管理員',
      phone: '0900-000-999',
      createdAt: '2026-07-01T09:00:00.000Z'
    }
  ];
}

function buildRooms() {
  return [
    {
      id: ROOM_IDS.singleA, name: '暖陽單人房 A', type: 'single',
      maxGuests: 1, nightlyPrice: 1800,
      images: ['assets/rooms/single-a.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '書桌'],
      features: ['商務友善', '安靜樓層'],
      description: '面向內庭的安靜單人房，適合商務短住。採光良好，附書桌與閱讀燈。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.singleB, name: '暖陽單人房 B', type: 'single',
      maxGuests: 1, nightlyPrice: 1800,
      images: ['assets/rooms/single-b.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '書桌'],
      features: ['商務友善'],
      description: '同層的另一間單人房，格局相同，窗景面向街道。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.doubleA, name: '日光雙人房 A', type: 'double',
      maxGuests: 2, nightlyPrice: 2600,
      images: ['assets/rooms/double-a.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '小冰箱', '備品組', '陽台'],
      features: ['採光佳', '情侶推薦'],
      description: '一張加大雙人床的標準房型，早晨採光充足，附小陽台，適合情侶或夫妻。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.doubleB, name: '日光雙人房 B', type: 'double',
      maxGuests: 2, nightlyPrice: 2600,
      images: ['assets/rooms/double-b.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '小冰箱', '備品組'],
      features: ['安靜樓層', '情侶推薦'],
      description: '與 A 房同規格，位於安靜的走廊末端。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.doubleC, name: '日光雙人房 C', type: 'double',
      maxGuests: 2, nightlyPrice: 2800,
      images: ['assets/rooms/double-c.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '小冰箱', '備品組', '浴缸', '陽台'],
      features: ['採光佳', '情侶推薦', '泡澡放鬆'],
      description: '含獨立浴缸與陽台的雙人房，空間略大於標準雙人房。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.twinA, name: '雙床房 A', type: 'twin',
      maxGuests: 2, nightlyPrice: 2900,
      images: ['assets/rooms/twin-a.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '小冰箱', '衣櫃'],
      features: ['商務友善', '朋友同行'],
      description: '兩張單人床的房型，適合朋友同行或商務同事。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.twinB, name: '雙床房 B', type: 'twin',
      maxGuests: 3, nightlyPrice: 3200,
      images: ['assets/rooms/twin-b.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '小冰箱', '衣櫃', '加床服務'],
      features: ['朋友同行', '可加床'],
      description: '可加床的雙床房，最多可住三人。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.family, name: '家庭四人房', type: 'family',
      maxGuests: 4, nightlyPrice: 4200,
      images: ['assets/rooms/family-a.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '小冰箱', '客廳區', '嬰兒床可租借', '浴缸'],
      features: ['親子友善', '無障礙', '可加床'],
      description: '兩大床的家庭房，附小客廳區與無障礙動線，適合親子出遊。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.suiteA, name: '景觀套房', type: 'suite',
      maxGuests: 2, nightlyPrice: 5600,
      images: ['assets/rooms/suite-a.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '浴缸', '小冰箱', '客廳區', '咖啡機', '陽台'],
      features: ['採光佳', '泡澡放鬆', '情侶推薦'],
      description: '頂層景觀套房，含起居空間與大面窗景，附膠囊咖啡機。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.suiteB, name: '景觀套房（整理中）', type: 'suite',
      maxGuests: 2, nightlyPrice: 5600,
      images: ['assets/rooms/suite-b.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '浴缸', '小冰箱', '客廳區', '咖啡機', '陽台'],
      features: ['採光佳', '泡澡放鬆'],
      description: '與景觀套房同規格。此房目前設為整理中，用於展示房態排除規則。',
      status: 'maintenance', averageRating: null
    },
    {
      id: ROOM_IDS.waDouble, name: '和風雙人房', type: 'double',
      maxGuests: 2, nightlyPrice: 3100,
      images: ['assets/rooms/wa-double.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '小冰箱', '備品組', '浴缸'],
      features: ['泡澡放鬆', '情侶推薦', '安靜樓層'],
      description: '榻榻米與檜木浴缸的和式房型，適合想放慢步調的旅客。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.waTwin, name: '和風雙床房', type: 'twin',
      maxGuests: 2, nightlyPrice: 3300,
      images: ['assets/rooms/wa-twin.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '小冰箱', '衣櫃', '備品組'],
      features: ['朋友同行', '安靜樓層'],
      description: '和式雙床房，兩張獨立床墊，附小型茶席空間。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.starView, name: '星空景觀房', type: 'double',
      maxGuests: 2, nightlyPrice: 4100,
      images: ['assets/rooms/star-view.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '小冰箱', '陽台', '咖啡機'],
      features: ['採光佳', '情侶推薦'],
      description: '面東的高樓層房型，天氣好時可從陽台看見星空。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.gardenView, name: '庭園景觀房', type: 'double',
      maxGuests: 2, nightlyPrice: 3600,
      images: ['assets/rooms/garden-view.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '小冰箱', '陽台', '備品組'],
      features: ['採光佳', '安靜樓層', '情侶推薦'],
      description: '低樓層房型，陽台直接面向內庭花園，清晨有鳥聲。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.bizSingle, name: '商務單人房', type: 'single',
      maxGuests: 1, nightlyPrice: 2100,
      images: ['assets/rooms/biz-single.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '書桌', '衣櫃'],
      features: ['商務友善', '安靜樓層'],
      description: '附大型書桌與人體工學椅，長時間工作也不易疲勞。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.bizDouble, name: '商務雙人房', type: 'double',
      maxGuests: 2, nightlyPrice: 2900,
      images: ['assets/rooms/biz-double.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '書桌', '小冰箱', '衣櫃'],
      features: ['商務友善'],
      description: '雙人商務房，兩側各有獨立插座與閱讀燈。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.kidsFamily, name: '親子主題房', type: 'family',
      maxGuests: 4, nightlyPrice: 4800,
      images: ['assets/rooms/kids-family.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '浴缸', '小冰箱', '客廳區', '嬰兒床可租借', '加床服務'],
      features: ['親子友善', '可加床', '採光佳'],
      description: '含遊戲區與防撞設計的家庭房，備有兒童備品與床欄。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.accessible, name: '無障礙友善房', type: 'double',
      maxGuests: 2, nightlyPrice: 3000,
      images: ['assets/rooms/accessible.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '小冰箱', '衣櫃'],
      features: ['無障礙', '安靜樓層'],
      description: '加寬門框與無門檻淋浴間，走道淨寬足供輪椅迴轉。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.execSuite, name: '頂樓行政套房', type: 'suite',
      maxGuests: 3, nightlyPrice: 6800,
      images: ['assets/rooms/exec-suite.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '浴缸', '小冰箱', '客廳區', '咖啡機', '陽台', '加床服務'],
      features: ['採光佳', '商務友善', '可加床', '泡澡放鬆'],
      description: '頂樓行政套房，含獨立起居室與辦公區，可加床。',
      status: 'available', averageRating: null
    },
    {
      id: ROOM_IDS.honeymoon, name: '蜜月套房', type: 'suite',
      maxGuests: 2, nightlyPrice: 7500,
      images: ['assets/rooms/honeymoon.svg'],
      amenities: ['免費 Wi-Fi', '冷氣', '獨立衛浴', '浴缸', '小冰箱', '客廳區', '咖啡機', '陽台', '備品組'],
      features: ['情侶推薦', '泡澡放鬆', '採光佳'],
      description: '雙人按摩浴缸與景觀陽台，房內備有慶祝布置服務。',
      status: 'maintenance', averageRating: null
    }
  ];
}

/**
 * 模擬的渠道價格。與 supabase/seed.sql 一致。
 * ⚠️ 手工編寫的示範資料，非真實擷取。本專案不爬取任何網站（FR-109）。
 */
function buildChannelPrices() {
  const at = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  return [
    { id: 'cp-01', roomId: ROOM_IDS.doubleA, channel: 'Agoda',   channelPrice: 2600, capturedAt: at(2), resolved: false },
    { id: 'cp-02', roomId: ROOM_IDS.doubleA, channel: 'Booking', channelPrice: 2700, capturedAt: at(2), resolved: false },
    { id: 'cp-03', roomId: ROOM_IDS.twinA,   channel: 'Agoda',   channelPrice: 2950, capturedAt: at(2), resolved: false },
    { id: 'cp-04', roomId: ROOM_IDS.family,  channel: 'Booking', channelPrice: 4200, capturedAt: at(2), resolved: false },
    { id: 'cp-05', roomId: ROOM_IDS.suiteA,  channel: 'Agoda',   channelPrice: 5600, capturedAt: at(2), resolved: false },
    // 以下三筆低於官網價，應觸發賤賣預警
    { id: 'cp-06', roomId: ROOM_IDS.singleA, channel: 'Agoda',   channelPrice: 1620, capturedAt: at(1), resolved: false },
    { id: 'cp-07', roomId: ROOM_IDS.doubleC, channel: 'Booking', channelPrice: 2380, capturedAt: at(1), resolved: false },
    { id: 'cp-08', roomId: ROOM_IDS.suiteA,  channel: 'Booking', channelPrice: 4980, capturedAt: at(0.5), resolved: false }
  ];
}

const GUEST_ID = '22222222-2222-4222-8222-000000000001';

/** 相對於今天的 YYYY-MM-DD，讓示範資料不會隨時間過期 */
function dayOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

/**
 * 示範用訂單：六種狀態各一筆，全部屬於 guest@sunny.com。
 *
 * 佔房的三種狀態（待付款、已確認、退款審核中）刻意分配到不同房源，
 * 因此不會觸發重疊判定——與 Supabase 模式的排除約束行為一致。
 *
 * 待付款訂單的 expiresAt 設為 3 天後而非系統參數的 60 分鐘，
 * 否則示範資料一小時內就會被 expireStaleOrders() 取消，
 * 「六種狀態齊備」的性質活不過一個下午。
 */
function buildOrders() {
  const base = {
    userId: GUEST_ID,
    contactName: '示範會員',
    phone: '0900-000-000',
    email: 'guest@sunny.com'
  };
  const iso = (days) => new Date(Date.now() + days * 86400_000).toISOString();

  return [
    {
      ...base, id: 'demo-order-01', orderNo: 'SN00000001',
      roomId: ROOM_IDS.doubleA, checkIn: dayOffset(200), checkOut: dayOffset(202),
      nights: 2, guestCount: 2, paymentMethod: 'LINE Pay', totalAmount: 5200,
      status: 'pending-payment', expiresAt: iso(3), cancelReason: null, createdAt: iso(-1)
    },
    {
      ...base, id: 'demo-order-02', orderNo: 'SN00000002',
      roomId: ROOM_IDS.suiteA, checkIn: dayOffset(210), checkOut: dayOffset(213),
      nights: 3, guestCount: 2, paymentMethod: 'credit-card', totalAmount: 16800,
      status: 'confirmed', expiresAt: iso(-5), cancelReason: null, createdAt: iso(-6)
    },
    {
      ...base, id: 'demo-order-03', orderNo: 'SN00000003',
      roomId: ROOM_IDS.family, checkIn: dayOffset(220), checkOut: dayOffset(222),
      nights: 2, guestCount: 4, paymentMethod: 'bank-transfer', totalAmount: 8400,
      status: 'refund-pending', expiresAt: iso(-8), cancelReason: null, createdAt: iso(-9)
    },
    {
      ...base, id: 'demo-order-04', orderNo: 'SN00000004',
      roomId: ROOM_IDS.doubleC, checkIn: dayOffset(230), checkOut: dayOffset(232),
      nights: 2, guestCount: 2, paymentMethod: 'LINE Pay', totalAmount: 5600,
      status: 'refunded', expiresAt: iso(-14), cancelReason: null, createdAt: iso(-15)
    },
    {
      ...base, id: 'demo-order-05', orderNo: 'SN00000005',
      roomId: ROOM_IDS.twinB, checkIn: dayOffset(240), checkOut: dayOffset(242),
      nights: 2, guestCount: 3, paymentMethod: 'credit-card', totalAmount: 6400,
      status: 'cancelled', expiresAt: iso(-2), cancelReason: 'payment-timeout', createdAt: iso(-3)
    },
    {
      ...base, id: 'demo-order-06', orderNo: 'SN00000006',
      roomId: ROOM_IDS.twinA, checkIn: dayOffset(-12), checkOut: dayOffset(-9),
      nights: 3, guestCount: 2, paymentMethod: 'credit-card', totalAmount: 8700,
      status: 'completed', expiresAt: iso(-20), cancelReason: null, createdAt: iso(-21)
    },
    {
      // 第二筆已完成訂單，讓「一訂單一評論」的限制有東西可測
      ...base, id: 'demo-order-07', orderNo: 'SN00000007',
      roomId: ROOM_IDS.doubleB, checkIn: dayOffset(-30), checkOut: dayOffset(-28),
      nights: 2, guestCount: 2, paymentMethod: 'LINE Pay', totalAmount: 5200,
      status: 'completed', expiresAt: iso(-35), cancelReason: null, createdAt: iso(-36)
    }
  ];
}

/** 已公開的評論會讓房源產生平均評分，排序功能才測得出來 */
function buildReviews() {
  const iso = (days) => new Date(Date.now() + days * 86400_000).toISOString();
  return [
    {
      id: 'demo-review-01', orderId: 'demo-order-06', roomId: ROOM_IDS.twinA,
      userId: GUEST_ID, rating: 5,
      comment: '房間比照片看起來更寬敞，床墊軟硬適中，一夜好眠。櫃檯人員也很親切。',
      category: 'cleanliness', status: 'approved',
      autoVerdict: 'auto-pass', autoRules: [], adminNote: null, createdAt: iso(-8)
    }
  ];
}

function buildRefunds() {
  const iso = (days) => new Date(Date.now() + days * 86400_000).toISOString();
  return [
    {
      id: 'demo-refund-01', orderId: 'demo-order-03', userId: GUEST_ID,
      reason: '出差行程臨時取消，需要取消這次的訂房。', amount: 8400,
      status: 'pending', adminNote: null, createdAt: iso(-2), reviewedAt: null
    },
    {
      id: 'demo-refund-02', orderId: 'demo-order-04', userId: GUEST_ID,
      reason: '家中臨時有事無法前往，麻煩協助辦理退款。', amount: 5600,
      status: 'approved',
      adminNote: '已確認符合入住前 7 天以上的全額退款條件。',
      createdAt: iso(-5), reviewedAt: iso(-3)
    }
  ];
}

/** 建立一份全新的種子資料集合 */
export function buildSeedData() {
  const rooms = buildRooms();
  const reviews = buildReviews();

  // 讓房源的平均評分與已公開的評論一致，與 Supabase 的 trigger 行為對齊
  reviews.filter((r) => r.status === 'approved').forEach((review) => {
    const room = rooms.find((r) => r.id === review.roomId);
    if (room) room.averageRating = review.rating;
  });

  return {
    users: buildUsers(),
    rooms,
    orders: buildOrders(),
    reviews,
    refunds: buildRefunds(),
    favorites: [],
    riskChecks: [],
    channelPrices: buildChannelPrices(),
    adminLogs: [],
    settings: { pending_payment_minutes: 60 },
    siteContent: {
      id: SITE_CONTENT_ID,
      heroTitle: 'Sunny 訂房平台',
      heroSubtitle: '舒適住宿，安心入住',
      heroImage: 'assets/hero.svg',
      updatedAt: new Date().toISOString()
    }
  };
}

export { ROOM_IDS };
