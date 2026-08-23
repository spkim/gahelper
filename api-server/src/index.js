import "dotenv/config";
import Fastify from "fastify";
import { pool } from "./db.js";
import { registerSites } from "./routes/sites.js";
import { registerPages } from "./routes/pages.js";
import { registerGoals } from "./routes/goals.js";
import { registerProcedures } from "./routes/procedures.js";
import { registerCatalog } from "./routes/catalog.js";

const app = Fastify({ logger: true });

app.get("/health", async () => {
  const { rows } = await pool.query("SELECT 1 AS ok");
  return { ok: rows[0].ok === 1 };
});

registerCatalog(app);
registerSites(app);
registerPages(app);
registerGoals(app);
registerProcedures(app);

const port = Number(process.env.BACKEND_PORT ?? 8000);
app.listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`setup-copilot api on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
