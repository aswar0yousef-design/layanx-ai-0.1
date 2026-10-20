/**
 * Outbound network guard shared by the read-only web tools (browser.read, http.read).
 *
 * Blocks requests that could reach this machine, the LAN, or cloud metadata services:
 * loopback, "this host" (0.0.0.0/8), RFC1918, CGNAT (100.64/10), link-local (incl. 169.254.169.254),
 * multicast/reserved space, IPv6 loopback/ULA/link-local, and IPv4-mapped/compatible IPv6 forms.
 *
 * Hostnames are resolved before the request and EVERY returned address must be public.
 * `pinnedFetch` (the default transport of the guarded tools) checks the answers again inside the socket's
 * own DNS lookup, so the connection can only go to an address that passed the check: a DNS-rebinding
 * server cannot swap in 127.0.0.1 between the check and the connect. Redirects are never followed by it.
 */
import {lookup} from "node:dns/promises";
import {lookup as socketLookup,type LookupAddress,type LookupAllOptions,type LookupOneOptions} from "node:dns";
import {request as httpRequest,type IncomingMessage} from "node:http";
import {request as httpsRequest} from "node:https";
import {Readable} from "node:stream";
import {isIP} from "node:net";

export type HostResolver=(hostname:string)=>Promise<string[]>;

export const defaultHostResolver:HostResolver=async hostname=>
 (await lookup(hostname,{all:true,verbatim:true})).map(entry=>entry.address);

function ipv4Octets(address:string):number[]|undefined{
 const parts=address.split(".");
 if(parts.length!==4)return undefined;
 const octets=parts.map(part=>/^\d{1,3}$/.test(part)?Number(part):NaN);
 return octets.every(value=>Number.isInteger(value)&&value>=0&&value<=255)?octets:undefined;
}

function isBlockedIpv4(address:string):boolean{
 const octets=ipv4Octets(address);
 if(!octets)return true;
 const [a,b]=octets as [number,number,number,number];
 if(a===0||a===10||a===127)return true;            // this-host, private, loopback
 if(a===100&&b>=64&&b<=127)return true;            // CGNAT / Tailscale
 if(a===169&&b===254)return true;                  // link-local + cloud metadata
 if(a===172&&b>=16&&b<=31)return true;             // private
 if(a===192&&b===168)return true;                  // private
 if(a===192&&b===0)return true;                    // IETF protocol assignments / 192.0.2 docs
 if(a===198&&(b===18||b===19))return true;         // benchmarking
 if(a===198&&b===51)return true;                   // TEST-NET-2
 if(a===203&&b===0)return true;                    // TEST-NET-3
 if(a>=224)return true;                            // multicast, reserved, broadcast
 return false;
}

function expandIpv6(address:string):number[]|undefined{
 let value=address.toLowerCase();
 const zone=value.indexOf("%");if(zone>=0)value=value.slice(0,zone);
 let tail:number[]=[];
 const lastColon=value.lastIndexOf(":");
 const maybeV4=value.slice(lastColon+1);
 if(maybeV4.includes(".")){
  const octets=ipv4Octets(maybeV4);if(!octets)return undefined;
  tail=[(octets[0]!<<8)|octets[1]!,(octets[2]!<<8)|octets[3]!];
  value=value.slice(0,lastColon+1)+"0:0";
 }
 const halves=value.split("::");
 if(halves.length>2)return undefined;
 const parse=(segment:string)=>segment?segment.split(":").map(part=>/^[0-9a-f]{1,4}$/.test(part)?parseInt(part,16):NaN):[];
 const head=parse(halves[0]??""),rest=halves.length===2?parse(halves[1]??""):[];
 const missing=8-head.length-rest.length;
 if(halves.length===1&&missing!==0)return undefined;
 if(missing<0)return undefined;
 const groups=[...head,...Array<number>(halves.length===2?missing:0).fill(0),...rest];
 if(groups.length!==8||groups.some(group=>!Number.isInteger(group)))return undefined;
 if(tail.length){groups[6]=tail[0]!;groups[7]=tail[1]!;}
 return groups;
}

function isBlockedIpv6(address:string):boolean{
 const groups=expandIpv6(address);
 if(!groups)return true;
 const allZeroUntil=(n:number)=>groups.slice(0,n).every(group=>group===0);
 if(allZeroUntil(7)&&(groups[7]===0||groups[7]===1))return true;                      // :: and ::1
 const embedded=`${groups[6]!>>8}.${groups[6]!&255}.${groups[7]!>>8}.${groups[7]!&255}`;
 if(allZeroUntil(5)&&groups[5]===0xffff)return isBlockedIpv4(embedded);              // ::ffff:a.b.c.d
 if(allZeroUntil(6))return isBlockedIpv4(embedded);                                  // ::a.b.c.d (deprecated)
 if(groups[0]===0x64&&groups[1]===0xff9b)return isBlockedIpv4(embedded);             // NAT64
 const first=groups[0]!;
 if((first&0xfe00)===0xfc00)return true;                                             // fc00::/7 ULA
 if((first&0xffc0)===0xfe80)return true;                                             // fe80::/10 link-local
 if((first&0xff00)===0xff00)return true;                                             // multicast
 if(first===0x2001&&groups[1]===0x0db8)return true;                                  // documentation
 if(first===0x2002)return true;                                                      // 6to4 can embed private v4
 return false;
}

/** True when the literal IP address must not be contacted by an outbound read tool. */
export function isBlockedAddress(address:string):boolean{
 const bare=address.startsWith("[")&&address.endsWith("]")?address.slice(1,-1):address;
 const family=isIP(bare.split("%")[0]??"");
 if(family===4)return isBlockedIpv4(bare);
 if(family===6)return isBlockedIpv6(bare);
 return true;
}

