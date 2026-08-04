"""pytest 共用設定。

此檔目前只建立測試能跑起來的最小骨架（T009）。共用 fixtures——測試資料庫、
member_token / admin_token / other_member_token——於 T037 補上，該任務依賴
T021（config）、T022（db）與 T031（auth service）。

**測試資料庫 MUST 為真正的 PostgreSQL。** 不能以 SQLite 替代：房況保證依賴
`EXCLUDE USING gist` 與 `daterange`，這是 PostgreSQL 特有能力（憲章原則 IV）。
換掉資料庫等於在測試裡拿掉那條保證，而測試仍會全綠——那比沒有測試更糟。
"""

from __future__ import annotations

import os

import pytest


@pytest.fixture(scope="session")
def database_url() -> str:
    """測試用的資料庫連線字串。

    以 `SUNNY_TEST_DATABASE_URL` 覆寫，避免誤連開發資料庫並清空它。
    未設定時跳過需要資料庫的測試，而非連上 `DATABASE_URL` 就地破壞資料。
    """
    url = os.environ.get("SUNNY_TEST_DATABASE_URL")
    if not url:
        pytest.skip("未設定 SUNNY_TEST_DATABASE_URL，跳過需要資料庫的測試")
    return url
