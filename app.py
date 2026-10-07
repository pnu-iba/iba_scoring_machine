"""채점 사이트 API. Vercel Python 런타임이 이 파일의 `app`을 찾아 실행한다.

엔드포인트 (스펙 "API 계약"):
- POST   /api/signup                 가입(아이디·비밀번호·닉네임·팀명) → 세션 쿠키
- POST   /api/login                  로그인 → 세션 쿠키
- POST   /api/logout                 세션 쿠키 삭제
- GET    /api/me                     로그인한 사용자 (로그인하지 않았으면 null)
- GET    /api/contest                대회 기간·상태·하루 한도·공지
- POST   /api/submit                 (로그인) CSV → public·전체 점수 채점·기록 (진행 중에만, 관리자는 거부)
- GET    /api/leaderboard            팀별 기록. 대회 중에는 public 순위, 마감 뒤에는 최종 순위
- GET    /api/quota                  (로그인) 우리 팀 오늘 남은 횟수
- POST   /api/games/{game}/score     (로그인) 미니게임 점수 기록
- GET    /api/games/{game}/leaderboard  미니게임 팀별 최고 점수
- /api/admin/*                       (관리자 계정) 대회 현황·설정·공지, 채점 확인, 제출·사용자 관리,
                                     결과 내보내기, 기수 초기화

정적 페이지는 Vercel에서는 public/이 CDN으로 서빙되고, 로컬에서는 이 앱이 public/을 마운트한다.
"""

from __future__ import annotations

import csv
import io
import os
import secrets
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Cookie, Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import auth
from scoring import clock
from scoring.clock import ContestSettings
from scoring.metrics import score
from scoring.parse import SubmissionError, parse_submission
from scoring.teams import NameError_, clean_nickname, clean_team_display, normalize_team
from store import Answers, DuplicateUsername, GameScore, Notice, PostgresStore, Store, Submission, User

app = FastAPI(title="IBA Scoring Machine", docs_url=None, redoc_url=None)

# --- 의존성 -------------------------------------------------------------------
# 테스트에서는 app.state.store / app.state.now 를 바꿔 끼운다.

def get_store(request: Request) -> Store:
    store = getattr(request.app.state, "store", None)
    if store is None:
        store = _memory_store_for_dev() if os.environ.get("DEV_ANSWER_CSV") else PostgresStore()
        request.app.state.store = store
    return store


def _memory_store_for_dev() -> Store:
    """로컬 개발용: DB 없이 DEV_ANSWER_CSV의 정답으로 메모리 저장소를 쓴다. 재시작하면 제출 기록은 사라진다."""
    import csv
    import random

    from scoring.split import pick_public
    from store import MemoryStore

    with open(os.environ["DEV_ANSWER_CSV"], newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        next(reader)
        rows = [(int(float(r[0])), float(r[1])) for r in reader if r and r[0].strip()]
    public = pick_public(len(rows), random.Random(0))
    return MemoryStore(Answers(ids=[r[0] for r in rows], prices=[r[1] for r in rows], public=public))


def get_now(request: Request) -> Callable[[], datetime]:
    return getattr(request.app.state, "now", lambda: datetime.now(timezone.utc))


def get_answers(request: Request, store: Store = Depends(get_store)) -> Answers:
    # 함수 인스턴스 안에서 첫 요청 때 한 번 읽고 메모리에 둔다(스펙 "채점 규칙").
    answers = getattr(request.app.state, "answers", None)
    if answers is None:
        answers = store.load_answers()
        # 정답(과 public 구간) 적재 전이면 캐시하지 않는다. 적재 후 재배포 없이 바로 채점되게 하려고.
        if any(answers.public):
            request.app.state.answers = answers
    return answers


def get_settings(store: Store = Depends(get_store)) -> ContestSettings:
    return store.get_settings()


def current_user(
    store: Store = Depends(get_store),
    iba_session: str | None = Cookie(default=None),
) -> User | None:
    user_id = auth.read_session(iba_session)
    return store.get_user(user_id) if user_id is not None else None


def require_user(user: User | None = Depends(current_user)) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    # 권한은 요청마다 DB에서 읽은 사용자로 판단한다. 해제하면 다음 요청부터 막힌다.
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="관리자만 쓸 수 있습니다.")
    return user


# --- 응답 도우미 ---------------------------------------------------------------


def _user_body(u: User) -> dict:
    return {"username": u.username, "nickname": u.nickname, "team": u.team_display, "is_admin": u.is_admin}


