import assert from "node:assert/strict";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {createPinnedFetch,type SocketLookup} from "../src/security/network-guard.js";
import {createHttpReadAdapter} from "../src/tools/http-read.js";
import {createBrowserToolAdapter} from "../src/tools/fabric.js";
import {MediaManager} from "../src/business/media.js";

// A local server stands in for an internal service (Ollama, router admin, cloud metadata).
let hits=0;
const server=createServer((req,res)=>{
 hits++;
 if(req.url==="/redirect"){res.writeHead(302,{location:"/final"});res.end();return;}
 res.writeHead(200,{"content-type":"text/plain","x-multi":["a","b"]});res.end(req.method==="HEAD"?undefined:"internal-secret");
});
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const port=(server.address() as AddressInfo).port;
const toLoopback:SocketLookup=(_host,_options,callback)=>callback(null,[{address:"127.0.0.1",family:4}]);
const publicFirst=async()=>["93.184.215.14"]; // what the pre-check sees (rebinding: first answer public)

try{
 // 1. Rebinding: the pre-check sees a public address, the socket lookup gets 127.0.0.1 -> refused before connecting.
 const pinned=createPinnedFetch({lookup:toLoopback});
 const http=createHttpReadAdapter({fetcher:pinned,resolveHost:publicFirst});
 await assert.rejects(()=>http.execute({toolName:"http.read",projectId:"p",payload:{url:`http://rebind.example:${port}/`}} as never),/blocked/);
 const browser=createBrowserToolAdapter({fetcher:pinned,resolveHost:publicFirst});
 await assert.rejects(()=>browser.execute({toolName:"browser.read",projectId:"p",payload:{url:`http://rebind.example:${port}/`}} as never),/blocked/);
 await assert.rejects(()=>new MediaManager({fetcher:pinned,resolveHost:publicFirst}).inspect(`http://rebind.example:${port}/a.jpg`),/blocked/);
 await assert.rejects(()=>pinned(`http://rebind.example:${port}/`),/blocked/);
 // mixed answers: one private address is enough to refuse
 await assert.rejects(()=>createPinnedFetch({lookup:(_h,_o,cb)=>cb(null,[{address:"93.184.215.14",family:4},{address:"10.0.0.5",family:4}])})(`http://mixed.example:${port}/`),/blocked/);
 // IP literal in the URL (no lookup happens) is checked too
 await assert.rejects(()=>createPinnedFetch()(`http://127.0.0.1:${port}/`),/blocked/);
 assert.equal(hits,0,"a blocked address was contacted");

 // 2. Transport behaviour when the address is allowed (test-only policy): body, headers, redirects, HEAD, timeout.
 const open=createPinnedFetch({lookup:toLoopback,isBlocked:()=>false});
 const ok=await open(`http://svc.example:${port}/`,{headers:{accept:"text/plain"}});
 assert.equal(ok.status,200);assert.equal(await ok.text(),"internal-secret");assert.equal(ok.headers.get("x-multi"),"a, b");
 await assert.rejects(()=>open(`http://svc.example:${port}/redirect`,{redirect:"error"}),/Redirects are not allowed/);
 await assert.rejects(()=>open(`http://svc.example:${port}/redirect`),/Redirects are not allowed/);
 const manual=await open(`http://svc.example:${port}/redirect`,{redirect:"manual"});
 assert.equal(manual.status,302);assert.equal(manual.headers.get("location"),"/final");
 await assert.rejects(()=>open(`http://svc.example:${port}/redirect`,{redirect:"follow"}),/does not follow redirects/);
 const head=await open(`http://svc.example:${port}/`,{method:"HEAD"});assert.equal(head.status,200);assert.equal(head.body,null);
 await assert.rejects(()=>open("file:///etc/passwd"),/Only HTTP/);
 const hang=createServer(()=>{});await new Promise<void>(done=>hang.listen(0,"127.0.0.1",done));
 try{await assert.rejects(()=>open(`http://slow.example:${(hang.address() as AddressInfo).port}/`,{signal:AbortSignal.timeout(200)}),(error:Error)=>error.name==="AbortError"||error.name==="TimeoutError");}
 finally{hang.closeAllConnections();hang.close();}
}finally{server.close();}
console.log("dns pinning (http.read, browser.read, media.inspect): ok");
