# IBA Scoring Machine

IBA 회귀 프로젝트(중고차 가격 예측)의 자동 채점 사이트다. 팀이 예측 결과 CSV를 올리면 RMSE와 R²를 바로 계산해 리더보드에 올린다. Vercel Hobby와 Neon Postgres Free로 운영하며 비용은 들지 않는다.

## 채점 규칙

- 제출 파일은 sample_submission.csv와 같은 `id,price` CSV다. 39,085행 전부를 test.csv와 같은 순서로 내야 한다.
- 채점은 id가 아니라 행 위치끼리 짝지어 한다. test.csv, sample_submission.csv, 정답의 id는 0부터 39,084까지의 행 번호다. 원본 데이터의 id는 서로 다른 차량이 같은 값을 쓰는 경우가 많아서 행 번호로 다시 매겼다.
- 순위는 RMSE로 매기고 R²는 참고용이다. 음수 예측은 0으로 바꿔 채점한다.
- 팀당 하루 3회까지 제출할 수 있고 한국 시간 자정에 초기화된다. 횟수는 관리자 페이지에서 바꿀 수 있다.
- 대회 중에는 test의 30%로 계산한 public 점수만 보인다. 마지막 날 다음 날 0시부터 제출이 막히고 리더보드가 전체 데이터 기준 최종 순위로 바뀐다. 최종 순위에는 팀마다 public 점수가 가장 좋았던 제출 1건이 쓰인다.
- 참가자는 아이디, 비밀번호, 닉네임, 팀 번호로 가입한다. 같은 팀 번호를 적은 사람끼리 한 팀이 된다.

## 폴더 구조

```
app.py               # FastAPI 앱, /api/* 엔드포인트 (Vercel Python 런타임 진입점)
auth.py              # 비밀번호 해시(PBKDF2), 서명 쿠키 세션
store.py             # 저장소 계층: PostgresStore(Neon) / MemoryStore(테스트·로컬)
scoring/             # 채점 로직: CSV 검증, RMSE·R², public 구간, 팀 번호 정규화, KST 일정
public/              # 정적 사이트 (Vercel CDN이 그대로 서빙)
  index.html 외      #   홈, 채점, 리더보드, 미니게임, 로그인, 마이페이지, 관리자, About, Thanks
  games/             #   미니게임: 사과게임, 테트리스, 블록깨기, 슈팅게임, 스네이크
  data/              #   참가자 배포용 train/test/sample_submission/brand_model.csv와 dataset.zip
scripts/             # schema.sql, load_answers.py(정답 적재), grant_admin.py(첫 관리자 지정)
tests/               # pytest (API 레벨)
scoring_machine/     # 참고 노트북 (베이스라인, 3조 코드)
docs/                # 구현 스펙, 결정 기록, 기술 스택 조사
```

## 로컬 실행

```bash
uv venv --python 3.12 .venv && uv pip install -r requirements-dev.txt
```

DB 없이 돌리려면 정답 CSV 경로만 넘긴다. 제출 기록은 메모리에만 남고 재시작하면 사라진다.

```bash
DEV_ANSWER_CSV=/path/to/answer.csv SESSION_SECRET=dev .venv/bin/uvicorn app:app --port 8765
```

이 모드에서는 아무 아이디와 비밀번호로나 로그인되고, 아이디 `admin`으로 로그인하면 관리자 계정이 된다. 실제 배포에서는 꺼져 있다.

테스트는 `.venv/bin/pytest`로 돌린다. 실제 정답 파일로 기준값 테스트까지 하려면 `ANSWER_CSV=/path/to/answer.csv .venv/bin/pytest tests/test_real_data.py`를 실행한다. sample_submission을 그대로 내면 전체 데이터 RMSE가 13,189.79로 나와야 한다.

## 배포

1. Neon에서 무료 프로젝트를 만들고 연결 문자열을 받는다.
2. `psql "$DATABASE_URL" -f scripts/schema.sql`로 스키마를 만든다. 이미 만든 DB에 다시 실행해도 빠진 컬럼과 테이블만 추가한다.
3. `DATABASE_URL=... .venv/bin/python scripts/load_answers.py /path/to/answer.csv`로 정답을 적재한다. 이때 public 구간이 무작위로 정해진다. 다시 적재하면 public 구간이 바뀌어 기존 점수와 맞지 않으므로 처음 한 번만 실행한다.
4. Vercel에서 이 저장소를 가져오고 환경변수 `DATABASE_URL`, `SESSION_SECRET`을 넣는다. `SESSION_SECRET`을 바꾸면 모든 사용자가 로그아웃된다.
5. 운영진 계정을 사이트에서 가입한 뒤 `DATABASE_URL=... .venv/bin/python scripts/grant_admin.py <아이디>`로 첫 관리자를 지정한다.
6. `/api/health`가 응답하는지, 정적 경로로 answer.csv에 접근할 수 없는지 확인한다.

## 운영

관리자 계정으로 로그인하면 사이드바에 Admin 메뉴(`/admin.html`)가 보인다. 관리자 계정으로는 제출할 수 없고, 파일 점수만 확인할 때는 채점 확인 기능을 쓴다.

| 탭 | 하는 일 |
|---|---|
| 현황 | 대회 상태, 시작·마감 시각, 정답 적재 여부, 제출 수와 가입자 수 |
| 대회 설정과 공지 | 시작일, 마지막 날, 하루 제출 횟수, 공지. 저장하면 바로 반영된다 |
| 제출 | 전체 제출 목록, 삭제와 복구 |
| 사용자 | 팀 번호 변경, 임시 비밀번호 발급, 관리자 지정과 해제 |
| 채점 확인과 초기화 | 기록이 남지 않는 채점, 결과 zip 내려받기, 기수 초기화 |

기수가 바뀌면 결과 zip을 먼저 내려받고 기수를 초기화한 뒤, 대회 설정에서 다음 기수 날짜와 공지를 정리한다. 초기화하면 제출 기록과 관리자가 아닌 계정, 미니게임 점수가 지워지고 정답과 설정, 공지는 남는다. 데이터셋과 정답은 기수가 바뀌어도 그대로 쓴다.

## 정답 파일 주의

이 저장소는 공개 저장소라서 answer.csv를 절대 커밋하지 않는다. `.gitignore`로 막혀 있고, 정답은 Neon DB의 `answers` 테이블에만 둔다.
