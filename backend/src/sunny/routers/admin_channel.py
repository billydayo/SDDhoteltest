"""渠道比價與控價（FR-108 ~ FR-113）。

⚠️ **本檔全部端點需管理員**，`dependencies` 掛在 router 上。

⚠️ **本模組不連線至任何外部平台，也不發送任何郵件。**

資料來自 `channel_prices` 種子表，是**模擬資料**（FR-109、FR-110）。
限制的理由不是技術做不到——現在有後端了——而是爬取 OTA 平台通常違反其
服務條款；「後端的存在 MUST NOT 被當成『現在可以寫爬蟲了』的理由」
（research B1-a、憲章原則 VI）。

申訴郵件只組出文字供管理員自行複製寄出（FR-112）。介面上 MUST 明確告知
系統不會代為寄送——一個看起來會寄出的按鈕，按下去卻什麼也沒發生，
比沒有這個功能更糟。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from sunny.deps import AdminUser, SessionDep, require_admin
from sunny.errors import DomainError
from sunny.repositories.admin_channel import ChannelPriceRepository
from sunny.schemas.channel import ChannelComparisonOut, ComplaintOut, ResolveIn
from sunny.services import audit, channel

router = APIRouter(
    prefix="/admin/channel-prices",
    tags=["admin:channel"],
    dependencies=[Depends(require_admin)],
)


async def _get_or_404(repo: ChannelPriceRepository, price_id: uuid.UUID):
    row = await repo.get(price_id)
    if row is None:
        raise DomainError("查無此比價紀錄。", code="CHANNEL_PRICE_NOT_FOUND", status_code=404)
    return row


@router.get("", response_model=list[ChannelComparisonOut], summary="渠道比價（需管理員）")
async def list_comparisons(
    session: SessionDep,
    room_id: Annotated[uuid.UUID | None, Query(alias="roomId")] = None,
    resolved: Annotated[bool | None, Query(description="是否已標記處理")] = None,
) -> list[ChannelComparisonOut]:
    """需管理員（FR-108）。依房源列出官網價、各平台售價、價差金額與百分比。

    ⚠️ **每一列都帶 `simulated: true` 與 `simulatedNotice`。** 介面頂端的常駐
    提示（FR-110）只存在於畫面；資料會被匯出、截圖、轉寄，標記必須跟著走。
    """
    rows = await ChannelPriceRepository(session).search(room_id=room_id, resolved=resolved)
    return [ChannelComparisonOut.of(c) for c in channel.compare_all(rows)]


@router.get(
    "/{price_id}/complaint",
    response_model=ComplaintOut,
    summary="申訴郵件範本（需管理員）",
)
async def complaint_template(price_id: uuid.UUID, session: SessionDep) -> ComplaintOut:
    """需管理員（FR-112）。**系統 MUST NOT 代為寄送。**

    只回主旨與內文，供管理員自行複製。刻意不回傳收件者信箱——一個帶著收件者的
    範本會讓人以為只差按一下送出。前端 MUST 於畫面上明確告知不會代寄。
    """
    row = await _get_or_404(ChannelPriceRepository(session), price_id)
    comparison = channel.compare(row)
    template = channel.compose_complaint(comparison)
    return ComplaintOut(
        subject=template["subject"],
        body=template["body"],
        will_send=False,
        notice="系統不會代為寄送此郵件，請自行複製內容後以自己的信箱寄出。",
    )


@router.patch(
    "/{price_id}/resolved",
    response_model=ChannelComparisonOut,
    summary="標記已處理（需管理員）",
)
async def set_resolved(
    price_id: uuid.UUID, payload: ResolveIn, session: SessionDep, admin: AdminUser
) -> ChannelComparisonOut:
    """需管理員（FR-113）。標記與取消標記皆 MUST 寫入 `admin_logs`。

    允許取消標記（`resolved: false`）：誤按之後若不能還原，那筆預警就會永遠
    從待處理清單消失，而它並沒有被處理。
    """
    repo = ChannelPriceRepository(session)
    price, room_name, official_price = await _get_or_404(repo, price_id)

    if price.resolved == payload.resolved:
        raise DomainError(
            "此紀錄已是該狀態，未做任何變更。",
            code="CHANNEL_STATUS_UNCHANGED",
            status_code=400,
            field="resolved",
        )

    await repo.mark_resolved(price, resolved=payload.resolved)

    await audit.record(
        session,
        actor_id=admin.id,
        action="channel.resolve" if payload.resolved else "channel.unresolve",
        target_table="channel_prices",
        target_id=price.id,
        summary={
            "roomName": room_name,
            "channel": price.channel,
            "resolved": payload.resolved,
            **({"note": payload.note} if payload.note else {}),
        },
    )
    await session.commit()

    return ChannelComparisonOut.of(channel.compare((price, room_name, official_price)))
