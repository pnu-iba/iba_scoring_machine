import math

import pytest

from store import Answers
from tests.conftest import ANSWER_ROWS, csv_bytes, perfect_rows, quota, submit


def test_perfect_submission_scores_zero_rmse(client):
    r = submit(client, csv_bytes(perfect_rows()))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rmse"] == 0
    assert body["r2"] == 1
    assert body["negative_clipped"] == 0
    assert body["remaining_today"] == 2
    assert body["rank"] == 1
    assert body["team"] == "3"


def test_known_error_gives_expected_rmse(client):
    # 모든 예측이 정답보다 100 크면 RMSE는 정확히 100
    rows = [(i, p + 100) for i, p in ANSWER_ROWS]
    body = submit(client, csv_bytes(rows)).json()
    assert math.isclose(body["rmse"], 100.0)
    assert body["r2"] < 1


def test_bom_crlf_and_trailing_blank_lines_are_accepted(client):
    text = "﻿id,price\r\n" + "\r\n".join(f"{i},{p}" for i, p in ANSWER_ROWS) + "\r\n\r\n"
    r = submit(client, text.encode("utf-8"))
    assert r.status_code == 200, r.text


def test_header_typo_rejected(client):
    r = submit(client, csv_bytes(perfect_rows(), header="id,prices"))
    assert r.status_code == 400
    assert r.json()["error_code"] == "bad_header"
    assert r.json()["row"] == 1


def test_missing_row_rejected(client):
    r = submit(client, csv_bytes(perfect_rows()[:-1]))
    assert r.status_code == 400
    body = r.json()
    assert body["error_code"] == "row_count"
    assert "4개" in body["message"] and "5개" in body["message"]


def test_swapped_rows_rejected_with_row_number(client):
    rows = perfect_rows()
    rows[0], rows[1] = rows[1], rows[0]
    r = submit(client, csv_bytes(rows))
    assert r.status_code == 400
    body = r.json()
    assert body["error_code"] == "id_mismatch"
    assert body["row"] == 2


def test_duplicate_ids_in_correct_order_are_fine(client):
    # ANSWER_ROWS에는 id 10001이 두 번 나온다. 순서만 맞으면 통과해야 한다.
    r = submit(client, csv_bytes(perfect_rows()))
    assert r.status_code == 200


def test_empty_price_rejected(client):
    rows = perfect_rows()
    rows[2] = (rows[2][0], "")
    r = submit(client, csv_bytes(rows))
    assert r.status_code == 400
    assert r.json()["error_code"] == "bad_price"
    assert r.json()["row"] == 4


def test_text_price_rejected(client):
    rows = perfect_rows()
    rows[4] = (rows[4][0], "abc")
    r = submit(client, csv_bytes(rows))
    assert r.status_code == 400
    assert r.json()["error_code"] == "bad_price"
    assert r.json()["row"] == 6


def test_negative_price_is_clipped_and_counted(client):
    rows = perfect_rows()
    rows[0] = (rows[0][0], -500)
    rows[1] = (rows[1][0], -1)
    r = submit(client, csv_bytes(rows))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["negative_clipped"] == 2
    # 0으로 클리핑됐으므로 두 행의 오차는 정답값 그대로. 응답 점수는 public 구간(1·3번째 행)만 본다.
    assert math.isclose(body["rmse"], math.sqrt(20299.0**2 / 2))


def test_oversized_file_rejected(client):
    big = b"id,price\n" + b"1,1\n" * (600_000)
    assert len(big) > 2 * 1024 * 1024
    r = submit(client, big)
    assert r.status_code == 400
    assert r.json()["error_code"] == "file_too_large"


def test_non_utf8_rejected(client):
    r = submit(client, b"\xff\xfe\x00id,price\n")
    assert r.status_code == 400
    assert r.json()["error_code"] == "not_utf8"


def test_quota_not_consumed_by_invalid_file(client):
    submit(client, csv_bytes(perfect_rows(), header="wrong"))
    q = quota(client).json()
    assert q["used_today"] == 0
    assert q["remaining_today"] == 3


def test_empty_answers_returns_503_and_is_not_cached(client, store):
    loaded = store._answers
    store._answers = Answers(ids=[], prices=[], public=[])

    for data in (csv_bytes(perfect_rows()), csv_bytes([])):
        r = submit(client, data)
        assert r.status_code == 503
        assert r.json()["error_code"] == "answers_not_ready"
    assert quota(client).json()["used_today"] == 0

    store._answers = loaded
    r = submit(client, csv_bytes(perfect_rows()))
    assert r.status_code == 200, r.text
    assert r.json()["rmse"] == 0


def test_submissions_are_numbered_per_team_and_keep_numbers_after_delete(client, store):
    from tests.conftest import login_as

    rows = csv_bytes(perfect_rows())
    assert submit(client, rows).json()["no"] == 1
    assert submit(client, rows).json()["no"] == 2
    login_as(client, team="1", nickname="다른팀")
    assert client.post("/api/submit", files={"file": ("a.csv", rows, "text/csv")}).json()["no"] == 1

    first = min(s.id for s in store.list_submissions("3"))
    store.soft_delete(first, store.list_submissions()[0].submitted_at)
    entries = client.get("/api/leaderboard").json()["entries"]
    assert sorted((e["team"], e["no"]) for e in entries) == [("1", 1), ("3", 2)]
