from tests.conftest import csv_bytes, login_admin, perfect_rows, signup, submit


def test_guest_can_sign_up_and_play_minigames(client):
    r = signup(client, "guest_1", team="0", nickname="게스트")
    assert r.status_code == 200, r.text
    assert r.json()["team"] == "0"
    assert client.post("/api/games/snake/score", json={"score": 120}).json() == {"rank": 1, "best": 120}
    assert client.get("/api/games/snake/leaderboard").json()[0]["team"] == "0"


def test_guest_cannot_submit_or_choose(client, store):
    signup(client, "guest_1", team="0")
    r = client.post("/api/submit", files={"file": ("submit.csv", csv_bytes(perfect_rows()), "text/csv")})
    assert r.status_code == 403
    assert r.json()["error_code"] == "guest_cannot_submit"
    assert client.get("/api/quota").status_code == 403
    assert client.post("/api/team/final-choice", json={"submission_id": None}).status_code == 403
    assert client.get("/api/team/submissions").json()["submissions"] == []
    assert store.list_submissions() == []


def test_guest_is_not_a_team_on_leaderboard_or_overview(client, store):
    signup(client, "guest_1", team="0")
    submit(client, csv_bytes(perfect_rows()), team="1", nickname="a")
    board = client.get("/api/leaderboard").json()
    assert "0" not in board["teams"]
    assert [row["team"] for row in board["rows"]] == ["1"]
    login_admin(client, store)
    o = client.get("/api/admin/overview").json()
    assert (o["users"], o["teams"]) == (2, 1)


def test_admin_can_move_user_to_and_from_guest(client, store):
    signup(client, "guest_1", team="0")
    login_admin(client, store)
    uid = store.get_user_by_username("guest_1").id
    assert client.patch(f"/api/admin/users/{uid}", json={"team": "2"}).json()["team"] == "2"
    assert client.patch(f"/api/admin/users/{uid}", json={"team": "0"}).json()["team"] == "0"
