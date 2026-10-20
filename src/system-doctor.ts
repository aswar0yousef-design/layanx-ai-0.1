/**
 * System Doctor: inspects the REAL machine LayanX runs on and reports what works, what is missing,
 * and what to do about it. Every check runs a live probe; nothing returns a fixed "ok".
 *
 *   npm run doctor                     -> provider + system report (exit 1 when a blocking check fails)
 *   npm run doctor -- --out report.json -> also writes the redacted report to a file
 *
 * Redaction: the report never contains API keys, tokens, passwords or vault contents. Provider
 * credentials are reported only as configured/not configured.
 */
import os from "node:os";
import {statfs,mkdir,writeFile,access,rm} from "node:fs/promises";
import {constants as fsConstants} from "node:fs";
import {createServer} from "node:net";
import {execFile} from "node:child_process";
import {join} from "node:path";
import {loadProviderConfig} from "./config/providers.js";
import {providerDoctor,fetchWithDeadline,type ProviderDoctorResult} from "./doctor.js";
import {defaultDataDir} from "./platform/paths.js";

export type CheckStatus="pass"|"warn"|"fail";
export interface DoctorCheck{id:string;status:CheckStatus;blocking:boolean;detail:string;hint?:string;data?:Record<string,unknown>}
export interface OllamaModelInfo{name:string;sizeBytes?:number;parameterSize?:string;quantization?:string;family?:string}
export interface SystemDoctorReport{
 ok:boolean;
 generatedAt:string;
 summary:{pass:number;warn:number;fail:number;blockingFailures:string[]};
 system:{platform:string;release:string;windowsBuild?:number;arch:string;node:string;cpus:number;cpuModel?:string;totalMemoryBytes:number;freeMemoryBytes:number;gpu?:{name:string;memoryMiB:number}[]};
 providers:ProviderDoctorResult[];
 ollamaModels:OllamaModelInfo[];
 checks:DoctorCheck[];
}

export type CommandProbe=(file:string,args:string[],timeoutMs:number)=>Promise<{ok:boolean;stdout:string;stderr:string}>;
export interface SystemDoctorOptions{
 env?:NodeJS.ProcessEnv;
 fetcher?:typeof fetch;
 probe?:CommandProbe;
 platform?:NodeJS.Platform;
 nodeVersion?:string;
 release?:string;
 totalMemoryBytes?:number;
 freeMemoryBytes?:number;
 dataDir?:string;
 ports?:number[];
 diskFree?:(path:string)=>Promise<number|undefined>;
 portFree?:(port:number)=>Promise<boolean>;
 timeoutMs?:number;
}

const REQUIRED_NODE_MAJOR=22;
const MIN_FREE_DISK_BYTES=10*1024**3;   // models + data; Ollama models alone are several GiB
const MIN_RAM_BYTES=8*1024**3;
const GIB=1024**3;

export const defaultProbe:CommandProbe=(file,args,timeoutMs)=>new Promise(resolve=>{
 execFile(file,args,{timeout:timeoutMs,windowsHide:true,shell:false,maxBuffer:256*1024},(error,stdout,stderr)=>{
  resolve({ok:!error,stdout:String(stdout??""),stderr:String(stderr??"")});
 });
});

async function defaultDiskFree(path:string):Promise<number|undefined>{
 try{const info=await statfs(path);return Number(info.bavail)*Number(info.bsize);}catch{return undefined;}
}
function defaultPortFree(port:number):Promise<boolean>{
 return new Promise(resolve=>{
  const server=createServer();
  server.once("error",()=>resolve(false));
  server.listen({port,host:"127.0.0.1",exclusive:true},()=>server.close(()=>resolve(true)));
 });
}

/** Human explanation for the low-level errors fetch() produces when Ollama is not running. */
export function explainOllamaError(reason:string|undefined,baseUrl:string):{detail:string;hint:string}{
 const text=(reason??"").toLowerCase();
 if(text.includes("timed out")||text.includes("timeout")||text.includes("aborted"))
  return{detail:`Ollama at ${baseUrl} did not answer in time.`,hint:"Ollama may be busy loading a model. Wait, then rerun `npm run doctor`. If it persists, restart the Ollama app."};
 if(text.includes("fetch failed")||text.includes("econnrefused")||text.includes("enotfound")||text.includes("unreachable"))
  return{detail:`Ollama is not running or not reachable at ${baseUrl}.`,hint:"Install Ollama from https://ollama.com/download, start it, then run `ollama pull <model>`. Set OLLAMA_BASE_URL if it listens elsewhere."};
 if(text.includes("not installed"))
  return{detail:"Ollama is running, but the configured model is not installed.",hint:"Run `ollama list` to see installed models, then `ollama pull <model>` or change OLLAMA_MODEL."};
 return{detail:`Ollama check failed: ${reason??"unknown error"}.`,hint:"Run `ollama list` in PowerShell to confirm Ollama works outside LayanX."};
}

