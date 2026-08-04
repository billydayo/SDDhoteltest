"""後台房源管理（FR-050 ~ FR-053a、FR-050e、FR-050f）。

⚠️ **本檔全部端點需管理員。** `dependencies=[Depends(require_admin)]` 掛在
router 上而非逐一標註——漏標一個函式就是一個公開的後台端點，而那不會有任何
測試失敗（contracts/README.md）。

⚠️ 每一次寫入 MUST 一併寫入 `admin_logs`，且 MUST 與變更在**同一個交易內**
完成（憲章資料存取規則）。本檔的每個寫入端點都以 `audit.record()` + 單一
`session.commit()` 達成，MUST NOT 出現「改了但沒記錄」。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

from sunny.deps import AdminUser, SessionDep, require_admin
from sunny.errors import DomainError
from sunny.models.room import ROOM_STATUSES
from sunny.repositories.admin_rooms import ROOM_FILTERS, AdminRoomRepository
from sunny.repositories.risk_checks import RiskCheckRepository
from sunny.schemas.admin import (
    AdminRoomOut,
    AffectedOrderOut,
    PhotoUploadOut,
    RoomStatusIn,
    RoomWriteIn,
)
from sunny.schemas.room import RiskCheckOut
from sunny.services import audit, filters, risk, room_photos
from sunny.utils import dates

router = APIRouter(
    prefix="/admin/rooms",
    tags=["admin:rooms"],
    dependencies=[Depends(require_admin)],
)

#: 照片端點刻意放在**獨立前綴**，不是 `/admin/rooms/photos`。
#:
#: 後者會與 `/admin/rooms/{room_id}` 撞路由——`photos` 會先被當成 room_id 比對到，
#: 於是 `DELETE /admin/rooms/photos` 變成「刪除 id 為 photos 的房源」，回 422。
#: 那種衝突可以靠「把具體路徑宣告在參數路徑之前」解決，但它會在**有人為了可讀性
#: 重排函式順序時靜默壞掉**，且不會有測試失敗——照片端點本來就打得到，只是打到
#: 另一個。用不同前綴讓這件事在結構上不可能發生。
photos_router = APIRouter(
    prefix="/admin/room-photos",
    tags=["admin:rooms"],
    dependencies=[Depends(require_admin)],
)


#: 區間解讀共用於清單與匯出兩個端點——匯出的列數 MUST 100% 等於畫面上的
#: 筆數（SC-033），而「兩端皆空視為今日」這種預設值只要有一邊不一樣，
#: 兩個數字就對不上（services/filters.py）。
_resolve_range = filters.resolve_inclusive_range


def _validate_status_filter(status_filter: str | None, *, has_explicit_date: bool) -> None:
    """篩選「已預訂」MUST 先選定日期（FR-053a）。

    「已預訂」是**推導**出來的，沒有日期就沒有這個概念。不擋的話會回一份
    以今日推導的清單，而使用者以為自己看到的是全部——那比報錯更難發現。
    """
    if status_filter is None:
        return
    if status_filter not in ROOM_FILTERS:
        raise DomainError(
            f"房態篩選僅接受 {ROOM_FILTERS}。",
            code="INVALID_STATUS_FILTER",
            status_code=400,
            field="status",
        )
    if status_filter == "booked" and not has_explicit_date:
        raise DomainError(
            "篩選「已預訂」需先選定日期或日期區間——已預訂是依日期推導的，沒有日期就無從判斷。",
            code="DATE_REQUIRED_FOR_BOOKED",
            status_code=400,
            field="startDate",
        )


# ---------------------------------------------------------------------------
# 查詢
# ---------------------------------------------------------------------------


@router.get("", response_model=list[AdminRoomOut], summary="房源清單（需管理員）")
async def list_rooms(
    session: SessionDep,
    keyword: Annotated[str | None, Query(description="房名或房型")] = None,
    room_type: Annotated[str | None, Query(alias="type")] = None,
    min_price: Annotated[int | None, Query(alias="minPrice", ge=0)] = None,
    max_price: Annotated[int | None, Query(alias="maxPrice", ge=0)] = None,
    start_date: Annotated[str | None, Query(alias="startDate", description="YYYY-MM-DD")] = None,
    end_date: Annotated[str | None, Query(alias="endDate", description="YYYY-MM-DD")] = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> list[AdminRoomOut]:
    """需管理員。房態依所選日期**區間**推導，含頭含尾（FR-051b）。"""
    start, end = _resolve_range(start_date, end_date)
    _validate_status_filter(status_filter, has_explicit_date=bool(start_date or end_date))

    rows = await AdminRoomRepository(session).list_with_availability(
        start=start,
        end=end,
        keyword=keyword,
        room_type=room_type,
        min_price=min_price,
        max_price=max_price,
        status_filter=status_filter,
    )
    return [AdminRoomOut.of(room, availability) for room, availability in rows]


async def _get_or_404(repo: AdminRoomRepository, room_id: uuid.UUID):
    room = await repo.get(room_id)
    if room is None:
        raise DomainError("查無此房源。", code="ROOM_NOT_FOUND", status_code=404)
    return room


@router.get("/{room_id}", response_model=AdminRoomOut, summary="房源詳情（需管理員）")
async def get_room(room_id: uuid.UUID, session: SessionDep) -> AdminRoomOut:
    """需管理員。"""
    repo = AdminRoomRepository(session)
    room = await _get_or_404(repo, room_id)
    today = dates.today()
    rows = await repo.list_with_availability(start=today, end=today)
    availability = next((a for r, a in rows if r.id == room_id), room.status)
    return AdminRoomOut.of(room, availability)


# ---------------------------------------------------------------------------
# 寫入
# ---------------------------------------------------------------------------


@router.post("", response_model=AdminRoomOut, status_code=201, summary="新增房源（需管理員）")
async def create_room(payload: RoomWriteIn, session: SessionDep, admin: AdminUser) -> AdminRoomOut:
    """需管理員（FR-050）。"""
    repo = AdminRoomRepository(session)
    room = await repo.create(payload.model_dump())

    await audit.record(
        session,
        actor_id=admin.id,
        action="room.create",
        target_table="rooms",
        target_id=room.id,
        summary={"name": room.name, "type": room.type, "nightlyPrice": room.nightly_price},
    )
    await session.commit()
    return AdminRoomOut.of(room, room.status)


@router.put("/{room_id}", response_model=AdminRoomOut, summary="編輯房源（需管理員）")
async def update_room(
    room_id: uuid.UUID, payload: RoomWriteIn, session: SessionDep, admin: AdminUser
) -> AdminRoomOut:
    """需管理員（FR-050）。

    ⚠️ 移除既有照片的**實際刪檔在提交之後**才執行（FR-050f）。順序反過來的話，
    儲存若失敗，資料列還指著已經被刪掉的檔案——房源詳情頁就會出現破圖。
    """
    repo = AdminRoomRepository(session)
    room = await _get_or_404(repo, room_id)

    before = {"name": room.name, "nightlyPrice": room.nightly_price, "status": room.status}
    old_images = list(room.images or [])

    await repo.update(room, payload.model_dump())
    after = {"name": room.name, "nightlyPrice": room.nightly_price, "status": room.status}

    changed = {k: [before[k], after[k]] for k in before if before[k] != after[k]}
    await audit.record(
        session,
        actor_id=admin.id,
        action="room.update",
        target_table="rooms",
        target_id=room.id,
        summary={"changed": changed} if changed else {"changed": {}, "note": "僅照片或文字內容"},
    )
    await session.commit()

    # 提交成功之後才刪檔
    room_photos.reconcile(old_images=old_images, new_images=list(room.images or []))
    return AdminRoomOut.of(room, room.status)


@router.patch("/{room_id}/status", response_model=AdminRoomOut, summary="調整房態（需管理員）")
async def set_room_status(
    room_id: uuid.UUID, payload: RoomStatusIn, session: SessionDep, admin: AdminUser
) -> AdminRoomOut:
    """需管理員（FR-051）。

    ⚠️ **可人工設定的只有 `available` 與 `maintenance`。**「已預訂」由當日的
    有效訂單推導（FR-015、FR-051a），開放人工設定就得在退房時改回來，
    而漏改一次那間房會永久無法販售——沒有任何錯誤訊息。
    """
    if payload.status not in ROOM_STATUSES:
        detail = (
            "「已預訂」由訂單自動判定，不可人工設定。可設定的房態為：空房、整理中。"
            if payload.status == "booked"
            else f"房態僅接受 {ROOM_STATUSES}。"
        )
        raise DomainError(detail, code="INVALID_ROOM_STATUS", status_code=400, field="status")

    repo = AdminRoomRepository(session)
    room = await _get_or_404(repo, room_id)
    previous = room.status

    await repo.update(room, {"status": payload.status})
    await audit.record(
        session,
        actor_id=admin.id,
        action="room.status",
        target_table="rooms",
        target_id=room.id,
        summary={"from": previous, "to": payload.status},
    )
    await session.commit()
    return AdminRoomOut.of(room, room.status)


@router.delete("/{room_id}", status_code=204, summary="刪除房源（需管理員）")
async def delete_room(
    room_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    confirm: Annotated[bool, Query(description="二次確認；未帶時只回報影響範圍")] = False,
) -> None:
    """需管理員（FR-052）。

    **兩段式**：未帶 `confirm=true` 時不執行刪除，改回 409 並列出受影響的
    未來訂單，供前端顯示警告。這就是「需二次確認」的伺服器端落實——
    只靠前端跳一個對話框，用直接呼叫 API 就繞過去了。

    ⚠️ `orders.room_id` 是 `on delete restrict`，因此只要有**任何**歷史訂單
    （含已完成、已取消），資料庫就會拒絕刪除。這種情況下二次確認也沒有用，
    先講清楚並建議改設為「整理中」，比丟一個 IntegrityError 有用得多。
    """
    repo = AdminRoomRepository(session)
    room = await _get_or_404(repo, room_id)

    future = await repo.future_active_orders(room_id, on_or_after=dates.today())
    if future and not confirm:
        raise DomainError(
            f"此房源尚有 {len(future)} 筆未結束的訂單，刪除後這些訂單將失去對應房源。"
            "請確認後再執行。",
            code="ROOM_HAS_FUTURE_ORDERS",
            status_code=409,
        )

    if await repo.has_any_order(room_id):
        # 資料庫層擋得住，但錯誤訊息會是一句 IntegrityError。先說人話。
        raise DomainError(
            "此房源有訂單紀錄，為保留訂單的完整性而無法刪除。"
            "若要停止販售，請將房態改為「整理中」。",
            code="ROOM_HAS_ORDER_HISTORY",
            status_code=409,
        )

    removable = [p for p in (room.images or []) if room_photos.is_managed(p)]

    await audit.record(
        session,
        actor_id=admin.id,
        action="room.delete",
        target_table="rooms",
        target_id=room.id,
        summary={"name": room.name, "type": room.type},
    )
    await repo.delete(room)
    await session.commit()

    for path in removable:
        room_photos.discard(path)


# ---------------------------------------------------------------------------
# 照片
# ---------------------------------------------------------------------------


@photos_router.post("", response_model=PhotoUploadOut, summary="上傳房源照片（需管理員）")
async def upload_photo(file: Annotated[UploadFile, File()]) -> PhotoUploadOut:
    """需管理員（FR-050b、FR-050e）。

    ⚠️ **上傳只把檔案放好，不掛到任何房源上。** 要生效必須由
    `PUT /admin/rooms/{id}` 把回傳的 `path` 寫進 `images`。這個分離是
    FR-050f 的前提——使用者按取消時，本次上傳但未保存的檔案才刪得掉。

    路徑刻意不含 `{room_id}`：新增房源時房源還不存在，卻已經要能選照片。
    也刻意不掛在 `/admin/rooms/photos` 之下——見 `photos_router` 的說明。

    ⚠️ 這是系統中唯二接收圖片的端點之一。**前台的「安全檢測」沒有對應端點**，
    使用者的私人照片 MUST 全程留在瀏覽器（FR-086、SC-030）。
    """
    content = await file.read()
    path, size, content_type = room_photos.save(content=content, content_type=file.content_type)
    return PhotoUploadOut(path=path, bytes=size, content_type=content_type)


@photos_router.delete("", status_code=204, summary="捨棄尚未保存的照片（需管理員）")
async def discard_photo(
    path: Annotated[str, Query(description="上傳時回傳的 path")],
) -> None:
    """需管理員（FR-050f 的「取消」路徑）。

    使用者按下取消時由前端呼叫，清掉本次上傳但未寫進任何房源的檔案。
    找不到檔案**不視為錯誤**——重複按取消是很正常的事。
    """
    room_photos.discard(path)


# ---------------------------------------------------------------------------
# 品質檢測（US9 的後端側）
# ---------------------------------------------------------------------------


@router.post(
    "/{room_id}/risk-checks",
    response_model=RiskCheckOut,
    status_code=201,
    summary="房源品質檢測（需管理員）",
)
async def create_risk_check(
    room_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    file: Annotated[UploadFile, File()],
    brightness: Annotated[int, Form(ge=0, le=100, description="0–100，越高越好")],
    clutter: Annotated[int, Form(ge=0, le=100, description="0–100，越高越好")],
    contrast: Annotated[int, Form(ge=0, le=100, description="0–100，越高越好")],
) -> RiskCheckOut:
    """需管理員（FR-104 ~ FR-107）。

    ⚠️ **這是系統中唯一接收「檢測圖片」的端點。**

    前台的「安全檢測」（FR-062 ~ FR-067）**沒有對應的端點**——使用者上傳的
    是自己的私人照片，MUST 全程留在瀏覽器內，MUST NOT 送往任何外部服務或
    長期儲存（FR-066、FR-086、SC-030）。兩條路徑共用「計算」，不共用「上傳」。

    ⚠️ **儲存前 MUST 已告知管理員此圖將公開顯示於房源詳情頁**（FR-105）。
    那是前端的二次確認（T148），後端無從驗證；此處記錄於稽核日誌，
    讓「誰在何時把哪張圖放上公開頁面」可被追溯。

    三項指標由瀏覽器的 Canvas 分析得出，**總分與等級由後端重算**——
    同一組指標在前後端算出不同分數時，畫面與資料庫會不一致而沒有任何錯誤
    訊息（services/risk.py）。

    MUST 檢查檔案大小與 MIME 類型（FR-104、FR-107、憲章「上傳」條）。
    """
    repo = AdminRoomRepository(session)
    await _get_or_404(repo, room_id)

    assessment = risk.assess(brightness=brightness, clutter=clutter, contrast=contrast)

    content = await file.read()
    image_path, size, _content_type = room_photos.save(
        content=content, content_type=file.content_type
    )

    checks = RiskCheckRepository(session)
    # 先取舊路徑再取代——取代之後就查不到它們了，而檔案還在磁碟上。
    old_paths = await checks.previous_image_paths(room_id)

    try:
        check = await checks.replace(
            room_id,
            assessment=assessment,
            image_path=image_path,
            checked_by=admin.id,
        )
        await audit.record(
            session,
            actor_id=admin.id,
            action="room.risk_check",
            target_table="room_risk_checks",
            target_id=check.id,
            summary={
                "roomId": str(room_id),
                "riskScore": assessment.risk_score,
                "riskLevel": assessment.risk_level,
                "bytes": size,
                # 此圖會公開顯示於房源詳情頁（FR-105）。記錄下來，
                # 讓「誰在何時把哪張圖放上公開頁面」可被追溯。
                "publiclyVisible": True,
            },
        )
        await session.commit()
    except Exception:
        # 剛存下的檔案還沒有任何資料列引用它，留著就是垃圾。
        room_photos.discard(image_path)
        raise

    # 提交成功之後才刪舊檔（FR-106、FR-107）。順序相反的話，儲存失敗會留下
    # 一筆指向已刪除檔案的舊紀錄——房源詳情頁上就是一張破圖。
    room_photos.retire(old_paths)

    return RiskCheckOut.model_validate(check)


@router.get(
    "/{room_id}/affected-orders",
    response_model=list[AffectedOrderOut],
    summary="刪除前的影響範圍（需管理員）",
)
async def affected_orders(room_id: uuid.UUID, session: SessionDep) -> list[AffectedOrderOut]:
    """需管理員。供前端在二次確認對話框中列出受影響的訂單（FR-052）。"""
    repo = AdminRoomRepository(session)
    await _get_or_404(repo, room_id)
    orders = await repo.future_active_orders(room_id, on_or_after=dates.today())
    return [AffectedOrderOut.model_validate(o) for o in orders]
