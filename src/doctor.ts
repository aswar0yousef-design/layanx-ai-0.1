import {loadProviderConfig,providerSummary} from "./config/providers.js";
import {createOpenAIProvider} from "./providers/openai-provider.js";
import {createAnthropicProvider} from "./providers/anthropic-provider.js";
import {createGeminiProvider} from "./providers/gemini-provider.js";

export interface ProviderDoctorResult{
  provider:string;
  configured:boolean;
  reachable:boolean;
  model?:string;
  modelAvailable?:boolean;
  reason?:string;
}

/**
 * fetch with a hard deadline. Uses a referenced timer (AbortSignal.timeout is unref'd), so a server that
 * accepts the connection but never answers still ends in a TimeoutError instead of a silent hang.
 */
export async function fetchWithDeadline(fetcher:typeof fetch,url:string,init:RequestInit,timeoutMs:number):Promise<Response>{
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{const error=new Error("Request timed out after "+timeoutMs+"ms.");error.name="TimeoutError";controller.abort(error);reject(error);},timeoutMs);});
 try{return await Promise.race([fetcher(url,{...init,signal:controller.signal}),deadline]);}
 finally{clearTimeout(timer);}
}

function ollamaTagsUrl(baseUrl:string){return baseUrl.replace(/\/$/,"")+"/api/tags";}

async function cloudHealth(
  provider:"openai"|"anthropic"|"gemini",
  config:ReturnType<typeof loadProviderConfig>,
  fetcher:typeof fetch,
  timeoutMs:number
):Promise<ProviderDoctorResult>{
  if(provider==="openai"){
    if(!config.openai.enabled)return{provider,configured:false,reachable:false,model:config.openai.model,reason:"OpenAI is disabled."};
    if(!config.openai.apiKey)return{provider,configured:false,reachable:false,model:config.openai.model,reason:"OpenAI API key is not configured."};
    const health=await createOpenAIProvider({
      apiKey:config.openai.apiKey,
      baseUrl:config.openai.baseUrl,
      healthUrl:config.openai.healthUrl,
      fetcher,
      timeoutMs
    }).health();
    return{provider,configured:true,reachable:health.available,model:config.openai.model,reason:health.reason};
  }
  if(provider==="anthropic"){
    if(!config.anthropic.enabled)return{provider,configured:false,reachable:false,model:config.anthropic.model,reason:"Anthropic is disabled."};
    if(!config.anthropic.apiKey)return{provider,configured:false,reachable:false,model:config.anthropic.model,reason:"Anthropic API key is not configured."};
    const health=await createAnthropicProvider({
      apiKey:config.anthropic.apiKey,
      baseUrl:config.anthropic.baseUrl,
      healthUrl:config.anthropic.healthUrl,
      fetcher,
      timeoutMs
    }).health();
    return{provider,configured:true,reachable:health.available,model:config.anthropic.model,reason:health.reason};
  }
  if(!config.gemini.enabled)return{provider,configured:false,reachable:false,model:config.gemini.model,reason:"Gemini is disabled."};
  if(!config.gemini.apiKey)return{provider,configured:false,reachable:false,model:config.gemini.model,reason:"Gemini API key is not configured."};
  const health=await createGeminiProvider({
    apiKey:config.gemini.apiKey,
    baseUrl:config.gemini.baseUrl,
    healthUrl:config.gemini.healthUrl,
    fetcher,
    timeoutMs
  }).health();
  return{provider,configured:true,reachable:health.available,model:config.gemini.model,reason:health.reason};
}

/** Live provider checks. Every request is bounded by timeoutMs so a hung server cannot stall the doctor. */
export async function providerDoctor(fetcher:typeof fetch=fetch,options:{timeoutMs?:number;env?:NodeJS.ProcessEnv}={}):Promise<{ok:boolean;providers:ProviderDoctorResult[]}>{
 const config=loadProviderConfig(options.env??process.env);
 const timeoutMs=options.timeoutMs??5000;
 const results:ProviderDoctorResult[]=[];

 if(config.ollama.enabled&&(config.mode==="local"||config.mode==="hybrid")){
  try{
   const response=await fetchWithDeadline(fetcher,ollamaTagsUrl(config.ollama.baseUrl),{method:"GET"},timeoutMs);
   if(!response.ok)throw new Error("Ollama returned HTTP "+response.status);
   const body=await response.json() as {models?:Array<{name?:string}>};
   const names=(body.models??[]).map(model=>model.name).filter((name):name is string=>Boolean(name));
   const modelAvailable=names.includes(config.ollama.model)||names.some(name=>name.startsWith(config.ollama.model+":"));
   results.push({
    provider:"ollama",configured:true,reachable:true,model:config.ollama.model,modelAvailable,
    reason:modelAvailable?undefined:"Configured model is not installed."
   });
  }catch(error){
   results.push({
    provider:"ollama",configured:true,reachable:false,model:config.ollama.model,modelAvailable:false,
    reason:error instanceof Error&&(error.name==="TimeoutError"||error.name==="AbortError")?"Ollama request timed out after "+timeoutMs+"ms.":error instanceof Error?error.message:"Ollama is unreachable."
   });
  }
 }

 if(config.mode==="cloud"||config.mode==="hybrid"){
  for(const provider of ["openai","anthropic","gemini"] as const){
   results.push(await cloudHealth(provider,config,fetcher,timeoutMs));
  }
 }

 return{
  ok:results.length>0&&results.every(result=>result.reachable&&(result.modelAvailable??true)),
  providers:results
 };
}

export function doctorSummary(){return providerSummary();}
