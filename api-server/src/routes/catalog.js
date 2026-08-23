import { pool } from "../db.js";

// 확장이 라우터 프롬프트에 사용하는 전역 goal 카탈로그.
// 형식: [{siteId, siteLabel, goalId, label, synonyms}]
export function registerCatalog(app) {
  app.get("/catalog/goals", async () => {
    const { rows } = await pool.query(
      `SELECT g.goal_id, g.site_id, g.label, g.synonyms,
              s.label AS site_label
       FROM goals g
       JOIN sites s ON s.site_id = g.site_id
       WHERE g.active = TRUE AND s.active = TRUE
       ORDER BY g.site_id, g.goal_id`
    );
    return {
      goals: rows.map((r) => ({
        siteId: r.site_id,
        siteLabel: r.site_label,
        goalId: r.goal_id,
        label: r.label,
        synonyms: r.synonyms,
      })),
    };
  });
}
