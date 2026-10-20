import {createHash} from "node:crypto";
import type {SkillManifest} from "./registry.js";
export interface ScanFinding{severity:"info"|"low"|"medium"|"high"|"critical";code:string;message:string;}
export interface ScanResult{safe:boolean;findings:ScanFinding[];}

/** SHA-256 hex of skill content. Manifests may store it bare or as "sha256:<hex>". */
export function skillChecksum(content:string):string{return createHash("sha256").update(content,"utf8").digest("hex");}
export function normalizeChecksum(value:string):string{return value.trim().toLowerCase().replace(/^sha256:/,"");}

/**
 * Instruction patterns that must never ship inside a skill. Skill text is untrusted data, so these
 * are blocking findings, not hints. Shared by learned skills and installed skill packages.
 */
const CONTENT_RULES:Array<{code:string;pattern:RegExp;message:string}>=[
 {code:"PROMPT_INJECTION",pattern:/ignore (all|previous|prior) instructions|disregard (the )?(system|previous) (prompt|instructions)/,message:"Skill text tries to override system instructions."},
 {code:"EXFILTRATION",pattern:/send .*token|send .*password|exfiltrat|upload .*(\.env|secret|credential)/,message:"Skill text asks to send secrets or credentials."},
 {code:"DESTRUCTIVE_COMMAND",pattern:/rm -rf|format c:|remove-item\s+.*-recurse.*-force\s+[a-z]:\\|del \/s \/q [a-z]:\\|reg delete hk(lm|ey_local_machine)/,message:"Skill text contains a destructive command."},
 {code:"REMOTE_CODE",pattern:/reverse shell|nc -e|curl .*\|.*sh|wget .*\|.*sh|invoke-expression|\biex\s*\(|powershell(\.exe)?\s+.*-enc(odedcommand)?\b|certutil\s+.*-urlcache/,message:"Skill text downloads or executes remote/obfuscated code."},
 {code:"SECURITY_TAMPERING",pattern:/set-mppreference\s+.*-disable|disable(-| )?(windows )?defender|bcdedit|vssadmin delete/,message:"Skill text disables security controls or deletes backups."}
];
export function scanSkillContent(content:string):ScanFinding[]{
 const lower=content.toLowerCase();
 return CONTENT_RULES.filter(rule=>rule.pattern.test(lower)).map(rule=>({severity:"critical",code:rule.code,message:rule.message}));
}

export class SkillScanner{
 /** Manifest checks; pass `content` to also verify the checksum against it and scan the instructions. */
 scan(skill:SkillManifest,content?:string):ScanResult{
  const findings:ScanFinding[]=[];
  if(!skill.checksum)findings.push({severity:"critical",code:"MISSING_CHECKSUM",message:"Skill has no integrity checksum."});
  if(!skill.license)findings.push({severity:"medium",code:"UNKNOWN_LICENSE",message:"Skill license is unknown."});
  if(skill.permissions.includes("L5_CRITICAL"))findings.push({severity:"high",code:"CRITICAL_PERMISSION",message:"Skill requests critical permission."});
  if(skill.networkHosts.includes("*"))findings.push({severity:"high",code:"OPEN_NETWORK",message:"Skill requests unrestricted network access."});
  if(content!==undefined){
   if(skill.checksum&&normalizeChecksum(skill.checksum)!==skillChecksum(content))findings.push({severity:"critical",code:"CHECKSUM_MISMATCH",message:"Skill content does not match its SHA-256 checksum."});
   findings.push(...scanSkillContent(content));
  }
  return{safe:!findings.some(f=>f.severity==="high"||f.severity==="critical"),findings};
 }
}
