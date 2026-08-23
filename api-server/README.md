# setup-copilot api-server

설정 지식 DB 의 read/write REST 게이트웨이. 확장이 사용하는 카탈로그, 페이지 스냅샷, 절차, 기여, 초안을 다룬다.

## 로컬 개발

```bash
# 프로젝트 루트에서
cp .env.example .env
docker compose up -d postgres

cd api-server
cp .env.example .env       # POSTGRES_HOST=localhost 로 두거나 루트 .env 값을 재사용
npm install
npm run migrate
npm run seed
npm run dev
```

health check:
```bash
curl http://localhost:8000/health
curl http://localhost:8000/catalog/goals
```

## 엔드포인트 (read-only)

| Method | Path | 설명 |
|---|---|---|
| GET | `/health` | 헬스체크 |
| GET | `/catalog/goals` | 전역 goal 카탈로그 (라우터 프롬프트 용) |
| GET | `/sites` | 활성 사이트 목록 |
| GET | `/sites/:siteId` | 사이트 상세 |
| GET | `/sites/:siteId/pages` | 사이트 내 페이지 |
| GET | `/sites/:siteId/goals` | 사이트 goal |
| GET | `/pages/:pageId` | 페이지 상세 |
| GET | `/pages/:pageId/snapshots` | 페이지 스냅샷 히스토리 |
| GET | `/snapshots/:snapshotId` | 스냅샷 상세 (dom_signature 포함) |
| GET | `/snapshots/:snapshotId/procedures` | 이 스냅샷에서 실행 가능한 verified 절차 |
| GET | `/goals` | 전체 goal |
| GET | `/procedures/:procedureId` | 절차 상세 |

## DB 원칙

- **append-only** — `page_snapshots`, `procedures` 는 물리 삭제 금지. `superseded_by` / `status` 로만 표시.
- **verify 강제** — `procedures.steps` 는 각 step 에 `verify` 필수. CHECK 제약으로 강제.
- **초안 grounding** — `guidance_proposals.observed_only = true` 만 저장 허용.

## 미구현 (Phase B 나머지)

- POST `/contributions` (옵트인 기여 업로드)
- POST `/guidance/propose` (관리자, LLM 초안 생성)
- POST `/guidance/verify` (관리자, 초안 승인 → procedure 승격)
- 인증 (admin token, contributor identity)
