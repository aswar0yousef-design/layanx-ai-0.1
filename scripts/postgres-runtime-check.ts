/**
 * CI check: the real runtime (createRuntime + restoreRuntime) uses PostgreSQL when LAYANX_DATABASE_URL is set,
 * and its storage health comes from the database, not from a file fallback.
 *   LAYANX_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/db npx tsx scripts/postgres-runtime-check.ts
 */
import {Pool} from "pg";
import {createRuntime,restoreRuntime,runtimeHealth} from "../src/runtime.js";

const url=process.env.LAYANX_DATABASE_URL?.trim();
if(!url){console.error("LAYANX_DATABASE_URL is required.");process.exit(1);}
const runtime=createRuntime();
if(!runtime.persistence){console.error("Runtime did not enable persistence with LAYANX_DATABASE_URL.");process.exit(1);}
await restoreRuntime(runtime);
const health=await runtimeHealth(runtime);
console.log(JSON.stringify({storage:health.storage},null,1));
if(!health.storage.healthy){console.error("Runtime storage is not healthy.");process.exit(1);}
const pool=new Pool({connectionString:url});
try{
 // The health probe the runtime just wrote must be in PostgreSQL (proves no file fallback), and fresh.
 const probe=await pool.query<{fresh:boolean}>("SELECT updated_at > NOW() - INTERVAL '2 minutes' AS fresh FROM layanx_runtime_kv WHERE key=$1",["runtime:health:probe"]);
 if(probe.rowCount!==1||!probe.rows[0]!.fresh){console.error("Runtime health probe was not written to PostgreSQL.");process.exit(1);}
}finally{await pool.end();}
console.log("Runtime on PostgreSQL: ok");
process.exit(0);
