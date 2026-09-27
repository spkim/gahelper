import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { pool } from "./db.js";
import { registerSites } from "./routes/sites.js";
import { registerPages } from "./routes/pages.js";
import { registerGoals } from "./routes/goals.js";
import { registerProcedures } from "./routes/procedures.js";
import { registerCatalog } from "./routes/catalog.js";
import { registerLocators } from "./routes/locators.js";

const app = Fastify({ logger: true });

// 확장(chrome-extension://) 및 localhost 개발 도구에서의 fetch 허용.
// 프로덕션 도메인이 정해지면 origin 을 화이트리스트로 좁힐 것.
await app.register(cors, { origin: true, methods: ["GET", "POST"] });

app.get("/health", async () => {
  const { rows } = await pool.query("SELECT 1 AS ok");
  return { ok: rows[0].ok === 1 };
});

registerCatalog(app);
registerSites(app);
registerPages(app);
registerGoals(app);
registerProcedures(app);
registerLocators(app);

const port = Number(process.env.BACKEND_PORT ?? 8000);
app.listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`setup-copilot api on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
