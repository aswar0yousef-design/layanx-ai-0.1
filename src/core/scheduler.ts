import type {LayanXCore} from "./orchestrator.js";
import type {RuntimeStorage} from "../storage/runtime-storage.js";

/**
 * Mission scheduler.
 *
 * Triggers: once | interval | daily | weekly | monthly. Calendar triggers (daily/weekly/monthly) use the
 * IANA `timezone` when given (e.g. "Asia/Muscat"), otherwise the host's local time (previous behaviour).
 *
 * Durability (when RuntimeStorage is supplied): schedules and a bounded run history are persisted. A run
 * that was still "running" when the process stopped is recorded as "interrupted" on the next hydrate and is
 * NOT re-executed automatically, because the mission may already have had side effects.
 *
 * Missed occurrences while the app was closed run at most once on the next tick (no catch-up storm).
 * Schedules do not run while LayanX is closed; use Windows Task Scheduler to start LayanX for that.
 *
 * Retry is opt-in (`retry.maxAttempts`, default 1 = no retry) because a retried mission is a NEW mission:
 * only enable it for goals that are safe to repeat.
 */
export type ScheduleTrigger={
 kind:"interval"|"once"|"daily"|"weekly"|"monthly";
 intervalMs?:number;
 runAt?:string;
 hour?:number;
 minute?:number;
 /** weekly: 0=Sunday ... 6=Saturday */
 daysOfWeek?:number[];
 /** monthly: 1-31; clamped to the last day of shorter months */
 dayOfMonth?:number;
 /** IANA time zone for daily/weekly/monthly, e.g. "Asia/Muscat". */
 timezone?:string;
 runImmediately?:boolean;
};
export interface ScheduleRetryPolicy{maxAttempts:number;backoffMs:number}
export interface ScheduledMission{
 id:string;
 goal:string;
 projectId:string;
 trigger:ScheduleTrigger;
 maxSteps?:number;
 agentId?:string;
 enabled:boolean;
 createdAt:string;
 lastRunAt?:string;
 nextRunAt?:string;
 runCount:number;
 retry?:ScheduleRetryPolicy;
 /** Consecutive failed attempts of the current occurrence (retry bookkeeping). */
 failedAttempts?:number;
 retryAt?:string;
 lastStatus?:SchedulerRun["status"];
};
export interface SchedulerRun{
 runId?:string;
 scheduleId:string;
 projectId?:string;
 missionId?:string;
 attempt?:number;
 startedAt:string;
 completedAt?:string;
 status:"running"|"completed"|"failed"|"skipped"|"interrupted";
 error?:string;
}

const MAX_HISTORY=500;
const MAX_RETRY_ATTEMPTS=5;
const MAX_RETRY_BACKOFF_MS=24*60*60*1000;
const SCHEDULES_KEY="scheduler:schedules";
const RUNS_KEY="scheduler:runs";

function assertTimezone(timezone:string|undefined){
 if(timezone===undefined)return;
 if(typeof timezone!=="string"||!timezone.trim())throw new Error("Schedule timezone must be a non-empty IANA name.");
 try{new Intl.DateTimeFormat("en-US",{timeZone:timezone});}catch{throw new Error("Unknown schedule timezone: "+timezone);}
}

/** Wall-clock parts of `instant` in `timezone`. */
function zonedParts(instant:Date,timezone:string){
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:timezone,hourCycle:"h23",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",second:"numeric"}).formatToParts(instant);
 const get=(type:string)=>Number(parts.find(part=>part.type===type)?.value);
 return{year:get("year"),month:get("month"),day:get("day"),hour:get("hour")%24,minute:get("minute"),second:get("second")};
}
/** UTC instant for a wall-clock time in `timezone` (DST-aware; a skipped local time moves forward). */
function zonedToInstant(year:number,month:number,day:number,hour:number,minute:number,timezone:string):Date{
 const target=Date.UTC(year,month-1,day,hour,minute,0,0);
 let guess=target;
 for(let i=0;i<3;i++){
  const p=zonedParts(new Date(guess),timezone);
  const shown=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second,0);
  const delta=target-shown;
  if(delta===0)break;
  guess+=delta;
 }
 return new Date(guess);
}
function daysInMonth(year:number,month:number){return new Date(Date.UTC(year,month,0)).getUTCDate();}

