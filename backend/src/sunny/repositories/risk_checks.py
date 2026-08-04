"""房源品質檢測的資料存取（FR-104 ~ FR-107）。

⚠️ **只有管理員路徑會寫入 `room_risk_checks`。**

前台「安全檢測」由使用者自行上傳的照片 MUST NOT 產生任何此表資料列
（FR-086、SC-030）。保證的方式是結構性的：前端根本沒有能上傳它的函式可呼叫，
且 T144／T144a 分別以靜態相依圖與執行期流量驗證這一點。

## 重新檢測會取代舊的那一筆

FR-106、FR-107：重新檢測後**舊圖片不再對外可讀取**，房源詳情頁僅顯示最新一筆。

做法是刪除舊資料列並刪除其檔案，而非留著舊列只是不顯示。留著的話會有一批
沒有任何畫面引用、卻仍可用網址直接開啟的圖片——那正是 FR-107 要避免的。
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from sunny.models.risk_check import RoomRiskCheck
from sunny.repositories.base import Repository
from sunny.services.risk import RiskAssessment


class RiskCheckRepository(Repository):
    """房源檢測紀錄。寫入僅供 `require_admin` 的路由使用。"""

    async def latest(self, room_id: uuid.UUID) -> RoomRiskCheck | None:
        """最新一筆。**尚未檢測時為 None**——前端顯示「尚未檢測」，
        MUST NOT 顯示 0 分或空白區塊（FR-014）。"""
        return await self.session.scalar(
            select(RoomRiskCheck)
            .where(RoomRiskCheck.room_id == room_id)
            .order_by(RoomRiskCheck.created_at.desc())
            .limit(1)
        )

    async def previous_image_paths(self, room_id: uuid.UUID) -> list[str]:
        """該房源既有檢測的全部圖片路徑，供刪檔使用。"""
        rows = await self.session.scalars(
            select(RoomRiskCheck.image_path).where(RoomRiskCheck.room_id == room_id)
        )
        return list(rows.all())

    async def replace(
        self,
        room_id: uuid.UUID,
        *,
        assessment: RiskAssessment,
        image_path: str,
        checked_by: uuid.UUID,
    ) -> RoomRiskCheck:
        """以新的一筆取代該房源既有的全部檢測（FR-106）。**不提交。**

        刪除舊列與新增新列在**同一個交易**內：分開提交的話，中間失敗會留下
        一間「曾經檢測過、現在查無紀錄」的房源，而詳情頁會從顯示分數變成
        顯示「尚未檢測」——看起來像資料遺失，因為那確實是。

        檔案的刪除**不在這裡**，由呼叫端於提交成功後執行
        （services/room_photos.py 的同一段考量：先刪檔後儲存失敗，
        資料列會指向不存在的檔案）。
        """
        existing = await self.session.scalars(
            select(RoomRiskCheck).where(RoomRiskCheck.room_id == room_id)
        )
        for row in existing.all():
            await self.session.delete(row)

        check = RoomRiskCheck(
            room_id=room_id,
            brightness=assessment.brightness,
            clutter=assessment.clutter,
            contrast=assessment.contrast,
            risk_score=assessment.risk_score,
            risk_level=assessment.risk_level,
            image_path=image_path,
            checked_by=checked_by,
        )
        self.session.add(check)
        await self.session.flush()
        return check


__all__ = ["RiskCheckRepository"]
