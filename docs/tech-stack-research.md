# 채점 사이트 기술 스택 조사: Vercel vs Cloudflare vs Netlify (무료 티어)

조사일: 2026-09-19
대상 결정: docs/decisions/006-tech-stack.md

## 질문

다음 조건을 **무료 티어만으로** 만족하는 플랫폼과 구성은 무엇인가.

- 제출 CSV(약 0.5 MB, 39,085행 `id,price`) 업로드를 받아 서버에서 `answer.csv`와 행 순서로 비교해 RMSE·R² 계산
- `answer.csv`는 클라이언트에 노출되지 않아야 함
- 제출 기록(팀명·닉네임·점수·시각) 저장 + 팀당 하루 3회 판정
- 리더보드 조회. 인증 없음. 관리자 삭제용 키 하나
- 비용 0원, 두 사람이 만들고 졸업 후 후배가 이어받을 수 있어야 함

## 한 줄 결론

**Vercel Hobby + Python(FastAPI) 함수 + Neon Postgres 무료 플랜**을 추천한다. 세 곳 중 유일하게 Python 함수를 정식 지원해 동아리원이 익숙한 언어로 채점 코드를 유지할 수 있고, 함수 실행 한도(최대 300초, 2 GB 메모리, 월 100만 회 호출)가 이 워크로드 대비 압도적으로 여유 있다. Cloudflare는 무료 CPU 한도 10 ms가 0.5 MB CSV 파싱에 아슬아슬하고 사실상 JavaScript 전용이 되며, Netlify는 무료 크레딧 소진 시 사이트가 통째로 멈추고 프로덕션 배포 1회당 크레딧을 소모해 반복 개발에 불리하다.

## 우리 워크로드 추정

가정: 기수당 팀 10개, 팀당 하루 3회, 프로젝트 기간 4주.

- 채점 요청: 10 × 3 × 28 = **840회/기수** (상한). 리더보드·페이지 조회를 넉넉히 잡아도 월 1만 요청 이내.
- 업로드 크기: 제출 CSV 약 0.5 MB(`sample_submission.csv`가 494 KB).
- 채점 연산 비용: 로컬 벤치마크(Node 24, Apple M1)에서 `answer.csv`와 제출 파일을 둘 다 파싱해 RMSE·R²까지 계산하면 **6–23 ms**(첫 실행 23 ms), 정답을 미리 파싱해 두고 제출 파일만 파싱하면 **3–5 ms**. 세 플랫폼 모두 요청 수·저장 용량은 문제되지 않으며, 차이는 **CPU 시간 한도·언어·과금 방식·인수인계**에서 난다.

## 플랫폼별 조사

### Cloudflare Workers (Workers Free)

