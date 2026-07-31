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

export const SEED_VERSION = 3;

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
  suiteB:  '11111111-1111-4111-8111-000000000010'
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

/** 建立一份全新的種子資料集合 */
export function buildSeedData() {
  return {
    users: buildUsers(),
    rooms: buildRooms(),
    orders: [],
    reviews: [],
    refunds: [],
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
