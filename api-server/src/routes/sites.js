import { pool } from "../db.js";

export function registerSites(app) {
  app.get("/sites", async () => {
    const { rows } = await pool.query(
      `SELECT site_id, label, matches, entry_url, entry_ready, active
       FROM sites WHERE active = TRUE ORDER BY site_id`
    );
    return { sites: rows };
  });

  app.get("/sites/:siteId", async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT site_id, label, matches, entry_url, entry_ready, active
       FROM sites WHERE site_id = $1`,
      [req.params.siteId],
    );
    if (!rows.length) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });
}
