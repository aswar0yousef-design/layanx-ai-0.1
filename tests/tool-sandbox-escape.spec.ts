import {assertSafeWorkspacePath} from "../src/platform/path-guard.js";
import {createFileToolAdapter,createFileWriteToolAdapter,createBrowserToolAdapter} from "../src/tools/fabric.js";
import {createHttpReadAdapter} from "../src/tools/http-read.js";
import {isBlockedAddress,assertPublicHttpUrl} from "../src/security/network-guard.js";
import type {ToolRequest} from "../src/core/types.js";
import {mkdtemp,mkdir,symlink,writeFile,readFile,access,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const base:Omit<ToolRequest,"tool"|"action"|"permission"|"payload">={missionId:"m",agentId:"a",projectId:"p1",idempotencyKey:"k"};
async function rejects(label:string,run:()=>Promise<unknown>,fragment:string){
 let message="";
 try{await run();}catch(error){message=error instanceof Error?error.message:String(error);}
 if(!message)throw new Error(label+" was accepted but must be blocked.");
 if(!message.includes(fragment))throw new Error(label+" failed with an unexpected error: "+message);
}

const root=await mkdtemp(join(tmpdir(),"layanx-escape-root-"));
const outside=await mkdtemp(join(tmpdir(),"layanx-escape-outside-"));
try{
 await writeFile(join(outside,"secret.txt"),"TOP-SECRET");
 await mkdir(join(root,"p1"),{recursive:true});
 await writeFile(join(root,"p1","inside.txt"),"inside");
 // Windows CI may lack symlink privilege for files; a directory junction needs none.
 await symlink(outside,join(root,"p1","escape"),process.platform==="win32"?"junction":"dir");
 let fileLink=true;
 try{await symlink(join(outside,"secret.txt"),join(root,"p1","secret-link.txt"),"file");}catch{fileLink=false;}

 const reader=createFileToolAdapter({root});
 const writer=createFileWriteToolAdapter({root});

 // Legitimate access keeps working.
 const ok=await reader.execute({...base,tool:"files.read",action:"read file",permission:"L1_READ",payload:{path:"inside.txt"}}) as {content:string};
 if(ok.content!=="inside")throw new Error("Normal in-sandbox read broke.");
 await writer.execute({...base,tool:"files.write",action:"write file",permission:"L3_MODIFY",payload:{path:"nested/new.txt",content:"hello"}});
 if(await readFile(join(root,"p1","nested","new.txt"),"utf8")!=="hello")throw new Error("Normal in-sandbox write broke.");

 await rejects("read through directory link",()=>reader.execute({...base,tool:"files.read",action:"read file",permission:"L1_READ",payload:{path:"escape/secret.txt"}}),"escapes the project sandbox");
 await rejects("list through directory link",()=>reader.execute({...base,tool:"files.list",action:"list files",permission:"L1_READ",payload:{path:"escape"}}),"escapes the project sandbox");
 await rejects("stat through directory link",()=>reader.execute({...base,tool:"files.stat",action:"stat file",permission:"L1_READ",payload:{path:"escape/secret.txt"}}),"escapes the project sandbox");
 await rejects("write through directory link",()=>writer.execute({...base,tool:"files.write",action:"write file",permission:"L3_MODIFY",payload:{path:"escape/pwned.txt",content:"x"}}),"escapes the project sandbox");
 await rejects("write into new dir under link",()=>writer.execute({...base,tool:"files.write",action:"write file",permission:"L3_MODIFY",payload:{path:"escape/deep/pwned.txt",content:"x"}}),"escapes the project sandbox");
 if(await access(join(outside,"pwned.txt")).then(()=>true,()=>false))throw new Error("A file was written outside the sandbox.");
 if(await access(join(outside,"deep")).then(()=>true,()=>false))throw new Error("A directory was created outside the sandbox.");
 if(fileLink){
  await rejects("read through file link",()=>reader.execute({...base,tool:"files.read",action:"read file",permission:"L1_READ",payload:{path:"secret-link.txt"}}),"escapes the project sandbox");
  await rejects("write through file link",()=>writer.execute({...base,tool:"files.write",action:"write file",permission:"L3_MODIFY",payload:{path:"secret-link.txt",content:"x"}}),"escapes the project sandbox");
  if(await readFile(join(outside,"secret.txt"),"utf8")!=="TOP-SECRET")throw new Error("The link target outside the sandbox was modified.");
 }
 await rejects("parent traversal",()=>reader.execute({...base,tool:"files.read",action:"read file",permission:"L1_READ",payload:{path:"../p2/x.txt"}}),"escapes the project sandbox");
}finally{
 await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});
}

