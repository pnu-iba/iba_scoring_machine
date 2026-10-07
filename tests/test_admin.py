"""관리자 계정과 관리자 API: 권한, 대회 설정과 상태, 공지, 채점 확인, 제출·사용자 관리, 내보내기, 기수 초기화."""

import io
import zipfile
from datetime import date

from scoring import clock as contest_clock
from scoring.clock import ContestSettings
from tests.conftest import (
    ANSWER_ROWS,
    PASSWORD,
    SETTINGS,
    csv_bytes,
    login_admin,
    login_as,
    perfect_rows,
    quota,
    signup,
    submit,
)


def offset_rows(delta: float):
    return [(i, p + delta) for i, p in ANSWER_ROWS]


# --- 권한 ---------------------------------------------------------------------


def test_admin_api_requires_admin_account(client):
    assert client.get("/api/admin/overview").status_code == 401
    signup(client, "student1")
    assert client.get("/api/admin/overview").status_code == 403
    assert client.delete("/api/admin/submissions/1").status_code == 403


def test_me_reports_admin_flag(client, store):
    signup(client, "student1")
    assert client.get("/api/me").json()["is_admin"] is False
    login_admin(client, store)
    assert client.get("/api/me").json()["is_admin"] is True


def test_admin_cannot_submit(client, store):
    login_admin(client, store)
    r = client.post("/api/submit", files={"file": ("s.csv", csv_bytes(perfect_rows()), "text/csv")})
    assert r.status_code == 403
    assert r.json()["error_code"] == "admin_cannot_submit"


def test_revoked_admin_is_blocked_on_next_request(client, store):
    login_admin(client, store)
    assert client.get("/api/admin/overview").status_code == 200
    store.get_user_by_username("operator").is_admin = False
    assert client.get("/api/admin/overview").status_code == 403


def test_dev_login_as_admin_creates_admin(client, monkeypatch):
    monkeypatch.setenv("DEV_ANSWER_CSV", "dev.csv")
    monkeypatch.delenv("VERCEL", raising=False)
    client.post("/api/login", json={"username": "admin", "password": "x"})
    assert client.get("/api/me").json()["is_admin"] is True


# --- 대회 설정과 상태 -----------------------------------------------------------


def test_contest_endpoint_reports_schedule_and_status(client):
    body = client.get("/api/contest").json()
    assert body["start"] == "2026-09-01"
    assert body["end"] == "2026-10-05"
    assert body["status"] == "open"
    assert body["daily_limit"] == 3
    assert body["final_at"] == "2026-10-06T00:00:00+09:00"


def test_submit_rejected_before_start(client, store):
    store.save_settings(ContestSettings(date(2026, 9, 20), date(2026, 10, 5), 3))
    r = submit(client, csv_bytes(perfect_rows()))
    assert r.status_code == 403
    assert r.json()["error_code"] == "contest_not_started"
    assert client.get("/api/contest").json()["status"] == "ready"


def test_start_boundary_is_kst_midnight(client, store, clock):
    store.save_settings(ContestSettings(date(2026, 9, 20), date(2026, 10, 5), 3))
    clock.now = contest_clock.start_at(store.get_settings())
    assert submit(client, csv_bytes(perfect_rows())).status_code == 200


def test_saving_settings_applies_immediately(client, store, clock):
    clock.now = contest_clock.final_at(SETTINGS)
    assert submit(client, csv_bytes(perfect_rows())).status_code == 403
    assert client.get("/api/leaderboard").json()["final"] is True

    # 마감을 미루면 제출이 다시 열리고 리더보드는 public 순위로 돌아간다
    login_admin(client, store)
    r = client.put("/api/admin/contest", json={"start": "2026-09-01", "end": "2026-10-10", "daily_limit": 5})
    assert r.status_code == 200
    assert submit(client, csv_bytes(perfect_rows())).status_code == 200
    assert client.get("/api/leaderboard").json()["final"] is False
    assert quota(client).json()["limit"] == 5


def test_contest_settings_validation(client, store):
    login_admin(client, store)
    r = client.put("/api/admin/contest", json={"start": "2026-10-10", "end": "2026-10-05", "daily_limit": 3})
    assert r.status_code == 400
    r = client.put("/api/admin/contest", json={"start": "2026-09-01", "end": "2026-10-05", "daily_limit": 0})
    assert r.status_code == 400
    assert store.get_settings() == SETTINGS


