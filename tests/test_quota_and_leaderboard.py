from tests.conftest import ANSWER_ROWS, csv_bytes, perfect_rows, quota, submit


def offset_rows(delta: float):
    return [(i, p + delta) for i, p in ANSWER_ROWS]


# --- 하루 3회 제한 ------------------------------------------------------------


def test_fourth_submission_same_day_is_rejected(client):
    for _ in range(3):
        assert submit(client, csv_bytes(perfect_rows())).status_code == 200
    r = submit(client, csv_bytes(perfect_rows()))
    assert r.status_code == 429
    body = r.json()
    assert body["error_code"] == "quota_exceeded"
    # 2026-09-19 15:00 KST 기준 다음 자정
    assert body["resets_at"].startswith("2026-09-20T00:00:00+09:00")


def test_team_number_variants_share_quota(client):
    assert submit(client, csv_bytes(perfect_rows()), team="5").status_code == 200
    assert submit(client, csv_bytes(perfect_rows()), team=" 05 ").status_code == 200
    assert submit(client, csv_bytes(perfect_rows()), team="５").status_code == 200
    assert submit(client, csv_bytes(perfect_rows()), team="005").status_code == 429
    board = client.get("/api/leaderboard").json()["rows"]
    assert [row["team"] for row in board] == ["5"]


def test_quota_resets_at_kst_midnight(client, clock):
    for _ in range(3):
        submit(client, csv_bytes(perfect_rows()))
    # 23:59 KST → 아직 같은 날
    clock.advance(hours=8, minutes=59)
    assert submit(client, csv_bytes(perfect_rows())).status_code == 429
    # 00:00 KST → 초기화
    clock.advance(minutes=1)
    r = submit(client, csv_bytes(perfect_rows()))
    assert r.status_code == 200
    assert r.json()["remaining_today"] == 2


def test_quota_endpoint_reports_usage(client):
    submit(client, csv_bytes(perfect_rows()))
    q = quota(client).json()
    assert q == {
        "used_today": 1,
        "remaining_today": 2,
        "resets_at": "2026-09-20T00:00:00+09:00",
        "limit": 3,
    }


# --- 리더보드 -----------------------------------------------------------------


def test_leaderboard_shows_best_record_per_team(client, clock):
    submit(client, csv_bytes(offset_rows(300)), team="1", nickname="a1")
    clock.advance(minutes=1)
    submit(client, csv_bytes(offset_rows(100)), team="1", nickname="a2")
    clock.advance(minutes=1)
    submit(client, csv_bytes(offset_rows(200)), team="2", nickname="b1")
    board = client.get("/api/leaderboard").json()["rows"]
    assert [(r["rank"], r["team"], r["nickname"]) for r in board] == [(1, "1", "a2"), (2, "2", "b1")]
    assert board[0]["submitted_at"].endswith("+09:00")


def test_leaderboard_tie_breaks_by_r2_then_time(client, clock):
    # 같은 RMSE, 같은 R²(동일 오프셋) → 먼저 제출한 팀이 위
    submit(client, csv_bytes(offset_rows(100)), team="1", nickname="x")
    clock.advance(minutes=5)
    submit(client, csv_bytes(offset_rows(100)), team="2", nickname="y")
    board = client.get("/api/leaderboard").json()["rows"]
    assert [r["team"] for r in board] == ["1", "2"]


def test_rank_in_submit_response_reflects_team_best(client):
    submit(client, csv_bytes(offset_rows(100)), team="1")
    r = submit(client, csv_bytes(offset_rows(200)), team="2")
    assert r.json()["rank"] == 2
    r = submit(client, csv_bytes(offset_rows(50)), team="2")
    assert r.json()["rank"] == 1
