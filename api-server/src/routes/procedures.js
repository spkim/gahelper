import { pool } from "../db.js";

export function registerProcedures(app) {
  app.get("/procedures/:procedureId", async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT procedure_id, goal_id, page_id, compatible_snapshots, steps,
              authored_by, verified, verified_by, verified_at, supersedes
       FROM procedures WHERE procedure_id = $1`,
      [req.params.procedureId],
    );
    if (!rows.length) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });

  // 특정 snapshot 에서 실행 가능한 verified 절차만 반환
  app.get("/snapshots/:snapshotId/procedures", async (req) => {
    const { rows } = await pool.query(
      `SELECT procedure_id, goal_id, page_id, compatible_snapshots, steps,
              authored_by, verified, verified_by, verified_at
       FROM procedures
       WHERE verified = TRUE
         AND compatible_snapshots @> to_jsonb(ARRAY[$1::text])
       ORDER BY procedure_id`,
      [req.params.snapshotId],
    );
    return { procedures: rows };
  });
}