def test_daily_limit_comes_from_settings(client, store):
    store.save_settings(ContestSettings(SETTINGS.start_date, SETTINGS.end_date, 1))
    assert submit(client, csv_bytes(perfect_rows())).status_code == 200
    r = submit(client, csv_bytes(perfect_rows()))
    assert r.status_code == 429
    assert "1회" in r.json()["message"]


# --- 공지 ---------------------------------------------------------------------


def test_notice_crud_and_order(client, store):
    login_admin(client, store)
    a = client.post("/api/admin/notices", json={"title": "  첫   공지 ", "date": "2026-09-22"}).json()
    b = client.post("/api/admin/notices", json={"title": "마감 연장", "date": "2026-10-01"}).json()
    assert a["title"] == "첫 공지"
    assert [n["title"] for n in client.get("/api/contest").json()["notices"]] == ["마감 연장", "첫 공지"]

    assert client.put(f"/api/admin/notices/{a['id']}", json={"title": "고친 공지", "date": "2026-10-02"}).status_code == 200
    assert [n["title"] for n in client.get("/api/contest").json()["notices"]] == ["고친 공지", "마감 연장"]

    assert client.delete(f"/api/admin/notices/{b['id']}").status_code == 200
    assert client.delete(f"/api/admin/notices/{b['id']}").status_code == 404
    assert client.post("/api/admin/notices", json={"title": "  ", "date": "2026-10-01"}).status_code == 400


# --- 채점 확인 -------------------------------------------------------------------


def test_score_check_does_not_record(client, store):
    login_admin(client, store)
    r = client.post("/api/admin/score-check", files={"file": ("s.csv", csv_bytes(offset_rows(100)), "text/csv")})
    assert r.status_code == 200
    assert r.json()["rmse"] == 100
    assert r.json()["public_rmse"] == 100
    assert store.list_submissions() == []

    bad = client.post("/api/admin/score-check", files={"file": ("s.csv", b"id,price\n1,2\n", "text/csv")})
    assert bad.status_code == 400
    assert "message" in bad.json()


# --- 제출 관리 -------------------------------------------------------------------


def test_delete_and_restore_submission(client, store):
    for _ in range(3):
        submit(client, csv_bytes(perfect_rows()), team="1")
    assert submit(client, csv_bytes(perfect_rows()), team="1").status_code == 429

    login_admin(client, store)
    subs = client.get("/api/admin/submissions", params={"team": "01"}).json()
    assert [s["id"] for s in subs] == [3, 2, 1]  # 최신순
    assert client.delete(f"/api/admin/submissions/{subs[0]['id']}").status_code == 200
    assert client.delete(f"/api/admin/submissions/{subs[0]['id']}").status_code == 404
    assert quota(client, "1").json()["remaining_today"] == 1

    login_admin(client, store)
    active = client.get("/api/admin/submissions", params={"include_deleted": "false"}).json()
    assert len(active) == 2

    # 복구하면 오늘 횟수가 다시 찬다
    assert client.post(f"/api/admin/submissions/{subs[0]['id']}/restore").status_code == 200
    assert client.post(f"/api/admin/submissions/{subs[0]['id']}/restore").status_code == 404
    assert quota(client, "1").json()["remaining_today"] == 0


def test_deleting_all_submissions_removes_team_from_leaderboard(client, store):
    submit(client, csv_bytes(perfect_rows()), team="1")
    login_admin(client, store)
    for s in client.get("/api/admin/submissions").json():
        client.delete(f"/api/admin/submissions/{s['id']}")
    assert client.get("/api/leaderboard").json()["rows"] == []


def test_bad_team_filter_is_400(client, store):
    login_admin(client, store)
    assert client.get("/api/admin/submissions", params={"team": "3조"}).status_code == 400


# --- 사용자 관리 -------------------------------------------------------------------


def test_user_list_hides_password_hash(client, store):
    signup(client, "student1", team="4")
    login_admin(client, store)
    users = client.get("/api/admin/users", params={"team": "4"}).json()
    assert [u["username"] for u in users] == ["student1"]
    assert "password_hash" not in users[0]


