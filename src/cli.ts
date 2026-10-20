import {LocalSecretVault} from "./security/local-secret-vault.js";
import {runtimeHealth,runtimeStatus} from "./runtime.js";
import {providerDoctor} from "./doctor.js";
import {runReadinessGate} from "./readiness.js";
const command=process.argv[2]??"status";
async function runSecrets(){
 const action=process.argv[3],name=process.argv[4];
 const vault=new LocalSecretVault();
 if(action==="list"){console.log(JSON.stringify({names:vault.names()},null,2));return;}
 if(action==="delete"){if(!name)throw new Error("secret name required");console.log(JSON.stringify({deleted:vault.delete(name),name}));return;}
 if(action==="set"){if(!name)throw new Error("secret name required");const chunks:string[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.isBuffer(chunk)?chunk.toString("utf8"):String(chunk));const value=chunks.join("").trim();if(!value)throw new Error("secret value must be provided on stdin");vault.set(name,value);console.log(JSON.stringify({saved:true,name}));return;}
 throw new Error("Usage: layanx secrets <set NAME|list|delete NAME>. Set reads the secret from stdin and never echoes it.");
}
if(command==="secrets"){try{await runSecrets();}catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}}
else if(command==="status"){console.log(JSON.stringify(runtimeStatus(),null,2));}
else if(command==="check"){const status=runtimeStatus();console.log(JSON.stringify(status,null,2));process.exitCode=status.ready?0:1;}
else if(command==="health"){const health=await runtimeHealth();console.log(JSON.stringify(health,null,2));process.exitCode=health.ready&&health.healthy?0:1;}
else if(command==="doctor"){
 // `doctor --providers` keeps the original provider-only output; plain `doctor` inspects the whole machine.
 if(process.argv.includes("--providers")){const doctor=await providerDoctor();console.log(JSON.stringify(doctor,null,2));process.exitCode=doctor.ok?0:1;}
 else{
  const {systemDoctor,redactReport}=await import("./system-doctor.js");
  const report=redactReport(await systemDoctor());
  const outIndex=process.argv.indexOf("--out"),out=outIndex>0?process.argv[outIndex+1]:undefined;
  if(out){const {writeFile}=await import("node:fs/promises");await writeFile(out,JSON.stringify(report,null,2),"utf8");}
  if(process.argv.includes("--json"))console.log(JSON.stringify(report,null,2));
  else{
   const mark={pass:"[ OK ]",warn:"[WARN]",fail:"[FAIL]"} as const;
   console.log(`LayanX System Doctor  ${report.generatedAt}`);
   console.log(`${report.system.platform} ${report.system.release} | Node ${report.system.node} | ${report.system.cpus} CPU threads | ${(report.system.totalMemoryBytes/1024**3).toFixed(1)} GiB RAM`);
   for(const check of report.checks){console.log(`${mark[check.status]} ${check.id}: ${check.detail}`);if(check.hint&&check.status!=="pass")console.log(`        -> ${check.hint}`);}
   if(report.ollamaModels.length)console.log("Installed Ollama models: "+report.ollamaModels.map(m=>m.name+(m.sizeBytes?` (${(m.sizeBytes/1024**3).toFixed(1)} GiB)`:"")).join(", "));
   console.log(`\nResult: ${report.ok?"READY":"NOT READY"}  pass=${report.summary.pass} warn=${report.summary.warn} fail=${report.summary.fail}`+(report.summary.blockingFailures.length?`  blocking: ${report.summary.blockingFailures.join(", ")}`:""));
   if(out)console.log(`Redacted report written to ${out}`);
  }
  process.exitCode=report.ok?0:1;
 }
}
else if(command==="hooks"){
 // layanx hooks [status|install|uninstall] [claude|codex|all]: Claude Code / Codex permission requests through LayanX (phone + fingerprint).
 const {installAgentHooks,uninstallAgentHooks,agentHooksStatus}=await import("./local/agent-hooks.js");
 const {resolveDataPaths}=await import("./platform/paths.js");const {loadSettings}=await import("./local/settings.js");
 const paths=resolveDataPaths();const port=Number(process.env.LAYANX_PUBLIC_PORT)||loadSettings(paths.settingsFile).publicPort;
 const action=process.argv[3]??"status",which=process.argv[4];
 const agents=which==="claude"||which==="codex"?[which as "claude"|"codex"]:which==="all"?["claude","codex"] as Array<"claude"|"codex">:undefined;
 const result=action==="install"?installAgentHooks({dataDir:paths.dataDir,port,agents}):action==="uninstall"?uninstallAgentHooks({dataDir:paths.dataDir,agents}):agentHooksStatus({dataDir:paths.dataDir});
 console.log(JSON.stringify(result,null,2));process.exitCode=(result as Array<{error?:string}>).some(r=>r.error)?1:0;
}
else if(command==="skills"){
 // Local skill package management. Install never executes anything; approve/enable are explicit owner steps.
 const [{SkillRegistry},{SkillInstaller},{defaultDataDir},{join}]=await Promise.all([import("./skills/registry.js"),import("./skills/installer.js"),import("./platform/paths.js"),import("node:path")]);
 const installer=new SkillInstaller(new SkillRegistry(),{root:process.env.LAYANX_SKILLS_DIR?.trim()||join(defaultDataDir(),"skills")});
 installer.hydrate();
 const [sub,arg]=[process.argv[3],process.argv[4]];
 const need=(label:string)=>{if(!arg)throw new Error(`Usage: layanx skills ${sub} <${label}>`);return arg;};
 try{
  let out:unknown;
  if(!sub||sub==="list")out=installer.list().map(r=>({id:r.manifest.id,version:r.manifest.version,status:r.manifest.status,permissions:r.manifest.permissions,tools:r.manifest.tools,networkHosts:r.manifest.networkHosts,findings:r.findings.map(f=>f.code)}));
  else if(sub==="inspect"){const i=installer.inspect(need("folder"));out={manifest:i.manifest,safe:i.safe,findings:i.findings};}
  else if(sub==="install")out=installer.install(need("folder"));
  else if(sub==="approve")out=installer.approve(need("id"));
  else if(sub==="enable")out=installer.enable(need("id"));
  else if(sub==="disable")out=installer.disable(need("id"));
  else if(sub==="uninstall"){installer.uninstall(need("id"));out={removed:arg};}
  else if(sub==="verify")out=installer.list().map(r=>({id:r.manifest.id,intact:installer.verifyStored(r.manifest.id)}));
  else throw new Error("Usage: layanx skills <list|inspect <folder>|install <folder>|approve <id>|enable <id>|disable <id>|uninstall <id>|verify>");
  console.log(JSON.stringify(out,null,2));
 }catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
else if(command==="ready"){const gate=await runReadinessGate();console.log(JSON.stringify(gate,null,2));process.exitCode=gate.ready?0:1;}
else{console.error("Usage: layanx <status|check|health|doctor [--json] [--out file] [--providers]|skills ...|ready>");process.exitCode=1;}
