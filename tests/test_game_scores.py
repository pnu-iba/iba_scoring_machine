from tests.conftest import login_as, signup


def record(client, game, score, team="3", nickname="민석"):
    login_as(client, team, nickname)
    return client.post(f"/api/games/{game}/score", json={"score": score})


def test_game_leaderboard_keeps_each_persons_best(client, clock):
    assert record(client, "apple", 40, team="1", nickname="a1").status_code == 200
    clock.advance(minutes=1)
    r = record(client, "apple", 55, team="1", nickname="a2")
    assert r.json() == {"rank": 1, "best": 55}
    clock.advance(minutes=1)
    assert record(client, "apple", 30, team="1", nickname="a1").json() == {"rank": 2, "best": 40}
    record(client, "apple", 50, team="2", nickname="b1")

    board = client.get("/api/games/apple/leaderboard").json()
    assert [(r["rank"], r["team"], r["nickname"], r["score"]) for r in board] == [
        (1, "1", "a2", 55), (2, "2", "b1", 50), (3, "1", "a1", 40)
    ]
    assert board[0]["played_at"].endswith("+09:00")
    assert [r["mine"] for r in board] == [False, True, False]   # 마지막으로 로그인한 b1


def test_same_nickname_ranked_separately(client):
    for username, score in [("minseok_a", 300), ("minseok_b", 200)]:
        assert signup(client, username, team="1", nickname="민석").status_code == 200
        client.post("/api/games/snake/score", json={"score": score})
    assert [r["score"] for r in client.get("/api/games/snake/leaderboard").json()] == [300, 200]


def test_old_rows_without_user_grouped_by_team_and_nickname(client, store, clock):
    from store import GameScore

    store.insert_game_score(GameScore(0, "apple", "1", "1", "a1", 70, clock()))
    store.insert_game_score(GameScore(0, "apple", "1", "1", "a1", 90, clock()))
    board = client.get("/api/games/apple/leaderboard").json()
    assert [(r["nickname"], r["score"], r["mine"]) for r in board] == [("a1", 90, False)]


def test_tie_goes_to_earlier_record(client, clock):
    record(client, "tetris", 1000, team="1")
    clock.advance(minutes=1)
    record(client, "tetris", 1000, team="2")
    assert [r["team"] for r in client.get("/api/games/tetris/leaderboard").json()] == ["1", "2"]


def test_games_are_separate(client):
    record(client, "tetris", 500)
    assert client.get("/api/games/blocks/leaderboard").json() == []


def test_score_requires_login(client):
    assert client.post("/api/games/apple/score", json={"score": 10}).status_code == 401


def test_unknown_game_and_bad_score_rejected(client):
    assert record(client, "chess", 10).status_code == 404
    assert client.get("/api/games/chess/leaderboard").status_code == 404
    assert record(client, "apple", 171).json()["error_code"] == "bad_score"
    assert record(client, "apple", -1).json()["error_code"] == "bad_score"
    assert client.get("/api/games/apple/leaderboard").json() == []


def test_shooter_score_recorded(client):
    assert record(client, "shooter", 12345).json() == {"rank": 1, "best": 12345}
    assert record(client, "shooter", 10_000_000).json()["error_code"] == "bad_score"


def test_snake_score_recorded(client):
    assert record(client, "snake", 1230).json() == {"rank": 1, "best": 1230}
    assert record(client, "snake", 1_000_000).json()["error_code"] == "bad_score"
