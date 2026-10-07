# IBA Scoring Machine

데이터분석 동아리 회귀 프로젝트(중고차 가격 예측) 자동 채점 사이트.
팀이 예측 결과 CSV(`id,price`)를 올리면 RMSE·R²를 바로 계산해 리더보드에 올린다.

## 현재 상태 (2026-09-19)

첫 구현 완료(API·정적 페이지·테스트). Vercel/Neon 배포는 아직. 결정 사항은 아래 문서에 있다.

| 문서 | 내용 |
|---|---|
| [docs/specs/scoring-site.md](docs/specs/scoring-site.md) | **구현 스펙** — 수용 기준, 데이터 모델, API 계약, 검증 계획 |
| [docs/wayfinder/scoring-site/MAP.md](docs/wayfinder/scoring-site/MAP.md) | 결정 지도 — 7개 결정과 그 근거 |
| [docs/research/scoring-site-tech-stack.md](docs/research/scoring-site-tech-stack.md) | 기술 스택 조사 (Vercel / Cloudflare / Netlify 무료 티어 비교) |

핵심 결정 요약:

- 제출: `sample_submission.csv`와 같은 `id,price` CSV. 코드 실행 없음.
- 채점: **행 순서 기준**. test.csv의 id는 0부터 매긴 행 번호이고, 제출 파일의 id가 같은 순서인지 확인한 뒤 같은 위치끼리 비교한다. RMSE가 순위 기준, R²는 보조.
- 참가: 아이디·비밀번호로 가입하고, 가입 때 적은 팀 번호(숫자만, 앞자리 0 무시)로 팀이 묶인다. 제출만 로그인 필요. 팀당 하루 3회(KST 자정 초기화, 관리자 페이지에서 바꿀 수 있음).
- 리더보드: 팀별 최고 기록 1건 — 닉네임·팀 번호·RMSE·R².
- 스택: Vercel Hobby + Python(FastAPI) + Neon Postgres Free + 정적 프론트. 비용 0원.
- 페이지: 홈 / 채점 / 리더보드 / 미니게임(사과게임·테트리스·블록깨기, 게임별 팀 순위) / 관리자(관리자 계정에만 보임).

## 저장소 구조

```
app.py               # FastAPI 앱 (Vercel Python 런타임 진입점). /api/* 엔드포인트
auth.py              # 비밀번호 해시(PBKDF2), 서명 쿠키 세션
store.py             # 저장소 계층: PostgresStore(Neon) / MemoryStore(테스트·로컬)
scoring/             # 채점 도메인 로직 (프레임워크·DB 무관)
  parse.py           #   제출 CSV 검증·파싱
  metrics.py         #   RMSE·R², 음수 클리핑
  teams.py           #   팀 번호·닉네임 정규화
  clock.py           #   KST 하루 경계, 대회 일정과 상태(준비·진행·결과 공개)
public/              # 정적 사이트 (Vercel CDN이 그대로 서빙)
  index.html, submit.html, leaderboard.html, minigame.html(게임 목록), login.html(로그인·가입), admin.html(관리자)
  games/             #   미니게임: apple(사과게임), tetris, blocks(블록깨기). 게임은 브라우저에서 돌고 점수만 API로 기록
  assets/            #   style.css, app.js(셸·공통), icons.js, admin.js·admin.css(관리자 페이지)
  data/              #   train/test/sample_submission/brand_model.csv (후배 배포용)
scripts/             # 운영 스크립트: schema.sql, load_answers.py, grant_admin.py(첫 관리자 지정)
tests/               # pytest (API 레벨)
scoring_machine/     # 참고 노트북 (베이스라인, 3조 코드)
docs/                # 스펙·결정 지도·조사
```

## 로컬 실행

```bash
uv venv --python 3.12 .venv && uv pip install -r requirements-dev.txt
```

DB 없이 돌리려면 정답 CSV 경로만 넘긴다(제출 기록은 메모리에만, 재시작하면 사라짐):

```bash
DEV_ANSWER_CSV=/path/to/answer.csv SESSION_SECRET=dev .venv/bin/uvicorn app:app --port 8765
```

이 모드에서는 아무 아이디·비밀번호로나 로그인된다(처음 보는 아이디면 그 이름으로 계정이 바로 만들어진다). 아이디 `admin`으로 로그인하면 관리자 계정이 된다. 화면을 빠르게 확인하기 위한 것이라 DB를 쓰는 실제 배포에서는 꺼져 있다.

