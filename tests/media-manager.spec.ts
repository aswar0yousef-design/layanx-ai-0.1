import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {MediaManager} from "../src/business/media.js";

const dir=mkdtempSync(join(tmpdir(),"layanx-media-"));
process.env.LAYANX_MEDIA_STORAGE_PATH=join(dir,"media.json");
const okFetch=(async()=>new Response("",{status:200,headers:{"content-type":"image/jpeg","content-length":"1234"}})) as typeof fetch;
const publicDns=async()=>["93.184.215.14"];
const m=new MediaManager({fetcher:okFetch,resolveHost:publicDns});
const first=await m.inspect("https://cdn.example/item.jpg");
assert.equal(first.kind,"image");assert.equal(first.contentLength,1234);assert.equal(first.reachable,true);
const second=await m.inspect("https://cdn.example/item.jpg");assert.equal(second.url,first.url);assert.equal(m.snapshot().length,1);
await assert.rejects(()=>m.inspect("file:///tmp/item.jpg"),/media_url_must_be_http/);
// SSRF: private targets, DNS answers and redirect hops are all checked before any request leaves.
let calls=0;
const spy=(async(input:RequestInfo|URL)=>{calls++;const u=String(input);if(u.startsWith("https://cdn.example/redirect"))return new Response(null,{status:302,headers:{location:"http://169.254.169.254/latest/meta-data"}});return new Response("",{status:200});}) as typeof fetch;
const guarded=new MediaManager({fetcher:spy,resolveHost:publicDns});
for(const url of ["http://127.0.0.1:11434/api/tags","http://10.0.0.1/x.jpg","http://169.254.169.254/latest","http://0.0.0.0/x.png","http://[::1]/a.png"])await assert.rejects(()=>guarded.inspect(url),/blocked/);
assert.equal(calls,0,"a blocked media URL reached the network");
await assert.rejects(()=>guarded.inspect("https://cdn.example/redirect.jpg"),/blocked/);
assert.equal(calls,1,"redirect to a private address was followed");
await assert.rejects(()=>new MediaManager({fetcher:spy,resolveHost:async()=>["192.168.1.10"]}).inspect("https://rebind.example/x.jpg"),/blocked/);
rmSync(dir,{recursive:true,force:true});
console.log("media manager validation: ok");