def test_change_team_moves_future_submissions_only(client, store):
    login_as(client, team="7", nickname="a")
    client.post("/api/submit", files={"file": ("s.csv", csv_bytes(perfect_rows()), "text/csv")})
    student = store.list_users("7")[0]

    login_admin(client, store)
    r = client.patch(f"/api/admin/users/{student.id}", json={"team": "08"})
    assert r.status_code == 200
    assert r.json()["team"] == "8"

    login_as(client, team="7", nickname="a")
    client.post("/api/submit", files={"file": ("s.csv", csv_bytes(perfect_rows()), "text/csv")})
    teams = sorted(s.team_key for s in store.list_submissions())
    assert teams == ["7", "8"]


def test_reset_password_issues_working_temporary_password(client, store):
    signup(client, "student1")
    uid = store.get_user_by_username("student1").id
    login_admin(client, store)
    pw = client.post(f"/api/admin/users/{uid}/reset-password").json()["password"]
    assert len(pw) >= 8
    assert client.post("/api/login", json={"username": "student1", "password": PASSWORD}).status_code == 401
    assert client.post("/api/login", json={"username": "student1", "password": pw}).status_code == 200


def test_grant_and_revoke_admin(client, store):
    signup(client, "student1")
    uid = store.get_user_by_username("student1").id
    login_admin(client, store)
    assert client.patch(f"/api/admin/users/{uid}", json={"is_admin": True}).json()["is_admin"] is True
    assert client.patch(f"/api/admin/users/{uid}", json={"is_admin": False}).json()["is_admin"] is False

    me = store.get_user_by_username("operator").id
    r = client.patch(f"/api/admin/users/{me}", json={"is_admin": False})
    assert r.status_code == 400
    assert store.get_user(me).is_admin is True


# --- 현황, 내보내기, 기수 초기화 ---------------------------------------------------


def test_overview_counts(client, store):
    submit(client, csv_bytes(perfect_rows()), team="1", nickname="a")
    submit(client, csv_bytes(perfect_rows()), team="2", nickname="b")
    login_admin(client, store)
    o = client.get("/api/admin/overview").json()
    assert o["status"] == "open"
    assert o["answer_rows"] == len(ANSWER_ROWS)
    assert o["public_rows"] == 2
    assert (o["submissions_total"], o["submissions_today"], o["submitting_teams"]) == (2, 2, 2)
    assert (o["users"], o["teams"]) == (2, 2)  # 관리자는 세지 않는다


def test_export_zip_has_four_csvs(client, store):
    submit(client, csv_bytes(perfect_rows()), team="1")
    login_admin(client, store)
    r = client.get("/api/admin/export")
    assert r.status_code == 200
    assert "iba-results-2026-10-05.zip" in r.headers["content-disposition"]
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert sorted(z.namelist()) == ["final_ranking.csv", "game_scores.csv", "submissions.csv", "users.csv"]
    users = z.read("users.csv").decode("utf-8-sig")
    assert "password" not in users


def test_reset_season(client, store):
    submit(client, csv_bytes(perfect_rows()), team="1")
    client.post("/api/games/apple/score", json={"score": 50})
    login_admin(client, store)
    client.post("/api/admin/notices", json={"title": "공지", "date": "2026-09-22"})

    r = client.post("/api/admin/reset", json={"confirm": "초기화"})
    assert r.status_code == 400
    assert len(store.list_submissions()) == 1

    r = client.post("/api/admin/reset", json={"confirm": "2026-10-05 대회 초기화"})
    assert r.status_code == 200
    assert r.json()["deleted"] == {"submissions": 1, "game_scores": 1, "users": 1}
    assert [u.username for u in store.list_users()] == ["operator"]
    assert store.list_game_scores() == []
    # 정답, 대회 설정, 공지는 남는다
    assert store.get_settings() == SETTINGS
    assert len(client.get("/api/contest").json()["notices"]) == 1
    assert client.get("/api/admin/overview").json()["answer_rows"] == len(ANSWER_ROWS)


def test_reset_can_keep_users_and_games(client, store):
    submit(client, csv_bytes(perfect_rows()), team="1")
    client.post("/api/games/apple/score", json={"score": 50})
    login_admin(client, store)
    r = client.post(
        "/api/admin/reset",
        json={"confirm": "2026-10-05 대회 초기화", "delete_games": False, "delete_users": False},
    )
    assert r.json()["deleted"] == {"submissions": 1, "game_scores": 0, "users": 0}
    assert len(store.list_users()) == 2
    assert len(store.list_game_scores()) == 1
