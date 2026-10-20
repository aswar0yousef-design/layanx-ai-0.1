import {systemDoctor,redactReport,explainOllamaError,modelFit,type CommandProbe} from "../src/system-doctor.js";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const dataDir=await mkdtemp(join(tmpdir(),"layanx-doctor-"));
const GIB=1024**3;
const baseEnv={LAYANX_AI_MODE:"local",OLLAMA_ENABLED:"true",OLLAMA_BASE_URL:"http://ollama.test",OLLAMA_MODEL:"qwen2.5-coder:7b"} as NodeJS.ProcessEnv;
// The user's PC: Windows 11, GTX 1660 Super 6 GiB, 32 GiB RAM.
const probe:CommandProbe=async(file)=>{
 if(file.startsWith("nvidia-smi"))return{ok:true,stdout:"NVIDIA GeForce GTX 1660 SUPER, 6144\n",stderr:""};
 if(file.startsWith("ffmpeg"))return{ok:false,stdout:"",stderr:"not found"};
 return{ok:true,stdout:file+" 1.0\n",stderr:""};
};
const tags={models:[
 {name:"qwen2.5-coder:7b",size:Math.round(4.7*GIB),details:{parameter_size:"7.6B",quantization_level:"Q4_K_M"}},
 {name:"llama3.2:3b",size:Math.round(2.0*GIB)},
 {name:"llama3.1:70b",size:Math.round(40*GIB)}
]};
try{
 const ready=await systemDoctor({env:baseEnv,dataDir,probe,platform:"win32",release:"10.0.26100",nodeVersion:"22.20.0",totalMemoryBytes:32*GIB,freeMemoryBytes:20*GIB,ports:[3000],
  diskFree:async()=>500*GIB,portFree:async()=>true,
  fetcher:async(input)=>{if(String(input)!=="http://ollama.test/api/tags")throw new Error("unexpected "+String(input));return new Response(JSON.stringify(tags),{status:200});}});
 const byId=(id:string)=>ready.checks.find(check=>check.id===id);
 if(!ready.ok)throw new Error("Healthy machine reported NOT READY: "+ready.summary.blockingFailures.join(","));
 if(byId("os")?.status!=="pass"||ready.system.windowsBuild!==26100)throw new Error("Windows 11 build was not recognised.");
 if(!byId("gpu")?.detail.includes("6144 MiB"))throw new Error("GPU VRAM was not reported.");
 if(byId("tool-ffmpeg")?.status!=="warn"||!byId("tool-ffmpeg")?.hint?.includes("winget"))throw new Error("Missing FFmpeg was not reported with an install hint.");
 if(byId("tool-powershell")?.status!=="pass")throw new Error("PowerShell probe missing on Windows.");
 if(ready.ollamaModels.length!==3)throw new Error("Installed Ollama models were not listed.");
 if(byId("model-llama3.1:70b")?.status!=="warn")throw new Error("Oversized 70B model was not flagged for a 32 GiB machine.");
 if(byId("model-llama3.2:3b"))throw new Error("A 2 GiB model was wrongly flagged on a 6 GiB GPU.");

 // Ollama missing -> blocking failure with a human explanation (not just "fetch failed").
 const down=await systemDoctor({env:baseEnv,dataDir,probe,platform:"win32",release:"10.0.26100",nodeVersion:"22.20.0",totalMemoryBytes:32*GIB,freeMemoryBytes:20*GIB,ports:[3000],diskFree:async()=>500*GIB,portFree:async()=>true,
  fetcher:async()=>{throw new TypeError("fetch failed");}});
 const ollama=down.checks.find(check=>check.id==="provider-ollama");
 if(down.ok||ollama?.status!=="fail"||!ollama.detail.includes("not running")||!ollama.hint?.includes("ollama pull qwen2.5-coder:7b"))throw new Error("Missing Ollama was not explained: "+JSON.stringify(ollama));

 // A hung Ollama must not hang the doctor.
 const started=Date.now();
 const hung=await systemDoctor({env:baseEnv,dataDir,probe,platform:"linux",release:"6.1",nodeVersion:"20.1.0",totalMemoryBytes:4*GIB,freeMemoryBytes:GIB,ports:[3000],diskFree:async()=>2*GIB,portFree:async()=>false,timeoutMs:300,
  fetcher:(async(_input:RequestInfo|URL,init?:RequestInit)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener("abort",()=>reject(init.signal?.reason));})) as typeof fetch});
 if(Date.now()-started>5000)throw new Error("Doctor did not bound the Ollama request.");
 const ids=new Map(hung.checks.map(check=>[check.id,check]));
 if(ids.get("node")?.status!=="fail"||!hung.summary.blockingFailures.includes("node"))throw new Error("Old Node.js was not a blocking failure.");
 if(ids.get("disk")?.status!=="warn"||ids.get("memory")?.status!=="warn"||ids.get("port-3000")?.status!=="warn")throw new Error("Low disk / low RAM / busy port were not reported.");
 if(!ids.get("provider-ollama")?.detail.includes("did not answer in time"))throw new Error("Ollama timeout was not explained: "+ids.get("provider-ollama")?.detail);

 // Secrets never leave in the exported report.
 const leaky=structuredClone(ready);leaky.checks.push({id:"x",status:"warn",blocking:false,detail:"key sk-abcdefghijklmnop and postgres://u:p@host/db and Bearer abcdefghijkl123"});
 const text=JSON.stringify(redactReport(leaky));
 if(text.includes("sk-abcdefghijklmnop")||text.includes("u:p@host")||text.includes("abcdefghijkl123"))throw new Error("Report redaction leaked a secret.");

 if(!explainOllamaError("connect ECONNREFUSED 127.0.0.1:11434","http://127.0.0.1:11434").hint.includes("ollama.com"))throw new Error("ECONNREFUSED explanation missing.");
 if(modelFit(undefined,6144,32*GIB)!=="unknown"||modelFit(2*GIB,6144,32*GIB)!=="gpu"||modelFit(8*GIB,6144,32*GIB)!=="partial-gpu"||modelFit(8*GIB,undefined,32*GIB)!=="cpu")throw new Error("modelFit classification is wrong.");
 console.log("System doctor tests passed.");
}finally{await rm(dataDir,{recursive:true,force:true});}