/** Rough fit of a local model on this machine. Weights must fit in VRAM for full GPU speed. */
export function modelFit(sizeBytes:number|undefined,vramMiB:number|undefined,ramBytes:number):"gpu"|"partial-gpu"|"cpu"|"too-large"|"unknown"{
 if(!sizeBytes)return"unknown";
 const needed=sizeBytes*1.2; // weights + KV cache/runtime overhead
 if(vramMiB&&needed<=vramMiB*1024**2)return"gpu";
 if(needed>ramBytes*0.8)return"too-large";
 if(vramMiB)return"partial-gpu";
 return"cpu";
}

function windowsBuild(release:string):number|undefined{const parts=release.split(".");const build=Number(parts[2]);return Number.isFinite(build)?build:undefined;}

async function listOllamaModels(baseUrl:string,fetcher:typeof fetch,timeoutMs:number):Promise<OllamaModelInfo[]|undefined>{
 try{
  const response=await fetchWithDeadline(fetcher,baseUrl.replace(/\/$/,"")+"/api/tags",{method:"GET"},timeoutMs);
  if(!response.ok)return undefined;
  const body=await response.json() as {models?:Array<{name?:string;size?:number;details?:{parameter_size?:string;quantization_level?:string;family?:string}}>};
  return (body.models??[]).filter(model=>typeof model.name==="string").map(model=>({name:model.name!,sizeBytes:typeof model.size==="number"?model.size:undefined,parameterSize:model.details?.parameter_size,quantization:model.details?.quantization_level,family:model.details?.family}));
 }catch{return undefined;}
}

