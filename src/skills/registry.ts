import type {PermissionLevel} from "../core/types.js";

export type SkillStatus="discovered"|"quarantined"|"testing"|"approved"|"enabled"|"disabled"|"rejected";
export interface SkillManifest{id:string;name:string;version:string;description:string;source:string;license?:string;permissions:PermissionLevel[];tools:string[];networkHosts:string[];checksum:string;status:SkillStatus;}
export class SkillRegistry{
 private readonly skills=new Map<string,SkillManifest>();
 register(skill:SkillManifest){if(this.skills.has(skill.id))throw new Error("Skill already registered.");if(skill.status==="enabled")throw new Error("New skills cannot be enabled before review.");this.skills.set(skill.id,{...skill,status:"quarantined"});}
 approve(id:string){const s=this.get(id);this.skills.set(id,{...s,status:"approved"});}
 enable(id:string){const s=this.get(id);if(s.status!=="approved")throw new Error("Skill must be approved before enablement.");this.skills.set(id,{...s,status:"enabled"});}
 disable(id:string){const s=this.get(id);this.skills.set(id,{...s,status:"disabled"});}
 get(id:string){const s=this.skills.get(id);if(!s)throw new Error("Unknown skill: "+id);return s;}
 list(){return[...this.skills.values()];}
 has(id:string){return this.skills.has(id);}
 /** Removes a skill (uninstall or before re-registering an updated version). */
 remove(id:string){if(!this.skills.delete(id))throw new Error("Unknown skill: "+id);}
 /**
  * Restores a skill whose integrity was re-verified from durable storage. Only the installer calls this;
  * it keeps a previously reviewed approved/enabled status instead of forcing a new quarantine.
  */
 restoreVerified(skill:SkillManifest){if(this.skills.has(skill.id))throw new Error("Skill already registered.");this.skills.set(skill.id,{...skill});}
}
