"""구경용 계정(iba_dev): Team IBA로 보이고, 제출은 채점만 하고 기록·횟수·리더보드에 남기지 않는다."""

from tests.conftest import PASSWORD, csv_bytes, login_admin, perfect_rows, signup


def login_demo(client):
    assert signup(client, "iba_dev", team="1", nickname="iba_dev").status_code == 200
    assert client.post("/api/login", json={"username": "iba_dev", "password": PASSWORD}).status_code == 200


def test_demo_account_shows_team_iba(client):
    login_demo(client)
    me = client.get("/api/me").json()
    assert me["team"] == "IBA"
    assert me["demo"] is True


def test_demo_submit_scores_without_recording(client, store):
    login_demo(client)
    for _ in range(5):   # 하루 3회 제한과 상관없이 계속 채점된다
        r = client.post("/api/submit", files={"file": ("sample_data.csv", csv_bytes(perfect_rows()), "text/csv")})
        assert r.status_code == 200, r.text
        assert r.json()["rmse"] == 0
        assert r.json()["demo"] is True
    assert store.list_submissions() == []
    assert client.get("/api/leaderboard").json()["entries"] == []
    assert client.get("/api/quota").json()["unlimited"] is True


def test_demo_submit_works_after_deadline(client, clock):
    login_demo(client)
    clock.advance(days=60)
    r = client.post("/api/submit", files={"file": ("sample_data.csv", csv_bytes(perfect_rows()), "text/csv")})
    assert r.status_code == 200, r.text


def test_demo_account_left_out_of_admin_counts(client, store):
    login_demo(client)
    assert signup(client, "student", team="3", nickname="학생").status_code == 200
    login_admin(client, store)
    overview = client.get("/api/admin/overview").json()
    assert overview["users"] == 1
    users = {u["username"]: u for u in client.get("/api/admin/users").json()}
    assert users["iba_dev"]["team"] == "IBA"


def test_other_accounts_unchanged(client):
    assert signup(client, "someone", team="3", nickname="학생").status_code == 200
    me = client.get("/api/me").json()
    assert me["team"] == "3"
    assert "demo" not in me


def test_demo_game_scores_not_recorded(client):
    login_demo(client)
    r = client.post("/api/games/apple/score", json={"score": 40})
    assert r.status_code == 200
    assert r.json()["demo"] is True
    assert client.get("/api/games/apple/leaderboard").json() == []
