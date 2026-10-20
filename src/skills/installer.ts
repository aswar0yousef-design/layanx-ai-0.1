/**
 * Skill package installer.
 *
 * A skill package is a folder with:
 *   skill.json  — manifest (id, name, version, description, source, license, permissions, tools, networkHosts, checksum)
 *   SKILL.md    — the instructions (max 256 KiB). `checksum` is SHA-256 of this file ("sha256:<hex>" or bare hex).
 *
 * install(): validates the manifest, verifies the checksum against the real content, scans manifest + text,
 * detects duplicates, copies the package into the LayanX skills store and registers it as "quarantined".
 * Nothing is executed during install. approve()/enable()/disable() are explicit and persisted.
 * hydrate(): on startup every stored skill is re-hashed; a tampered skill is marked "rejected" and never enabled.
 */
import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync,lstatSync,renameSync} from "node:fs";
import {join,resolve} from "node:path";
import type {PermissionLevel} from "../core/types.js";
import type {SkillManifest,SkillStatus} from "./registry.js";
import {SkillRegistry} from "./registry.js";
import {SkillScanner,skillChecksum,normalizeChecksum,type ScanFinding} from "./scanner.js";
import {isPathInside} from "../platform/path-guard.js";

const MAX_CONTENT_BYTES=256*1024;
const MAX_MANIFEST_BYTES=32*1024;
const PERMISSIONS:PermissionLevel[]=["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE","L5_CRITICAL"];
const ID_PATTERN=/^[a-z0-9][a-z0-9._-]{1,63}$/;
const SEMVER=/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export interface InstalledSkillRecord{manifest:SkillManifest;installedAt:string;updatedAt:string;previousVersion?:string;findings:ScanFinding[]}
export interface SkillInspection{manifest:SkillManifest;content:string;safe:boolean;findings:ScanFinding[]}

export function compareSemver(a:string,b:string):number{
 const x=SEMVER.exec(a),y=SEMVER.exec(b);
 if(!x||!y)throw new Error("Invalid semantic version.");
 for(let i=1;i<=3;i++){const d=Number(x[i])-Number(y[i]);if(d)return Math.sign(d);}
 if(x[4]===y[4])return 0;
 if(!x[4])return 1;if(!y[4])return -1;
 return x[4]<y[4]?-1:1;
}

function readBounded(path:string,max:number,label:string):string{
 let info;
 try{info=lstatSync(path);}catch{throw new Error(`${label} is missing.`);}
 if(info.isSymbolicLink())throw new Error(`${label} must not be a symbolic link.`);
 if(!info.isFile())throw new Error(`${label} is not a regular file.`);
 if(info.size>max)throw new Error(`${label} is larger than ${Math.round(max/1024)} KiB.`);
 return readFileSync(path,"utf8");
}

function stringArray(value:unknown,label:string,max=64):string[]{
 if(value===undefined)return[];
 if(!Array.isArray(value)||value.length>max||value.some(item=>typeof item!=="string"||!item.trim()||item.length>200))throw new Error(`Manifest ${label} must be an array of strings.`);
 return [...new Set(value.map(item=>item.trim()))];
}

export function parseSkillManifest(raw:unknown):SkillManifest{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("skill.json must contain a JSON object.");
 const m=raw as Record<string,unknown>;
 const text=(key:string,max:number,required=true)=>{const value=m[key];if(value===undefined&&!required)return undefined;if(typeof value!=="string"||!value.trim()||value.length>max)throw new Error(`Manifest ${key} is required (max ${max} characters).`);return value.trim();};
 const id=text("id",64)!;
 if(!ID_PATTERN.test(id))throw new Error("Manifest id must be lowercase letters, digits, '.', '_' or '-' (2-64 characters).");
 const version=text("version",64)!;
 if(!SEMVER.test(version))throw new Error("Manifest version must be semantic (for example 1.0.0).");
 const permissions=stringArray(m.permissions,"permissions",5);
 if(!permissions.length)throw new Error("Manifest permissions must list at least one permission level.");
 if(permissions.some(level=>!PERMISSIONS.includes(level as PermissionLevel)))throw new Error("Manifest permissions contain an unknown level.");
 const checksum=text("checksum",80)!;
 if(!/^[0-9a-f]{64}$/.test(normalizeChecksum(checksum)))throw new Error("Manifest checksum must be a SHA-256 hex digest.");
 return{
  id,name:text("name",120)!,version,description:text("description",1000)!,source:text("source",500)!,license:text("license",100,false),
  permissions:permissions as PermissionLevel[],tools:stringArray(m.tools,"tools"),networkHosts:stringArray(m.networkHosts,"networkHosts"),
  checksum:normalizeChecksum(checksum),status:"quarantined"
 };
}

export class SkillInstaller{
 private readonly root:string;
 private records=new Map<string,InstalledSkillRecord>();
 constructor(private readonly registry:SkillRegistry,options:{root:string},private readonly scanner=new SkillScanner()){this.root=resolve(options.root);}

 private indexFile(){return join(this.root,"installed.json");}
 private skillDir(id:string,version:string){
  const dir=resolve(this.root,id,version);
  if(!isPathInside(this.root,dir))throw new Error("Skill path escapes the skills store.");
  return dir;
 }
 private save(){
  mkdirSync(this.root,{recursive:true});
  const tmp=this.indexFile()+".tmp";
  writeFileSync(tmp,JSON.stringify([...this.records.values()],null,2)+"\n","utf8");
  renameSync(tmp,this.indexFile());
 }

