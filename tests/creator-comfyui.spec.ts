import assert from "node:assert/strict";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {readFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {CreatorEngine} from "../src/creator/engine.js";

// Local stand-in for ComfyUI's HTTP API: POST /prompt -> prompt_id, GET /history/<id>, GET /view?filename=...
const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(64,1)]);
const received:Array<Record<string,unknown>>=[];let historyCalls=0;let failNext=false;
const server=createServer((req,res)=>{
 const url=new URL(req.url??"/","http://x");
 if(req.method==="POST"&&url.pathname==="/prompt"){let body="";req.on("data",c=>body+=c);req.on("end",()=>{received.push(JSON.parse(body));res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({prompt_id:"p"+received.length}));});return;}
 if(url.pathname.startsWith("/history/")){
  historyCalls++;const id=decodeURIComponent(url.pathname.slice(9));res.writeHead(200,{"content-type":"application/json"});
  if(historyCalls%2===1){res.end("{}");return;} // first poll: still running
  if(failNext){res.end(JSON.stringify({[id]:{status:{status_str:"error"},outputs:{}}}));return;}
  res.end(JSON.stringify({[id]:{status:{status_str:"success"},outputs:{"9":{images:[{filename:id+".png",subfolder:"",type:"output"}]}}}}));return;
 }
 if(url.pathname==="/view"){res.writeHead(200,{"content-type":"image/png"});res.end(PNG);return;}
 res.writeHead(404);res.end();
});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const root=join(process.cwd(),".test-creator-comfy");rmSync(root,{recursive:true,force:true});
const saved={url:process.env.LAYANX_COMFYUI_URL,wf:process.env.LAYANX_COMFYUI_WORKFLOW_JSON,exe:process.env.LAYANX_CREATOR_VISUAL_EXECUTABLE};
try{
 delete process.env.LAYANX_CREATOR_VISUAL_EXECUTABLE;
 process.env.LAYANX_COMFYUI_URL=`http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
 const engine=new CreatorEngine({root,generateText:async()=>JSON.stringify({title:"t",hook:"h",script:"الأول. الثاني."})});
 const project=await engine.plan({topic:"اختبار",platform:"youtube",durationSec:16});
 delete process.env.LAYANX_COMFYUI_WORKFLOW_JSON;
 await assert.rejects(()=>engine.generateAssets(project.id),/WORKFLOW_JSON is required/);
 process.env.LAYANX_COMFYUI_WORKFLOW_JSON=JSON.stringify({"6":{class_type:"CLIPTextEncode",inputs:{text:"{prompt}"}},"5":{class_type:"EmptyLatentImage",inputs:{aspect:"{aspect}"}}});
 const done=await engine.generateAssets(project.id);
 assert.equal(received.length,project.scenes.length);
 const first=received[0] as {prompt:Record<string,{inputs:Record<string,string>}>;client_id:string};
 assert.equal(first.client_id,"layanx-creator");
 assert.equal(first.prompt["6"]!.inputs.text,project.scenes[0]!.visualPrompt,"{prompt} placeholder substituted");
 assert.equal(first.prompt["5"]!.inputs.aspect,"16:9","{aspect} placeholder substituted");
 for(const s of done.scenes)assert.deepEqual(readFileSync(s.assetPath!),PNG);
 assert.ok(historyCalls>=project.scenes.length*2,"polled until ComfyUI finished");
 failNext=true;
 await assert.rejects(()=>engine.generateAssets(project.id),/creator_comfyui_generation_failed/);
}finally{
 server.close();rmSync(root,{recursive:true,force:true});
 for(const [k,v] of [["LAYANX_COMFYUI_URL",saved.url],["LAYANX_COMFYUI_WORKFLOW_JSON",saved.wf],["LAYANX_CREATOR_VISUAL_EXECUTABLE",saved.exe]] as const){if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
console.log("creator comfyui adapter: ok");