export class MissionScheduler{
 private readonly schedules=new Map<string,ScheduledMission>();
 private readonly runs=new Map<string,SchedulerRun>();
 private history:SchedulerRun[]=[];
 private timer?:ReturnType<typeof setInterval>;
 private readonly active=new Set<string>();
 constructor(private readonly core:LayanXCore,storageOrTickMs?:RuntimeStorage|number,tickMs=1000){this.storage=typeof storageOrTickMs==="number"?undefined:storageOrTickMs;this.tickMs=typeof storageOrTickMs==="number"?storageOrTickMs:tickMs;}
 private readonly storage?:RuntimeStorage;
 private readonly tickMs:number;

 register(input:Omit<ScheduledMission,"id"|"createdAt"|"runCount"|"enabled"|"failedAttempts"|"retryAt"|"lastStatus"> & {enabled?:boolean}):ScheduledMission{
  if(!input.goal.trim())throw new Error("Scheduled mission goal is empty.");
  const projectId=this.core.projectIsolation.normalize(input.projectId);
  this.validateTrigger(input.trigger);
  const retry=this.validateRetry(input.retry);
  const now=new Date().toISOString();
  const next=this.nextTime(input.trigger,new Date(),true);
  const schedule:ScheduledMission={...input,id:crypto.randomUUID(),projectId,createdAt:now,runCount:0,enabled:input.enabled??true,nextRunAt:next?.toISOString()};
  if(retry)schedule.retry=retry;else delete schedule.retry;
  this.schedules.set(schedule.id,schedule);this.persist();
  this.core.audit.append({timestamp:now,actor:"scheduler",action:"schedule.create",resource:schedule.id,result:"success",metadata:{projectId,goal:schedule.goal,trigger:schedule.trigger}});
  return structuredClone(schedule);
 }
 unregister(id:string){const schedule=this.schedules.get(id);if(!schedule)throw new Error("Unknown schedule.");this.schedules.delete(id);this.persist();this.core.audit.append({timestamp:new Date().toISOString(),actor:"scheduler",action:"schedule.delete",resource:id,result:"success"});}
 setEnabled(id:string,enabled:boolean){const schedule=this.require(id);schedule.enabled=enabled;schedule.nextRunAt=enabled?this.nextTime(schedule.trigger,new Date(),true)?.toISOString():undefined;if(!enabled){delete schedule.retryAt;schedule.failedAttempts=0;}this.persist();this.core.audit.append({timestamp:new Date().toISOString(),actor:"scheduler",action:"schedule.toggle",resource:id,result:"success",metadata:{enabled}});return structuredClone(schedule);}
 list(){return [...this.schedules.values()].map(item=>structuredClone(item));}
 get(id:string){const schedule=this.schedules.get(id);return schedule?structuredClone(schedule):undefined;}
 /** Most recent runs first. Filter by schedule and/or project; bounded by `limit` (max 500). */
 runHistory(filter:{scheduleId?:string;projectId?:string;limit?:number}={}):SchedulerRun[]{
  const limit=Math.min(Math.max(Math.floor(filter.limit??50),1),MAX_HISTORY);
  return this.history.filter(run=>(!filter.scheduleId||run.scheduleId===filter.scheduleId)&&(!filter.projectId||run.projectId===filter.projectId)).slice(-limit).reverse().map(run=>structuredClone(run));
 }
 async hydrate(){
  if(!this.storage)return;
  const saved=await this.storage.get<ScheduledMission[]>(SCHEDULES_KEY);
  if(saved){this.schedules.clear();for(const item of saved)this.schedules.set(item.id,item);}
  const runs=await this.storage.get<SchedulerRun[]>(RUNS_KEY);
  this.history=Array.isArray(runs)?runs.slice(-MAX_HISTORY):[];
  let changed=false;
  const at=new Date().toISOString();
  for(const run of this.history){
   if(run.status!=="running")continue;
   run.status="interrupted";run.completedAt=at;run.error="LayanX stopped before this run finished; it was not re-executed automatically.";changed=true;
   const schedule=this.schedules.get(run.scheduleId);if(schedule)schedule.lastStatus="interrupted";
   this.core.audit.append({timestamp:at,actor:"scheduler",action:"schedule.run.interrupted",resource:run.scheduleId,result:"failure",metadata:{runId:run.runId,missionId:run.missionId}});
  }
  if(changed){this.persist();this.persistHistory();}
 }
 private persist(){if(this.storage)void this.storage.set([...this.schedules.values()].map(item=>structuredClone(item)),SCHEDULES_KEY);}
 private persistHistory(){if(this.storage)void this.storage.set(this.history.map(run=>structuredClone(run)),RUNS_KEY);}
 private record(run:SchedulerRun){
  const index=run.runId?this.history.findIndex(item=>item.runId===run.runId):-1;
  if(index>=0)this.history[index]=structuredClone(run);else this.history.push(structuredClone(run));
  if(this.history.length>MAX_HISTORY)this.history.splice(0,this.history.length-MAX_HISTORY);
  this.persistHistory();
 }
 start(){if(this.timer)return;this.timer=setInterval(()=>void this.tick(),this.tickMs);this.timer.unref?.();void this.tick();}
 stop(){if(this.timer){clearInterval(this.timer);this.timer=undefined;}}
 async tick(now=new Date()):Promise<SchedulerRun[]>{
  const at=now.getTime();
  const due=[...this.schedules.values()].filter(s=>s.enabled&&!this.active.has(s.id)&&(
   (s.retryAt!==undefined&&new Date(s.retryAt).getTime()<=at)||
   (s.nextRunAt!==undefined&&new Date(s.nextRunAt).getTime()<=at)));
  return Promise.all(due.map(schedule=>this.run(schedule,now)));
 }
 private async run(schedule:ScheduledMission,now:Date):Promise<SchedulerRun>{
  const isRetry=schedule.retryAt!==undefined&&new Date(schedule.retryAt).getTime()<=now.getTime()&&!(schedule.nextRunAt&&new Date(schedule.nextRunAt).getTime()<=now.getTime());
  const attempt=isRetry?(schedule.failedAttempts??0)+1:1;
  const run:SchedulerRun={runId:crypto.randomUUID(),scheduleId:schedule.id,projectId:schedule.projectId,attempt,startedAt:now.toISOString(),status:"running"};
  if(this.active.has(schedule.id)){run.status="skipped";run.completedAt=new Date().toISOString();return run;}
  this.active.add(schedule.id);this.runs.set(schedule.id,run);
  schedule.lastRunAt=now.toISOString();schedule.runCount+=1;delete schedule.retryAt;
  if(!isRetry){schedule.failedAttempts=0;schedule.nextRunAt=this.nextTime(schedule.trigger,new Date(now.getTime()+1))?.toISOString();}
  this.persist();this.record(run);
  try{
   const result=await this.core.runAgentGateway(schedule.goal,schedule.projectId,schedule.maxSteps??10,{},schedule.agentId??"core");
   run.missionId=result.missionId;run.status=result.completed?"completed":"failed";
   if(!result.completed)run.error=typeof result.reason==="string"?result.reason:"Scheduled mission did not complete.";
   this.core.audit.append({timestamp:new Date().toISOString(),actor:"scheduler",action:"schedule.run",resource:schedule.id,result:result.completed?"success":"failure",metadata:{scheduleId:schedule.id,missionId:result.missionId,projectId:schedule.projectId,runCount:schedule.runCount,attempt}});
  }catch(error){run.status="failed";run.error=error instanceof Error?error.message:"Scheduled mission failed.";this.core.audit.append({timestamp:new Date().toISOString(),actor:"scheduler",action:"schedule.run",resource:schedule.id,result:"failure",metadata:{scheduleId:schedule.id,projectId:schedule.projectId,error:run.error,attempt}});}
  finally{
   run.completedAt=new Date().toISOString();this.active.delete(schedule.id);this.runs.set(schedule.id,structuredClone(run));
   schedule.lastStatus=run.status;
   if(run.status==="failed"&&schedule.retry&&attempt<schedule.retry.maxAttempts&&this.schedules.has(schedule.id)&&schedule.enabled){
    schedule.failedAttempts=attempt;
    const delay=Math.min(schedule.retry.backoffMs*2**(attempt-1),MAX_RETRY_BACKOFF_MS);
    schedule.retryAt=new Date(Date.now()+delay).toISOString();
   }else if(run.status==="completed"){schedule.failedAttempts=0;}
   else schedule.failedAttempts=attempt;
   this.persist();this.record(run);
  }
  return structuredClone(run);
 }
 private require(id:string){const schedule=this.schedules.get(id);if(!schedule)throw new Error("Unknown schedule.");return schedule;}
 private validateRetry(retry:ScheduleRetryPolicy|undefined):ScheduleRetryPolicy|undefined{
  if(retry===undefined)return undefined;
  if(!retry||typeof retry!=="object")throw new Error("Retry policy must be an object.");
  const {maxAttempts,backoffMs}=retry;
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>MAX_RETRY_ATTEMPTS)throw new Error(`Retry maxAttempts must be an integer from 1 to ${MAX_RETRY_ATTEMPTS}.`);
  if(!Number.isInteger(backoffMs)||backoffMs<1000||backoffMs>MAX_RETRY_BACKOFF_MS)throw new Error("Retry backoffMs must be an integer from 1000 to 86400000.");
  return maxAttempts===1?undefined:{maxAttempts,backoffMs};
 }
 private validateClock(trigger:ScheduleTrigger,label:string){
  const hour=trigger.hour;const minute=trigger.minute;
  if(hour===undefined||!Number.isInteger(hour)||hour<0||hour>23)throw new Error(label+" trigger requires hour 0-23.");
  if(minute===undefined||!Number.isInteger(minute)||minute<0||minute>59)throw new Error(label+" trigger requires minute 0-59.");
  assertTimezone(trigger.timezone);
 }
 private validateTrigger(trigger:ScheduleTrigger){
  if(!trigger||typeof trigger!=="object")throw new Error("Unknown schedule trigger.");
  if(trigger.kind==="interval"){const intervalMs=trigger.intervalMs;if(intervalMs===undefined||!Number.isFinite(intervalMs)||!Number.isInteger(intervalMs)||intervalMs<1000)throw new Error("Interval must be an integer of at least 1000ms.");return;}
  if(trigger.kind==="once"){if(!trigger.runAt||Number.isNaN(Date.parse(trigger.runAt)))throw new Error("A valid runAt timestamp is required.");return;}
  if(trigger.kind==="daily"){this.validateClock(trigger,"Daily");return;}
  if(trigger.kind==="weekly"){
   this.validateClock(trigger,"Weekly");
   const days=trigger.daysOfWeek;
   if(!Array.isArray(days)||!days.length||days.length>7||days.some(day=>!Number.isInteger(day)||day<0||day>6))throw new Error("Weekly trigger requires daysOfWeek with values 0 (Sunday) to 6 (Saturday).");
   return;
  }
  if(trigger.kind==="monthly"){
   this.validateClock(trigger,"Monthly");
   const day=trigger.dayOfMonth;
   if(day===undefined||!Number.isInteger(day)||day<1||day>31)throw new Error("Monthly trigger requires dayOfMonth 1-31.");
   return;
  }
  throw new Error("Unknown schedule trigger.");
 }
 /** First calendar occurrence strictly not before `from` that matches `matches(year,month,day,weekday)`. */
 private nextCalendar(trigger:ScheduleTrigger,from:Date,matches:(year:number,month:number,day:number,weekday:number)=>boolean):Date|undefined{
  const hour=trigger.hour!,minute=trigger.minute!;
  if(trigger.timezone){
   const start=zonedParts(from,trigger.timezone);
   for(let offset=0;offset<=400;offset++){
    const civil=new Date(Date.UTC(start.year,start.month-1,start.day+offset));
    const year=civil.getUTCFullYear(),month=civil.getUTCMonth()+1,day=civil.getUTCDate(),weekday=civil.getUTCDay();
    if(!matches(year,month,day,weekday))continue;
    const candidate=zonedToInstant(year,month,day,hour,minute,trigger.timezone);
    if(candidate.getTime()>=from.getTime())return candidate;
   }
   return undefined;
  }
  for(let offset=0;offset<=400;offset++){
   const candidate=new Date(from);candidate.setHours(0,0,0,0);candidate.setDate(candidate.getDate()+offset);
   if(!matches(candidate.getFullYear(),candidate.getMonth()+1,candidate.getDate(),candidate.getDay()))continue;
   candidate.setHours(hour,minute,0,0);
   if(candidate.getTime()>=from.getTime())return candidate;
  }
  return undefined;
 }
 /** `initial` is true only when a schedule is created or re-enabled: runImmediately affects the first run only. */
 private nextTime(trigger:ScheduleTrigger,from:Date,initial=false){
  if(trigger.kind==="once"){const at=new Date(trigger.runAt!);return at.getTime()>=from.getTime()?at:undefined;}
  if(trigger.kind==="daily"){this.validateClock(trigger,"Daily");return this.nextCalendar(trigger,from,()=>true);}
  if(trigger.kind==="weekly"){const days=new Set(trigger.daysOfWeek??[]);return this.nextCalendar(trigger,from,(_y,_m,_d,weekday)=>days.has(weekday));}
  if(trigger.kind==="monthly"){const wanted=trigger.dayOfMonth!;return this.nextCalendar(trigger,from,(year,month,day)=>day===Math.min(wanted,daysInMonth(year,month)));}
  const intervalMs=trigger.intervalMs;
  if(typeof intervalMs!=="number"||!Number.isFinite(intervalMs))throw new Error("Interval trigger is missing intervalMs.");
  const delayMs=initial&&trigger.runImmediately===true?0:intervalMs;
  return new Date(from.getTime()+delayMs);
 }
}
