"""SQLAlchemy 2.0 宣告式模型。

12 張表，與 `alembic/versions/0001_initial.py` 一致。

**模型不是結構的事實來源**——Alembic 的遷移歷程才是（憲章資料庫約束）。
PostgreSQL 特有的結構（`EXCLUDE USING gist`、trigger、函式）無法由模型完整
表達，由遷移以原生 SQL 維護。模型裡看不見不代表它們不存在，原則 IV 的
房況保證正是其中之一。
"""

from sunny.models.admin_log import AdminLog
from sunny.models.base import Base
from sunny.models.channel_price import ChannelPrice
from sunny.models.favorite import Favorite
from sunny.models.message import Message
from sunny.models.order import Order
from sunny.models.profile import Profile
from sunny.models.refund import Refund
from sunny.models.review import Review
from sunny.models.risk_check import RoomRiskCheck
from sunny.models.room import Room
from sunny.models.site_content import SiteContent
from sunny.models.system_setting import SystemSetting

__all__ = [
    "AdminLog",
    "Base",
    "ChannelPrice",
    "Favorite",
    "Message",
    "Order",
    "Profile",
    "Refund",
    "Review",
    "Room",
    "RoomRiskCheck",
    "SiteContent",
    "SystemSetting",
]
