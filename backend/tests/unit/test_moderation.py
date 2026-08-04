"""T105：規則式自動審核（SC-029、FR-103、FR-103a）。

SC-029 指定了五則樣本：**不當字詞、過短、評分與內容矛盾、重複送件、正常**，
並要求 100% 產出「可解釋且附觸發規則」的判定。因此本檔的核心不是「判對了嗎」，
而是三件事：

1. 每一則都有判定（`auto-pass` / `auto-reject`）
2. 每一則都附觸發規則，**包含正常的那一則**（`["clean"]`）
3. 每一條規則都有中文說明——「可解釋」不能只是一串英文代碼

第 2 點是最容易寫錯的：正常的評論很自然地會回一個空陣列，而空陣列在後台
畫面上與「引擎沒跑」完全一樣。管理員無從分辨「檢查過，沒問題」與「這則
根本沒被檢查」。

## 不需要資料庫

純函式。`previous_comments` 由呼叫端（`routers/reviews.py`）自資料庫取得後
傳入——把查詢留在外面，這一層才測得起來，也才不會有人為了測試而去接一個
假的 session。
"""

from __future__ import annotations

import pytest

from sunny.models.review import VERDICT_PASS, VERDICT_REJECT
from sunny.services import moderation

# ---------------------------------------------------------------------------
# SC-029 的五則樣本
# ---------------------------------------------------------------------------
#: (樣本名稱, 評分, 內文, 先前評論, 期望判定, 期望觸發的規則)
_SAMPLES = [
    (
        "不當字詞",
        1,
        "這間根本是垃圾，櫃檯的態度也差到極點，完全不值這個價錢。",
        [],
        VERDICT_REJECT,
        moderation.RULE_BANNED_WORD,
    ),
    (
        "過短",
        5,
        "不錯。",
        [],
        VERDICT_REJECT,
        moderation.RULE_TOO_SHORT,
    ),
    (
        "評分與內容矛盾",
        5,
        "浴室很髒，床單有異味，整晚都沒睡好，實在非常失望。",
        [],
        VERDICT_REJECT,
        moderation.RULE_RATING_MISMATCH,
    ),
    (
        "重複送件",
        4,
        "房間乾淨、採光很好，櫃檯人員也很親切，整體住起來很舒服。",
        ["房間乾淨、採光很好，櫃檯人員也很親切，整體住起來很舒服。"],
        VERDICT_REJECT,
        moderation.RULE_DUPLICATE,
    ),
    (
        "正常",
        4,
        "房間比想像中寬敞，早餐的選擇也多，下次來這一帶還會再訂。",
        [],
        VERDICT_PASS,
        moderation.RULE_CLEAN,
    ),
]

_IDS = [name for name, *_ in _SAMPLES]


@pytest.mark.parametrize(
    ("rating", "comment", "previous", "expected_verdict", "expected_rule"),
    [sample[1:] for sample in _SAMPLES],
    ids=_IDS,
)
def test_every_sample_gets_an_explainable_verdict(
    rating: int,
    comment: str,
    previous: list[str],
    expected_verdict: str,
    expected_rule: str,
) -> None:
    """五則樣本 **100%** 產出可解釋且附觸發規則的判定（SC-029）。"""
    verdict = moderation.review(rating=rating, comment=comment, previous_comments=previous)

    assert verdict.verdict == expected_verdict
    assert expected_rule in verdict.rules, f"期望觸發 {expected_rule}，實際為 {verdict.rules}"

    # 「可解釋」：每一條規則都要說得出中文理由。少一條說明，後台就會出現
    # 一串英文代碼——管理員看不懂的初判，覆寫就變成憑感覺推翻（FR-103b）。
    assert verdict.rules, "判定 MUST 附觸發規則，空陣列解釋不了任何事"
    assert verdict.explain() == [moderation.RULE_DESCRIPTIONS[code] for code in verdict.rules]
    assert all(text.strip() for text in verdict.explain())


def test_every_rule_code_has_a_chinese_description() -> None:
    """新增規則卻忘了寫說明時，在這裡失敗而不是在後台畫面上。

    FR-069：介面文字 MUST 為繁體中文。規則代碼會原樣顯示在評論審核頁，
    漏掉說明的後果是管理員看到 `rating-mismatch`。
    """
    codes = {
        value
        for name, value in vars(moderation).items()
        if name.startswith("RULE_") and isinstance(value, str)
    }
    assert codes, "找不到任何規則代碼——這個測試正在空轉"
    assert codes <= set(moderation.RULE_DESCRIPTIONS)


