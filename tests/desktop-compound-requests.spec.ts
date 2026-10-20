import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {openRequest,firstYouTubeVideoId} from "../src/tools/open-app.js";
import {createDesktopControlToolAdapter,resolvePlayRequest} from "../src/tools/desktop-control.js";
import {LayanXCore} from "../src/core/orchestrator.js";

/**
 * Owner report (Windows, 2026-10-21): «افتح كروم وافتح يوتيوب وشغل القرآن الكريم بصوت رعد الكردي» became a
 * 3-milestone cloud-planned mission that asked to approve git.branch and gave "verify Chrome" to the
 * researcher. Compound open / play / search requests are now one desktop step without the model, and the
 * supervisor's direct desktop path covers every program and site (it was Notepad only).
 */
const yt=(q:string)=>"https://www.youtube.com/results?search_query="+encodeURIComponent(q);
const cases:Array<[string,unknown]>=[
  ["افتح كروم وافتح يوتيوب وشغل القرآن الكريم بصوت رعد الكردي",{app:"كروم",url:yt("القرآن الكريم بصوت رعد الكردي"),play:"القرآن الكريم بصوت رعد الكردي",label:"YouTube: القرآن الكريم بصوت رعد الكردي",windowTitle:"YouTube"}],
  ["افتح كروم وافتح يوتيوب وشغّل القرآن الكريم بصوت رعد الكردي وتأكد من التشغيل",{app:"كروم",url:yt("القرآن الكريم بصوت رعد الكردي"),play:"القرآن الكريم بصوت رعد الكردي",label:"YouTube: القرآن الكريم بصوت رعد الكردي",windowTitle:"YouTube"}],
  ["افتح المتصفح وابحث عن أسعار الذهب اليوم",{url:"https://www.google.com/search?q="+encodeURIComponent("أسعار الذهب اليوم"),label:"Google: أسعار الذهب اليوم",windowTitle:"Google"}],
  ["افتح كروم وابحث في يوتيوب عن وصفات",{app:"كروم",url:yt("وصفات"),label:"YouTube: وصفات",windowTitle:"YouTube"}],
  ["افتح تطبيق جوجل كروم وافتح يوتيوب",{app:"جوجل كروم",url:"https://www.youtube.com/",label:"YouTube",windowTitle:"YouTube"}],
  ["شغل سورة الكهف على يوتيوب",{url:yt("سورة الكهف"),play:"سورة الكهف",label:"YouTube: سورة الكهف",windowTitle:"YouTube"}],
  ["شغل سورة الكهف",{url:yt("سورة الكهف"),play:"سورة الكهف",label:"YouTube: سورة الكهف",windowTitle:"YouTube"}],
  ["open chrome and search for gold price",{app:"chrome",url:"https://www.google.com/search?q=gold%20price",label:"Google: gold price",windowTitle:"Google"}],
  // Development, research and anything not fully understood stay with the planner.
  ["شغل الاختبارات",null],["شغل البناء وتأكد من النجاح",null],["ابحث عن أسعار الذهب اليوم",null],
  ["افتح الحاسبة والمفكرة",null],["افتح كروم وافتح ملف التقرير",null],["افتح كروم واكتب رسالة لأحمد وأرسلها",null],
  ["افتح كروم وابحث عن أ وشغل سورة",null]
];
for(const [text,want] of cases)assert.deepEqual(openRequest(text),want,text);

// ---------- first video on a results page
assert.equal(firstYouTubeVideoId('x "videoRenderer":{"videoId":"AbC_d-12345"} y "videoId":"zzzzzzzzzzz"'),"AbC_d-12345");
assert.equal(firstYouTubeVideoId('"videoId":"Q1w2E3r4T5y"'),"Q1w2E3r4T5y");
assert.equal(firstYouTubeVideoId("<html>no results</html>"),null);
{
  const seen:string[]=[];
  const page=(body:string,status=200)=>(async(url:string|URL|Request)=>{seen.push(String(url));return new Response(body,{status});}) as typeof fetch;
  const ok=await resolvePlayRequest({app:"كروم",play:"سورة الكهف"},page('{"videoRenderer":{"videoId":"Q1w2E3r4T5y"}}'));
  assert.deepEqual(ok,{payload:{app:"كروم",url:"https://www.youtube.com/watch?v=Q1w2E3r4T5y"},video:"Q1w2E3r4T5y"});
  assert.equal(seen[0],yt("سورة الكهف"),"only YouTube's public results page is read");
  const down=await resolvePlayRequest({play:"سورة الكهف"},page("",503));
  assert.deepEqual(down,{payload:{url:yt("سورة الكهف")},video:null},"results page when the lookup fails");
  const thrown=await resolvePlayRequest({play:"x y"},(async()=>{throw new Error("offline");}) as typeof fetch);
  assert.equal(thrown.video,null);
  await assert.rejects(resolvePlayRequest({play:"x".repeat(151)},page("")),/play must be/);
  const none=await resolvePlayRequest({app:"كروم"},page(""));
  assert.deepEqual(none,{payload:{app:"كروم"},video:null});
}

