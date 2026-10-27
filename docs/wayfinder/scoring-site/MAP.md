# 동아리 ML 프로젝트 자동 채점 사이트 (scoring-site)

> 2026년 9월 구현 전에 정한 결정 기록이다. 이후 구현에서 바뀐 부분이 있으며, 현재 동작은 README와 docs/specs/scoring-site.md를 따른다.

## Destination

후배 팀이 회귀 프로젝트(중고차 가격 예측)의 예측 결과를 제출하면 사람 손 없이 점수가 계산되어 보이는 웹사이트를 만들기 위해,
"무엇을 제출받고, 무엇으로 채점하고, 누가 어떻게 운영하는지"가 정해져 `to-spec`으로 구현 스펙을 쓸 수 있는 상태.

## Notes

- 원자료: `scoring_machine/regression/` (2026-09-19 기준). 분류 과제는 2026-09-19에 폐기 결정 → Out of scope.
- 회귀: 중고차 가격. train 58,627행(`mileage`/`tax`/`mpg` 결측 있음) / test 39,085행(`id` 포함, 결측 없음), 타깃 `price`. `brand_model.csv`는 model 인코딩용 클래스 목록.
- 정답: `scoring_machine/regression/answer.csv`(`id,price`, 39,085행) — 2026-09-17 추가. 분포·상관이 train과 일치해 실제 정답으로 판단. `sample_submission.csv`의 price는 균등 난수 placeholder(정답 대비 RMSE 13,190).
- **원본 test.csv의 `id`는 고유하지 않았음**: 31,573개 고유값 / 39,085행, 중복 id 7,512건이 서로 다른 차량. 그래서 **행 순서(위치) 기준**으로 채점한다. 2026-10-02에 배포 전 test.csv·answer.csv·sample_submission.csv의 id를 0부터 행 번호로 다시 매겼다(id merge 채점 템플릿이 다른 차량끼리 짝지어 점수를 부풀리던 문제). 제출 파일은 test.csv와 같은 순서·같은 행 수여야 함.
- 3조 노트북·베이스라인은 RMSE와 R²를 사용, 음수 예측은 0으로 클리핑, `id,price` 형식으로 제출 파일 생성.
- 사용자: 운영자는 사용자와 친구 2명(졸업 이후 유지보수 주체가 불명확), 이용자는 매 기수 후배 팀.
- 사이트 페이지 구성(2026-09-19 결정): **홈 화면 / 채점 페이지 / 리더보드 / 미니게임** 네 페이지. 앞 세 페이지는 001~007로 내용이 정해졌고, 미니게임은 채점과 무관한 순수 프론트 장난감(서버·DB 접근 없음).
- 구현 스펙(2026-09-19): [docs/specs/scoring-site.md](../../specs/scoring-site.md). Not yet specified의 스펙 단계 항목(하루 기준 KST 자정, 리더보드 최고 기록, 음수 0 클리핑, 팀명 정규화, 관리자 엔드포인트, 기수 교체 절차)은 스펙에서 확정됨.
- 유용한 스킬: `grilling`(선호·트레이드오프 결정), `domain-modeling`(제출·채점·리더보드 용어 정리), `to-spec`(맵 완성 후).

## Decision map

| Decision | Type | Status | Depends on | Detail |
|---|---|---|---|---|
| 채점 입력 단위: 예측 파일 vs 코드 | grilling | resolved | — | [001](decisions/001-submission-unit.md) |
| 정답 데이터 확보와 보관 | task | resolved | — | [002](decisions/002-ground-truth.md) |
| 공식 평가 지표 확정 | grilling | resolved | — | [003](decisions/003-metrics.md) |
| 참가자 식별·팀·제출 제한 | grilling | resolved | — | [004](decisions/004-participants-and-limits.md) |
| 운영 주체와 호스팅 조건 | grilling | resolved | — | [005](decisions/005-operations-and-hosting.md) |
| 팀 식별과 제출 한도 강제 방식 | grilling | resolved | 004 | [007](decisions/007-team-identity.md) |
| 기술 스택 선택 | research | resolved | 004, 005, 007 | [006](decisions/006-tech-stack.md) |