# ---------------------------------------------------------------------------
# 規則各自的邊界
# ---------------------------------------------------------------------------
def test_all_triggered_rules_are_reported_not_just_the_first() -> None:
    """一則同時犯了多條的評論 MUST 列出全部。

    只回第一條的話，管理員請對方改掉之後才發現還有第二條，要來回好幾次；
    更糟的是他會以為「只有這一個問題」而據此回覆。
    """
    verdict = moderation.review(rating=5, comment="垃圾", previous_comments=[])

    assert verdict.rejected
    assert moderation.RULE_BANNED_WORD in verdict.rules
    assert moderation.RULE_TOO_SHORT in verdict.rules


def test_punctuation_does_not_pad_out_the_length() -> None:
    """⚠️ 標點與空白不計入字數。

    「。。。。。。。。。。」有十個字元，卻沒有任何內容。不剔除的話，這是
    長度規則最容易被繞過的方式，而且完全不需要惡意——隨手打的一串省略號就會。
    """
    verdict = moderation.review(
        rating=5, comment="。。。。。。。。。。！！！", previous_comments=[]
    )
    assert moderation.RULE_TOO_SHORT in verdict.rules


def test_duplicate_detection_ignores_spacing_and_width() -> None:
    """同一段話換了空白或全形標點仍算重複。

    複製貼上很常帶進不同的空白字元。比對原文的話，這種最典型的重複送件
    會被判為新內容。
    """
    original = "房間乾淨、採光很好，櫃檯人員也很親切，整體住起來很舒服。"
    resubmitted = " 房間乾淨、採光很好，  櫃檯人員也很親切，整體住起來很舒服。 "

    verdict = moderation.review(rating=4, comment=resubmitted, previous_comments=[original])
    assert moderation.RULE_DUPLICATE in verdict.rules


def test_a_different_members_identical_wording_is_not_the_callers_problem() -> None:
    """重複只比對**傳進來的**清單。

    呼叫端 MUST 只給本人先前的評論（`ReviewRepository.comments_by`）。這個
    測試釘住的是本函式不會自己去撈別人的資料——兩個人碰巧寫了同一句
    「房間乾淨、交通方便」不是重複送件。
    """
    verdict = moderation.review(
        rating=4,
        comment="房間乾淨、採光很好，櫃檯人員也很親切，整體住起來很舒服。",
        previous_comments=[],
    )
    assert verdict.verdict == VERDICT_PASS


@pytest.mark.parametrize("rating", [3])
def test_a_neutral_rating_never_counts_as_contradiction(rating: int) -> None:
    """3 分不判矛盾。

    持平的評論本來就會同時寫優點與缺點，把它算成矛盾會讓最中肯的那些評論
    全部進退件——而那些正是其他旅客最需要看到的。
    """
    verdict = moderation.review(
        rating=rating,
        comment="床很舒服，但隔壁施工很吵，整體還算可以接受。",
        previous_comments=[],
    )
    assert moderation.RULE_RATING_MISMATCH not in verdict.rules


def test_a_low_rating_with_glowing_content_is_also_a_mismatch() -> None:
    """矛盾偵測是雙向的。

    只查「高分寫負評」會漏掉按錯星數的那一半——一位其實很滿意的房客給了
    1 分，那則評論會拉低房源平均（FR-046），而內容本身讀起來完全正面。
    """
    verdict = moderation.review(
        rating=1,
        comment="房間很乾淨，服務也很棒，下次還會再來住這一間。",
        previous_comments=[],
    )
    assert moderation.RULE_RATING_MISMATCH in verdict.rules


def test_verdict_never_decides_publication() -> None:
    """⚠️ 本模組 MUST NOT 產出 `approved`（FR-045、FR-103）。

    初判只有 `auto-pass` 與 `auto-reject` 兩個值，兩者都不是評論狀態。
    哪天有人讓它回一個 `approved`，`routers/reviews.py` 若照著寫進 `status`，
    前台就會多出一批沒有人看過的評論——而過程中不會有任何錯誤。
    """
    for rating, comment in ((5, "很棒的一次住宿體驗，房間寬敞明亮。"), (1, "垃圾")):
        verdict = moderation.review(rating=rating, comment=comment, previous_comments=[])
        assert verdict.verdict in {VERDICT_PASS, VERDICT_REJECT}