export async function systemDoctor(options:SystemDoctorOptions={}):Promise<SystemDoctorReport>{
 const env=options.env??process.env;
 const fetcher=options.fetcher??fetch;
 const probe=options.probe??defaultProbe;
 const platform=options.platform??process.platform;
 const timeoutMs=options.timeoutMs??5000;
 const nodeVersion=options.nodeVersion??process.versions.node;
 const release=options.release??os.release();
 const totalMemoryBytes=options.totalMemoryBytes??os.totalmem();
 const freeMemoryBytes=options.freeMemoryBytes??os.freemem();
 const dataDir=options.dataDir??defaultDataDir(env,platform);
 const checks:DoctorCheck[]=[];
 const add=(check:DoctorCheck)=>{checks.push(check);};

 // Node.js
 const major=Number(nodeVersion.split(".")[0]);
 add(major>=REQUIRED_NODE_MAJOR
  ?{id:"node",status:"pass",blocking:true,detail:`Node.js ${nodeVersion}.`}
  :{id:"node",status:"fail",blocking:true,detail:`Node.js ${nodeVersion} is too old; LayanX needs ${REQUIRED_NODE_MAJOR} or newer.`,hint:"Install the Node.js 22 LTS from https://nodejs.org, then rerun `npm ci`."});

 // Operating system
 const build=platform==="win32"?windowsBuild(release):undefined;
 if(platform==="win32")add(build!==undefined&&build>=22000
  ?{id:"os",status:"pass",blocking:false,detail:`Windows 11 (build ${build}).`}
  :{id:"os",status:"warn",blocking:false,detail:`Windows build ${build??release} is older than Windows 11.`,hint:"LayanX targets Windows 11; desktop-control and sandbox features may not work on older builds."});
 else add({id:"os",status:"warn",blocking:false,detail:`Running on ${platform} ${release}. Windows-only features (desktop control, PowerShell sandbox, installer) are unavailable here.`});

 // Memory
 add(totalMemoryBytes>=MIN_RAM_BYTES
  ?{id:"memory",status:"pass",blocking:false,detail:`${(totalMemoryBytes/GIB).toFixed(1)} GiB RAM, ${(freeMemoryBytes/GIB).toFixed(1)} GiB free.`}
  :{id:"memory",status:"warn",blocking:false,detail:`Only ${(totalMemoryBytes/GIB).toFixed(1)} GiB RAM.`,hint:"Use small local models (1-3B parameters) or a cloud provider."});

 // GPU (NVIDIA only; absence is not an error)
 let gpu:{name:string;memoryMiB:number}[]|undefined;
 const smi=await probe(platform==="win32"?"nvidia-smi.exe":"nvidia-smi",["--query-gpu=name,memory.total","--format=csv,noheader,nounits"],timeoutMs);
 if(smi.ok){
  gpu=smi.stdout.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const [name,mem]=line.split(",").map(part=>part.trim());return{name:name??"NVIDIA GPU",memoryMiB:Number(mem)||0};});
  add({id:"gpu",status:"pass",blocking:false,detail:gpu.map(item=>`${item.name} (${item.memoryMiB} MiB VRAM)`).join(", ")||"NVIDIA GPU detected."});
 }else add({id:"gpu",status:"warn",blocking:false,detail:"No NVIDIA GPU detected (nvidia-smi unavailable). Local models will run on the CPU.",hint:"If you have an NVIDIA card, install the current driver so Ollama can use it."});
 const vramMiB=gpu?.reduce((max,item)=>Math.max(max,item.memoryMiB),0)||undefined;

 // Data directory: exists/creatable and writable, and free disk space
 try{
  await mkdir(dataDir,{recursive:true});
  const marker=join(dataDir,`.doctor-${process.pid}-${Date.now()}`);
  await writeFile(marker,"ok");await rm(marker,{force:true});
  await access(dataDir,fsConstants.W_OK);
  add({id:"data-dir",status:"pass",blocking:true,detail:`Data directory is writable: ${dataDir}`});
 }catch(error){
  add({id:"data-dir",status:"fail",blocking:true,detail:`Data directory is not writable: ${dataDir}`,hint:"Set LAYANX_DATA_DIR to a folder you own, or fix the folder permissions.",data:{error:error instanceof Error?error.message:String(error)}});
 }
 const free=await (options.diskFree??defaultDiskFree)(dataDir);
 if(free===undefined)add({id:"disk",status:"warn",blocking:false,detail:"Free disk space could not be measured."});
 else add(free>=MIN_FREE_DISK_BYTES
  ?{id:"disk",status:"pass",blocking:false,detail:`${(free/GIB).toFixed(1)} GiB free on the data drive.`}
  :{id:"disk",status:"warn",blocking:false,detail:`Only ${(free/GIB).toFixed(1)} GiB free on the data drive.`,hint:"Local models need several GiB each. Free space or move LAYANX_DATA_DIR / OLLAMA_MODELS to a larger drive."});

 // Runtime persistence
 const storagePath=env.LAYANX_RUNTIME_STORAGE_PATH?.trim();
 const databaseUrl=(env.LAYANX_DATABASE_URL??env.DATABASE_URL)?.trim();
 add(storagePath||databaseUrl
  ?{id:"persistence",status:"pass",blocking:false,detail:databaseUrl?"PostgreSQL persistence is configured (connection string redacted).":`Durable JSON persistence: ${storagePath}`}
  :{id:"persistence",status:"warn",blocking:false,detail:"Runtime persistence is disabled: missions and schedules are lost when the process exits.",hint:"Set LAYANX_RUNTIME_STORAGE_PATH (for example .layanx/runtime.json) to keep state across restarts. The Windows launcher (LayanX.cmd / npm run local) sets this automatically."});

 // Ports
 const ports=options.ports??[Number(env.LAYANX_API_PORT??3000)].filter(port=>Number.isInteger(port)&&port>0);
 for(const port of ports){
  const isFree=await (options.portFree??defaultPortFree)(port);
  add(isFree
   ?{id:`port-${port}`,status:"pass",blocking:false,detail:`Port ${port} is free.`}
   :{id:`port-${port}`,status:"warn",blocking:false,detail:`Port ${port} is already in use.`,hint:"LayanX may already be running (open http://127.0.0.1:"+port+"), or another app holds the port. Change LAYANX_API_PORT if needed."});
 }

 // External tools
 const tools:Array<{id:string;file:string;args:string[];blocking:boolean;why:string;hint:string}>=[
  {id:"git",file:platform==="win32"?"git.exe":"git",args:["--version"],blocking:false,why:"Git tools, checkpoints and rollback need Git.",hint:"Install Git for Windows: `winget install --id Git.Git -e`."},
  {id:"ffmpeg",file:platform==="win32"?"ffmpeg.exe":"ffmpeg",args:["-version"],blocking:false,why:"Video assembly and audio conversion need FFmpeg.",hint:"Install FFmpeg: `winget install --id Gyan.FFmpeg -e`."},
  {id:"python",file:platform==="win32"?"python.exe":"python3",args:["--version"],blocking:false,why:"Local voice (Whisper/Piper) and the MT5 bridge need Python.",hint:"Install Python 3.11+: `winget install --id Python.Python.3.11 -e`."}
 ];
 if(platform==="win32")tools.push({id:"powershell",file:"powershell.exe",args:["-NoProfile","-Command","$PSVersionTable.PSVersion.ToString()"],blocking:false,why:"Desktop control and the Windows sandbox use PowerShell.",hint:"PowerShell ships with Windows; check that it is not blocked by policy."});
 for(const tool of tools){
  const result=await probe(tool.file,tool.args,timeoutMs);
  const version=(result.stdout||result.stderr).split(/\r?\n/)[0]?.trim().slice(0,120);
  add(result.ok?{id:`tool-${tool.id}`,status:"pass",blocking:tool.blocking,detail:`${tool.id}: ${version||"available"}`}
   :{id:`tool-${tool.id}`,status:"warn",blocking:tool.blocking,detail:`${tool.id} was not found. ${tool.why}`,hint:tool.hint});
 }
 let playwright=false;
 try{await import("playwright-core");playwright=true;}catch{playwright=false;}
 add(playwright?{id:"tool-playwright",status:"pass",blocking:false,detail:"playwright-core is installed (interactive browser automation available)."}
  :{id:"tool-playwright",status:"warn",blocking:false,detail:"playwright-core is not installed; only the read-only browser tool is available.",hint:"Run `npm install` (it is an optional dependency)."});

 // Providers (live), with an explanation people can act on
 const providers=await providerDoctor(fetcher,{timeoutMs,env});
 const config=loadProviderConfig(env);
 const ollamaModels=config.ollama.enabled?(await listOllamaModels(config.ollama.baseUrl,fetcher,timeoutMs))??[]:[];
 for(const provider of providers.providers){
  if(provider.provider==="ollama"){
   if(provider.reachable&&provider.modelAvailable)add({id:"provider-ollama",status:"pass",blocking:true,detail:`Ollama is running and ${provider.model} is installed.`});
   else{const why=explainOllamaError(provider.reason,config.ollama.baseUrl);add({id:"provider-ollama",status:"fail",blocking:true,detail:why.detail,hint:why.hint.replace("<model>",provider.model??"<model>")});}
  }else add(provider.reachable
   ?{id:`provider-${provider.provider}`,status:"pass",blocking:false,detail:`${provider.provider} is reachable (model ${provider.model}).`}
   :{id:`provider-${provider.provider}`,status:provider.configured?"fail":"warn",blocking:false,detail:`${provider.provider}: ${provider.reason??"unreachable"}`,hint:provider.configured?"Check the API key with `npm run secrets -- list` and your network.":"Optional. Add a key only if you want this cloud provider."});
 }
 if(!providers.providers.length)add({id:"providers",status:"fail",blocking:true,detail:"No model provider is enabled for the current LAYANX_AI_MODE.",hint:"Enable Ollama (OLLAMA_ENABLED=true) or configure a cloud provider."});
 for(const model of ollamaModels){
  const fit=modelFit(model.sizeBytes,vramMiB,totalMemoryBytes);
  if(fit==="too-large")add({id:`model-${model.name}`,status:"warn",blocking:false,detail:`${model.name} (${((model.sizeBytes??0)/GIB).toFixed(1)} GiB) is likely too large for this machine's memory.`,hint:"Prefer a smaller or more quantized variant."});
  else if(fit==="partial-gpu")add({id:`model-${model.name}`,status:"warn",blocking:false,detail:`${model.name} (${((model.sizeBytes??0)/GIB).toFixed(1)} GiB) exceeds the GPU memory and will be split between GPU and CPU (slower).`});
 }

 const blockingFailures=checks.filter(check=>check.blocking&&check.status==="fail").map(check=>check.id);
 return{
  ok:blockingFailures.length===0,
  generatedAt:new Date().toISOString(),
  summary:{pass:checks.filter(c=>c.status==="pass").length,warn:checks.filter(c=>c.status==="warn").length,fail:checks.filter(c=>c.status==="fail").length,blockingFailures},
  system:{platform,release,windowsBuild:build,arch:os.arch(),node:nodeVersion,cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model,totalMemoryBytes,freeMemoryBytes,gpu},
  providers:providers.providers,
  ollamaModels,
  checks
 };
}

const SECRET_PATTERN=/(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|Bearer\s+[A-Za-z0-9._-]{10,}|postgres(?:ql)?:\/\/[^\s"']+)/g;
/** Defence in depth before a report leaves the process (file export, support ticket). */
export function redactReport(report:SystemDoctorReport):SystemDoctorReport{
 return JSON.parse(JSON.stringify(report).replace(SECRET_PATTERN,"[redacted]")) as SystemDoctorReport;
}