function isLocalName(host:string):boolean{
 return host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||host.endsWith(".home.arpa")||!host.includes(".");
}

/**
 * Throws when the URL targets a non-public destination. When a resolver is supplied the hostname
 * is resolved and every address is checked; pass `undefined` only for injected test transports.
 */
export async function assertPublicHttpUrl(url:URL,resolver:HostResolver|undefined):Promise<void>{
 if(url.protocol!=="http:"&&url.protocol!=="https:")throw new Error("Only HTTP and HTTPS URLs are allowed.");
 if(url.username||url.password)throw new Error("URLs cannot contain credentials.");
 const raw=url.hostname.toLowerCase().replace(/\.$/,"");
 const host=raw.startsWith("[")&&raw.endsWith("]")?raw.slice(1,-1):raw;
 if(!host)throw new Error("URL host is required.");
 if(isIP(host)){
  if(isBlockedAddress(host))throw new Error("Private or local network targets are blocked.");
  return;
 }
 if(isLocalName(host))throw new Error("Private or local network targets are blocked.");
 if(!resolver)return;
 let addresses:string[];
 try{addresses=await resolver(host);}catch{throw new Error("Host could not be resolved.");}
 if(!addresses.length)throw new Error("Host could not be resolved.");
 if(addresses.some(isBlockedAddress))throw new Error("Host resolves to a private or local network address and is blocked.");
}

type LookupCallback=(error:NodeJS.ErrnoException|null,address:string|LookupAddress[],family?:number)=>void;
export type SocketLookup=(hostname:string,options:LookupAllOptions,callback:(error:NodeJS.ErrnoException|null,addresses:LookupAddress[])=>void)=>void;

/**
 * fetch-compatible transport for untrusted URLs. Differences from global fetch, on purpose:
 * - every address the socket would connect to is checked with `isBlockedAddress` (DNS pinning);
 * - redirects are never followed: `redirect:"error"` throws on 3xx, `"manual"` returns the 3xx response,
 *   `"follow"` is refused (callers must re-check each hop themselves);
 * - no proxy, no cookies, no credentials in URLs.
 */
export function createPinnedFetch(options:{lookup?:SocketLookup;isBlocked?:(address:string)=>boolean}={}):typeof fetch{
 const resolveAll:SocketLookup=options.lookup??((hostname,lookupOptions,callback)=>socketLookup(hostname,lookupOptions,callback));
 const blocked=options.isBlocked??isBlockedAddress;
 const guardedLookup=(hostname:string,lookupOptions:LookupOneOptions|LookupAllOptions,callback:LookupCallback)=>{
  resolveAll(hostname,{...lookupOptions,all:true},(error,addresses)=>{
   if(error){callback(error,"");return;}
   const list=addresses??[];
   if(!list.length){callback(Object.assign(new Error("Host could not be resolved."),{code:"ENOTFOUND"}),"");return;}
   if(list.some(entry=>blocked(entry.address))){callback(Object.assign(new Error("Host resolves to a private or local network address and is blocked."),{code:"EBLOCKED"}),"");return;}
   if((lookupOptions as LookupAllOptions).all)callback(null,list);
   else callback(null,list[0]!.address,list[0]!.family);
  });
 };
 const pinned=async(input:string|URL|Request,init:RequestInit={}):Promise<Response>=>{
  if(typeof Request!=="undefined"&&input instanceof Request)throw new Error("pinnedFetch accepts a URL, not a Request object.");
  const url=new URL(String(input));
  if(url.protocol!=="http:"&&url.protocol!=="https:")throw new Error("Only HTTP and HTTPS URLs are allowed.");
  const host=url.hostname.startsWith("[")?url.hostname.slice(1,-1):url.hostname;
  if(isIP(host)&&blocked(host))throw new Error("Private or local network targets are blocked.");
  if(init.redirect==="follow")throw new Error("pinnedFetch does not follow redirects; re-check each hop.");
  const headers:Record<string,string>={};
  new Headers(init.headers).forEach((value,key)=>{headers[key]=value;});
  const body=typeof init.body==="string"||init.body instanceof Uint8Array?init.body:undefined;
  if(init.body!=null&&body===undefined)throw new Error("pinnedFetch supports string or Uint8Array bodies only.");
  const send=url.protocol==="https:"?httpsRequest:httpRequest;
  const response=await new Promise<IncomingMessage>((resolveResponse,reject)=>{
   const req=send(url,{method:init.method??"GET",headers,lookup:guardedLookup as never,signal:init.signal??undefined,agent:false},resolveResponse);
   req.on("error",reject);
   if(body!==undefined)req.write(body);
   req.end();
  });
  const status=response.statusCode??0;
  if(status>=300&&status<400&&response.headers.location&&(init.redirect??"error")==="error"){response.resume();throw new TypeError("Redirects are not allowed.");}
  const outHeaders=new Headers();
  for(const [key,value] of Object.entries(response.headers)){if(value===undefined)continue;for(const item of Array.isArray(value)?value:[value])outHeaders.append(key,item);}
  const empty=init.method==="HEAD"||status===204||status===304;
  if(empty)response.resume();
  return new Response(empty?null:Readable.toWeb(response) as ReadableStream<Uint8Array>,{status,statusText:response.statusMessage,headers:outHeaders});
 };
 return pinned as typeof fetch;
}

/** Default transport for untrusted URLs (browser.read, http.read, media.inspect). */
export const pinnedFetch:typeof fetch=createPinnedFetch();
