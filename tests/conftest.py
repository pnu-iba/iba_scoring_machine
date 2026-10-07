"""API 레벨 테스트용 픽스처. DB 대신 MemoryStore, 시계는 주입 가능한 함수로 바꿔 끼운다.

고정 입력 두 개(스펙 "Validation Decisions"):
- public/data/sample_submission.csv → RMSE ≈ 13,189.79, R² ≈ -0.79
- 정답 자체를 제출 → RMSE 0, R² 1
제출은 로그인이 필요하므로 submit()은 (팀, 닉네임)마다 계정을 하나 만들어 로그인한 뒤 제출한다.
정답 파일은 저장소에 없으므로, 테스트는 작은 합성 정답(ANSWER_ROWS)으로 파싱·제한·리더보드를 검사하고,
실제 answer.csv가 있는 환경에서만 sample_submission 기준값 테스트를 돌린다.
"""

from __future__ import annotations

import hashlib
import os
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import auth
from app import app
from scoring.clock import ContestSettings
from store import Answers, MemoryStore

ANSWER_ROWS = [(69940, 20299.0), (44315, 13000.0), (10001, 8000.0), (10001, 25000.0), (55555, 15000.0)]
# public 채점 구간: 첫 행과 셋째 행
PUBLIC = [True, False, True, False, False]
# 테스트 시계(2026-09-19)가 대회 기간 안에 들도록 한 일정
SETTINGS = ContestSettings(date(2026, 9, 1), date(2026, 10, 5), 3)


class FakeClock:
    def __init__(self, start: datetime):
        self.now = start

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs) -> None:
        self.now += timedelta(**kwargs)


@pytest.fixture
def clock():
    # 2026-09-19 15:00 KST = 06:00 UTC
    return FakeClock(datetime(2026, 9, 19, 6, 0, tzinfo=timezone.utc))


@pytest.fixture
def store():
    s = MemoryStore(Answers(ids=[r[0] for r in ANSWER_ROWS], prices=[r[1] for r in ANSWER_ROWS], public=PUBLIC))
    s.save_settings(SETTINGS)
    return s


@pytest.fixture
def client(store, clock, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "test-session-secret")
    monkeypatch.setattr(auth, "PBKDF2_ITERATIONS", 1000)  # 테스트 속도용
    app.state.store = store
    app.state.now = clock
    app.state.answers = None
    with TestClient(app) as c:
        yield c
    app.state.answers = None


def csv_bytes(rows: list[tuple], header: str = "id,price") -> bytes:
    lines = [header] + [f"{a},{b}" for a, b in rows]
    return ("\n".join(lines) + "\n").encode("utf-8")


PASSWORD = "password123"


def signup(client: TestClient, username: str, team: str = "3", nickname: str = "민석", password: str = PASSWORD):
    return client.post(
        "/api/signup", json={"username": username, "password": password, "nickname": nickname, "team": team}
    )


def login_as(client: TestClient, team: str = "3", nickname: str = "민석") -> None:
    """(팀, 닉네임)마다 계정 하나. 없으면 가입하고, 있으면 로그인해 세션 쿠키를 바꾼다."""
    username = "u" + hashlib.sha1(f"{team}|{nickname}".encode()).hexdigest()[:12]
    r = signup(client, username, team=team, nickname=nickname)
    if r.status_code == 409:
        r = client.post("/api/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text


def submit(client: TestClient, data: bytes, team: str = "3", nickname: str = "민석"):
    login_as(client, team, nickname)
    return client.post("/api/submit", files={"file": ("submit.csv", data, "text/csv")})


def quota(client: TestClient, team: str = "3"):
    login_as(client, team)
    return client.get("/api/quota")


def perfect_rows():
    return [(i, p) for i, p in ANSWER_ROWS]


def login_admin(client: TestClient, store) -> None:
    """관리자 계정으로 로그인한다. 처음이면 가입한 뒤 저장소에서 관리자로 지정한다."""
    r = client.post("/api/login", json={"username": "operator", "password": PASSWORD})
    if r.status_code == 401:
        assert signup(client, "operator", team="0", nickname="운영진").status_code == 200
        store.get_user_by_username("operator").is_admin = True
