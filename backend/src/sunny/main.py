"""FastAPI 應用進入點。

三件事在此集中：CORS、全域例外處理、路由註冊。

## 錯誤格式

所有錯誤回應統一為結構化 JSON（contracts/README.md）：

    {"detail": "使用者可理解的繁體中文訊息", "code": "ROOM_UNAVAILABLE"}

**MUST NOT 回傳堆疊追蹤、SQL 語句或內部檔案路徑**（憲章後端約束）。
真正的成因寫進伺服器日誌，不送給用戶端——錯誤訊息是攻擊者最省力的偵察管道。
"""

from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from sunny.config import get_settings
from sunny.db import dispose_engine
from sunny.errors import DomainError, InternalError, translate_integrity_error

logger = logging.getLogger("sunny")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # 設定於此處讀取一次。缺少必要環境變數時 pydantic 會拋 ValidationError，
    # 應用因而在啟動時明確失敗——這是刻意的，MUST NOT 以預設值靜默啟動。
    get_settings()
    yield
    await dispose_engine()


#: 合法的 `field` 值：ASCII 識別字。前端會拿它組 `[name="..."]` 選擇器。
_FIELD_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


def _to_camel(value: str) -> str:
    head, *rest = value.split("_")
    return head + "".join(word.capitalize() for word in rest)


def _error_response(
    detail: str, code: str, status_code: int, field: str | None = None
) -> JSONResponse:
    """錯誤回應：`{"detail", "code"}`，逐欄錯誤另帶 `field`。

    ⚠️ **`field` MUST 以請求上的名稱回覆，也就是 camelCase。**

    領域層寫的是 `check_out`——那是 Python／資料庫的命名。但用戶端送出的是
    `checkOut`，它的輸入框也叫 `checkOut`。回一個 `check_out` 等於指向一個
    請求裡不存在的欄位：前端拿它去找輸入框會找不到，於是**焦點安靜地不動**，
    而 FR-010 要求的正是「將焦點移至第一個有問題的欄位」。

    這種失敗不會拋錯、不會出現在日誌裡，畫面上只是「錯誤訊息出現了但游標
    沒動」——沒有人會把它當成 bug 回報。
    """
    content: dict[str, str] = {"detail": detail, "code": code}
    if field:
        # ⚠️ `utils.dates.parse_calendar_date` 也有一個叫 `field` 的參數，
        # 但它是**給人看的中文標籤**（「入住日」），只被插進訊息裡。哪天有人
        # 把它接到這裡，前端就會拿「入住日」去查 DOM 選擇器而靜默失敗。
        # 在邊界擋掉，並留下日誌——這比在十個呼叫端各自小心可靠。
        if _FIELD_NAME_RE.match(field):
            content["field"] = _to_camel(field)
        else:
            logger.warning("捨棄非識別字的錯誤欄位名: %r（code=%s）", field, code)
    return JSONResponse(status_code=status_code, content=content)