테스트:

```bash
.venv/bin/pytest
```

실제 정답 파일로 기준값 테스트(sample_submission → 전체 데이터 RMSE 13,189.79)까지 돌리려면:

```bash
ANSWER_CSV=/path/to/answer.csv .venv/bin/pytest tests/test_real_data.py
```

## 배포 (Vercel Hobby + Neon Free)

1. Neon에서 무료 프로젝트를 만들고 연결 문자열을 받는다.
2. 스키마 생성: `psql "$DATABASE_URL" -f scripts/schema.sql`. 이미 만든 DB에 다시 실행해도 되며, 빠진 컬럼과 테이블만 추가한다. 대회 설정이 없을 때만 첫 기수 일정과 공지를 넣는다.
3. 정답 적재: `DATABASE_URL=... .venv/bin/python scripts/load_answers.py /path/to/answer.csv`. 이때 public 채점 구간(전체의 30%)을 무작위로 정해 함께 저장한다. 데이터셋은 기수가 바뀌어도 그대로 쓰므로 처음 한 번만 실행한다. 다시 적재하면 public 구간이 바뀌어 기존 점수와 맞지 않게 된다.
4. Vercel에서 이 저장소를 가져오고 환경변수 두 개를 넣는다: `DATABASE_URL`, `SESSION_SECRET`(긴 무작위 문자열). `SESSION_SECRET`을 바꾸면 모든 사용자가 로그아웃된다.
5. 운영진 계정을 사이트에서 가입한 뒤 첫 관리자로 지정한다: `DATABASE_URL=... .venv/bin/python scripts/grant_admin.py <아이디>`. 그다음부터 관리자 지정과 해제는 관리자 페이지에서 한다.
6. 배포 후 확인: `/api/health`, 공개 저장소·정적 경로에 `answer.csv`가 없는지, 첫 요청 소요 시간.

## 운영

운영은 관리자 계정으로 로그인해 사이드바의 Admin 메뉴(`/admin.html`)에서 한다. 관리자 계정은 대회에 제출할 수 없고, 제출 파일을 확인할 때는 채점 확인 기능을 쓴다.

| 탭 | 하는 일 |
|---|---|
| 현황 | 대회 상태, 시작·마감 시각, 정답 적재 여부, 제출 수와 가입자 수 |
| 대회 설정과 공지 | 시작일, 마지막 날, 하루 제출 횟수, 리더보드에 보이는 공지. 저장하면 배포 없이 바로 반영된다 |
| 제출 | 전체 제출 목록, 삭제(리더보드와 그날 횟수에서 빠짐)와 복구 |
| 사용자 | 팀 번호 변경, 임시 비밀번호 발급, 관리자 지정과 해제 |
| 채점 확인과 초기화 | 기록이 남지 않는 채점, 결과 zip 내려받기, 기수 초기화 |

채점은 두 단계다. 대회 중에는 public 구간(test의 30%) 점수만 보여주고, 대회 마지막 날 다음 날 0시(KST)부터 제출을 막고 리더보드를 전체 데이터 기준 최종 순위로 바꾼다. 최종 순위에는 팀마다 public 점수가 가장 좋았던 제출 1건이 쓰인다. 시작일 0시 전에는 제출을 받지 않는다.

기수 교체는 관리자 페이지에서 끝난다.

1. 채점 확인과 초기화 탭에서 결과 zip을 내려받는다. 지난 기수 기록은 이 파일로만 남는다.
2. 같은 탭에서 기수를 초기화한다. 제출 기록은 항상 지우고, 사용자 계정(관리자 제외)과 미니게임 점수는 기본으로 함께 지운다. 팀 번호를 기수마다 다시 쓰기 때문이다. 정답, 대회 설정, 공지는 남는다.
3. 대회 설정 탭에서 다음 기수의 시작일과 마지막 날을 정하고 공지를 정리한다.

운영진이 바뀌면 새 운영진이 가입한 뒤 기존 관리자가 사용자 탭에서 관리자로 지정한다.

## 정답 파일 주의

`answer.csv`(test 정답)는 **이 저장소에 절대 커밋하지 않는다.** 공개 저장소이기 때문이다. `.gitignore`로 막혀 있으며, 정답은 운영자가 Neon 데이터베이스의 `answers` 테이블에만 적재한다(스펙의 "기수 교체 절차" 참고).
