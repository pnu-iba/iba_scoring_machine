import auth
from tests.conftest import PASSWORD, csv_bytes, perfect_rows, signup


def test_signup_logs_in_and_me_returns_user(client):
    r = signup(client, "minseok_3", team=" 03 ", nickname="민석")
    assert r.status_code == 200, r.text
    assert r.json() == {"username": "minseok_3", "nickname": "민석", "team": "3", "is_admin": False}
    assert client.get("/api/me").json()["username"] == "minseok_3"


def test_username_is_case_insensitive_and_unique(client):
    assert signup(client, "Alice01").status_code == 200
    r = signup(client, "alice01")
    assert r.status_code == 409
    assert r.json()["error_code"] == "username_taken"


def test_signup_validation(client):
    assert signup(client, "ab").json()["error_code"] == "bad_account"           # 아이디 너무 짧음
    assert signup(client, "한글아이디").json()["error_code"] == "bad_account"
    assert signup(client, "valid_id", password="short").json()["error_code"] == "bad_account"
    assert signup(client, "valid_id", team="   ").json()["error_code"] == "bad_name"
    assert signup(client, "valid_id", team="1" * 41).json()["error_code"] == "bad_name"
    assert signup(client, "valid_id", team="3조").json()["error_code"] == "bad_name"   # 팀 번호는 숫자만
    assert signup(client, "valid_id", team="-3").json()["error_code"] == "bad_name"
    assert signup(client, "valid_id", nickname="").json()["error_code"] == "bad_name"


def test_team_number_ignores_leading_zeros(client):
    signup(client, "first_1", team="7")
    r = signup(client, "second_2", team="  007 ")
    assert r.json()["team"] == "7"


def test_login_logout(client):
    signup(client, "bob_1234")
    client.post("/api/logout")
    assert client.get("/api/me").json() is None

    assert client.post("/api/login", json={"username": "bob_1234", "password": "wrong-pass"}).status_code == 401
    assert client.post("/api/login", json={"username": "nobody", "password": PASSWORD}).status_code == 401
    r = client.post("/api/login", json={"username": "BOB_1234", "password": PASSWORD})
    assert r.status_code == 200
    assert client.get("/api/me").json()["username"] == "bob_1234"


def test_password_is_not_stored_in_plain_text(client, store):
    signup(client, "carol_99")
    stored = store.get_user_by_username("carol_99").password_hash
    assert PASSWORD not in stored
    assert auth.verify_password(PASSWORD, stored)
    assert not auth.verify_password("other-password", stored)


def test_submit_and_quota_require_login(client):
    r = client.post("/api/submit", files={"file": ("s.csv", csv_bytes(perfect_rows()), "text/csv")})
    assert r.status_code == 401
    assert client.get("/api/quota").status_code == 401


def test_submission_uses_account_team_and_nickname(client):
    signup(client, "dave_123", team="12", nickname="태정")
    r = client.post("/api/submit", files={"file": ("s.csv", csv_bytes(perfect_rows()), "text/csv")})
    assert r.status_code == 200, r.text
    board = client.get("/api/leaderboard").json()["rows"]
    assert (board[0]["team"], board[0]["nickname"]) == ("12", "태정")


def test_tampered_or_expired_session_is_rejected(client):
    signup(client, "erin_123")
    token = client.cookies.get(auth.SESSION_COOKIE)
    user_id, expires, sig = token.split(".")
    client.cookies.set(auth.SESSION_COOKIE, f"{int(user_id) + 1}.{expires}.{sig}")
    assert client.get("/api/me").json() is None

    past = auth.make_session(int(user_id), now=0)
    client.cookies.set(auth.SESSION_COOKIE, past)
    assert client.get("/api/me").json() is None


def test_wrong_login_message_is_english(client, monkeypatch):
    monkeypatch.delenv("DEV_ANSWER_CSV", raising=False)
    r = client.post("/api/login", json={"username": "nobody", "password": "whatever"})
    assert r.status_code == 401
    assert r.json()["message"] == "Wrong ID or password."


def test_dev_mode_accepts_any_login(client, monkeypatch):
    # 로컬 개발 서버(DEV_ANSWER_CSV)에서는 아무 값으로나 로그인되고, 처음 보는 아이디는 바로 계정이 생긴다
    monkeypatch.setenv("DEV_ANSWER_CSV", "dev.csv")
    monkeypatch.delenv("VERCEL", raising=False)
    signup(client, "carol_1")
    client.post("/api/logout")
    assert client.post("/api/login", json={"username": "carol_1", "password": "anything"}).status_code == 200
    client.post("/api/logout")
    r = client.post("/api/login", json={"username": "Any Name", "password": "x"})
    assert r.status_code == 200
    assert client.get("/api/me").json()["nickname"] == "Any Name"


def test_dev_any_login_is_off_on_vercel(client, monkeypatch):
    monkeypatch.setenv("DEV_ANSWER_CSV", "dev.csv")
    monkeypatch.setenv("VERCEL", "1")
    assert client.post("/api/login", json={"username": "nobody", "password": "x"}).status_code == 401
