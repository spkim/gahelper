import { pool } from "../db.js";

const VALID_SERVICES = new Set(["gsc", "naver", "bing"]);
const VALID_LOCATOR_BY = new Set(["labelText", "buttonText", "linkText", "textPresent", "css"]);

// hits 임계값: 이 수 이상 보고된 로케이터만 canonical 로 반환.
// 초기 운영 시 1 로 시작, 충분한 데이터 쌓이면 상향 조정.
const MIN_HITS = 1;

export function registerLocators(app) {
  // ── 로케이터 보고 ──────────────────────────────────────────────
  // 블로거툴 content-indexing.js 가 요소 발견 시 호출.
  // structural_hash 가 다르면 다른 UI 버전으로 판단 → 별도 행 생성.
  app.post(
    "/locators/report",
    {
      schema: {
        body: {
          type: "object",
          required: ["structural_hash", "service", "element_key", "locator"],
          additionalProperties: false,
          properties: {
            structural_hash: { type: "string", minLength: 64, maxLength: 64 },
            service:         { type: "string", enum: ["gsc", "naver", "bing"] },
            element_key:     { type: "string", minLength: 1, maxLength: 50 },
            locator:         { type: "object" },
          },
        },
      },
    },
    async (req, reply) => {
      const { structural_hash, service, element_key, locator } = req.body;

      // locator.by 유효성 검사
      if (!VALID_LOCATOR_BY.has(locator?.by)) {
        return reply.status(400).send({ error: "invalid locator.by" });
      }

      await pool.query(
        `INSERT INTO element_locators
           (structural_hash, service, element_key, locator, hits, last_seen)
         VALUES ($1, $2, $3, $4::jsonb, 1, NOW())
         ON CONFLICT (structural_hash, element_key, locator)
         DO UPDATE SET
           hits      = element_locators.hits + 1,
           last_seen = NOW()`,
        [structural_hash, service, element_key, JSON.stringify(locator)]
      );

      return { ok: true };
    }
  );

  // ── canonical 로케이터 조회 ────────────────────────────────────
  // structural_hash 에 대해 element_key 별 최다 hits 로케이터를 반환.
  // 결과: { url_input: {by:'labelText', text:'URL 검사'}, prop: {...}, ... }
  app.get(
    "/locators/:hash",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            hash: { type: "string", minLength: 64, maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      const { hash } = req.params;

      // element_key 별로 hits 가장 높은 1개만 선출
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (element_key)
           element_key, locator
         FROM element_locators
         WHERE structural_hash = $1
           AND hits >= $2
         ORDER BY element_key, hits DESC`,
        [hash, MIN_HITS]
      );

      const result = {};
      for (const row of rows) {
        result[row.element_key] = row.locator;
      }
      return result;
    }
  );

  // ── 통계 (개발·디버그용) ──────────────────────────────────────
  app.get("/locators/stats", async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT service,
              element_key,
              COUNT(DISTINCT structural_hash) AS hash_count,
              SUM(hits)                       AS total_hits
       FROM element_locators
       GROUP BY service, element_key
       ORDER BY service, element_key`
    );
    return rows;
  });
}
