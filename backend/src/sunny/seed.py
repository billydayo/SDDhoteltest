"""種子資料。**可重複執行**（FR-072、FR-073）。

執行：`uv run python -m sunny.seed`

每次執行都會把資料還原為初始展示狀態：先清空業務資料，再重新寫入。
`system_settings` 與 `site_content` 的起始列由初始 revision 建立，此處只重設
其內容，不刪除——`site_content` 有單列 CHECK 約束，刪掉再插回沒有好處。

⚠️ **示範帳號的密碼在此處「計算」雜湊，MUST NOT 硬編碼雜湊值。**

FR-009a 明訂密碼保管無任何例外，含公開列出的測試帳號。硬編碼雜湊會讓日後
調整 argon2 成本參數時，種子資料悄悄落後於正式路徑——而那正是「示範帳號走
特例路徑」的另一種形式（research R5）。
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from sunny.db import dispose_engine, get_session_factory
from sunny.models import (
    ChannelPrice,
    Favorite,
    Message,
    Order,
    Profile,
    Refund,
    Review,
    Room,
    RoomRiskCheck,
    SiteContent,
)
from sunny.models.profile import ROLE_ADMIN, ROLE_MEMBER
from sunny.models.site_content import SITE_CONTENT_ID
from sunny.services.auth import hash_password
from sunny.utils import dates

# ---------------------------------------------------------------------------
# 示範帳號
# ---------------------------------------------------------------------------
# 這組帳密公開標示於登入畫面（FR-005），且**MUST 為本專案展示專用**，
# MUST NOT 與任何人的真實密碼相同（憲章原則 VI）。
GUEST_EMAIL = "guest@sunny.com"
GUEST_PASSWORD = "guest123"
ADMIN_EMAIL = "admin@sunny.com"
ADMIN_PASSWORD = "admin123"

# ---------------------------------------------------------------------------
# 房源
# ---------------------------------------------------------------------------
# 照片取自 Unsplash（Unsplash License，免費商用、免署名），不使用任何真實
# 飯店的受著作權保護照片。載入失敗時前端退回專案內的 SVG 後備圖。
_U = "https://images.unsplash.com/photo-"

ROOMS: tuple[dict, ...] = (
    {
        "name": "海景雙人房 201",
        "type": "雙人房",
        "max_guests": 2,
        "nightly_price": 2800,
        "amenities": ["免費 Wi-Fi", "冷氣", "獨立衛浴", "陽台", "小冰箱", "書桌"],
        "features": ["採光佳", "情侶推薦", "安靜樓層"],
        "description": "面海的落地窗與獨立陽台，晨光會自己找上門。",
        "images": [f"{_U}1566073771259-6a8506099945?w=1200"],
    },
    {
        "name": "山景雙人房 202",
        "type": "雙人房",
        "max_guests": 2,
        "nightly_price": 2400,
        "amenities": ["免費 Wi-Fi", "冷氣", "獨立衛浴", "書桌", "衣櫃"],
        "features": ["安靜樓層", "商務友善"],
        "description": "背山面谷，適合需要安靜工作的旅人。",
        "images": [f"{_U}1611892440504-42a792e24d32?w=1200"],
    },
    {
        "name": "豪華雙人房 203",
        "type": "雙人房",
        "max_guests": 2,
        "nightly_price": 3600,
        "amenities": ["免費 Wi-Fi", "冷氣", "獨立衛浴", "浴缸", "陽台", "咖啡機", "備品組"],
        "features": ["泡澡放鬆", "情侶推薦", "採光佳"],
        "description": "獨立浴缸與陽台，把一整天的疲勞留在水裡。",
        "images": [f"{_U}1582719478250-c89cae4dc85b?w=1200"],
    },
    {
        "name": "標準單人房 101",
        "type": "單人房",
        "max_guests": 1,
        "nightly_price": 1600,
        "amenities": ["免費 Wi-Fi", "冷氣", "獨立衛浴", "書桌"],
        "features": ["商務友善", "安靜樓層"],
        "description": "一個人出差剛剛好，書桌夠大，網路夠快。",
        "images": [f"{_U}1631049307264-da0ec9d70304?w=1200"],
    },
    {
        "name": "經濟單人房 102",
        "type": "單人房",
        "max_guests": 1,
        "nightly_price": 1200,
        "amenities": ["免費 Wi-Fi", "冷氣", "獨立衛浴"],
        "features": ["安靜樓層"],
        "description": "簡單、乾淨、價格友善。",
        "images": [f"{_U}1505693416388-ac5ce068fe85?w=1200"],
    },
    {
        "name": "家庭四人房 301",
        "type": "家庭房",
        "max_guests": 4,
        "nightly_price": 4200,
        "amenities": [
            "免費 Wi-Fi",
            "冷氣",
            "獨立衛浴",
            "浴缸",
            "小冰箱",
            "加床服務",
            "嬰兒床可租借",
        ],
        "features": ["親子友善", "可加床", "朋友同行"],
        "description": "兩張大床加一組沙發，帶孩子出門不必擠。",
        "images": [f"{_U}1560448204-e02f11c3d0e2?w=1200"],
    },
    {
        "name": "家庭六人房 302",
        "type": "家庭房",
        "max_guests": 6,
        "nightly_price": 5600,
        "amenities": ["免費 Wi-Fi", "冷氣", "獨立衛浴", "客廳區", "小冰箱", "加床服務"],
        "features": ["親子友善", "朋友同行", "可加床"],
        "description": "獨立客廳區，一大家子晚上還能坐下來聊天。",
        "images": [f"{_U}1591088398332-8a7791972843?w=1200"],
    },
    {
        "name": "無障礙客房 103",
        "type": "無障礙房",
        "max_guests": 2,
        "nightly_price": 2200,
        "amenities": ["免費 Wi-Fi", "冷氣", "獨立衛浴", "書桌"],
        "features": ["無障礙", "安靜樓層"],
        "description": "加寬門框、無門檻淋浴間與扶手，輪椅可全區通行。",
        "images": [f"{_U}1595576508898-0ad5c879a061?w=1200"],
    },
    {
        "name": "景觀套房 401",
        "type": "套房",
        "max_guests": 3,
        "nightly_price": 6800,
        "amenities": [
            "免費 Wi-Fi",
            "冷氣",
            "獨立衛浴",
            "浴缸",
            "陽台",
            "客廳區",
            "咖啡機",
            "備品組",
        ],
        "features": ["採光佳", "泡澡放鬆", "情侶推薦", "商務友善"],
        "description": "頂樓轉角，兩面採光，浴缸就在窗邊。",
        "images": [f"{_U}1631049035182-249067d7618e?w=1200"],
    },
    {
        "name": "閣樓套房 402",
        "type": "套房",
        "max_guests": 3,
        "nightly_price": 5200,
        "amenities": ["免費 Wi-Fi", "冷氣", "獨立衛浴", "客廳區", "書桌", "咖啡機"],
        "features": ["採光佳", "商務友善", "情侶推薦"],
        "description": "斜屋頂與天窗，晚上躺著就能看星星。",
        "images": [f"{_U}1618773928121-c32242e63f39?w=1200"],
        "status": "maintenance",  # 展示「整理中」不可訂的行為（FR-016）
    },
)

CHANNELS = ("Agoda", "Booking.com", "Trip.com")


async def _reset_business_data(session: AsyncSession) -> None:
    """清空業務資料。依外鍵相依的反序刪除。

    ⚠️ **`admin_logs` 刻意不在此列，`profiles` 也不整批刪除。**

    FR-073 要求「將所有資料還原為初始種子資料」，FR-116 要求「操作日誌 MUST
    為僅可新增，任何角色（含管理員）MUST NOT 能刪除既有紀錄」。兩者對
    `admin_logs` 直接牴觸，本專案取後者——**一個按下重置就會被清空的稽核日誌，
    不叫僅可新增**（SC-027）。

    這不只是原則問題：`sunny_app` 上的 DELETE 權限已被 REVOKE，這裡真的刪不掉。
    第一次執行本腳本時就是被這道權限擋下來的，那是保證正在生效的證據。

    連帶的後果是 `profiles` 也不能整批刪——`admin_logs.actor_id` 對它是
    `on delete restrict`。改為：示範帳號以 email 做 upsert（保留既有 id，
    讓日誌的操作者仍指得到人），其餘帳號只刪除沒有留下日誌的那些。
    """
    for model in (
        Message,
        Refund,
        Review,
        Favorite,
        RoomRiskCheck,
        ChannelPrice,
        Order,
        Room,
    ):
        await session.execute(delete(model))

    # 非示範帳號：只刪除沒有留下稽核紀錄的。留有紀錄的帳號保留，
    # 否則日誌會失去操作者——那等同於間接竄改了它。
    await session.execute(
        text(
            "delete from public.profiles p "
            "where p.email not in (:guest, :admin) "
            "  and not exists (select 1 from public.admin_logs a where a.actor_id = p.id)"
        ),
        {"guest": GUEST_EMAIL, "admin": ADMIN_EMAIL},
    )


async def _upsert_profile(
    session: AsyncSession, *, email: str, password: str, role: str, display_name: str, phone: str
) -> Profile:
    """以 email 為鍵建立或更新示範帳號。

    **保留既有 id**：`admin_logs` 可能已引用它，換 id 會讓稽核紀錄指向不存在
    的操作者。密碼雜湊每次重新**計算**，不硬編碼（research R5）。
    """
    profile = await session.scalar(select(Profile).where(Profile.email == email))
    if profile is None:
        profile = Profile(email=email)
        session.add(profile)
    profile.password_hash = hash_password(password)
    profile.google_sub = None
    profile.role = role
    profile.display_name = display_name
    profile.phone = phone
    await session.flush()
    return profile


async def _seed_profiles(session: AsyncSession) -> tuple[Profile, Profile]:
    guest = await _upsert_profile(
        session,
        email=GUEST_EMAIL,
        password=GUEST_PASSWORD,
        role=ROLE_MEMBER,
        display_name="示範會員",
        phone="0912-345-678",
    )
    admin = await _upsert_profile(
        session,
        email=ADMIN_EMAIL,
        password=ADMIN_PASSWORD,
        role=ROLE_ADMIN,
        display_name="示範管理員",
        phone="0987-654-321",
    )
    return guest, admin


async def _seed_rooms(session: AsyncSession) -> list[Room]:
    rooms = [Room(**spec) for spec in ROOMS]
    session.add_all(rooms)
    await session.flush()
    return rooms


async def _seed_orders(session: AsyncSession, guest: Profile, rooms: list[Room]) -> list[Order]:
    """建立涵蓋各種狀態的示範訂單。

    ⚠️ 日期刻意錯開，避免撞上 `orders_no_overlap`——同一房源的區間不得重疊，
    種子資料自己撞上約束會讓整支腳本失敗。
    """
    today = dates.today()
    now = datetime.now(UTC)

    def make(room: Room, start_offset: int, nights: int, status: str, **kw) -> Order:
        check_in = today + timedelta(days=start_offset)
        check_out = check_in + timedelta(days=nights)
        return Order(
            user_id=guest.id,
            room_id=room.id,
            order_no=f"SN{check_in:%Y%m%d}{abs(start_offset):04d}",
            check_in=check_in,
            check_out=check_out,
            nights=nights,
            guest_count=min(2, room.max_guests),
            contact_name="示範會員",
            phone="0912-345-678",
            email=GUEST_EMAIL,
            payment_method="LINE Pay",
            total_amount=room.nightly_price * nights,
            status=status,
            expires_at=now + timedelta(hours=1),
            **kw,
        )

    orders = [
        # 已完成——供撰寫評論（FR-042：僅能對已入住的房源評論）
        make(rooms[0], -30, 2, "completed"),
        make(rooms[2], -20, 3, "completed"),
        # 已確認的未來訂單——供申請退款（FR-035）
        make(rooms[1], 14, 2, "confirmed"),
        # 待付款——展示倒數與主動取消（FR-035a、FR-102）
        make(rooms[3], 21, 1, "pending-payment"),
        # 已取消（逾期）
        make(rooms[4], 7, 2, "cancelled", cancel_reason="payment-timeout"),
        # 退款審核中——供後台審核（US7）
        make(rooms[5], 28, 2, "refund-pending"),
    ]
    session.add_all(orders)
    await session.flush()
    return orders


async def _seed_reviews(session: AsyncSession, guest: Profile, orders: list[Order]) -> None:
    completed = [o for o in orders if o.status == "completed"]
    reviews = [
        Review(
            order_id=completed[0].id,
            room_id=completed[0].room_id,
            user_id=guest.id,
            rating=5,
            comment="房間乾淨，陽台的海景比照片還好。櫃檯人員很細心。",
            category="住宿體驗",
            status="approved",
            auto_verdict="auto-pass",
            auto_rules=[],
            admin_reply="謝謝您的肯定，期待再次為您服務。",
            admin_reply_at=datetime.now(UTC),
        ),
        Review(
            order_id=completed[1].id,
            room_id=completed[1].room_id,
            user_id=guest.id,
            rating=4,
            comment="浴缸很棒，但隔壁施工有點吵。整體仍推薦。",
            category="住宿體驗",
            status="pending",  # 待審核——供後台複核（US7）
            auto_verdict="auto-pass",
            auto_rules=[],
        ),
    ]
    session.add_all(reviews)


async def _seed_refunds(session: AsyncSession, guest: Profile, orders: list[Order]) -> None:
    pending = next(o for o in orders if o.status == "refund-pending")
    session.add(
        Refund(
            order_id=pending.id,
            user_id=guest.id,
            reason="臨時有事無法成行，希望能取消訂房。",
            amount=pending.total_amount,  # 距入住 28 天 → 全額（FR-041）
            status="pending",
        )
    )


async def _seed_channel_prices(session: AsyncSession, rooms: list[Room]) -> None:
    """渠道比價的**模擬**資料。

    ⚠️ 非真實爬取結果。系統不爬取任何網站，也不呼叫任何 OTA API——
    理由是服務條款，不是技術限制（FR-109、research B1-a）。

    刻意讓部分項目低於官網價，以展示「賤賣預警」（FR-111）。
    """
    offsets = (-320, 80, -150)  # 兩個低於官網價 → 觸發預警
    entries = [
        ChannelPrice(
            room_id=room.id,
            channel=channel,
            channel_price=max(100, room.nightly_price + offset),
            resolved=False,
        )
        for room in rooms[:5]
        for channel, offset in zip(CHANNELS, offsets, strict=True)
    ]
    session.add_all(entries)


async def _seed_messages(session: AsyncSession, guest: Profile, admin: Profile) -> None:
    base = datetime.now(UTC) - timedelta(days=2)
    session.add_all(
        [
            Message(
                thread_user_id=guest.id,
                sender_id=guest.id,
                sender_role="member",
                body="請問可以提早入住嗎？大概下午一點會到。",
                created_at=base,
            ),
            Message(
                thread_user_id=guest.id,
                sender_id=admin.id,
                sender_role="admin",
                body="您好，若當日房間已整理完畢即可提早入住，建議抵達前來電確認。",
                created_at=base + timedelta(hours=3),
            ),
        ]
    )


async def _reset_site_content(session: AsyncSession) -> None:
    await session.execute(
        update(SiteContent)
        .where(SiteContent.id == SITE_CONTENT_ID)
        .values(
            hero_title="Sunny 訂房平台",
            hero_subtitle="舒適住宿，安心入住",
            hero_image=f"{_U}1571003123894-1f0594d2b5d9?w=2000",
        )
    )
    # 初始 revision 已建立該列；防禦性地補一筆以防有人手動刪掉
    if await session.scalar(select(SiteContent).where(SiteContent.id == SITE_CONTENT_ID)) is None:
        session.add(SiteContent(id=SITE_CONTENT_ID))


async def seed() -> None:
    """把資料庫還原為初始展示狀態。可重複執行。"""
    factory = get_session_factory()
    async with factory() as session, session.begin():
        await _reset_business_data(session)
        guest, admin = await _seed_profiles(session)
        rooms = await _seed_rooms(session)
        orders = await _seed_orders(session, guest, rooms)
        await _seed_reviews(session, guest, orders)
        await _seed_refunds(session, guest, orders)
        await _seed_channel_prices(session, rooms)
        await _seed_messages(session, guest, admin)
        await _reset_site_content(session)

        # 訊息的 created_at 由 trigger 覆寫為 now()，此處還原為刻意錯開的時間，
        # 好讓對話看起來像真的有先後。trigger 只在 INSERT 時蓋章。
        await session.execute(
            text(
                "update public.messages set created_at = created_at - interval '2 days' "
                "where sender_role = 'member'"
            )
        )


async def _main() -> None:
    await seed()
    await dispose_engine()
    print("種子資料已寫入。")
    print(f"  會員   {GUEST_EMAIL} / {GUEST_PASSWORD}")
    print(f"  管理員 {ADMIN_EMAIL} / {ADMIN_PASSWORD}")


if __name__ == "__main__":
    asyncio.run(_main())