#: 框架層 HTTP 錯誤的繁體中文訊息與機器可讀代碼。
#:
#: ⚠️ 訊息 MUST NOT 透露路徑是否存在的細節。「找不到您要的頁面」對打錯網址的
#: 使用者已經足夠；而對正在探測端點的人，它不提供任何額外資訊。
_HTTP_ERRORS: dict[int, tuple[str, str]] = {
    404: ("找不到您要的資源。", "NOT_FOUND"),
    405: ("此操作不被支援。", "METHOD_NOT_ALLOWED"),
    413: ("送出的內容過大。", "PAYLOAD_TOO_LARGE"),
    415: ("不支援的檔案或內容類型。", "UNSUPPORTED_MEDIA_TYPE"),
    429: ("操作過於頻繁，請稍候再試。", "TOO_MANY_REQUESTS"),
}


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Sunny 訂房平台 API",
        description=(
            "React SPA 與資料庫之間的唯一通道。\n\n"
            "**付款與退款為模擬**，不涉及任何真實金流；**認證與授權為真實實作**。"
            "兩者混在同一個介面裡而不加區分，比全部都假還危險。"
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    # -- CORS ---------------------------------------------------------------
    # 允許來源 MUST 明確列出。**MUST NOT 使用 ["*"] 搭配 allow_credentials=True**
    # （憲章後端約束）——那個組合會讓任何網站都能帶著使用者的憑證呼叫本 API。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # -- 例外處理 ------------------------------------------------------------
    @app.exception_handler(DomainError)
    async def _domain_error(_: Request, exc: DomainError) -> JSONResponse:
        if isinstance(exc, InternalError):
            # 成因只寫日誌，不送給用戶端
            logger.error("內部錯誤: %s", exc.internal_reason)
        return _error_response(exc.detail, exc.code, exc.status_code, exc.field)

    @app.exception_handler(IntegrityError)
    async def _integrity_error(_: Request, exc: IntegrityError) -> JSONResponse:
        # **以約束名稱分派**。只看例外型別會把「夜數對不上」回成「已無空房」，
        # 使用者照著訊息改日期永遠改不好（research R3）。
        domain = translate_integrity_error(exc)
        if isinstance(domain, InternalError):
            logger.error("未預期的約束違反: %s", domain.internal_reason)
        return _error_response(domain.detail, domain.code, domain.status_code, domain.field)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI 預設的 422 內容含欄位路徑與輸入值，對使用者不可讀，
        # 且可能回顯送出的內容。改為單一可讀訊息，細節留在日誌。
        logger.info("輸入驗證失敗: %s", exc.errors())
        return _error_response(
            "送出的資料格式不正確，請檢查各欄位後重試。", "VALIDATION_ERROR", 422
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        # 框架自己產生的 404／405 預設回 `{"detail": "Not Found"}`：**英文，
        # 且沒有 `code`**。contracts/README.md 明訂所有錯誤回應為
        # `{"detail": ..., "code": ...}`，FR-069 要求介面文字為繁體中文。
        #
        # 少了 `code`，前端只能比對 detail 字串來判斷錯誤種類——那會在任何
        # 一次文案修改時無聲壞掉。而英文訊息會直接出現在使用者面前。
        detail, code = _HTTP_ERRORS.get(
            exc.status_code, ("操作無法完成，請稍後再試。", "HTTP_ERROR")
        )
        return _error_response(detail, code, exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("未處理的例外", exc_info=exc)
        return _error_response("系統發生內部錯誤，請稍後再試。", "INTERNAL_ERROR", 500)

    _register_routers(app)
    _mount_uploads(app)
    return app


def _mount_uploads(app: FastAPI) -> None:
    """對外提供已上傳的房源照片。

    `room_photos.save()` 回傳的是 `/uploads/<檔名>`，而那個路徑要真的能被瀏覽器
    取到，才有房源照片可看。少了這一段，上傳會成功、`images` 會寫進去、
    後台與前台各顯示一張破圖——**沒有任何錯誤訊息**，因為每一步都成功了。

    ⚠️ **公開，不需登入。** 房源詳情頁對訪客開放（US1），照片自然也是。
    這裡不是存取控制的位置：真正需要保護的是「誰能上傳」，而那由
    `admin_rooms.photos_router` 的 `require_admin` 把關（FR-050e）。

    路徑前綴取自 `room_photos.PUBLIC_PREFIX`，目錄取自 `room_photos.upload_root()`
    ——兩者都只有一個來源。在這裡寫死 `"/uploads"` 會與存檔端各自演化。
    """
    from fastapi.staticfiles import StaticFiles

    from sunny.services import room_photos

    app.mount(
        room_photos.PUBLIC_PREFIX.rstrip("/"),
        StaticFiles(directory=room_photos.upload_root()),
        name="uploads",
    )


def _register_routers(app: FastAPI) -> None:
    """註冊路由。

    ⚠️ **每個路由 MUST 明確宣告其授權要求**（`Depends(get_current_user)` 或
    `require_admin`）。預設不是「公開」而是「需登入」——新增路由時忘記標註
    MUST 導致拒絕而非放行（contracts/README.md）。

    移除 RLS 後這是唯一的存取邊界。
    """
    from sunny.routers import (
        admin_channel,
        admin_content,
        admin_dashboard,
        admin_exports,
        admin_logs,
        admin_messages,
        admin_orders,
        admin_refunds,
        admin_reviews,
        admin_rooms,
        admin_settings,
        admin_users,
        auth,
        favorites,
        messages,
        orders,
        profiles,
        rooms,
    )

    app.include_router(rooms.router)  # 公開：瀏覽與搜尋
    app.include_router(auth.router)  # 公開：登入前沒有身分
    app.include_router(admin_content.public_router)  # 公開：首頁標題與主圖
    app.include_router(profiles.router)  # 需登入
    app.include_router(orders.router)  # 需登入
    app.include_router(favorites.router)  # 需登入
    app.include_router(messages.router)  # 需登入

    # 後台。授權以 `dependencies=[Depends(require_admin)]` 掛在各 router 上，
    # 而非逐一標註在函式——漏標一個函式就是一個公開的後台端點，
    # 而那不會有任何測試失敗。T116 的契約測試逐一驗證這件事。
    app.include_router(admin_dashboard.router)  # 需管理員
    app.include_router(admin_rooms.router)  # 需管理員
    app.include_router(admin_rooms.photos_router)  # 需管理員
    app.include_router(admin_orders.router)  # 需管理員
    app.include_router(admin_users.router)  # 需管理員
    app.include_router(admin_reviews.router)  # 需管理員
    app.include_router(admin_refunds.router)  # 需管理員
    app.include_router(admin_content.router)  # 需管理員
    app.include_router(admin_exports.router)  # 需管理員
    app.include_router(admin_channel.router)  # 需管理員
    app.include_router(admin_logs.router)  # 需管理員
    app.include_router(admin_settings.router)  # 需管理員
    app.include_router(admin_messages.router)  # 需管理員


app: Any = create_app()
