"""認證端點。

⚠️ **本檔的端點皆為公開（未認證即可呼叫）——這是必然的，登入前沒有身分。**
但這也表示它們是攻擊面最大的地方，每一條的失敗行為都要刻意設計。

## 登入失敗必須無法區分（FR-004）

「帳號不存在」與「密碼錯誤」的**訊息、狀態碼與回應時間**都不得洩漏該 email
是否已註冊。前兩者容易做到；第三個容易漏——帳號不存在時若直接回傳，會比
「查到帳號 → 執行一次 argon2 驗證」快上兩個數量級，時間差本身就構成一條
帳號列舉管道（contracts/README.md）。
"""

from __future__ import annotations

import secrets
from typing import Annotated, Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import RedirectResponse

from sunny.config import get_settings
from sunny.deps import SessionDep
from sunny.errors import DomainError
from sunny.repositories.profiles import ProfileRepository
from sunny.schemas.auth import LoginIn, ProfileOut, RegisterIn, TokenOut
from sunny.services import auth

router = APIRouter(prefix="/auth", tags=["auth"])

#: 兩種登入失敗共用的訊息。**MUST 完全相同**（FR-004）。
_LOGIN_FAILED = "電子郵件或密碼錯誤。"

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def _token_response(profile: Any) -> TokenOut:
    return TokenOut(
        access_token=auth.create_access_token(profile.id, profile.role),
        profile=ProfileOut.model_validate(profile, from_attributes=True),
    )


@router.post("/register", response_model=TokenOut, status_code=201, summary="註冊（公開）")
async def register(payload: RegisterIn, session: SessionDep) -> TokenOut:
    """建立會員帳號並自動登入（FR-001、FR-002、FR-009b）。

    email 重複時回 **409**——請求本身合法，是與既有資料的衝突。
    """
    auth.validate_password_length(payload.password)

    repo = ProfileRepository(session)
    if await repo.get_by_email(payload.email) is not None:
        # 註冊端點刻意**確實**告知 email 已被使用（FR-002 明訂要顯示明確原因）。
        # 這與登入端點的不透露原則不衝突：註冊本來就必須告知才能讓使用者改用
        # 別的信箱，而任何註冊表單都無法避免洩漏這項資訊。
        raise DomainError(
            "此電子郵件已被註冊。", code="EMAIL_TAKEN", status_code=409, field="email"
        )

    profile = await repo.create(
        email=payload.email,
        password_hash=auth.hash_password(payload.password),
        display_name=payload.display_name,
    )
    await session.commit()
    return _token_response(profile)


@router.post("/login", response_model=TokenOut, summary="登入（公開）")
async def login(payload: LoginIn, session: SessionDep) -> TokenOut:
    """以電子郵件與密碼登入（FR-003、FR-004）。"""
    repo = ProfileRepository(session)
    profile = await repo.get_by_email(payload.email)

    if profile is None:
        # ⚠️ **不可直接 raise。** 先做一次虛設驗證，讓回應時間與「密碼錯誤」
        # 那條路徑相當，否則時間差會洩漏該帳號是否存在（FR-004）。
        auth.waste_time_like_a_real_verification()
        raise DomainError(_LOGIN_FAILED, code="LOGIN_FAILED", status_code=401)

    if profile.password_hash is None:
        # 僅以 Google 註冊的帳號沒有密碼。**MUST 走獨立分支**，MUST NOT 落入
        # 一般的比對失敗分支（data-model.md）——否則使用者會反覆嘗試一個
        # 從來不存在的密碼。
        raise DomainError(
            "此帳號請以 Google 登入。",
            code="USE_GOOGLE_LOGIN",
            status_code=401,
        )

    if not auth.verify_password(profile.password_hash, payload.password):
        raise DomainError(_LOGIN_FAILED, code="LOGIN_FAILED", status_code=401)

    # 成本參數調高後，於使用者登入當下（此時握有明文）自動重新雜湊，
    # 不必要求全體重設密碼（research R5）。
    if auth.needs_rehash(profile.password_hash):
        profile.password_hash = auth.hash_password(payload.password)
        await session.commit()

    return _token_response(profile)


# ---------------------------------------------------------------------------
# Google 第三方登入（FR-087、FR-088、FR-090、research R7）
# ---------------------------------------------------------------------------
def _require_google_config() -> Any:
    settings = get_settings()
    if not settings.google_client_id or not settings.google_client_secret:
        raise DomainError(
            "本站尚未啟用 Google 登入，請以電子郵件與密碼登入。",
            code="GOOGLE_NOT_CONFIGURED",
            status_code=503,
        )
    return settings


