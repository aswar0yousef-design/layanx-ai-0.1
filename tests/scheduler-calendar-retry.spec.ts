import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {MissionScheduler} from "../src/core/scheduler.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";

type Outcome={completed:boolean;reason?:string};
const audit:string[]=[];
let outcomes:Outcome[]=[];let calls=0;let hold:Promise<void>|undefined;
const core={projectIsolation:{normalize:(id:string)=>id},audit:{append:(e:{action:string})=>{audit.push(e.action);}},
 runAgentGateway:async()=>{calls++;if(hold)await hold;const o=outcomes.shift()??{completed:true};return{missionId:"m-"+calls,...o};}} as never;

// ---- Timezone-aware calendar triggers (Asia/Muscat = UTC+4, no DST) ----
const s=new MissionScheduler(core,1000);
const daily=s.register({goal:"daily muscat",projectId:"p",trigger:{kind:"daily",hour:8,minute:30,timezone:"Asia/Muscat"}});
const next=new Date(daily.nextRunAt!);
assert.equal(next.getUTCHours(),4);assert.equal(next.getUTCMinutes(),30);
assert.ok(next.getTime()>Date.now()&&next.getTime()-Date.now()<=24*3600*1000);

const weekly=s.register({goal:"weekly",projectId:"p",trigger:{kind:"weekly",daysOfWeek:[0],hour:9,minute:0,timezone:"Asia/Muscat"}});
const wnext=new Date(weekly.nextRunAt!);
assert.equal(new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Muscat",weekday:"short"}).format(wnext),"Sun");
assert.equal(wnext.getUTCHours(),5);
assert.ok(wnext.getTime()-Date.now()<=7*24*3600*1000);

// Monthly on the 31st clamps to the last day of shorter months.
const monthly=s.register({goal:"monthly",projectId:"p",trigger:{kind:"monthly",dayOfMonth:31,hour:0,minute:0,timezone:"UTC"}});
const mnext=new Date(monthly.nextRunAt!);
const lastDay=new Date(Date.UTC(mnext.getUTCFullYear(),mnext.getUTCMonth()+1,0)).getUTCDate();
assert.equal(mnext.getUTCDate(),lastDay);

// DST zone: 09:00 New York stays 09:00 local on both sides of a transition.
const ny=s.register({goal:"ny",projectId:"p",trigger:{kind:"daily",hour:9,minute:0,timezone:"America/New_York"}});
assert.equal(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"numeric",hourCycle:"h23"}).format(new Date(ny.nextRunAt!)),"09:00");

assert.throws(()=>s.register({goal:"bad tz",projectId:"p",trigger:{kind:"daily",hour:1,minute:0,timezone:"Mars/Olympus"}}),/Unknown schedule timezone/);
assert.throws(()=>s.register({goal:"bad week",projectId:"p",trigger:{kind:"weekly",daysOfWeek:[7],hour:1,minute:0}}),/daysOfWeek/);
assert.throws(()=>s.register({goal:"bad month",projectId:"p",trigger:{kind:"monthly",dayOfMonth:0,hour:1,minute:0}}),/dayOfMonth/);
assert.throws(()=>s.register({goal:"bad retry",projectId:"p",trigger:{kind:"interval",intervalMs:1000},retry:{maxAttempts:9,backoffMs:1000}}),/maxAttempts/);
assert.throws(()=>s.register({goal:"bad backoff",projectId:"p",trigger:{kind:"interval",intervalMs:1000},retry:{maxAttempts:2,backoffMs:5}}),/backoffMs/);

// ---- Bounded retry with backoff; regular cadence is not advanced by retries ----
const dir=mkdtempSync(join(tmpdir(),"layanx-sched-retry-"));
try{
 const storage=RuntimeStorage.json(join(dir,"runtime.json"));
 const r=new MissionScheduler(core,storage);
 const job=r.register({goal:"flaky",projectId:"proj-a",trigger:{kind:"interval",intervalMs:3600000,runImmediately:true},retry:{maxAttempts:3,backoffMs:1000}});
 outcomes=[{completed:false,reason:"provider down"},{completed:false,reason:"still down"},{completed:false,reason:"down again"}];
 calls=0;
 const t0=Date.now();
 const first=await r.tick(new Date(t0));
 assert.equal(first.length,1);assert.equal(first[0]!.status,"failed");assert.equal(first[0]!.attempt,1);
 const afterFirst=r.get(job.id)!;
 assert.ok(afterFirst.retryAt,"retry was not scheduled");
 const regular=afterFirst.nextRunAt;
 assert.equal((await r.tick(new Date(t0+10))).length,0,"retry ran before its backoff");
 const second=await r.tick(new Date(Date.now()+1500));
 assert.equal(second[0]!.attempt,2);
 assert.equal(r.get(job.id)!.nextRunAt,regular,"a retry advanced the regular cadence");
 const third=await r.tick(new Date(Date.now()+5000));
 assert.equal(third[0]!.attempt,3);assert.equal(third[0]!.status,"failed");
 assert.equal(r.get(job.id)!.retryAt,undefined,"retries exceeded maxAttempts");
 assert.equal(calls,3);

 // History is persisted, newest first, filterable by project.
 const history=r.runHistory({scheduleId:job.id});
 assert.deepEqual(history.map(run=>run.attempt),[3,2,1]);
 assert.equal(r.runHistory({projectId:"other"}).length,0);
 await new Promise(resolve=>setTimeout(resolve,50));
 const reloaded=new MissionScheduler(core,storage);await reloaded.hydrate();
 assert.equal(reloaded.runHistory({scheduleId:job.id}).length,3);
 assert.equal(reloaded.get(job.id)!.lastStatus,"failed");

 // A run in progress when the process stops is marked interrupted on restart and not re-run.
 const crashy=r.register({goal:"long",projectId:"proj-a",trigger:{kind:"once",runAt:new Date(Date.now()+5).toISOString()}});
 let release!:()=>void;hold=new Promise<void>(resolve=>{release=resolve;});
 const pending=r.tick(new Date(Date.now()+100));
 await new Promise(resolve=>setTimeout(resolve,50));
 const afterCrash=new MissionScheduler(core,RuntimeStorage.json(join(dir,"runtime.json")));await afterCrash.hydrate();
 const interrupted=afterCrash.runHistory({scheduleId:crashy.id});
 assert.equal(interrupted[0]?.status,"interrupted");
 const before=calls;
 assert.equal((await afterCrash.tick(new Date(Date.now()+1000))).length,0,"interrupted once-run was executed again");
 assert.equal(calls,before);
 assert.ok(audit.includes("schedule.run.interrupted"));
 hold=undefined;release();await pending;
 // Let fire-and-forget persistence settle before deleting the store.
 await new Promise(resolve=>setTimeout(resolve,200));
}finally{rmSync(dir,{recursive:true,force:true});}
console.log("scheduler calendar/timezone/retry/history: ok");
