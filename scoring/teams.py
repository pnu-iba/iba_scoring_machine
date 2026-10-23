"""팀 번호·닉네임 정규화.

팀은 가입할 때 적은 팀 번호로 식별한다(결정 007). 숫자만 받으며, 앞뒤 공백을 지우고 전각 숫자를
반각으로 바꾼(NFKC) 뒤 앞자리 0을 떼어 같은 팀으로 본다("03"과 "3"은 같은 팀).
가입은 TEAMS에 있는 번호만 받는다. 관리자 페이지의 팀 번호 변경과 필터는 숫자이기만 하면 된다.
"""

from __future__ import annotations

import re
import unicodedata

MAX_TEAM_LEN = 40
MAX_NICKNAME_LEN = 40
# 이번 기수 팀 번호. 가입은 이 번호로만 받고, 리더보드는 제출이 없어도 이 팀들을 보여준다.
TEAMS = ("1", "2", "3", "4")

_WS = re.compile(r"\s+")


class NameError_(ValueError):
    pass


def _josa(word: str, with_final: str, without_final: str) -> str:
    """마지막 글자의 받침 여부에 맞는 조사(을/를, 은/는)."""
    last = word[-1]
    has_final = "가" <= last <= "힣" and (ord(last) - ord("가")) % 28 != 0
    return with_final if has_final else without_final


def clean_display(raw: str, max_len: int, label: str) -> str:
    text = _WS.sub(" ", unicodedata.normalize("NFKC", raw)).strip()
    if not text:
        raise NameError_(f"{label}{_josa(label, '을', '를')} 입력하세요.")
    if len(text) > max_len:
        raise NameError_(f"{label}{_josa(label, '은', '는')} {max_len}자 이하여야 합니다.")
    return text


def normalize_team(raw: str) -> str:
    text = clean_display(raw, MAX_TEAM_LEN, "팀 번호")
    if not (text.isascii() and text.isdigit()):
        raise NameError_("팀 번호는 숫자만 입력하세요.")
    return str(int(text))


def signup_team(raw: str) -> str:
    team = normalize_team(raw)
    if team not in TEAMS:
        raise NameError_(f"팀 번호는 {', '.join(TEAMS)} 중 하나여야 합니다.")
    return team


def clean_team_display(raw: str) -> str:
    return normalize_team(raw)


def clean_nickname(raw: str) -> str:
    return clean_display(raw, MAX_NICKNAME_LEN, "닉네임")
