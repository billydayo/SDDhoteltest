"""首頁內容管理與主圖上傳（FR-061）。

⚠️ **寫入端點需管理員；讀取端點是公開的。**

`GET /site-content` 沒有掛 `require_admin`——前台首頁必須讀得到標題與主圖，
而首頁不需要登入。這是本專案少數幾個公開端點之一，因此在此明確註記
（deps.py：「公開端點 MUST 在路由上明確註記其為公開」）。

寫入走另一個 router，前綴 `/admin/site-content`，掛 `require_admin`。
兩者拆成兩個 router 而非在同一支函式裡判斷角色：授權掛在 router 上時，
**不可能有人新增一支函式卻忘了標註**。

## 上傳的兩段式與 FR-061

「上傳後尚未儲存就離開或改選其他圖片時，該檔案 MUST 被清除，MUST NOT 在
儲存空間留下無人引用的檔案。」

因此上傳端點只回一個路徑，**不寫進資料庫**；`PUT` 才是生效的那一步，並在
成功後把被換掉的舊檔刪除。放棄的檔案由前端呼叫 `DELETE /admin/room-photos`
清除——與房源照片共用同一套機制（services/room_photos.py），因為它們的
生命週期問題一模一樣，各寫一套只會有一套被維護。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile

from sunny.deps import AdminUser, SessionDep, require_admin
from sunny.models.site_content import SiteContent
from sunny.repositories.site_content import SiteContentRepository
from sunny.schemas.admin import PhotoUploadOut
from sunny.schemas.content import SiteContentIn, SiteContentOut
from sunny.services import audit, room_photos

#: 公開讀取。前台首頁需要它，而首頁不需要登入。
public_router = APIRouter(tags=["content"])

router = APIRouter(
    prefix="/admin/site-content",
    tags=["admin:content"],
    dependencies=[Depends(require_admin)],
)


async def _load(session) -> SiteContent:
    """取得那唯一一列（不存在時建立預設值）。

    資料存取一律經 `repositories/`，即使只有一列——憲章原則 III 沒有
    「只有一列就不算」的例外（T175、repositories/site_content.py）。
    """
    return await SiteContentRepository(session).get_or_create()


@public_router.get("/site-content", response_model=SiteContentOut, summary="首頁內容（公開）")
async def get_site_content(session: SessionDep) -> SiteContentOut:
    """**公開端點，不需登入。** 前台首頁的標題、副標與主圖（FR-061）。"""
    return SiteContentOut.model_validate(await _load(session))


@router.get("", response_model=SiteContentOut, summary="首頁內容（需管理員）")
async def get_for_edit(session: SessionDep) -> SiteContentOut:
    """需管理員。內容與公開端點相同，分開是為了讓後台的編輯畫面有一個
    與其他後台端點一致的入口（且未來若要加上未發布的草稿欄位，公開端點
    不必跟著變）。"""
    return SiteContentOut.model_validate(await _load(session))


@router.put("", response_model=SiteContentOut, summary="編輯首頁內容（需管理員）")
async def update_site_content(
    payload: SiteContentIn, session: SessionDep, admin: AdminUser
) -> SiteContentOut:
    """需管理員（FR-061）。儲存後即時套用至前台。

    ⚠️ **舊主圖於儲存成功後才刪除。** 順序相反的話，儲存失敗會留下一個
    標題指向已不存在的圖片的首頁——而首頁是所有訪客看到的第一個畫面。
    """
    content = await _load(session)
    previous_image = content.hero_image

    content.hero_title = payload.hero_title
    content.hero_subtitle = payload.hero_subtitle
    content.hero_image = payload.hero_image
    await session.flush()

    await audit.record(
        session,
        actor_id=admin.id,
        action="site_content.update",
        target_table="site_content",
        target_id=content.id,
        # 標題與副標是公開文案，不是個資；但仍只記「改了哪些欄位」，
        # 與 user.update 同一口徑——日誌的用途是「誰在何時動了什麼」。
        summary={"fields": ["heroTitle", "heroSubtitle", "heroImage"]},
    )
    await session.commit()

    # 換圖之後把舊檔清掉，避免儲存空間累積無人引用的檔案（FR-061）。
    # 只處理本系統管理的路徑——填入的外部網址不歸我們刪。
    if previous_image != content.hero_image:
        room_photos.discard(previous_image)

    return SiteContentOut.model_validate(content)


@router.post("/hero-image", response_model=PhotoUploadOut, summary="上傳首頁主圖（需管理員）")
async def upload_hero_image(file: Annotated[UploadFile, File()]) -> PhotoUploadOut:
    """需管理員。MUST 檢查檔案大小與 MIME 類型（FR-061、憲章「上傳」條）。

    ⚠️ **回傳的路徑尚未生效。** 要真正套用必須由 `PUT /admin/site-content`
    把它寫進 `heroImage`；未儲存就離開時前端 MUST 呼叫
    `DELETE /admin/room-photos` 清除（FR-061）。

    ⚠️ 上傳前 MUST 已於瀏覽器內以 Canvas 壓縮，**MUST NOT 上傳原始檔**
    （憲章「上傳」條）。後端的大小上限是最後一道網，不是壓縮的替代品。
    """
    content = await file.read()
    path, size, content_type = room_photos.save(content=content, content_type=file.content_type)
    return PhotoUploadOut(path=path, bytes=size, content_type=content_type)
