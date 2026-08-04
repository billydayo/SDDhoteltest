"""評論的自動審核（FR-103、FR-103a、SC-029）。

## ⚠️ 這是規則式引擎，不是 AI

介面 MUST 標示為「自動審核（規則式）」，**MUST NOT 被描述為 AI 或人工智慧
判讀，MUST NOT 呼叫任何外部 AI 服務**（FR-103a、憲章原則 VI）。

這是刻意的範圍決定，不是做不到（research B1-b）：規則式判定**可解釋、可覆寫**，
而那正是 FR-103b 要求的——管理員要能看到判了什麼、依據哪一條規則，才可能推翻它。
一個只給結論的模型，覆寫會變成憑感覺推翻，等於沒有初判。

## MUST 於後端執行

審核結果決定評論是否公開，屬授權範圍內的決定。留在前端等於**讓使用者自行決定
自己的評論過不過審**（research B1-b）——改一個 JavaScript 變數就能讓任何內容
標記為通過。

## 初判 MUST NOT 直接公開

本模組只產出 `auto_verdict` 與 `auto_rules`。**評論一律先進 `pending`**，
公開與否從頭到尾由人決定（FR-103、FR-045）。`auto-pass` 的意思是
「自動通過（待複核）」，不是「已公開」。

## 為什麼規則代碼不回傳給評論作者

`auto_rules` 只出現在後台（`schemas/moderation.py` 的 `ReviewOut`），
會員端的回應不含它。告訴作者「你觸發了 banned-word」等於附上一份規避指南——
他只要換掉那個詞就能通過，而審核的目的不是考驗改寫能力。
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final

from sunny.models.review import VERDICT_PASS, VERDICT_REJECT

# ---------------------------------------------------------------------------
# 規則
# ---------------------------------------------------------------------------
#: 規則代碼 → 給管理員看的說明。
#:
#: ⚠️ **代碼是穩定識別字，說明是可改的文案。** `reviews.auto_rules` 存的是代碼，
#: 一則兩年前的評論仍應查得出當時觸發了哪一條；若存的是中文說明，日後修一次
#: 字就會讓歷史紀錄跟著改變，而稽核的價值正在於它不隨後來的措辭而變。
RULE_BANNED_WORD: Final = "banned-word"
RULE_TOO_SHORT: Final = "too-short"
RULE_RATING_MISMATCH: Final = "rating-mismatch"
RULE_DUPLICATE: Final = "duplicate-content"
RULE_CLEAN: Final = "clean"

RULE_DESCRIPTIONS: Final[dict[str, str]] = {
    RULE_BANNED_WORD: "內容含不當字詞",
    RULE_TOO_SHORT: "內容過短，不足以構成評價",
    RULE_RATING_MISMATCH: "評分與內容描述不一致",
    RULE_DUPLICATE: "與同一位會員先前的評論重複",
    RULE_CLEAN: "未觸發任何退件規則",
}

#: 低於此字數視為過短（不計空白與標點）。
#:
#: 中文一個字即一個詞，10 個字大約是「房間很乾淨服務也不錯」的長度——
#: 再短就只剩情緒而沒有可供其他旅客判斷的資訊。
MIN_CONTENT_LENGTH: Final = 10

#: 不當字詞。**刻意保持短而明確**：規則式引擎的價值在於可解釋，
#: 一份龐大而模糊的清單會產出大量無法對他人交代的退件。
#: 真正的邊界案例交給管理員複核，那是 FR-103b 存在的理由。
_BANNED_WORDS: Final[tuple[str, ...]] = (
    "垃圾",
    "廢物",
    "去死",
    "白痴",
    "智障",
    "幹你",
    "他媽",
    "騙子",
    "詐騙",
    "婊",
    "fuck",
    "shit",
    "bitch",
    "asshole",
)

#: 明確的負面描述。用於「高評分卻寫負評」的矛盾偵測。
_NEGATIVE_MARKERS: Final[tuple[str, ...]] = (
    "很髒",
    "髒亂",
    "惡臭",
    "發霉",
    "蟑螂",
    "老鼠",
    "有蟲",
    "難吃",
    "很吵",
    "超吵",
    "態度差",
    "很失望",
    "非常失望",
    "不推薦",
    "不會再來",
    "糟透",
    "很爛",
    "超爛",
)

#: 明確的正面描述。用於「低評分卻寫好評」的矛盾偵測。
_POSITIVE_MARKERS: Final[tuple[str, ...]] = (
    "很乾淨",
    "非常乾淨",
    "很棒",
    "超棒",
    "很滿意",
    "非常滿意",
    "很舒適",
    "很推薦",
    "強力推薦",
    "還會再來",
    "物超所值",
    "無可挑剔",
)

#: 高評分／低評分的界線。3 分是中性，不參與矛盾判定——
#: 一則 3 分的評論本來就可能同時寫優點與缺點，那不是矛盾而是持平。
HIGH_RATING_FROM: Final = 4
LOW_RATING_UP_TO: Final = 2

#: 計算「內容長度」時要剔除的字元：空白與各類標點符號。
#:
#: 不剔除的話，「。。。。。。。。。。」會是十個字而通過長度檢查——
#: 那是這條規則最容易被繞過的方式，而且不需要任何惡意，隨手打的省略號就會。
_PUNCTUATION_CATEGORIES: Final = ("P", "S", "Z", "C")

_WHITESPACE_RE: Final = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class Verdict:
    """一次自動審核的判定。

    `rules` **永遠非空**：通過時為 `["clean"]`。SC-029 要求每一則樣本都產出
    「可解釋且附觸發規則」的判定，而一個空陣列解釋不了任何事——管理員看到的
    會是一片空白，分不出「沒觸發規則」與「引擎沒跑」。
    """

    verdict: str
    rules: list[str]

    @property
    def rejected(self) -> bool:
        return self.verdict == VERDICT_REJECT

    def explain(self) -> list[str]:
        """觸發規則的中文說明，依 `rules` 的順序。

        供管理員介面與測試使用。找不到說明的代碼原樣回傳——那表示有人新增了
        規則卻忘了寫說明，讓它顯眼地出現在畫面上，比安靜地少一行好。
        """
        return [RULE_DESCRIPTIONS.get(code, code) for code in self.rules]


def _significant_length(comment: str) -> int:
    """扣掉空白與標點後的字數。"""
    return sum(1 for ch in comment if unicodedata.category(ch)[0] not in _PUNCTUATION_CATEGORIES)


def normalize(comment: str) -> str:
    """比對用的正規化形式：全形轉半形、小寫、去除空白。

    ⚠️ **重複偵測 MUST 用這個形式比對。** 直接比對原文的話，同一段話多打一個
    空格或換成全形標點就會被視為不同——而那正是重複送件最常見的樣子，
    多半還不是故意的（複製貼上時帶進了不同的空白）。
    """
    folded = unicodedata.normalize("NFKC", comment).casefold()
    return _WHITESPACE_RE.sub("", folded)


def _contains_any(haystack: str, needles: Iterable[str]) -> bool:
    return any(needle in haystack for needle in needles)


def review(
    *,
    rating: int,
    comment: str,
    previous_comments: Iterable[str] = (),
) -> Verdict:
    """對一則評論做初判（FR-103）。

    四條退件規則，全部命中的都會列出——**MUST NOT 在第一條命中時就回傳**。
    只回一條的話，管理員改掉那一條之後才發現還有第二條，複核要來回好幾次；
    而更糟的是他會以為「只有這一個問題」。

    `previous_comments` 是**同一位會員**先前的評論內文。呼叫端負責只給本人的
    ——拿全站的評論來比會把兩個人碰巧寫得一樣的短句判成重複，而那不是重複送件。

    回傳 `auto-pass` 時仍 MUST 進入待審核（FR-045）。本函式不決定 `status`。
    """
    normalized = normalize(comment)
    rules: list[str] = []

    if _contains_any(normalized, (normalize(word) for word in _BANNED_WORDS)):
        rules.append(RULE_BANNED_WORD)

    if _significant_length(comment) < MIN_CONTENT_LENGTH:
        rules.append(RULE_TOO_SHORT)

    if _rating_contradicts(rating, normalized):
        rules.append(RULE_RATING_MISMATCH)

    if any(normalize(previous) == normalized for previous in previous_comments):
        rules.append(RULE_DUPLICATE)

    if rules:
        return Verdict(verdict=VERDICT_REJECT, rules=rules)
    return Verdict(verdict=VERDICT_PASS, rules=[RULE_CLEAN])


def _rating_contradicts(rating: int, normalized: str) -> bool:
    """評分與內容是否明顯矛盾。

    只在**兩端**判定（4–5 分寫負評、1–2 分寫好評）。3 分不判——持平的評論
    本來就會同時寫優點與缺點，把它算成矛盾會讓最中肯的那些評論全部進退件。

    ⚠️ 這條規則的退件率天生偏高（反諷、轉折句都可能命中），因此它 MUST 只是
    初判。真正的把關是管理員的複核（FR-103b），本模組不決定公開與否。
    """
    if rating >= HIGH_RATING_FROM:
        return _contains_any(normalized, (normalize(m) for m in _NEGATIVE_MARKERS))
    if rating <= LOW_RATING_UP_TO:
        return _contains_any(normalized, (normalize(m) for m in _POSITIVE_MARKERS))
    return False


__all__ = [
    "HIGH_RATING_FROM",
    "LOW_RATING_UP_TO",
    "MIN_CONTENT_LENGTH",
    "RULE_BANNED_WORD",
    "RULE_CLEAN",
    "RULE_DESCRIPTIONS",
    "RULE_DUPLICATE",
    "RULE_RATING_MISMATCH",
    "RULE_TOO_SHORT",
    "VERDICT_PASS",
    "VERDICT_REJECT",
    "Verdict",
    "normalize",
    "review",
]
