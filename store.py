"""저장소 계층. 운영은 PostgresStore(Neon), 테스트는 MemoryStore.

두 구현은 같은 규칙을 지킨다:
- 삭제된 제출(deleted_at IS NOT NULL)은 리더보드·오늘 횟수·순위 계산에서 제외한다.
- 리더보드는 팀별로 public 점수가 가장 좋은 제출 1건을 고른다(public RMSE 오름차순, 같으면 public R²
  내림차순, 같으면 먼저 제출한 쪽). 대회 중에는 그 public 점수로, 마감 뒤에는 같은 제출의 전체 데이터
  점수로 같은 규칙에 따라 순위를 매긴다.
- 미니게임 순위도 팀별 최고 점수 1건: 점수 내림차순, 같으면 먼저 기록한 쪽.
- 아이디(username)는 중복될 수 없다. 팀 표기는 그 팀으로 처음 가입한 사람의 표기를 따른다.
- 기수 초기화는 제출 기록을 지우고, 고른 경우 미니게임 점수와 관리자가 아닌 계정도 지운다.
  정답, 대회 설정, 공지는 남긴다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Protocol

from scoring.clock import DEFAULT_SETTINGS, ContestSettings


@dataclass(frozen=True)
class Answers:
    ids: list[int]
    prices: list[float]
    public: list[bool]  # public 채점 구간에 들어가는 행


class DuplicateUsername(Exception):
    pass


@dataclass
class User:
    id: int
    username: str
    password_hash: str
    nickname: str
    team_key: str
    team_display: str
    created_at: datetime
    is_admin: bool = False


@dataclass
class Notice:
    id: int
    title: str
    notice_date: date


@dataclass
class Submission:
    id: int
    team_key: str
    team_display: str
    nickname: str
    rmse: float  # 전체 데이터 점수(최종 순위용)
    r2: float
    public_rmse: float  # public 구간 점수(대회 중 공개)
    public_r2: float
    negative_clipped: int
    submitted_at: datetime
    deleted_at: datetime | None = None


@dataclass(frozen=True)
class LeaderboardRow:
    rank: int
    team: str
    nickname: str
    rmse: float  # 순위 기준 점수: 대회 중에는 public, 마감 뒤에는 전체 데이터
    r2: float
    public_rmse: float
    public_r2: float
    public_rank: int
    submitted_at: datetime
    team_key: str = field(repr=False)


@dataclass
class GameScore:
    id: int
    game: str
    team_key: str
    team_display: str
    nickname: str
    score: int
    played_at: datetime


@dataclass(frozen=True)
class GameRow:
    rank: int
    team: str
    nickname: str
    score: int
    played_at: datetime
    team_key: str = field(repr=False)


def _rank_game(rows: list[GameScore]) -> list[GameRow]:
    best: dict[str, GameScore] = {}
    for s in rows:
        cur = best.get(s.team_key)
        if cur is None or (-s.score, s.played_at) < (-cur.score, cur.played_at):
            best[s.team_key] = s
    ordered = sorted(best.values(), key=lambda s: (-s.score, s.played_at))
    return [
        GameRow(rank=i + 1, team=s.team_display, nickname=s.nickname, score=s.score, played_at=s.played_at, team_key=s.team_key)
        for i, s in enumerate(ordered)
    ]


def _public_key(s: Submission):
    return (s.public_rmse, -s.public_r2, s.submitted_at)


def _final_key(s: Submission):
    return (s.rmse, -s.r2, s.submitted_at)


def _rank(rows: list[Submission], final: bool) -> list[LeaderboardRow]:
    best: dict[str, Submission] = {}
    for s in rows:
        if s.deleted_at is not None:
            continue
        cur = best.get(s.team_key)
        if cur is None or _public_key(s) < _public_key(cur):
            best[s.team_key] = s
    public_order = sorted(best.values(), key=_public_key)
    public_rank = {s.team_key: i + 1 for i, s in enumerate(public_order)}
    ordered = sorted(best.values(), key=_final_key) if final else public_order
    return [
        LeaderboardRow(
            rank=i + 1,
            team=s.team_display,
            nickname=s.nickname,
            rmse=s.rmse if final else s.public_rmse,
            r2=s.r2 if final else s.public_r2,
            public_rmse=s.public_rmse,
            public_r2=s.public_r2,
            public_rank=public_rank[s.team_key],
            submitted_at=s.submitted_at,
            team_key=s.team_key,
        )
        for i, s in enumerate(ordered)
    ]


class Store(Protocol):
    def load_answers(self) -> Answers: ...
    def create_user(self, u: User) -> int: ...
    def get_user(self, user_id: int) -> User | None: ...
    def get_user_by_username(self, username: str) -> User | None: ...
    def first_team_display(self, team_key: str) -> str | None: ...
    def count_submissions_between(self, team_key: str, start: datetime, end: datetime) -> int: ...
    def insert_submission(self, s: Submission) -> int: ...
    def leaderboard(self, final: bool = False) -> list[LeaderboardRow]: ...
    def list_submissions(self, team_key: str | None = None) -> list[Submission]: ...
    def soft_delete(self, submission_id: int, now: datetime) -> bool: ...
    def restore(self, submission_id: int) -> bool: ...
    def insert_game_score(self, s: GameScore) -> int: ...
    def game_leaderboard(self, game: str) -> list[GameRow]: ...
    def list_game_scores(self) -> list[GameScore]: ...
    def list_users(self, team_key: str | None = None) -> list[User]: ...
    def update_user(self, u: User) -> None: ...
    def get_settings(self) -> ContestSettings: ...
    def save_settings(self, s: ContestSettings) -> None: ...
    def list_notices(self) -> list[Notice]: ...
    def add_notice(self, n: Notice) -> int: ...
    def update_notice(self, n: Notice) -> bool: ...
    def delete_notice(self, notice_id: int) -> bool: ...
    def reset_season(self, delete_games: bool, delete_users: bool) -> dict[str, int]: ...


def _newest_first(rows: list[Submission]) -> list[Submission]:
    return sorted(rows, key=lambda s: s.id, reverse=True)


def _notice_order(rows: list[Notice]) -> list[Notice]:
    return sorted(rows, key=lambda n: (n.notice_date, n.id), reverse=True)


class MemoryStore:
    def __init__(self, answers: Answers):
        self._answers = answers
        self._rows: list[Submission] = []
        self._users: list[User] = []
        self._game_scores: list[GameScore] = []
        self._settings = DEFAULT_SETTINGS
        self._notices: list[Notice] = []
        self._next_id = {"user": 1, "submission": 1, "game": 1, "notice": 1}

    def _new_id(self, kind: str) -> int:
        n = self._next_id[kind]
        self._next_id[kind] = n + 1
        return n

    def load_answers(self) -> Answers:
        return self._answers

    def create_user(self, u: User) -> int:
        if self.get_user_by_username(u.username):
            raise DuplicateUsername(u.username)
        u.id = self._new_id("user")
        self._users.append(u)
        return u.id

    def get_user(self, user_id: int) -> User | None:
        return next((u for u in self._users if u.id == user_id), None)

    def get_user_by_username(self, username: str) -> User | None:
        return next((u for u in self._users if u.username == username), None)

    def first_team_display(self, team_key: str) -> str | None:
        return next((u.team_display for u in self._users if u.team_key == team_key), None)

    def count_submissions_between(self, team_key: str, start: datetime, end: datetime) -> int:
        return sum(
            1
            for s in self._rows
            if s.team_key == team_key and s.deleted_at is None and start <= s.submitted_at < end
        )

    def insert_submission(self, s: Submission) -> int:
        s.id = self._new_id("submission")
        self._rows.append(s)
        return s.id

    def leaderboard(self, final: bool = False) -> list[LeaderboardRow]:
        return _rank(self._rows, final)

    def list_submissions(self, team_key: str | None = None) -> list[Submission]:
        return _newest_first([s for s in self._rows if team_key is None or s.team_key == team_key])

    def soft_delete(self, submission_id: int, now: datetime) -> bool:
        for s in self._rows:
            if s.id == submission_id and s.deleted_at is None:
                s.deleted_at = now
                return True
        return False

    def restore(self, submission_id: int) -> bool:
        for s in self._rows:
            if s.id == submission_id and s.deleted_at is not None:
                s.deleted_at = None
                return True
        return False

    def insert_game_score(self, s: GameScore) -> int:
        s.id = self._new_id("game")
        self._game_scores.append(s)
        return s.id

    def game_leaderboard(self, game: str) -> list[GameRow]:
        return _rank_game([s for s in self._game_scores if s.game == game])

    def list_game_scores(self) -> list[GameScore]:
        return list(self._game_scores)

    def list_users(self, team_key: str | None = None) -> list[User]:
        return [u for u in self._users if team_key is None or u.team_key == team_key]

    def update_user(self, u: User) -> None:
        pass  # 메모리에서는 호출한 쪽이 같은 객체를 이미 고쳤다

    def get_settings(self) -> ContestSettings:
        return self._settings

    def save_settings(self, s: ContestSettings) -> None:
        self._settings = s

    def list_notices(self) -> list[Notice]:
        return _notice_order(self._notices)

    def add_notice(self, n: Notice) -> int:
        n.id = self._new_id("notice")
        self._notices.append(n)
        return n.id

    def update_notice(self, n: Notice) -> bool:
        for i, cur in enumerate(self._notices):
            if cur.id == n.id:
                self._notices[i] = n
                return True
        return False

    def delete_notice(self, notice_id: int) -> bool:
        before = len(self._notices)
        self._notices = [n for n in self._notices if n.id != notice_id]
        return len(self._notices) < before

    def reset_season(self, delete_games: bool, delete_users: bool) -> dict[str, int]:
        counts = {"submissions": len(self._rows), "game_scores": 0, "users": 0}
        self._rows = []
        if delete_games:
            counts["game_scores"] = len(self._game_scores)
            self._game_scores = []
        if delete_users:
            kept = [u for u in self._users if u.is_admin]
            counts["users"] = len(self._users) - len(kept)
            self._users = kept
        return counts


class PostgresStore:
    """Neon Postgres. 서버리스라 요청마다 짧은 연결을 연다(기수당 수백 요청 규모)."""

    def __init__(self, dsn: str | None = None):
        self._dsn = dsn or os.environ["DATABASE_URL"]

    def _connect(self):
        import psycopg

        return psycopg.connect(self._dsn, connect_timeout=10)

    def load_answers(self) -> Answers:
        with self._connect() as conn:
            rows = conn.execute("SELECT id, price, in_public FROM answers ORDER BY row_no").fetchall()
        return Answers(
            ids=[int(r[0]) for r in rows], prices=[float(r[1]) for r in rows], public=[bool(r[2]) for r in rows]
        )

    def count_submissions_between(self, team_key: str, start: datetime, end: datetime) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT count(*) FROM submissions "
                "WHERE team_key = %s AND deleted_at IS NULL AND submitted_at >= %s AND submitted_at < %s",
                (team_key, start, end),
            ).fetchone()
        return int(row[0])

    def create_user(self, u: User) -> int:
        import psycopg

        try:
            with self._connect() as conn:
                row = conn.execute(
                    "INSERT INTO users (username, password_hash, nickname, team_key, team_display, created_at, is_admin) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (u.username, u.password_hash, u.nickname, u.team_key, u.team_display, u.created_at, u.is_admin),
                ).fetchone()
                conn.commit()
        except psycopg.errors.UniqueViolation as e:
            raise DuplicateUsername(u.username) from e
        u.id = int(row[0])
        return u.id

    def _one_user(self, where: str, value) -> User | None:
        with self._connect() as conn:
            r = conn.execute(f"SELECT {_USER_COLUMNS} FROM users WHERE {where} = %s", (value,)).fetchone()
        return _row_to_user(r) if r else None

    def get_user(self, user_id: int) -> User | None:
        return self._one_user("id", user_id)

    def get_user_by_username(self, username: str) -> User | None:
        return self._one_user("username", username)

    def first_team_display(self, team_key: str) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT team_display FROM users WHERE team_key = %s ORDER BY id LIMIT 1",
                (team_key,),
            ).fetchone()
        return row[0] if row else None

    def insert_submission(self, s: Submission) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "INSERT INTO submissions "
                "(team_key, team_display, nickname, rmse, r2, public_rmse, public_r2, negative_clipped, submitted_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    s.team_key, s.team_display, s.nickname, s.rmse, s.r2,
                    s.public_rmse, s.public_r2, s.negative_clipped, s.submitted_at,
                ),
            ).fetchone()
            conn.commit()
        s.id = int(row[0])
        return s.id

    def _all_active(self) -> list[Submission]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, team_key, team_display, nickname, rmse, r2, public_rmse, public_r2, negative_clipped, "
                "submitted_at, deleted_at "
                "FROM submissions WHERE deleted_at IS NULL"
            ).fetchall()
        return [_row_to_submission(r) for r in rows]

    def leaderboard(self, final: bool = False) -> list[LeaderboardRow]:
        return _rank(self._all_active(), final)

    def list_submissions(self, team_key: str | None = None) -> list[Submission]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, team_key, team_display, nickname, rmse, r2, public_rmse, public_r2, negative_clipped, "
                "submitted_at, deleted_at "
                "FROM submissions WHERE %s::text IS NULL OR team_key = %s ORDER BY id DESC",
                (team_key, team_key),
            ).fetchall()
        return [_row_to_submission(r) for r in rows]

    def soft_delete(self, submission_id: int, now: datetime) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE submissions SET deleted_at = %s WHERE id = %s AND deleted_at IS NULL",
                (now, submission_id),
            )
            conn.commit()
            return cur.rowcount == 1

    def restore(self, submission_id: int) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE submissions SET deleted_at = NULL WHERE id = %s AND deleted_at IS NOT NULL", (submission_id,)
            )
            conn.commit()
            return cur.rowcount == 1

    def insert_game_score(self, s: GameScore) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "INSERT INTO game_scores (game, team_key, team_display, nickname, score, played_at) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (s.game, s.team_key, s.team_display, s.nickname, s.score, s.played_at),
            ).fetchone()
            conn.commit()
        s.id = int(row[0])
        return s.id

    def game_leaderboard(self, game: str) -> list[GameRow]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, game, team_key, team_display, nickname, score, played_at FROM game_scores WHERE game = %s",
                (game,),
            ).fetchall()
        return _rank_game([GameScore(int(r[0]), r[1], r[2], r[3], r[4], int(r[5]), r[6]) for r in rows])

    def list_game_scores(self) -> list[GameScore]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, game, team_key, team_display, nickname, score, played_at FROM game_scores ORDER BY id"
            ).fetchall()
        return [GameScore(int(r[0]), r[1], r[2], r[3], r[4], int(r[5]), r[6]) for r in rows]

    def list_users(self, team_key: str | None = None) -> list[User]:
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT {_USER_COLUMNS} FROM users WHERE %s::text IS NULL OR team_key = %s ORDER BY id",
                (team_key, team_key),
            ).fetchall()
        return [_row_to_user(r) for r in rows]

    def update_user(self, u: User) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE users SET password_hash = %s, team_key = %s, team_display = %s, is_admin = %s WHERE id = %s",
                (u.password_hash, u.team_key, u.team_display, u.is_admin, u.id),
            )
            conn.commit()

    def get_settings(self) -> ContestSettings:
        with self._connect() as conn:
            r = conn.execute("SELECT start_date, end_date, daily_limit FROM contest_settings WHERE id = 1").fetchone()
        return ContestSettings(r[0], r[1], int(r[2])) if r else DEFAULT_SETTINGS

    def save_settings(self, s: ContestSettings) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO contest_settings (id, start_date, end_date, daily_limit) VALUES (1, %s, %s, %s) "
                "ON CONFLICT (id) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, "
                "daily_limit = EXCLUDED.daily_limit",
                (s.start_date, s.end_date, s.daily_limit),
            )
            conn.commit()

    def list_notices(self) -> list[Notice]:
        with self._connect() as conn:
            rows = conn.execute("SELECT id, title, notice_date FROM notices").fetchall()
        return _notice_order([Notice(int(r[0]), r[1], r[2]) for r in rows])

    def add_notice(self, n: Notice) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "INSERT INTO notices (title, notice_date) VALUES (%s, %s) RETURNING id", (n.title, n.notice_date)
            ).fetchone()
            conn.commit()
        n.id = int(row[0])
        return n.id

    def update_notice(self, n: Notice) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE notices SET title = %s, notice_date = %s WHERE id = %s", (n.title, n.notice_date, n.id)
            )
            conn.commit()
            return cur.rowcount == 1

    def delete_notice(self, notice_id: int) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM notices WHERE id = %s", (notice_id,))
            conn.commit()
            return cur.rowcount == 1

    def reset_season(self, delete_games: bool, delete_users: bool) -> dict[str, int]:
        # 한 트랜잭션: 중간에 실패하면 아무것도 지우지 않는다.
        with self._connect() as conn:
            counts = {"submissions": conn.execute("DELETE FROM submissions").rowcount, "game_scores": 0, "users": 0}
            if delete_games:
                counts["game_scores"] = conn.execute("DELETE FROM game_scores").rowcount
            if delete_users:
                counts["users"] = conn.execute("DELETE FROM users WHERE NOT is_admin").rowcount
            conn.commit()
        return counts


_USER_COLUMNS = "id, username, password_hash, nickname, team_key, team_display, created_at, is_admin"


def _row_to_user(r) -> User:
    return User(int(r[0]), r[1], r[2], r[3], r[4], r[5], r[6], bool(r[7]))


def _row_to_submission(r) -> Submission:
    submitted = r[9] if r[9].tzinfo else r[9].replace(tzinfo=timezone.utc)
    deleted = r[10]
    if deleted is not None and deleted.tzinfo is None:
        deleted = deleted.replace(tzinfo=timezone.utc)
    return Submission(
        id=int(r[0]),
        team_key=r[1],
        team_display=r[2],
        nickname=r[3],
        rmse=float(r[4]),
        r2=float(r[5]),
        public_rmse=float(r[6]),
        public_r2=float(r[7]),
        negative_clipped=int(r[8]),
        submitted_at=submitted,
        deleted_at=deleted,
    )
