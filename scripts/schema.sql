-- Neon Postgres 스키마. 최초 1회 실행: psql "$DATABASE_URL" -f scripts/schema.sql

CREATE TABLE IF NOT EXISTS answers (
    row_no  INTEGER PRIMARY KEY,          -- test.csv에서의 위치(0부터). 채점은 이 순서 기준.
    id      BIGINT NOT NULL,              -- test.csv의 id (행 번호, 순서 확인용)
    price   DOUBLE PRECISION NOT NULL,
    in_public BOOLEAN NOT NULL DEFAULT FALSE -- public 채점 구간(전체의 30%) 여부. load_answers.py가 정한다.
);

CREATE TABLE IF NOT EXISTS users (
    id               BIGSERIAL PRIMARY KEY,
    username         TEXT NOT NULL UNIQUE, -- 로그인 아이디 (소문자)
    password_hash    TEXT NOT NULL,        -- pbkdf2_sha256$반복$솔트$해시
    nickname         TEXT NOT NULL,
    team_key         TEXT NOT NULL,        -- 정규화된 팀명
    team_display     TEXT NOT NULL,        -- 그 팀으로 처음 가입한 사람의 표기
    created_at       TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
    id               BIGSERIAL PRIMARY KEY,
    team_key         TEXT NOT NULL,       -- 정규화된 팀명 (하루 3회 판정·리더보드 그룹 기준)
    team_display     TEXT NOT NULL,       -- 제출자 팀의 표기 (users.team_display)
    nickname         TEXT NOT NULL,
    rmse             DOUBLE PRECISION NOT NULL, -- 전체 데이터 점수(최종 순위용)
    r2               DOUBLE PRECISION NOT NULL,
    public_rmse      DOUBLE PRECISION NOT NULL, -- public 구간 점수(대회 중 공개)
    public_r2        DOUBLE PRECISION NOT NULL,
    negative_clipped INTEGER NOT NULL DEFAULT 0,
    submitted_at     TIMESTAMPTZ NOT NULL,
    deleted_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS game_scores (
    id               BIGSERIAL PRIMARY KEY,
    game             TEXT NOT NULL,        -- apple, tetris, blocks
    team_key         TEXT NOT NULL,
    team_display     TEXT NOT NULL,
    nickname         TEXT NOT NULL,
    score            INTEGER NOT NULL,
    played_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS game_scores_game ON game_scores (game);

CREATE INDEX IF NOT EXISTS submissions_team_day ON submissions (team_key, submitted_at) WHERE deleted_at IS NULL;

-- public/private 분할 전에 만든 DB용. 여러 번 실행해도 된다.
-- 이전 제출은 예측값이 없어 public 점수를 다시 계산할 수 없으므로 전체 점수를 그대로 넣는다.
ALTER TABLE answers ADD COLUMN IF NOT EXISTS in_public BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS public_rmse DOUBLE PRECISION;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS public_r2 DOUBLE PRECISION;
UPDATE submissions SET public_rmse = rmse, public_r2 = r2 WHERE public_rmse IS NULL;
ALTER TABLE submissions ALTER COLUMN public_rmse SET NOT NULL;
ALTER TABLE submissions ALTER COLUMN public_r2 SET NOT NULL;

-- 관리자 계정과 대회 설정. 여러 번 실행해도 된다.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS contest_settings (
    id          INTEGER PRIMARY KEY CHECK (id = 1), -- 한 행만 둔다
    start_date  DATE NOT NULL,                      -- 첫날(KST)
    end_date    DATE NOT NULL,                      -- 마지막 날(KST). 다음 날 0시에 마감
    daily_limit INTEGER NOT NULL DEFAULT 3
);

-- 설정 행이 없으면 첫 기수 일정으로 만든다. 이후에는 관리자 페이지에서 바꾼다.
INSERT INTO contest_settings (id, start_date, end_date, daily_limit)
VALUES (1, DATE '2026-09-22', DATE '2026-10-05', 3)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS notices (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    notice_date DATE NOT NULL
);