// Address classification.
for(const address of ["127.0.0.1","127.0.0.2","0.0.0.0","10.1.2.3","172.16.0.1","172.31.255.255","192.168.1.1","169.254.169.254","100.64.0.1","100.127.255.254","224.0.0.1","255.255.255.255","::1","::","::ffff:127.0.0.1","::ffff:7f00:1","::ffff:169.254.169.254","fc00::1","fd12:3456::1","fe80::1","ff02::1","64:ff9b::a00:1","2002:c0a8:101::1","not-an-ip"]){
 if(!isBlockedAddress(address))throw new Error("Address must be blocked: "+address);
}
for(const address of ["8.8.8.8","1.1.1.1","93.184.215.14","172.32.0.1","100.128.0.1","2606:4700:4700::1111","::ffff:8.8.8.8"]){
 if(isBlockedAddress(address))throw new Error("Public address was blocked: "+address);
}

// DNS answers are checked: a public-looking name that resolves to a private address is refused.
const rebinding=async()=>["127.0.0.1"];
await rejects("DNS to loopback",()=>assertPublicHttpUrl(new URL("https://looks-public.example"),rebinding),"blocked");
await rejects("DNS mixed answers",()=>assertPublicHttpUrl(new URL("https://mixed.example"),async()=>["93.184.215.14","10.0.0.1"]),"blocked");
await rejects("DNS failure",()=>assertPublicHttpUrl(new URL("https://nx.example"),async()=>{throw new Error("ENOTFOUND");}),"could not be resolved");
await assertPublicHttpUrl(new URL("https://example.com"),async()=>["93.184.215.14"]);

let calls=0;
const fake=(async()=>{calls++;return new Response("internal");}) as typeof fetch;
const browser=createBrowserToolAdapter({fetcher:fake,resolveHost:rebinding});
const http=createHttpReadAdapter({fetcher:fake,resolveHost:rebinding});
for(const url of ["http://169.254.169.254/latest/meta-data","http://10.0.0.5/","http://0.0.0.0:11434/api/tags","http://127.0.0.2/","http://[::ffff:127.0.0.1]/","http://[::1]/","http://intranet/","http://printer.local/","https://looks-public.example/"]){
 await rejects("browser "+url,()=>browser.execute({...base,tool:"browser.read",action:"read web page",permission:"L1_READ",payload:{url}}),"blocked");
 await rejects("http "+url,()=>http.execute({...base,tool:"http.read",action:"read url",permission:"L1_READ",payload:{url}}),"blocked");
}
if(calls!==0)throw new Error("A blocked request reached the network transport.");
console.log("Tool sandbox escape and SSRF guard tests passed.");

// Windows path traps are rejected through the shared path guard (validated with win32 rules on every OS).
for(const bad of ["notes.txt:hidden","CON","nul.txt","\\\\?\\C:\\Windows\\win.ini","secret.env.","D:foo"]){
 let blocked=false;try{assertSafeWorkspacePath("C:\\work\\p1",bad,"win32");}catch{blocked=true;}
 if(!blocked)throw new Error("Windows path trap accepted: "+bad);
}
console.log("Windows path trap checks passed.");