def _set_session(response: Response, u: User) -> None:
    response.set_cookie(
        auth.SESSION_COOKIE,
        auth.make_session(u.id),
        max_age=auth.SESSION_TTL,
        httponly=True,
        samesite="lax",
        secure=bool(os.environ.get("VERCEL")),
    )


def _bad_request(code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error_code": code, "message": message})


def _quota_body(store: Store, team_key: str, now: datetime, limit: int) -> dict:
    start, end = clock.day_window(now)
    used = store.count_submissions_between(team_key, start, end)
    return {
        "used_today": used,
        "remaining_today": max(limit - used, 0),
        "resets_at": clock.resets_at(now).isoformat(),
    }


def _team_rank(store: Store, team_key: str) -> int | None:
    """대회 중 public 리더보드에서 이 팀의 순위."""
    for row in store.leaderboard():
        if row.team_key == team_key:
            return row.rank
    return None


def _leaderboard_row(row, final: bool) -> dict:
    body = {
        "rank": row.rank,
        "team": row.team,
        "nickname": row.nickname,
        "rmse": row.rmse,
        "r2": row.r2,
        "submitted_at": row.submitted_at.astimezone(clock.KST).isoformat(),
    }
    # 대회 중에는 전체 데이터 점수를 내보내지 않는다. 마감 뒤에는 public 순위와 비교할 수 있게 함께 준다.
    if final:
        body.update(public_rmse=row.public_rmse, public_r2=row.public_r2, public_rank=row.public_rank)
    return body


def _kst(dt: datetime) -> str:
    return dt.astimezone(clock.KST).isoformat()


def _submission_row(s: Submission) -> dict:
    return {
        "id": s.id,
        "team": s.team_display,
        "nickname": s.nickname,
        "rmse": s.rmse,
        "r2": s.r2,
        "public_rmse": s.public_rmse,
        "public_r2": s.public_r2,
        "negative_clipped": s.negative_clipped,
        "submitted_at": s.submitted_at.astimezone(clock.KST).isoformat(),
        "deleted_at": s.deleted_at.astimezone(clock.KST).isoformat() if s.deleted_at else None,
    }


# --- 엔드포인트 ----------------------------------------------------------------


class SignupBody(BaseModel):
    username: str
    password: str
    nickname: str
    team: str


class ScoreBody(BaseModel):
    score: int


# 미니게임별 점수 상한. 점수는 브라우저가 보내므로 불가능한 값만 거른다.
GAME_MAX_SCORE = {"apple": 170, "tetris": 9_999_999, "blocks": 999_999, "shooter": 9_999_999, "snake": 999_999}


class LoginBody(BaseModel):
    username: str
    password: str


@app.post("/api/signup")
def signup(
    body: SignupBody,
    response: Response,
    store: Store = Depends(get_store),
    now_fn: Callable[[], datetime] = Depends(get_now),
):
    try:
        username = auth.clean_username(body.username)
        auth.check_password_rules(body.password)
        nickname = clean_nickname(body.nickname)
        team_key = normalize_team(body.team)
        team_display = clean_team_display(body.team)
    except auth.AccountError as e:
        return _bad_request("bad_account", str(e))
    except NameError_ as e:
        return _bad_request("bad_name", str(e))

    # 같은 팀의 첫 표기를 유지한다(리더보드 표기 일관성).
    user = User(
        id=0,
        username=username,
        password_hash=auth.hash_password(body.password),
        nickname=nickname,
        team_key=team_key,
        team_display=store.first_team_display(team_key) or team_display,
        created_at=now_fn(),
    )
    try:
        store.create_user(user)
    except DuplicateUsername:
        return JSONResponse(
            status_code=409, content={"error_code": "username_taken", "message": "이미 쓰이는 아이디입니다."}
        )
    _set_session(response, user)
    return _user_body(user)


def _dev_any_login() -> bool:
    """로컬 개발 서버(DB 없는 메모리 모드)에서만 켜진다. 배포(Vercel)와 테스트에서는 꺼져 있다."""
    return bool(os.environ.get("DEV_ANSWER_CSV")) and not os.environ.get("VERCEL")


def _dev_user_for(store: Store, raw: str, password: str, now: datetime) -> User:
    """개발용: 아무 아이디·비밀번호로 로그인한다. 처음 보는 아이디면 그 이름으로 계정을 바로 만든다.
    아이디가 admin이면 관리자 계정으로 만든다."""
    username = raw.strip().lower() or "guest"
    user = store.get_user_by_username(username)
    if user is None:
        user = User(
            id=0, username=username, password_hash=auth.hash_password(password or "dev"),
            nickname=(raw.strip() or "guest")[:40], team_key="0", team_display="0", created_at=now,
            is_admin=username == "admin",
        )
        store.create_user(user)
    return user


@app.post("/api/login")
def login(
    body: LoginBody,
    response: Response,
    store: Store = Depends(get_store),
    now_fn: Callable[[], datetime] = Depends(get_now),
):
    if _dev_any_login():
        user = _dev_user_for(store, body.username, body.password, now_fn())
        _set_session(response, user)
        return _user_body(user)
    user = store.get_user_by_username(body.username.strip().lower())
    if user is None or not auth.verify_password(body.password, user.password_hash):
        return JSONResponse(
            status_code=401,
            content={"error_code": "bad_login", "message": "Wrong ID or password."},
        )
    _set_session(response, user)
    return _user_body(user)


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(auth.SESSION_COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(user: User | None = Depends(current_user)):
    return _user_body(user) if user else None


@app.get("/api/contest")
def contest(
    settings: ContestSettings = Depends(get_settings),
    store: Store = Depends(get_store),
    now_fn: Callable[[], datetime] = Depends(get_now),
):
    return {
        "start": settings.start_date.isoformat(),
        "end": settings.end_date.isoformat(),
        "status": clock.status(now_fn(), settings),
        "final_at": clock.final_at(settings).isoformat(),
        "daily_limit": settings.daily_limit,
        "notices": [_notice_row(n) for n in store.list_notices()],
    }


def _notice_row(n: Notice) -> dict:
    return {"id": n.id, "title": n.title, "date": n.notice_date.isoformat()}


@app.post("/api/submit")
async def submit(
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    store: Store = Depends(get_store),
    now_fn: Callable[[], datetime] = Depends(get_now),
    answers: Answers = Depends(get_answers),
    settings: ContestSettings = Depends(get_settings),
):
    if not any(answers.public):
        return JSONResponse(
            status_code=503,
            content={"error_code": "answers_not_ready", "message": "정답이 아직 등록되지 않아 채점할 수 없습니다. 운영진에게 알려 주세요."},
        )

    if user.is_admin:
        return JSONResponse(
            status_code=403,
            content={"error_code": "admin_cannot_submit", "message": "관리자 계정은 제출할 수 없습니다. 관리자 페이지의 채점 확인을 쓰세요."},
        )
    team_key = user.team_key
    now = now_fn()
    state = clock.status(now, settings)
    if state == clock.READY:
        return JSONResponse(
            status_code=403,
            content={"error_code": "contest_not_started", "message": "대회가 아직 시작되지 않았습니다."},
        )
    # 로컬 CSV·메모리 모드에서는 마감 뒤에도 채점 테스트를 허용한다.
    if state == clock.FINAL and not _dev_any_login():
        return JSONResponse(
            status_code=403,
            content={"error_code": "contest_closed", "message": "대회가 마감되어 더 이상 제출할 수 없습니다."},
        )
    quota = _quota_body(store, team_key, now, settings.daily_limit)
    if quota["remaining_today"] <= 0:
        return JSONResponse(
            status_code=429,
            content={
                "error_code": "quota_exceeded",
                "message": f"오늘 제출 횟수 {settings.daily_limit}회를 모두 사용했습니다.",
                "resets_at": quota["resets_at"],
            },
        )

    data = await file.read()
    try:
        full, public = _score_both(data, answers)
    except SubmissionError as e:
        return JSONResponse(status_code=400, content=e.to_dict())

    record = Submission(
        id=0,
        team_key=team_key,
        team_display=user.team_display,
        nickname=user.nickname,
        rmse=full.rmse,
        r2=full.r2,
        public_rmse=public.rmse,
        public_r2=public.r2,
        negative_clipped=full.negative_clipped,
        submitted_at=now,
    )
    store.insert_submission(record)

    # 학생에게는 public 점수만 보여준다. 전체 데이터 점수는 마감 뒤 리더보드에서 공개한다.
    return {
        "rmse": public.rmse,
        "r2": public.r2,
        "negative_clipped": full.negative_clipped,
        "remaining_today": quota["remaining_today"] - 1,
        "resets_at": quota["resets_at"],
        "rank": _team_rank(store, team_key),
        "team": user.team_display,
    }


def _score_both(data: bytes, answers: Answers):
    """제출 CSV를 전체 데이터와 public 구간으로 각각 채점한다. 형식이 틀리면 SubmissionError."""
    parsed = parse_submission(data, answers.ids)
    full = score(answers.prices, parsed.prices)
    public_idx = [i for i, p in enumerate(answers.public) if p]
    public = score([answers.prices[i] for i in public_idx], [parsed.prices[i] for i in public_idx])
    return full, public


@app.get("/api/leaderboard")
def leaderboard(
    store: Store = Depends(get_store),
    now_fn: Callable[[], datetime] = Depends(get_now),
    settings: ContestSettings = Depends(get_settings),
):
    final = clock.is_final(now_fn(), settings)
    return {
        "final": final,
        "final_at": clock.final_at(settings).isoformat(),
        "rows": [_leaderboard_row(r, final) for r in store.leaderboard(final)],
    }


@app.get("/api/quota")
def quota(
    user: User = Depends(require_user),
    store: Store = Depends(get_store),
    now_fn: Callable[[], datetime] = Depends(get_now),
    settings: ContestSettings = Depends(get_settings),
):
    body = _quota_body(store, user.team_key, now_fn(), settings.daily_limit)
    body["limit"] = settings.daily_limit
    return body


def _game_row(row) -> dict:
    return {
        "rank": row.rank,
        "team": row.team,
        "nickname": row.nickname,
        "score": row.score,
        "played_at": row.played_at.astimezone(clock.KST).isoformat(),
    }


@app.post("/api/games/{game}/score")
def record_game_score(
    game: str,
    body: ScoreBody,
    user: User = Depends(require_user),
    store: Store = Depends(get_store),
    now_fn: Callable[[], datetime] = Depends(get_now),
):
    if game not in GAME_MAX_SCORE:
        raise HTTPException(status_code=404, detail="없는 게임입니다.")
    if not 0 <= body.score <= GAME_MAX_SCORE[game]:
        return _bad_request("bad_score", "점수가 올바르지 않습니다.")
    store.insert_game_score(
        GameScore(0, game, user.team_key, user.team_display, user.nickname, body.score, now_fn())
    )
    rows = store.game_leaderboard(game)
    mine = next(r for r in rows if r.team_key == user.team_key)
    return {"rank": mine.rank, "team_best": mine.score}


@app.get("/api/games/{game}/leaderboard")
def game_leaderboard(game: str, store: Store = Depends(get_store)):
    if game not in GAME_MAX_SCORE:
        raise HTTPException(status_code=404, detail="없는 게임입니다.")
    return [_game_row(r) for r in store.game_leaderboard(game)]


# --- 관리자 -------------------------------------------------------------------
# 모두 로그인한 관리자 계정만 부를 수 있다. 비로그인은 401, 일반 사용자는 403.

admin = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


def _team_filter(team: str | None) -> str | None:
    """팀 번호 필터. 비어 있으면 전체, 숫자가 아니면 400."""
    if team is None or not team.strip():
        return None
    try:
        return normalize_team(team)
    except NameError_ as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@admin.get("/overview")
def admin_overview(
    store: Store = Depends(get_store),
    now_fn: Callable[[], datetime] = Depends(get_now),
    settings: ContestSettings = Depends(get_settings),
    answers: Answers = Depends(get_answers),
):
    now = now_fn()
    day_start, day_end = clock.day_window(now)
    active = [s for s in store.list_submissions() if s.deleted_at is None]
    users = [u for u in store.list_users() if not u.is_admin]
    return {
        "status": clock.status(now, settings),
        "start_at": clock.start_at(settings).isoformat(),
        "final_at": clock.final_at(settings).isoformat(),
        "daily_limit": settings.daily_limit,
        "answer_rows": len(answers.ids),
        "public_rows": sum(answers.public),
        "submissions_total": len(active),
        "submissions_today": sum(1 for s in active if day_start <= s.submitted_at < day_end),
        "submitting_teams": len({s.team_key for s in active}),
        "users": len(users),
        "teams": len({u.team_key for u in users}),
    }


class ContestBody(BaseModel):
    start: date
    end: date
    daily_limit: int


@admin.put("/contest")
def admin_save_contest(body: ContestBody, store: Store = Depends(get_store)):
    if body.start > body.end:
        return _bad_request("bad_contest", "시작일이 마지막 날보다 늦습니다.")
    if not 1 <= body.daily_limit <= 100:
        return _bad_request("bad_contest", "하루 제출 횟수는 1-100 사이여야 합니다.")
    store.save_settings(ContestSettings(body.start, body.end, body.daily_limit))
    return {"start": body.start.isoformat(), "end": body.end.isoformat(), "daily_limit": body.daily_limit}


class NoticeBody(BaseModel):
    title: str
    date: date


def _notice_from(body: NoticeBody, notice_id: int = 0) -> Notice:
    title = " ".join(body.title.split())
    if not 1 <= len(title) <= 200:
        raise HTTPException(status_code=400, detail="공지 제목은 1-200자여야 합니다.")
    return Notice(notice_id, title, body.date)


@admin.post("/notices")
def admin_add_notice(body: NoticeBody, store: Store = Depends(get_store)):
    n = _notice_from(body)
    store.add_notice(n)
    return _notice_row(n)


@admin.put("/notices/{notice_id}")
def admin_update_notice(notice_id: int, body: NoticeBody, store: Store = Depends(get_store)):
    n = _notice_from(body, notice_id)
    if not store.update_notice(n):
        raise HTTPException(status_code=404, detail="해당 공지가 없습니다.")
    return _notice_row(n)


@admin.delete("/notices/{notice_id}")
def admin_delete_notice(notice_id: int, store: Store = Depends(get_store)):
    if not store.delete_notice(notice_id):
        raise HTTPException(status_code=404, detail="해당 공지가 없습니다.")
    return {"deleted": notice_id}


@admin.post("/score-check")
async def admin_score_check(file: UploadFile = File(...), answers: Answers = Depends(get_answers)):
    """기록과 제출 횟수에 남기지 않고 채점만 한다."""
    if not any(answers.public):
        return JSONResponse(
            status_code=503, content={"error_code": "answers_not_ready", "message": "정답이 아직 적재되지 않았습니다."}
        )
    try:
        full, public = _score_both(await file.read(), answers)
    except SubmissionError as e:
        return JSONResponse(status_code=400, content=e.to_dict())
    return {
        "public_rmse": public.rmse,
        "public_r2": public.r2,
        "rmse": full.rmse,
        "r2": full.r2,
        "negative_clipped": full.negative_clipped,
    }


@admin.get("/submissions")
def admin_submissions(team: str | None = None, include_deleted: bool = True, store: Store = Depends(get_store)):
    rows = store.list_submissions(_team_filter(team))
    return [_submission_row(s) for s in rows if include_deleted or s.deleted_at is None]


@admin.delete("/submissions/{submission_id}")
def admin_delete_submission(
    submission_id: int,
    store: Store = Depends(get_store),
    now_fn: Callable[[], datetime] = Depends(get_now),
):
    if not store.soft_delete(submission_id, now_fn()):
        raise HTTPException(status_code=404, detail="해당 제출이 없거나 이미 삭제되었습니다.")
    return {"deleted": submission_id}


@admin.post("/submissions/{submission_id}/restore")
def admin_restore_submission(submission_id: int, store: Store = Depends(get_store)):
    # 그날 제출 한도는 다시 확인하지 않는다. 운영진이 판단해서 되살리는 것이다.
    if not store.restore(submission_id):
        raise HTTPException(status_code=404, detail="해당 제출이 없거나 삭제되지 않았습니다.")
    return {"restored": submission_id}


def _admin_user_row(u: User) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "nickname": u.nickname,
        "team": u.team_display,
        "is_admin": u.is_admin,
        "created_at": _kst(u.created_at),
    }


@admin.get("/users")
def admin_users(team: str | None = None, store: Store = Depends(get_store)):
    return [_admin_user_row(u) for u in store.list_users(_team_filter(team))]


class UserPatch(BaseModel):
    team: str | None = None
    is_admin: bool | None = None


def _target_user(store: Store, user_id: int) -> User:
    u = store.get_user(user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="해당 사용자가 없습니다.")
    return u


@admin.patch("/users/{user_id}")
def admin_update_user(
    user_id: int,
    body: UserPatch,
    me_: User = Depends(require_admin),
    store: Store = Depends(get_store),
):
    u = _target_user(store, user_id)
    if body.team is not None:
        try:
            team_key = normalize_team(body.team)
        except NameError_ as e:
            return _bad_request("bad_name", str(e))
        # 이미 낸 제출은 원래 팀에 남는다. 표기는 옮겨 가는 팀의 첫 표기를 따른다.
        u.team_display = store.first_team_display(team_key) or clean_team_display(body.team)
        u.team_key = team_key
    if body.is_admin is not None:
        # 자기 권한을 못 풀게 해 두면 관리자가 0명이 되는 일도 없다.
        if u.id == me_.id and not body.is_admin:
            return _bad_request("self_demote", "자기 자신의 관리자 권한은 해제할 수 없습니다.")
        u.is_admin = body.is_admin
    store.update_user(u)
    return _admin_user_row(u)


@admin.post("/users/{user_id}/reset-password")
def admin_reset_password(user_id: int, store: Store = Depends(get_store)):
    u = _target_user(store, user_id)
    password = secrets.token_urlsafe(9)  # 12자
    u.password_hash = auth.hash_password(password)
    store.update_user(u)
    return {"username": u.username, "password": password}


def _csv(header: list[str], rows: list[list]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue().encode("utf-8-sig")  # 엑셀에서 한글이 깨지지 않게 BOM을 붙인다


@admin.get("/export")
def admin_export(store: Store = Depends(get_store), settings: ContestSettings = Depends(get_settings)):
    """최종 순위·전체 제출·사용자·미니게임 점수를 CSV 네 개로 묶는다. 기수 기록은 이 파일로만 남는다."""
    final = store.leaderboard(final=True)
    files = {
        "final_ranking.csv": _csv(
            ["rank", "team", "nickname", "rmse", "r2", "public_rank", "public_rmse", "public_r2", "submitted_at"],
            [[r.rank, r.team, r.nickname, r.rmse, r.r2, r.public_rank, r.public_rmse, r.public_r2, _kst(r.submitted_at)]
             for r in final],
        ),
        "submissions.csv": _csv(
            ["id", "team", "nickname", "rmse", "r2", "public_rmse", "public_r2", "negative_clipped", "submitted_at", "deleted_at"],
            [[s.id, s.team_display, s.nickname, s.rmse, s.r2, s.public_rmse, s.public_r2, s.negative_clipped,
              _kst(s.submitted_at), _kst(s.deleted_at) if s.deleted_at else ""]
             for s in reversed(store.list_submissions())],
        ),
        "users.csv": _csv(
            ["id", "username", "nickname", "team", "is_admin", "created_at"],
            [[u.id, u.username, u.nickname, u.team_display, u.is_admin, _kst(u.created_at)] for u in store.list_users()],
        ),
        "game_scores.csv": _csv(
            ["id", "game", "team", "nickname", "score", "played_at"],
            [[g.id, g.game, g.team_display, g.nickname, g.score, _kst(g.played_at)] for g in store.list_game_scores()],
        ),
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    filename = f"iba-results-{settings.end_date.isoformat()}.zip"
    return Response(
        buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def reset_phrase(settings: ContestSettings) -> str:
    return f"{settings.end_date.isoformat()} 대회 초기화"


class ResetBody(BaseModel):
    confirm: str
    delete_games: bool = True
    delete_users: bool = True


@admin.post("/reset")
def admin_reset(body: ResetBody, store: Store = Depends(get_store), settings: ContestSettings = Depends(get_settings)):
    """기수 초기화. 제출 기록은 항상, 미니게임 점수와 관리자가 아닌 계정은 고른 경우에 지운다."""
    if body.confirm.strip() != reset_phrase(settings):
        return _bad_request("bad_confirm", f"확인 문구가 다릅니다. '{reset_phrase(settings)}'를 입력하세요.")
    return {"deleted": store.reset_season(body.delete_games, body.delete_users)}


app.include_router(admin)


@app.get("/api/health")
def health():
    return {"ok": True}


# --- 로컬 개발용 정적 파일 -----------------------------------------------------
# Vercel에서는 public/이 CDN에서 서빙되므로 마운트하지 않는다(Vercel FastAPI 가이드).
if not os.environ.get("VERCEL"):
    from fastapi.staticfiles import StaticFiles

    class _NoCacheStaticFiles(StaticFiles):
        """로컬 개발용: 브라우저가 매번 새 버전인지 확인하게 해 고친 CSS·JS·HTML이 바로 보이게 한다.
        Cache-Control이 없으면 브라우저가 알아서 한동안 옛 파일을 재사용한다."""

        def file_response(self, *args, **kwargs):
            response = super().file_response(*args, **kwargs)
            response.headers["Cache-Control"] = "no-cache"
            return response

    _public = Path(__file__).parent / "public"
    if _public.is_dir():
        app.mount("/", _NoCacheStaticFiles(directory=_public, html=True), name="public")
