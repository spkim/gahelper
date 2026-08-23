import { pool } from "../db.js";

export function registerPages(app) {
  app.get("/sites/:siteId/pages", async (req) => {
    const { rows } = await pool.query(
      `SELECT page_id, site_id, route, label, canonical_probes, latest_snapshot_id
       FROM pages WHERE site_id = $1 ORDER BY page_id`,
      [req.params.siteId],
    );
    return { pages: rows };
  });

  app.get("/pages/:pageId", async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT page_id, site_id, route, label, canonical_probes, latest_snapshot_id
       FROM pages WHERE page_id = $1`,
      [req.params.pageId],
    );
    if (!rows.length) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });

  app.get("/pages/:pageId/snapshots", async (req) => {
    const { rows } = await pool.query(
      `SELECT snapshot_id, structural_hash, observed_at, last_seen_at,
              observed_count, superseded_by, status, source
       FROM page_snapshots WHERE page_id = $1
       ORDER BY observed_at DESC`,
      [req.params.pageId],
    );
    return { snapshots: rows };
  });

  app.get("/snapshots/:snapshotId", async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT snapshot_id, page_id, structural_hash, dom_signature,
              observed_at, last_seen_at, observed_count, contributor_count,
              superseded_by, status, diff_summary, source
       FROM page_snapshots WHERE snapshot_id = $1`,
      [req.params.snapshotId],
    );
    if (!rows.length) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });
}