// ---------- the Windows tool opens the video page in the named browser
{
  const real=Object.getOwnPropertyDescriptor(process,"platform")!;
  Object.defineProperty(process,"platform",{value:"win32"});
  try{
    const ops:any[]=[];
    const adapter=createDesktopControlToolAdapter({
      windows:{async send(op){ops.push(op);return "ok|"+Buffer.from(String(op.value),"base64").toString();}},
      fetcher:(async()=>new Response('{"videoRenderer":{"videoId":"Q1w2E3r4T5y"}}')) as typeof fetch
    });
    const out=await adapter.execute({missionId:"m",agentId:"core",projectId:"p",tool:"desktop.app.open",action:"desktop open app",permission:"L4_EXECUTE",idempotencyKey:"k",payload:{app:"كروم",url:yt("q"),play:"سورة الكهف"}} as any) as any;
    assert.equal(out.playing,"https://www.youtube.com/watch?v=Q1w2E3r4T5y");
    const op=ops.at(-1);
    assert.deepEqual({op:op.op,kind:op.kind,browser:op.browser,value:Buffer.from(op.value,"base64").toString()},{op:"openapp",kind:"url",browser:"chrome",value:"https://www.youtube.com/watch?v=Q1w2E3r4T5y"});
  }finally{Object.defineProperty(process,"platform",real);}
}

// ---------- through the agent: one step with the play payload, no model call
{
  const core=new LayanXCore();
  let modelCalls=0;
  core.models.register({id:"m",provider:"fake",capabilities:["reasoning"],local:true,enabled:true,priority:1});
  core.providers.register({name:"fake",async health(){return{provider:"fake",available:true,updatedAt:new Date().toISOString()};},async generate(model){modelCalls++;return{modelId:model.id,provider:"fake",output:'{"tool":"git.branch"}'};}});
  core.registerAgent({agentId:"core",purpose:"open",allowedTools:["desktop.app.open","git.branch"],forbiddenResources:[],requiredPermission:"L4_EXECUTE",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
  core.tools.register({name:"git.branch",description:"branch",permission:"L3_WRITE",dangerous:false,actions:["create branch"],tags:["git"]});
  core.tools.register({name:"desktop.app.open",description:"open a program",permission:"L4_EXECUTE",dangerous:true,actions:["desktop open app"],tags:["desktop","open"]});
  const opened:unknown[]=[];
  core.toolAdapters.register("desktop.app.open",{async execute(r){opened.push(r.payload);return{opened:true};}});
  const first=await core.runAgentGateway("افتح كروم وافتح يوتيوب وشغل القرآن الكريم بصوت رعد الكردي","default",10) as any;
  assert.ok(first.paused&&first.approvalId,"supervised: it asks first");
  core.executionRuntime.approvals.approve(first.approvalId);
  const done=await core.executeAgentLoop(first.missionId,"default",10,{0:first.approvalId},"core") as any;
  assert.equal(done.completed,true,JSON.stringify(done));
  assert.deepEqual(opened,[{app:"كروم",url:yt("القرآن الكريم بصوت رعد الكردي"),play:"القرآن الكريم بصوت رعد الكردي"}]);
  assert.equal(modelCalls,0,"no model, and no git.branch");
}

// ---------- the autonomous supervisor: open + window check, both desktop, no planner call
{
  const {Supervisor}=await import("../src/autonomy/supervisor.js");
  const store=fs.mkdtempSync(path.join(os.tmpdir(),"lx-compound-store-"));
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"lx-compound-ws-"));
  process.env.LAYANX_STORE_DIR=store;process.env.LAYANX_WORKSPACE_ROOT=workspace;
  fs.mkdirSync(path.join(workspace,"default"),{recursive:true});
  const calls:{agent:string;goal:string}[]=[];let planningCalls=0;
  const supervisor=new Supervisor({
    async think(prompt){if(prompt.includes("planning lead"))planningCalls++;return "{}";},
    async runAgent(goal,_p,agent){calls.push({agent,goal});return{completed:true,missionId:"m"+calls.length,final:{ok:true,verified:true}};},
    async resumeAgent(){return{completed:true};},
    async runTool(){return{ok:true,data:{ok:true,exitCode:0}};},
    isApproved:()=>false,cloudAvailable:()=>true,externalAgent:()=>null,detect:()=>null
  },{file:path.join(store,"jobs.json"),pollMs:5});
  try{
    const job=supervisor.create("افتح كروم وافتح يوتيوب وشغل القرآن الكريم بصوت رعد الكردي","default");
    const end=Date.now()+8000;
    while(!["completed","failed"].includes(supervisor.get(job.id)!.status)){if(Date.now()>end)throw new Error(JSON.stringify(supervisor.get(job.id)!.log.slice(-6)));await new Promise(r=>setTimeout(r,10));}
    const result=supervisor.get(job.id)!;
    assert.equal(result.status,"completed",result.log.map(l=>l.msg).join("\n"));
    assert.equal(planningCalls,0,"no cloud/local planner for a desktop request");
    assert.deepEqual(result.milestones.map(m=>m.kind),["desktop","desktop"]);
    assert.deepEqual(calls.map(c=>c.agent),["operator","operator"],"never the researcher");
    assert.ok(calls[1]!.goal.includes("نافذة «YouTube»"));
    assert.equal(result.checks?.security,false);assert.equal(result.checks?.browser,null);
  }finally{supervisor.stop();fs.rmSync(store,{recursive:true,force:true});fs.rmSync(workspace,{recursive:true,force:true});}
}
console.log("desktop compound requests: open + play + search in one step, no model, supervisor never researches");
