"""房源與詞彙表的公開端點。

⚠️ **本檔的所有端點皆為「公開」——這是刻意的，且已明確標註。**

contracts/README.md：「每個路由 MUST 明確宣告其授權要求。預設不是『公開』
而是『需登入』。」訪客瀏覽、搜尋與已通過審核的評論是憲章允許的公開層級
（US1 的整個前提就是不需登入即可瀏覽）。

新增端點到本檔時 MUST 重新確認它真的該公開。
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select

from sunny.deps import SessionDep
from sunny.errors import DomainError
from sunny.models.risk_check import RoomRiskCheck
from sunny.repositories.rooms import RoomRepository
from sunny.repositories.settings import SettingsRepository
from sunny.schemas.room import RiskCheckOut, RoomDetailOut, RoomOut, VocabularyOut
from sunny.services import search
from sunny.utils import dates

router = APIRouter(tags=["rooms"])


@router.get("/rooms", response_model=list[RoomOut], summary="搜尋房源（公開）")
async def list_rooms(
    session: SessionDep,
    keyword: Annotated[str | None, Query(description="關鍵字：房名、房型或描述")] = None,
    check_in: Annotated[str | None, Query(alias="checkIn", description="YYYY-MM-DD")] = None,
    check_out: Annotated[str | None, Query(alias="checkOut", description="YYYY-MM-DD")] = None,
    guest_count: Annotated[int | None, Query(alias="guestCount")] = None,
    max_price: Annotated[int | None, Query(alias="maxPrice")] = None,
    amenities: Annotated[list[str] | None, Query(description="須同時具備（AND）")] = None,
    features: Annotated[list[str] | None, Query(description="須同時具備（AND）")] = None,
    room_type: Annotated[str | None, Query(alias="type", description="房型頁籤")] = None,
    sort: Annotated[str | None, Query(description="price_asc / price_desc / rating_*")] = None,
) -> list[RoomOut]:
    """公開端點。**不需登入。**

    條件式必填的檢查只在有帶日期或人數時才生效——首頁初次載入不帶任何參數，
    因而回傳全部房源（FR-010、US1）。
    """
    parsed_in, parsed_out, guests = search.validate_conditional_filters(
        check_in, check_out, guest_count
    )
    search.validate_sort(sort)

    rooms = await RoomRepository(session).search(
        keyword=keyword,
        check_in=parsed_in,
        check_out=parsed_out,
        guest_count=guests,
        max_price=max_price,
        amenities=amenities,
        features=features,
        room_type=room_type,
        sort=sort,
    )
    return [RoomOut.model_validate(r) for r in rooms]


@router.get("/rooms/{room_id}", response_model=RoomDetailOut, summary="房源詳情（公開）")
async def get_room(
    room_id: uuid.UUID,
    session: SessionDep,
    on: str | None = Query(default=None, description="查詢房態的日期，預設今日"),
) -> RoomDetailOut:
    """公開端點。**不需登入。**

    房態依 `on` 所指的日期推導；未指定時以今日計（FR-015）。
    """
    repo = RoomRepository(session)
    room = await repo.get(room_id)
    if room is None:
        raise DomainError("查無此房源。", code="ROOM_NOT_FOUND", status_code=404)

    day: date = dates.parse_calendar_date(on, field="查詢日期") if on else dates.today()
    availability = await repo.availability_on(room_id, day)

    # 最新一次的品質檢測。**尚未檢測時為 None**——前端顯示「尚未檢測」，
    # MUST NOT 顯示 0 分或空白區塊（FR-014）。
    latest = await session.scalar(
        select(RoomRiskCheck)
        .where(RoomRiskCheck.room_id == room_id)
        .order_by(RoomRiskCheck.created_at.desc())
        .limit(1)
    )

    return RoomDetailOut.from_room(
        room,
        availability=availability,
        latest_risk_check=RiskCheckOut.model_validate(latest) if latest else None,
    )


@router.get("/vocabulary", response_model=VocabularyOut, summary="設施與房型特色（公開）")
async def get_vocabulary(session: SessionDep) -> VocabularyOut:
    """公開端點。**不需登入。**

    ⚠️ 這兩份清單 MUST 對未登入的訪客可讀，否則前台的篩選器會是空的
    （FR-010a）。尚未設定過時退回程式內建的預設值。
    """
    repo = SettingsRepository(session)
    return VocabularyOut(amenities=await repo.amenities(), features=await repo.features())
