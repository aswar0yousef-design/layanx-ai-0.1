/**
 * Outbound network guard shared by the read-only web tools (browser.read, http.read).
 *
 * Blocks requests that could reach this machine, the LAN, or cloud metadata services:
 * loopback, "this host" (0.0.0.0/8), RFC1918, CGNAT (100.64/10), link-local (incl. 169.254.169.254),
 * multicast/reserved space, IPv6 loopback/ULA/link-local, and IPv4-mapped/compatible IPv6 forms.
 *
 * Hostnames are resolved before the request and EVERY returned address must be public.
 * Residual risk (documented in docs/SECURITY.md): the HTTP client resolves again when connecting,
 * so a DNS-rebinding server can still race this check. Redirects stay disabled by the callers.
 */
import {lookup} from "node:dns/promises";
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