 inspect(packageDir:string):SkillInspection{
  const dir=resolve(packageDir);
  const manifest=parseSkillManifest(JSON.parse(readBounded(join(dir,"skill.json"),MAX_MANIFEST_BYTES,"skill.json")));
  const content=readBounded(join(dir,"SKILL.md"),MAX_CONTENT_BYTES,"SKILL.md");
  const scan=this.scanner.scan(manifest,content);
  const findings=[...scan.findings];
  for(const record of this.records.values()){
   if(record.manifest.id!==manifest.id&&record.manifest.checksum===manifest.checksum)
    findings.push({severity:"medium",code:"DUPLICATE_CONTENT",message:`Same content is already installed as "${record.manifest.id}".`});
  }
  return{manifest,content,safe:scan.safe,findings};
 }

 install(packageDir:string):{skill:SkillManifest;action:"installed"|"updated"|"unchanged";findings:ScanFinding[]}{
  const inspection=this.inspect(packageDir);
  if(!inspection.safe)throw new Error("Skill rejected by security scan: "+inspection.findings.filter(f=>f.severity==="high"||f.severity==="critical").map(f=>f.code).join(", "));
  const {manifest,content}=inspection;
  const existing=this.records.get(manifest.id);
  let action:"installed"|"updated"="installed";
  if(existing){
   const order=compareSemver(manifest.version,existing.manifest.version);
   if(order===0&&existing.manifest.checksum===manifest.checksum)return{skill:this.registry.get(manifest.id),action:"unchanged",findings:inspection.findings};
   if(order<=0)throw new Error(`Skill ${manifest.id} ${existing.manifest.version} is installed; an update needs a higher version (got ${manifest.version}).`);
   action="updated";
  }
  const dir=this.skillDir(manifest.id,manifest.version);
  mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,"SKILL.md"),content,"utf8");
  writeFileSync(join(dir,"skill.json"),JSON.stringify({...manifest,status:undefined},null,2)+"\n","utf8");
  if(this.registry.has(manifest.id))this.registry.remove(manifest.id);
  this.registry.register(manifest); // always quarantined: an update must be reviewed again
  const now=new Date().toISOString();
  this.records.set(manifest.id,{manifest:{...manifest,status:"quarantined"},installedAt:existing?.installedAt??now,updatedAt:now,previousVersion:existing?.manifest.version,findings:inspection.findings});
  this.save();
  return{skill:this.registry.get(manifest.id),action,findings:inspection.findings};
 }

 private setStatus(id:string,status:SkillStatus){const record=this.require(id);record.manifest={...record.manifest,status};record.updatedAt=new Date().toISOString();this.save();}
 approve(id:string){this.require(id);this.verifyStored(id,true);this.registry.approve(id);this.setStatus(id,"approved");return this.registry.get(id);}
 enable(id:string){this.require(id);this.verifyStored(id,true);this.registry.enable(id);this.setStatus(id,"enabled");return this.registry.get(id);}
 disable(id:string){this.require(id);this.registry.disable(id);this.setStatus(id,"disabled");return this.registry.get(id);}
 uninstall(id:string){
  const record=this.require(id);
  const dir=resolve(this.root,record.manifest.id);
  if(!isPathInside(this.root,dir)||dir===this.root)throw new Error("Skill path escapes the skills store.");
  rmSync(dir,{recursive:true,force:true});
  if(this.registry.has(id))this.registry.remove(id);
  this.records.delete(id);this.save();
 }
 list(){return [...this.records.values()].map(record=>structuredClone(record));}
 content(id:string){const record=this.require(id);return readBounded(join(this.skillDir(id,record.manifest.version),"SKILL.md"),MAX_CONTENT_BYTES,"SKILL.md");}

 /** Re-hash stored content. Returns false (and marks the skill rejected) when it was modified on disk. */
 verifyStored(id:string,throwOnFailure=false):boolean{
  const record=this.require(id);
  let ok=false;
  try{ok=skillChecksum(this.content(id))===record.manifest.checksum;}catch{ok=false;}
  if(!ok){
   record.manifest={...record.manifest,status:"rejected"};
   record.findings=[...record.findings.filter(f=>f.code!=="STORED_CONTENT_MODIFIED"),{severity:"critical",code:"STORED_CONTENT_MODIFIED",message:"Installed skill content changed after installation."}];
   this.save();
   if(this.registry.has(id)){const current=this.registry.get(id);this.registry.remove(id);this.registry.restoreVerified({...current,status:"rejected"});}
   if(throwOnFailure)throw new Error("Installed skill integrity check failed: "+id);
  }
  return ok;
 }

 /** Load the store and re-verify every skill before it reaches the registry. */
 hydrate(){
  this.records.clear();
  if(!existsSync(this.indexFile()))return{loaded:0,rejected:0};
  let saved:InstalledSkillRecord[]=[];
  try{const parsed=JSON.parse(readFileSync(this.indexFile(),"utf8"));if(Array.isArray(parsed))saved=parsed as InstalledSkillRecord[];}catch{return{loaded:0,rejected:0};}
  let rejected=0;
  for(const record of saved){
   if(!record?.manifest||!ID_PATTERN.test(record.manifest.id))continue;
   this.records.set(record.manifest.id,record);
   if(this.registry.has(record.manifest.id))continue;
   const ok=this.verifyStored(record.manifest.id);
   if(!ok)rejected++;
   const status=ok?record.manifest.status:"rejected";
   this.registry.restoreVerified({...record.manifest,status});
  }
  return{loaded:this.records.size,rejected};
 }

 private require(id:string){const record=this.records.get(id);if(!record)throw new Error("Unknown installed skill: "+id);return record;}
}
