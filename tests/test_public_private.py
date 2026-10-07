"""public 구간 점수(대회 중)와 전체 데이터 점수(마감 뒤 최종 순위).

conftest의 PUBLIC 구간은 1·3번째 행이다. 2·4·5번째 행만 틀리게 내면 public 점수는 0이다.
"""

import math
from datetime import timedelta

from scoring import clock as contest_clock
from tests.conftest import ANSWER_ROWS, PUBLIC, SETTINGS, csv_bytes, perfect_rows, submit


def private_only_error(delta: float):
    return [(i, p if pub else p + delta) for (i, p), pub in zip(ANSWER_ROWS, PUBLIC)]


def to_final(clock):
    clock.now = contest_clock.final_at(SETTINGS) + timedelta(minutes=1)


def test_submit_reports_public_score_only(client):
    body = submit(client, csv_bytes(private_only_error(1000))).json()
    assert body["rmse"] == 0
    assert body["r2"] == 1


def test_public_leaderboard_hides_full_score(client):
    submit(client, csv_bytes(private_only_error(1000)), team="1")
    board = client.get("/api/leaderboard").json()
    assert board["final"] is False
    row = board["rows"][0]
    assert row["rmse"] == 0
    assert "public_rmse" not in row


def test_final_leaderboard_ranks_by_full_score_of_best_public_submission(client, clock):
    # 1팀: public은 완벽하지만 나머지 행이 크게 틀림. 2팀: 모든 행이 100씩 틀림.
    submit(client, csv_bytes(private_only_error(5000)), team="1")
    clock.advance(minutes=1)
    submit(client, csv_bytes([(i, p + 100) for i, p in ANSWER_ROWS]), team="2")
    # 3팀: 전체 점수가 더 좋은 제출(+300)이 있어도 최종에는 public이 더 좋은 나중 제출이 쓰인다
    clock.advance(minutes=1)
    submit(client, csv_bytes([(i, p + 300) for i, p in ANSWER_ROWS]), team="3")
    clock.advance(minutes=1)
    submit(client, csv_bytes(private_only_error(9000)), team="3")

    public_board = client.get("/api/leaderboard").json()["rows"]
    assert [r["team"] for r in public_board] == ["1", "3", "2"]

    to_final(clock)
    board = client.get("/api/leaderboard").json()
    assert board["final"] is True
    rows = board["rows"]
    # 최종 순위는 각 팀의 public 최고 제출을 전체 데이터로 매긴 점수 순서
    assert [r["team"] for r in rows] == ["2", "1", "3"]
    assert math.isclose(rows[0]["rmse"], 100.0)
    assert [r["public_rank"] for r in rows] == [3, 1, 2]
    assert rows[1]["public_rmse"] == 0


def test_submit_closed_after_contest_end(client, clock):
    to_final(clock)
    r = submit(client, csv_bytes(perfect_rows()))
    assert r.status_code == 403
    assert r.json()["error_code"] == "contest_closed"


def test_contest_end_boundary_is_kst_midnight(client, clock):
    clock.now = contest_clock.final_at(SETTINGS) - timedelta(seconds=1)
    assert submit(client, csv_bytes(perfect_rows())).status_code == 200
    assert client.get("/api/leaderboard").json()["final"] is False
