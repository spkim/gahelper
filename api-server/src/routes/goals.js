import { pool } from "../db.js";

export function registerGoals(app) {
  app.get("/goals", async () => {
    const { rows } = await pool.query(
      `SELECT goal_id, site_id, label, synonyms, procedure_ids, active
       FROM goals WHERE active = TRUE ORDER BY site_id, goal_id`
    );
    return { goals: rows };
  });

  app.get("/sites/:siteId/goals", async (req) => {
    const { rows } = await pool.query(
      `SELECT goal_id, site_id, label, synonyms, procedure_ids, active
       FROM goals WHERE site_id = $1 AND active = TRUE ORDER BY goal_id`,
      [req.params.siteId],
    );
    return { goals: rows };
  });
}
