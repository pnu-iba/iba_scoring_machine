"""팀이 최종 순위에 쓸 제출을 고르는 기능. 고르지 않으면 public 최고 제출이 쓰인다.

conftest의 PUBLIC 구간은 1·3번째 행이다. 2·4·5번째 행만 틀리게 내면 public 점수는 0이다.
"""

import math
from datetime import timedelta

from scoring import clock as contest_clock
from tests.conftest import ANSWER_ROWS, PUBLIC, SETTINGS, csv_bytes, login_admin, login_as, submit


def private_only_error(delta: float):
    return [(i, p if pub else p + delta) for (i, p), pub in zip(ANSWER_ROWS, PUBLIC)]


def to_final(clock):
    clock.now = contest_clock.final_at(SETTINGS) + timedelta(minutes=1)


def two_submissions(client, clock):
    """3팀: 1번은 모든 행이 300씩 틀림(public은 나쁘고 전체는 좋음), 2번은 public만 맞음(전체는 나쁨)."""
    submit(client, csv_bytes([(i, p + 300) for i, p in ANSWER_ROWS]))
    clock.advance(minutes=1)
    submit(client, csv_bytes(private_only_error(9000)))
    return {s["no"]: s for s in client.get("/api/team/submissions").json()["submissions"]}


def choose(client, submission_id):
    return client.post("/api/team/final-choice", json={"submission_id": submission_id})


def test_without_choice_public_best_is_picked(client, clock):
    subs = two_submissions(client, clock)
    assert subs[2]["pick"] and subs[2]["auto"]
    assert not subs[1]["pick"]


def test_chosen_submission_is_used_for_final_rank(client, clock):
    subs = two_submissions(client, clock)
    body = choose(client, subs[1]["id"]).json()
    assert body["chosen_by"] == "민석"
    picked = {s["no"]: s for s in body["submissions"]}
    assert picked[1]["pick"] and not picked[1]["auto"]
    assert picked[2]["auto"] and not picked[2]["pick"]

    entries = client.get("/api/leaderboard").json()["entries"]
    assert [e["no"] for e in entries if e["best"]] == [1]

    to_final(clock)
    row = client.get("/api/leaderboard").json()["rows"][0]
    assert math.isclose(row["rmse"], 300.0)


def test_clearing_choice_returns_to_public_best(client, clock):
    subs = two_submissions(client, clock)
    choose(client, subs[1]["id"])
    body = client.post("/api/team/final-choice", json={"submission_id": None}).json()
    assert body["chosen_by"] is None
    assert [s["no"] for s in body["submissions"] if s["pick"]] == [2]


def test_teammate_sees_the_same_choice(client, clock):
    subs = two_submissions(client, clock)
    choose(client, subs[1]["id"])
    login_as(client, team="3", nickname="팀원")
    body = client.get("/api/team/submissions").json()
    assert body["chosen_by"] == "민석"
    assert [s["no"] for s in body["submissions"] if s["pick"]] == [1]


def test_cannot_choose_other_team_submission(client, clock):
    subs = two_submissions(client, clock)
    login_as(client, team="1", nickname="다른팀")
    r = choose(client, subs[1]["id"])
    assert r.status_code == 400
    assert r.json()["error_code"] == "bad_submission"


def test_deleted_choice_falls_back_to_public_best(client, clock, store):
    subs = two_submissions(client, clock)
    choose(client, subs[1]["id"])
    store.soft_delete(subs[1]["id"], clock.now)
    body = client.get("/api/team/submissions").json()
    assert body["chosen_by"] is None
    assert [s["no"] for s in body["submissions"] if s["pick"]] == [2]
    assert choose(client, subs[1]["id"]).status_code == 400


def test_choice_is_locked_after_deadline(client, clock):
    subs = two_submissions(client, clock)
    to_final(clock)
    assert client.get("/api/team/submissions").json()["locked"] is True
    r = choose(client, subs[1]["id"])
    assert r.status_code == 403
    assert r.json()["error_code"] == "contest_closed"


def test_admin_cannot_choose(client, store):
    login_admin(client, store)
    r = choose(client, None)
    assert r.status_code == 403
    assert client.get("/api/team/submissions").json()["submissions"] == []


def test_season_reset_clears_choices(client, clock, store):
    subs = two_submissions(client, clock)
    choose(client, subs[1]["id"])
    store.reset_season(delete_games=False, delete_users=False)
    assert store.final_choices() == {}
