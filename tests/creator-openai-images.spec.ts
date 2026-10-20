import assert from "node:assert/strict";
import {existsSync,readFileSync,rmSync,statSync} from "node:fs";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {deflateSync} from "node:zlib";
import {CreatorEngine} from "../src/creator/engine.js";

// A real 64x64 PNG (valid chunks + CRC) so ffmpeg can decode it.
function crc32(buf:Buffer){let c=~0;for(const b of buf){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return (~c)>>>0;}
function chunk(type:string,data:Buffer){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);}
function png(w:number,h:number){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;raw[o]=34;raw[o+1]=197;raw[o+2]=94;}}return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);}

const root=join(process.cwd(),".test-creator-openai");rmSync(root,{recursive:true,force:true});
const saved={provider:process.env.LAYANX_CREATOR_IMAGE_PROVIDER,key:process.env.OPENAI_API_KEY,exe:process.env.LAYANX_CREATOR_VISUAL_EXECUTABLE,comfy:process.env.LAYANX_COMFYUI_URL};
delete process.env.LAYANX_CREATOR_VISUAL_EXECUTABLE;delete process.env.LAYANX_COMFYUI_URL;
const KEY="sk-test-DO-NOT-LEAK-123";
const calls:Array<{url:string;auth:string;body:Record<string,unknown>}>=[];
let mode:"ok"|"401"|"notpng"="ok";
const fetcher=(async(input:RequestInfo|URL,init?:RequestInit)=>{
 calls.push({url:String(input),auth:String((init?.headers as Record<string,string>).authorization),body:JSON.parse(String(init?.body))});
 if(mode==="401")return new Response(JSON.stringify({error:{code:"invalid_api_key",message:"Incorrect API key provided: "+KEY}}),{status:401});
 const bytes=mode==="notpng"?Buffer.from("<html>not an image</html>".repeat(10)):png(64,64);
 return new Response(JSON.stringify({data:[{b64_json:bytes.toString("base64")}]}),{status:200});
}) as typeof fetch;
try{
 const engine=new CreatorEngine({root,fetcher,generateText:async()=>JSON.stringify({title:"عرض",hook:"هل تعلم؟",script:"المشهد الأول. المشهد الثاني."})});
 const project=await engine.plan({topic:"عرض",platform:"tiktok",durationSec:16});
 // not selected => no paid call
 delete process.env.LAYANX_CREATOR_IMAGE_PROVIDER;process.env.OPENAI_API_KEY=KEY;
 await assert.rejects(()=>engine.generateAssets(project.id),/creator_visual_generator_not_configured/);assert.equal(calls.length,0);
 process.env.LAYANX_CREATOR_IMAGE_PROVIDER="openai";delete process.env.OPENAI_API_KEY;
 await assert.rejects(()=>engine.generateAssets(project.id),/requires_OPENAI_API_KEY/);assert.equal(calls.length,0);
 process.env.OPENAI_API_KEY=KEY;
 const doctor=await engine.doctor();assert.equal(doctor.providers.find(p=>p.name==="openai-images")?.available,true);assert.ok(!JSON.stringify(doctor).includes(KEY));
 // wrong key: error names the status, never the key
 mode="401";await assert.rejects(()=>engine.generateAssets(project.id),(e:Error)=>/creator_openai_images_http_401/.test(e.message)&&!e.message.includes(KEY));
 // HTML instead of PNG is refused
 mode="notpng";await assert.rejects(()=>engine.generateAssets(project.id),/creator_openai_images_not_png/);
 // success: one call per scene, portrait size, PNG files written
 mode="ok";calls.length=0;
 const done=await engine.generateAssets(project.id);
 assert.equal(calls.length,project.scenes.length);
 for(const c of calls){assert.equal(c.url,"https://api.openai.com/v1/images/generations");assert.equal(c.auth,"Bearer "+KEY);assert.equal(c.body.size,"1024x1536");assert.equal(c.body.model,"gpt-image-1");assert.equal(c.body.quality,"low");assert.equal(c.body.output_format,"png");}
 for(const s of done.scenes){assert.ok(s.assetPath&&existsSync(s.assetPath));assert.deepEqual([...readFileSync(s.assetPath).subarray(0,4)],[0x89,0x50,0x4e,0x47]);}
 // and the real renderer turns them into an MP4 when ffmpeg is installed
 // containment holds on every OS (separator-aware): outside paths and the root itself are refused
 await assert.rejects(()=>engine.render(project.id,join(root,"..","escape.mp4")),/creator_output_outside_workspace/);
 await assert.rejects(()=>engine.render(project.id,root),/creator_output_outside_workspace/);
 if(spawnSync(process.env.LAYANX_FFMPEG_PATH??"ffmpeg",["-version"]).status===0){const rendered=await engine.render(project.id);assert.ok(rendered.outputPath&&statSync(rendered.outputPath).size>1000);console.log("rendered",rendered.outputPath);}
 else console.log("ffmpeg not installed: render step skipped");
}finally{
 for(const [k,v] of [["LAYANX_CREATOR_IMAGE_PROVIDER",saved.provider],["OPENAI_API_KEY",saved.key],["LAYANX_CREATOR_VISUAL_EXECUTABLE",saved.exe],["LAYANX_COMFYUI_URL",saved.comfy]] as const){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 rmSync(root,{recursive:true,force:true});
}
console.log("creator openai images: ok");