| 항목 | 값 | 출처 |
|---|---|---|
| 요청 | 100,000/일 | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| **CPU 시간** | **10 ms/요청** (Paid는 기본 30초, 최대 5분) | 같은 문서 |
| 메모리 | 128 MB | 같은 문서 |
| 요청 본문 | 100 MB (Cloudflare Free 플랜 기준) | 같은 문서 |
| Worker 크기 | 64 MiB(비압축) | 같은 문서 |
| D1(SQLite) 무료 | 읽기 500만 행/일, 쓰기 10만 행/일, 저장 5 GB, DB당 500 MB, 초과 시 그날 쿼리 실패 | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| KV 무료 | 쓰기·삭제·리스트 각 1,000/일, 저장 1 GB, 00:00 UTC 리셋 | [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) |
| 정적 자산 | Worker당 파일 2만 개, 파일당 25 MiB; `ASSETS` 바인딩으로 함수에서 제공 | [Static assets](https://developers.cloudflare.com/workers/static-assets/) |
| Python | Python Workers 지원. 패키지는 "pure 및 PyEmscripten 휠, Pyodide 포함 패키지"만. "WebAssembly support for Python packages is still in early stages" | [Python Workers](https://developers.cloudflare.com/workers/languages/python/), [Packages](https://developers.cloudflare.com/workers/languages/python/packages/) |
| 결제 수단 | 문서에 카드 요구 언급 없음 | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |

평가:

- **CPU 10 ms가 핵심 위험.** 문서 자체가 "parse large payloads typically use 10–20 ms"라고 적고 있고, 로컬 벤치마크(M1)에서도 두 파일 파싱 시 6–23 ms였다. 정답을 전역 스코프에서 미리 파싱하고(시작 시간 한도 1초는 별도) 제출 파일만 파싱하면 3–5 ms로 들어오지만, Workers 실제 하드웨어는 M1보다 느릴 수 있어 여유가 거의 없다. 한도를 넘으면 Error 1102로 요청이 실패한다. "built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit"라는 완충은 있으나 보장은 아니다.
- 이 한도 때문에 Pyodide 기반 Python Workers로 pandas 채점을 돌리는 것은 현실적이지 않다 → 사실상 **JavaScript 전용**.
- `answer.csv`를 정적 자산에 두면 공개되므로 안 된다. Worker 번들에 모듈로 포함하거나 D1/KV에 넣어야 한다.
- D1·KV 무료 한도 자체는 840회/기수 워크로드에 충분하다.

### Vercel (Hobby)

| 항목 | 값 | 출처 |
|---|---|---|
| 함수 호출 | 월 100만 회 | [Hobby plan](https://vercel.com/docs/plans/hobby) |
| Active CPU / 메모리 시간 | 4 CPU-hr, 360 GB-hr | 같은 문서 |
| 함수 최대 실행 시간 | 300초 (Hobby 기본·최대) | [Functions limitations](https://vercel.com/docs/functions/limitations), [Duration](https://vercel.com/docs/functions/configuring-functions/duration) |
| 함수 메모리 | Hobby 2 GB | [Functions limitations](https://vercel.com/docs/functions/limitations) |
| **요청 본문** | **4.5 MB** (초과 시 413) | 같은 문서 |
| 함수 번들 크기 | 250 MB, **Python은 500 MB** | 같은 문서 |
| Python | FastAPI/Flask/Django 프리셋 자동 감지, `requirements.txt` 기반, "the app you run locally deploys as-is" | [Python runtime](https://vercel.com/docs/functions/runtimes/python) |
| Blob | Hobby 포함: 1 GB 저장, Simple 작업 1만 회, 전송 10 GB. **Private 스토어** 지원(토큰 필요, 함수의 `get()`으로만 읽음) | [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing), [Blob overview](https://vercel.com/docs/vercel-blob) |
| DB | Marketplace(Neon, Supabase, Upstash, Turso 등). Neon Free: $0/월, 프로젝트당 0.5 GB, 100 CU-hour/월 | [Storage](https://vercel.com/docs/storage), [Neon plans](https://neon.com/docs/introduction/plans) |
| 사용 제한 | "Hobby teams are restricted to non-commercial personal use only" | [Fair use](https://vercel.com/docs/limits/fair-use-guidelines) |
| 초과 시 | 무료 티어라 청구는 없고 "wait until 30 days have passed before you can use the feature again" | [Hobby plan](https://vercel.com/docs/plans/hobby) |
| Git 협업 | GitHub **조직의 비공개 저장소**에서는 Hobby로 배포 불가(공개 저장소 또는 Pro). 조직 저장소는 커밋 작성자가 Hobby 팀 소유자여야 배포됨. **개인 계정 저장소의 협업자에게는 이 제한이 적용되지 않음** | [Git](https://vercel.com/docs/git) |
| 결제 수단 | 문서에 카드 요구 언급 없음 | — |

평가:

- 실행 한도(300초, 2 GB)가 워크로드 대비 수백 배 여유. Python으로 `csv` 표준 라이브러리 또는 numpy로 채점 코드를 짜도 전혀 문제없다. 노트북에서 쓰던 `mean_squared_error`/`r2_score` 로직을 그대로 옮길 수 있다.
- 동아리 채점 사이트는 비상업이므로 Hobby 이용 조건에 부합한다.
- 저장소 설계: `answer.csv`는 **비공개 Blob** 또는 Neon 테이블에, 제출 기록은 Neon에. Neon 하나로 둘 다 처리하면 의존성이 하나로 줄어든다(정답 39,085행은 0.5 GB 한도의 극히 일부).
- 인수인계: 저장소를 GitHub 조직에 두려면 **공개 저장소**여야 하므로 `answer.csv`를 git 밖(Blob/Neon)에 두는 설계가 필수. 개인 저장소를 쓰면 비공개도 가능하지만 졸업 시 저장소·Vercel 프로젝트 소유권을 넘겨야 한다.
- 미확인: Marketplace를 통한 Neon 설치 시 Hobby에서 결제 수단을 요구하는지는 문서에 없음. Neon에 직접 가입해 연결 문자열을 환경변수로 넣는 방식이면 Vercel 결제와 무관하다.

### Netlify (Free, Credit-based)

| 항목 | 값 | 출처 |
|---|---|---|
| 요금 모델 | **월 300 크레딧, 하드 리밋**, 추가 구매 불가 | [How credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/), [Pricing](https://www.netlify.com/pricing/) |
| 크레딧 단가 | **프로덕션 배포 15 크레딧/회**, 컴퓨트 10 크레딧/GB-hr, 웹 요청 2 크레딧/1만 회, 대역폭 20 크레딧/GB. Deploy Preview·브랜치 배포는 0 | 같은 문서 |
| 소진 시 | "all of your web projects … are paused and visitors … will find a `Site not available` page" 다음 결제 주기까지 | 같은 문서 |
| 함수 | 메모리 1,024 MB, 동기 실행 60초, 버퍼 페이로드 6 MB(바이너리는 base64로 실질 4.5 MB) | [Functions configuration](https://docs.netlify.com/build/functions/configuration/) |
| 언어 | 함수는 JS/TS(Node) 중심, Go 언급 있음("Functions written in Go cannot access Netlify Blobs"). Python은 빌드 도구로만 언급, 함수 런타임 아님 | [Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), [Functions overview](https://docs.netlify.com/build/functions/overview/) |
| 저장소 | Netlify Blobs(키-값, 객체 5 GB까지), Netlify Database | [Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) |
| 팀 | Free/Personal은 팀원 추가 불가 | [Billing FAQ](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/) |
| 결제 수단 | Personal/Pro만 결제 수단 필수. 신용카드·Apple Pay·Google Pay | 같은 문서 |

평가:

- 워크로드 자체는 크레딧 안에 들어온다(840회 × 1초 × 1 GB ≈ 0.23 GB-hr ≈ 2–3 크레딧, 1만 요청 ≈ 2 크레딧). 그러나 **프로덕션 배포 1회 = 15 크레딧**이라 다른 사용이 0이어도 월 20회가 상한이고, 개발 초기에 자주 배포하면 금방 닿는다. 소진되면 사이트가 통째로 내려가 후배 프로젝트 기간 중 사고가 될 수 있다.
- Python 함수가 없어 JavaScript로 채점 코드를 써야 한다.
- 팀원 추가가 안 돼 두 사람이 한 계정을 공유해야 한다.

## 비교표

| 조건 | Cloudflare Workers Free | Vercel Hobby | Netlify Free |
|---|---|---|---|
| 0.5 MB 업로드 | 100 MB 한도 ✅ | 4.5 MB 한도 ✅ | 6 MB(실질 4.5 MB) ✅ |
| 채점 함수 실행 여유 | **CPU 10 ms — 아슬아슬** ⚠️ | 300초 / 2 GB ✅ | 60초 / 1 GB ✅ |
| Python 채점 코드 | 사실상 불가(CPU 한도) ❌ | 정식 지원 ✅ | 없음 ❌ |
| 제출 기록 저장소 | D1/KV 무료 ✅ | Neon 등 Marketplace 또는 직접 연결 ✅ | Blobs/Database ✅ |
| 정답 비공개 보관 | 번들 내부 또는 D1/KV ✅ | Private Blob 또는 Neon ✅ | Blobs ✅ |
| 비용 0원 유지 | 일 한도 초과 시 그날 실패 | 30일 대기 | **크레딧 소진 시 사이트 전체 중단** ⚠️ |
| 반복 배포 부담 | 없음 | 없음 | 프로덕션 배포당 15 크레딧 ⚠️ |
| 2인 협업 | 계정 멤버 추가 가능(문서 미확인) | 개인 저장소 협업자 OK / 조직은 공개 저장소만 | 팀원 추가 불가 ❌ |
| 카드 요구 | 문서 언급 없음 | 문서 언급 없음 | Free는 불필요(명시) |

## 추천 구성

1. **호스팅**: Vercel Hobby. 저장소는 동아리 GitHub 조직의 **공개** 저장소(인수인계 목적) — 따라서 `answer.csv`는 절대 git에 넣지 않는다.
2. **백엔드**: Python + FastAPI 단일 앱(`api/index.py`). 엔드포인트 3개면 충분: `POST /submit`(CSV 검증·채점·기록), `GET /leaderboard`, `DELETE /submissions/{id}`(관리자 키 헤더 필요). 채점은 표준 `csv` + `math`로 충분하고, pandas를 쓰면 콜드 스타트만 조금 늘어난다.
3. **저장소**: Neon Postgres Free 하나. 테이블 두 개 — `answers(row_no, id, price)`(정답, 최초 1회 적재), `submissions(id, team, nickname, rmse, r2, submitted_at)`. 하루 3회 판정은 `submissions`에서 팀명·날짜로 count.
4. **프론트**: 정적 HTML/JS(업로드 폼 + 리더보드 표). 프레임워크 없어도 된다.
5. **비밀값**: `DATABASE_URL`, `ADMIN_KEY`만 Vercel 환경변수로.

대안:

- **Cloudflare Workers + D1 (JS)**: 한 벤더로 끝나고 요청 한도가 크지만, 10 ms CPU 때문에 파서를 손으로 최적화하고 정답을 전역에서 미리 파싱해야 한다. 채점이 간헐적으로 1102 오류를 낼 위험을 감수해야 하므로 후배용 서비스에는 권하지 않는다.
- **Netlify**: 조건상 가장 불리(크레딧 하드 리밋 + 배포 과금 + Python 없음).

## 미확인 사항

- Vercel Hobby에서 Marketplace 네이티브 통합(Neon 등) 설치 시 결제 수단 등록을 요구하는지 — 문서에 명시 없음. Neon 직접 가입으로 우회 가능.
- Cloudflare Free 계정의 멤버 추가 가능 여부 — 문서 페이지에서 확인하지 못함.
- Vercel Python 함수의 콜드 스타트 시간 — 문서에 수치 없음. 표준 라이브러리만 쓰면 무시할 수준으로 예상되나 스펙 단계에서 실측 필요.

## 출처

- Cloudflare: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) · [Static assets](https://developers.cloudflare.com/workers/static-assets/) · [Python Workers](https://developers.cloudflare.com/workers/languages/python/) · [Python packages](https://developers.cloudflare.com/workers/languages/python/packages/)
- Vercel: [Hobby plan](https://vercel.com/docs/plans/hobby) · [Fair use](https://vercel.com/docs/limits/fair-use-guidelines) · [Functions limitations](https://vercel.com/docs/functions/limitations) · [Duration](https://vercel.com/docs/functions/configuring-functions/duration) · [Python runtime](https://vercel.com/docs/functions/runtimes/python) · [Blob overview](https://vercel.com/docs/vercel-blob) · [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) · [Storage](https://vercel.com/docs/storage) · [Git](https://vercel.com/docs/git)
- Neon: [Plans](https://neon.com/docs/introduction/plans)
- Netlify: [Pricing](https://www.netlify.com/pricing/) · [How credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/) · [Billing FAQ](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/) · [Functions configuration](https://docs.netlify.com/build/functions/configuration/) · [Functions overview](https://docs.netlify.com/build/functions/overview/) · [Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- 로컬 벤치마크: `answer.csv` + `sample_submission.csv` 파싱·RMSE·R² 계산, Node 24.15 / Apple M1, 5회 반복 (본 조사 중 실행).