Status: `ready`, `blocked`, `in-progress`, `resolved`, or `out-of-scope`.

## Decisions so far

- [채점 입력 단위](decisions/001-submission-unit.md): `sample_submission.csv`와 같은 `id,price` CSV만 제출받는다. 코드 실행 없음. 행 순서 보존을 안내·검증하고, id는 행 번호로 다시 매김.
- [정답 데이터 확보와 보관](decisions/002-ground-truth.md): `answer.csv` 확보 완료. id 중복 때문에 행 순서 기준 채점으로 확정. 정답 파일은 배포본·공개 저장소에서 분리해야 함(보관 위치는 005에서).
- [공식 평가 지표](decisions/003-metrics.md): RMSE(주, 순위 기준)와 R²(보조)를 함께 계산·표시. 음수·결측 처리와 동점 규칙은 스펙 단계에서.
- [참가자·제출 제한](decisions/004-participants-and-limits.md): 팀당 하루 3회. 리더보드는 닉네임·팀명·RMSE·R². 팀 식별 방식은 007로 분리.
- [운영·호스팅](decisions/005-operations-and-hosting.md): 별도 사이트, 비용 0원, Vercel/Cloudflare/Netlify 중 택일(006에서 비교).
- [팀 식별](decisions/007-team-identity.md): 자체 계정(아이디·비밀번호). 가입 때 팀명을 적고, 제출만 로그인 필요. 하루 3회는 팀 단위, 남의 팀명으로 가입하는 것은 신뢰로 막음. 운영자용 삭제 수단은 필요.
- [기술 스택](decisions/006-tech-stack.md): Vercel Hobby + Python(FastAPI) 함수 + Neon Postgres Free + 정적 프론트. 저장소는 동아리 GitHub 조직 공개 저장소, `answer.csv`는 Neon 테이블에. 근거: [조사 문서](../../research/scoring-site-tech-stack.md).

## Not yet specified

- 미니게임 페이지의 구체적 내용(어떤 게임인지) — 2026-09-19 결정: 채점·리더보드와 연결되지 않는 **순수 프론트 장난감**. 백엔드·DB에 영향 없으므로 결정 파일 없이 스펙 단계에서 페이지 하나로 다룸.
- 리더보드 public/private 분할 — 2026-10-02 결정: test의 30%(중복 없이 무작위)로 중간 채점, 마감 뒤 전체 데이터로 최종 채점. 최종 순위는 팀별 public 최고 제출 기준, 마감 다음 날 0시(KST)에 자동 공개. 스펙 "채점 규칙"에 반영.
- RMSE·R² 외에 채점 결과를 얼마나 상세히 돌려줄지(오차 분포 / 구간별 오차).
- 관리자 기능의 범위: 잘못된 제출 삭제(007에서 필요해짐), 매 기수 데이터셋·정답 교체를 파일 교체·재배포로 할지 UI로 할지 — 006 이후.
- 플랫폼·저장소 계정을 개인 계정으로 둘지 동아리 공용 계정으로 둘지(졸업 후 인수인계) — 2026-10-22 결정: 동아리 공용 계정. Vercel 팀 pnu-iba와 Neon은 동아리 구글 계정으로 만들었고, GitHub 조직 pnu-iba에는 동아리 GitHub 계정 pnuiba를 Owner로 두어 Vercel과 연결했다.
- "하루"의 기준(KST 자정 vs 24시간 롤링), 리더보드 점수가 최고 기록인지 최신인지 — 스펙 단계.

## Out of scope

- 분류 과제(German Credit) 채점 — 2026-09-19 폐기 결정. `scoring_machine/classification/`은 참고용으로만 남음.
- 후배들이 모델을 학습시킬 환경(Colab 대체 등) 제공 — 채점과 무관.
- 프로젝트 커리큘럼·데이터셋 자체의 설계 변경 — 기존 자료를 그대로 채점 대상으로 삼음.
- 기존 3조 노트북의 모델 성능 개선 — 참고 자료일 뿐.