def _frontend_redirect(path: str, **fragment: str) -> RedirectResponse:
    """把瀏覽器送回前端，資料放在 **URL 片段**（`#` 之後）。

    ⚠️ **片段而非查詢字串，這個選擇是刻意的。**

    片段不會被送到任何伺服器：它不進 access log、不進 `Referer` 標頭、不會
    被反向代理或 CDN 記錄。access token 放在 `?accessToken=` 裡，等於把它
    寫進沿途每一台機器的日誌，而日誌的保存期限通常比 token 長得多。

    仍有一項殘留風險：網址列的內容會進瀏覽器歷史。前端的 `/auth/callback`
    因此在讀完之後立刻 `history.replaceState` 把它抹掉。

    這是 OAuth 把憑證交給單頁應用的標準作法，不是本專案的發明。
    """
    base = get_settings().frontend_base_url.rstrip("/")
    encoded = "&".join(f"{k}={quote(v, safe='')}" for k, v in fragment.items() if v)
    return RedirectResponse(f"{base}{path}" + (f"#{encoded}" if encoded else ""), status_code=303)


@router.get("/google", summary="導向 Google 授權頁（公開）")
async def google_start() -> RedirectResponse:
    """開始 Authorization Code Flow。

    前端只負責導向這裡並接回 code；**code 交換由後端執行**，
    client secret MUST 只存在於後端環境變數（research R7）。

    ⚠️ 這條路徑是**瀏覽器的導覽**，不是 fetch。尚未設定 Google client 時
    MUST NOT 回 503 JSON——使用者會看到一頁 `{"detail": ...}` 而不是一個
    可以理解的登入畫面。改為送回登入頁並附上原因。
    """
    try:
        settings = _require_google_config()
    except DomainError as exc:
        return _frontend_redirect("/login", error=exc.code)

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        # CSRF 防護。此處為單純的隨機值；正式部署應與 session 綁定。
        "state": secrets.token_urlsafe(16),
    }
    query = "&".join(f"{k}={httpx.QueryParams({k: v})[k]}" for k, v in params.items())
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{query}")


async def _exchange_code_for_userinfo(code: str) -> dict[str, Any]:
    """以 code 換 token，再取使用者資訊。**全程在後端。**"""
    settings = _require_google_config()
    async with httpx.AsyncClient(timeout=15) as client:
        token_res = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_res.status_code != 200:
            raise DomainError(
                "Google 登入失敗，請再試一次。",
                code="GOOGLE_EXCHANGE_FAILED",
                status_code=502,
            )
        access_token = token_res.json().get("access_token")

        info_res = await client.get(
            GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
        )
        if info_res.status_code != 200:
            raise DomainError(
                "無法取得 Google 帳號資訊，請再試一次。",
                code="GOOGLE_USERINFO_FAILED",
                status_code=502,
            )
        return info_res.json()


@router.get("/google/callback", summary="Google 回呼（公開）")
async def google_callback(
    session: SessionDep,
    code: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
) -> RedirectResponse:
    """接回 Google 的授權碼並完成登入，然後把瀏覽器送回前端。

    ⚠️ **這條路徑 MUST 回導向，MUST NOT 回 JSON。**

    抵達這裡的是 Google 把使用者的瀏覽器導過來的一次**頁面導覽**，不是前端
    發出的 fetch。回 `{"accessToken": "..."}` 的話，使用者的視窗裡就是那一行
    JSON——沒有錯誤、沒有例外、測試也全綠，只是登入流程停在一頁原始資料上，
    而且他的 token 就攤在畫面上。

    ⚠️ **FR-088 是這裡最容易失守的一條**：以既有電子郵件的 Google 帳號登入時
    MUST 進入既有帳號，MUST NOT 建立第二筆。失守的表現不是錯誤訊息，而是
    使用者「登入後訂單不見了」——沒有任何日誌會記下這件事。
    """
    if error or code is None:
        # 使用者於 Google 授權畫面取消。**MUST NOT 建立任何帳號**（FR-090）。
        return _frontend_redirect("/login", error="GOOGLE_CANCELLED")

    try:
        info = await _exchange_code_for_userinfo(code)
    except DomainError as exc:
        # 交換失敗（設定錯誤、Google 端故障）同樣是導覽中，MUST NOT 變成 JSON
        return _frontend_redirect("/login", error=exc.code)

    email = (info.get("email") or "").strip().lower()
    google_sub = info.get("sub")
    if not email or not google_sub:
        return _frontend_redirect("/login", error="GOOGLE_NO_EMAIL")

    repo = ProfileRepository(session)

    # 先以 google_sub 找（同一個 Google 帳號改過 email 的情況）
    profile = await repo.get_by_google_sub(google_sub)

    if profile is None:
        # 再以 email 找。**這一步是 FR-088 的實作**：找到就綁定，不建新帳號。
        profile = await repo.get_by_email(email)
        if profile is not None:
            profile.google_sub = google_sub
        else:
            profile = await repo.create(
                email=email,
                password_hash=None,  # 僅第三方登入的帳號沒有密碼
                display_name=info.get("name") or email.split("@")[0],
                google_sub=google_sub,
            )

    await session.commit()
    return _frontend_redirect(
        "/auth/callback", accessToken=auth.create_access_token(profile.id, profile.role)
    )
