import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {LayanXCore} from "../src/core/orchestrator.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
import {PostgresStorageAdapter} from "../src/storage/postgres-adapter.js";

// Runs against a REAL PostgreSQL server. CI starts one (job "postgres") and sets LAYANX_REQUIRE_POSTGRES=1,
// so a missing database there is a failure, not a silent pass.
const url=process.env.LAYANX_TEST_DATABASE_URL?.trim();
if(!url){
 if(process.env.LAYANX_REQUIRE_POSTGRES==="1")throw new Error("LAYANX_TEST_DATABASE_URL is required in this job.");
 console.log("postgres storage: SKIPPED (set LAYANX_TEST_DATABASE_URL to run against a real PostgreSQL)");
 process.exit(0);
}
const prefix="test:"+randomUUID()+":";
const adapter=new PostgresStorageAdapter(url);
try{
 // 1. commit + JSON round trip (Arabic, nested, numbers)
 const value={name:"شحنة مسقط",items:[{sku:"A-1",qty:2,price:1.25}],ok:true,nested:{n:null}};
 await adapter.transaction(async tx=>{await tx.set(prefix+"a",value);});
 const other=new PostgresStorageAdapter(url);
 try{assert.deepEqual(await other.transaction(tx=>tx.get(prefix+"a")),value,"committed value visible from a new pool");}finally{await other.close();}
 // 2. throw inside the transaction => rollback, nothing written
 await assert.rejects(()=>adapter.transaction(async tx=>{await tx.set(prefix+"b",{x:1});throw new Error("boom");}),/boom/);
 assert.equal(await adapter.transaction(tx=>tx.get(prefix+"b")),undefined,"rolled back on error");
 // 3. explicit rollback; writes after close are refused
 await adapter.transaction(async tx=>{await tx.set(prefix+"c",{x:1});await tx.rollback();await assert.rejects(()=>tx.set(prefix+"c",{x:2}),/closed/);});
 assert.equal(await adapter.transaction(tx=>tx.get(prefix+"c")),undefined,"explicit rollback");
 // 4. read-your-own-writes inside one transaction, update overwrites
 await adapter.transaction(async tx=>{await tx.set(prefix+"d",{v:1});assert.deepEqual(await tx.get(prefix+"d"),{v:1});await tx.set(prefix+"d",{v:2});});
 assert.deepEqual(await adapter.transaction(tx=>tx.get(prefix+"d")),{v:2});
 // 5. 20 concurrent writers to different keys all land
 await Promise.all(Array.from({length:20},(_,i)=>adapter.transaction(async tx=>{await tx.set(prefix+"k"+i,{i});})));
 for(let i=0;i<20;i++)assert.deepEqual(await adapter.transaction(tx=>tx.get(prefix+"k"+i)),{i});
 // 6. health
 assert.equal((await adapter.health()).healthy,true);
 const badUrl=new URL(url);badUrl.password="definitely-wrong-"+randomUUID().slice(0,8);
 const bad=new PostgresStorageAdapter({connectionString:badUrl.toString(),connectionTimeoutMillis:3000});
 try{const h=await bad.health();assert.equal(h.healthy,false);assert.ok(!h.reason.includes("definitely-wrong"),"health reason must not echo the password");}finally{await bad.close();}

 // 7. restart recovery on Postgres: approval survives a restart and the mission resumes (same flow as approval-restart-recovery.spec)
 const persistence=new RuntimePersistence(new RuntimeStorage(adapter,{snapshot:prefix+"runtime:snapshots"}));
 const setup=(core:LayanXCore)=>{
  core.registerAgent({agentId:"core",purpose:"pg restart",allowedTools:["dangerous.read"],forbiddenResources:[],requiredPermission:"L4_EXECUTE",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["approved"],stopCondition:"stop"});
  core.tools.register({name:"dangerous.read",description:"pg restart test",permission:"L4_EXECUTE",dangerous:true,actions:["run sensitive test"],tags:["test"]});
  core.toolAdapters.register("dangerous.read",{async execute(){return{approved:true};}});
 };
 const first=new LayanXCore(undefined,persistence);setup(first);
 const mission=first.startMission("pg restart","pg-restart-project");
 mission.requiredPermission="L4_EXECUTE";
 mission.tools=[{tool:"dangerous.read",action:"run sensitive test",permission:"L4_EXECUTE",reason:"restart test"}];
 first.missions.save(mission);
 const blocked=await first.executeMissionTool(mission.id,mission.projectId,0,{});
 assert.ok(!blocked.ok&&blocked.approvalId,"approval requested");
 const restarted=new LayanXCore(undefined,persistence);setup(restarted);
 const restored=await persistence.get(mission.id);assert.ok(restored,"snapshot read back from PostgreSQL");
 restarted.restoreRuntimeSnapshot(restored!);
 const approval=restarted.executionRuntime.approvals.get(blocked.approvalId!);
 restarted.executionRuntime.approvals.approve(approval.id);
 const resumed=await restarted.executeMissionTool(mission.id,mission.projectId,0,{},approval.id);
 assert.ok(resumed.ok&&resumed.verified,resumed.error);
 assert.equal(restarted.missions.get(mission.id)?.status,"completed");
}finally{
 // remove this run's rows, keep everything else
 const {Pool}=await import("pg");const pool=new Pool({connectionString:url});
 try{await pool.query("DELETE FROM layanx_runtime_kv WHERE key LIKE $1",[prefix+"%"]);}finally{await pool.end();}
 await adapter.close();
}
console.log("postgres storage (real server): ok");
