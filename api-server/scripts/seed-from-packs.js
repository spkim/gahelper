import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = path.resolve(__dirname, "../../packs");

function sha256(obj) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(obj))
    .digest("hex");
}

function pageIdFor(siteId, procedureKey) {
  return `${siteId}:${procedureKey}`;
}

function procedureIdFor(siteId, procedureKey) {
  return `${siteId}.${procedureKey}`;
}

function routeFor(procedure) {
  const urlVerify = procedure.steps.find(
    (s) => s.verify?.is === "urlIncludes" && typeof s.verify.text === "string"
  );
  return urlVerify?.verify?.text ?? `/${procedure.label ?? "unknown"}`;
}

function canonicalProbesFor(procedure) {
  return procedure.probes ?? {};
}

async function seedPack(client, pack) {
  console.log(`\nseeding ${pack.id} …`);

  await client.query(
    `INSERT INTO sites (site_id, label, matches, entry_url, entry_ready, active)
     VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, TRUE)
     ON CONFLICT (site_id) DO UPDATE SET
       label = EXCLUDED.label,
       matches = EXCLUDED.matches,
       entry_url = EXCLUDED.entry_url,
       entry_ready = EXCLUDED.entry_ready,
       updated_at = NOW()`,
    [
      pack.id,
      pack.label,
      JSON.stringify(pack.matches),
      pack.entry.url,
      JSON.stringify(pack.entry.ready ?? null),
    ],
  );

  // 각 procedure 를 page 하나로 매핑 (seed 단계에서는 1:1)
  const procedureToSnapshot = new Map();
  for (const [procKey, proc] of Object.entries(pack.procedures)) {
    const pageId = pageIdFor(pack.id, procKey);
    const route = routeFor(proc);
    const canonicalProbes = canonicalProbesFor(proc);

    await client.query(
      `INSERT INTO pages (page_id, site_id, route, label, canonical_probes)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (page_id) DO UPDATE SET
         route = EXCLUDED.route,
         label = EXCLUDED.label,
         canonical_probes = EXCLUDED.canonical_probes`,
      [pageId, pack.id, route, proc.label ?? procKey, JSON.stringify(canonicalProbes)],
    );

    // seed snapshot: 실제 브라우저 관측이 아니므로 결정론적 해시 사용
    const seedHash = sha256({ pack: pack.id, procKey, probes: canonicalProbes });
    const { rows: existing } = await client.query(
      `SELECT snapshot_id FROM page_snapshots
       WHERE page_id = $1 AND structural_hash = $2 AND source = 'seed'`,
      [pageId, seedHash],
    );

    let snapshotId;
    if (existing.length) {
      snapshotId = existing[0].snapshot_id;
    } else {
      const { rows } = await client.query(
        `INSERT INTO page_snapshots (page_id, structural_hash, dom_signature, source, status)
         VALUES ($1, $2, $3::jsonb, 'seed', 'active')
         RETURNING snapshot_id`,
        [pageId, seedHash, JSON.stringify([])],
      );
      snapshotId = rows[0].snapshot_id;
    }
    procedureToSnapshot.set(procKey, { pageId, snapshotId });

    await client.query(
      `UPDATE pages SET latest_snapshot_id = $1 WHERE page_id = $2`,
      [snapshotId, pageId],
    );
  }

  // goals + procedures
  for (const goal of pack.goals) {
    const goalId = `${pack.id}.${goal.id}`;
    const procedureIds = goal.procedures.map((k) => procedureIdFor(pack.id, k));

    await client.query(
      `INSERT INTO goals (goal_id, site_id, label, synonyms, procedure_ids, active)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, TRUE)
       ON CONFLICT (goal_id) DO UPDATE SET
         label = EXCLUDED.label,
         procedure_ids = EXCLUDED.procedure_ids`,
      [goalId, pack.id, goal.label, JSON.stringify([]), JSON.stringify(procedureIds)],
    );

    for (const procKey of goal.procedures) {
      const proc = pack.procedures[procKey];
      if (!proc) {
        console.warn(`  ! missing procedure ${procKey} for goal ${goal.id}`);
        continue;
      }
      const mapping = procedureToSnapshot.get(procKey);
      const procedureId = procedureIdFor(pack.id, procKey);
      // 각 step 에 procedure.probes 를 인라인해서 엔진 호환성 유지
      const steps = proc.steps.map((s) => ({
        ...s,
        probes: proc.probes ?? {},
      }));

      // draft 팩은 verified=false. 실제 관측·검증 뒤 관리 API 로 승격.
      await client.query(
        `INSERT INTO procedures
           (procedure_id, goal_id, page_id, compatible_snapshots, steps,
            authored_by, verified)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'human', $6)
         ON CONFLICT (procedure_id) DO UPDATE SET
           goal_id = EXCLUDED.goal_id,
           page_id = EXCLUDED.page_id,
           compatible_snapshots = EXCLUDED.compatible_snapshots,
           steps = EXCLUDED.steps,
           verified = EXCLUDED.verified`,
        [
          procedureId,
          goalId,
          mapping.pageId,
          JSON.stringify([mapping.snapshotId]),
          JSON.stringify(steps),
          !pack.draft,
        ],
      );
    }
  }

  console.log(`  ok — ${Object.keys(pack.procedures).length} pages, ${pack.goals.length} goals`);
}

async function main() {
  const files = (await fs.readdir(PACKS_DIR))
    .filter((f) => f.endsWith(".json"))
    .sort();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const f of files) {
      const pack = JSON.parse(await fs.readFile(path.join(PACKS_DIR, f), "utf8"));
      await seedPack(client, pack);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
  console.log("\nseed complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
