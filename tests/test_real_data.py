"""실제 정답 파일이 있을 때만 도는 기준값 테스트(스펙 "Validation Decisions").

ANSWER_CSV 환경변수에 answer.csv 경로를 넣고 실행한다:
    ANSWER_CSV=/path/to/answer.csv .venv/bin/pytest tests/test_real_data.py
"""

import csv
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import auth
from app import app
import random

from scoring.split import pick_public
from store import Answers, MemoryStore
from tests.conftest import SETTINGS, FakeClock, submit

ANSWER_CSV = os.environ.get("ANSWER_CSV")
SAMPLE = Path(__file__).resolve().parents[1] / "public" / "data" / "sample_submission.csv"

pytestmark = pytest.mark.skipif(not ANSWER_CSV, reason="ANSWER_CSV 환경변수가 없어 건너뜀")


@pytest.fixture
def real_client(monkeypatch):
    with open(ANSWER_CSV, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        next(reader)
        rows = [(int(float(r[0])), float(r[1])) for r in reader if r]
    public = pick_public(len(rows), random.Random(0))
    store = MemoryStore(Answers(ids=[r[0] for r in rows], prices=[r[1] for r in rows], public=public))
    store.save_settings(SETTINGS)
    app.state.store = store
    app.state.now = FakeClock(datetime(2026, 9, 19, 6, 0, tzinfo=timezone.utc))
    app.state.answers = None
    monkeypatch.setenv("SESSION_SECRET", "s")
    monkeypatch.setattr(auth, "PBKDF2_ITERATIONS", 1000)
    with TestClient(app) as c:
        yield c
    app.state.answers = None


def test_sample_submission_matches_known_baseline(real_client):
    body = submit(real_client, SAMPLE.read_bytes()).json()
    # 응답은 public 구간 점수라 전체 기준값과 조금 다르다
    assert math.isclose(body["rmse"], 13189.79, rel_tol=0.03)
    full = app.state.store.list_submissions("3")[0]
    assert math.isclose(full.rmse, 13189.79, abs_tol=0.01)
    assert math.isclose(full.r2, -0.79, abs_tol=0.01)


def test_answer_file_scores_perfectly(real_client):
    body = submit(real_client, Path(ANSWER_CSV).read_bytes()).json()
    assert body["rmse"] == 0
    assert body["r2"] == 1
