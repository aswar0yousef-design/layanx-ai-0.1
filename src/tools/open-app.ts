/**
 * "Open Chrome", «افتح واتساب», «شغّل الحاسبة», "open youtube.com": what to open on this computer.
 * Shared by the desktop.app.open tool (what it runs), the planner (an "open X" request is planned without
 * the model) and the voice assistant (it does not ask the model what "open X" means).
 *
 * Nothing here runs a command line: a known program is one of a fixed list the Windows helper maps to its
 * own command; anything else is looked up by name among the Start menu's installed apps; a web page must
 * be an http(s) address.
 */
export type KnownApp="chrome"|"msedge"|"firefox"|"explorer"|"notepad"|"calc"|"settings"|"paint"|"taskmgr";
export const KNOWN_APPS:Record<KnownApp,{label:string;names:string[];browser?:boolean}>={
  chrome:{label:"Google Chrome",browser:true,names:["chrome","google chrome","كروم","جوجل كروم","قوقل كروم","غوغل كروم","متصفح كروم","متصفح جوجل كروم"]},
  msedge:{label:"Microsoft Edge",browser:true,names:["edge","microsoft edge","ms edge","ايدج","ادج","مايكروسوفت ايدج","متصفح ايدج"]},
  firefox:{label:"Firefox",browser:true,names:["firefox","فايرفوكس","فاير فوكس","متصفح فايرفوكس"]},
  explorer:{label:"File Explorer",names:["explorer","file explorer","files","مستكشف الملفات","مستكشف","الملفات","ملفاتي"]},
  notepad:{label:"Notepad",names:["notepad","المفكره","مفكره","النوتباد","نوتباد"]},
  calc:{label:"Calculator",names:["calculator","calc","الحاسبه","حاسبه","الاله الحاسبه"]},
  settings:{label:"Settings",names:["settings","windows settings","الاعدادات","اعدادات","اعدادات ويندوز"]},
  paint:{label:"Paint",names:["paint","mspaint","الرسام","رسام"]},
  taskmgr:{label:"Task Manager",names:["task manager","taskmgr","مدير المهام","اداره المهام"]}
};
/** Arabic (and common) names of programs found by their Start menu name. */
const START_MENU_NAMES:Record<string,string>={
  "واتساب":"WhatsApp","واتس اب":"WhatsApp","الواتساب":"WhatsApp","whatsapp":"WhatsApp",
  "وورد":"Word","ورد":"Word","word":"Word","اكسل":"Excel","excel":"Excel","باوربوينت":"PowerPoint","بوربوينت":"PowerPoint","powerpoint":"PowerPoint",
  "اوتلوك":"Outlook","outlook":"Outlook","تيمز":"Teams","teams":"Teams","تيليجرام":"Telegram","تلجرام":"Telegram","تليجرام":"Telegram","telegram":"Telegram",
  "سبوتيفاي":"Spotify","spotify":"Spotify","ديسكورد":"Discord","discord":"Discord","زووم":"Zoom","zoom":"Zoom","سكايب":"Skype","skype":"Skype",
  "ميتاتريدر":"MetaTrader","ميتا تريدر":"MetaTrader","ميتاتريدر 5":"MetaTrader 5","mt5":"MetaTrader 5","metatrader":"MetaTrader","metatrader 5":"MetaTrader 5",
  "في اس كود":"Visual Studio Code","فيجوال ستوديو كود":"Visual Studio Code","vs code":"Visual Studio Code","vscode":"Visual Studio Code","visual studio code":"Visual Studio Code",
  "فوتوشوب":"Photoshop","photoshop":"Photoshop","ستيم":"Steam","steam":"Steam","فيديو":"Media Player","مشغل الوسائط":"Media Player","الصور":"Photos","photos":"Photos",
  "الكاميرا":"Camera","camera":"Camera","المتجر":"Microsoft Store","متجر مايكروسوفت":"Microsoft Store","microsoft store":"Microsoft Store",
  "ollama":"Ollama","اولاما":"Ollama","obs":"OBS Studio","او بي اس":"OBS Studio","anydesk":"AnyDesk","اني ديسك":"AnyDesk"
};
const norm=(s:string)=>s.toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g,"").replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه")
  .replace(/[«»"'“”.,،!؟?:;()]/g," ").replace(/\s+/g," ").trim();
const KNOWN_BY_NAME=new Map<string,KnownApp>(Object.entries(KNOWN_APPS).flatMap(([k,v])=>[...v.names,v.label].map(n=>[norm(n),k as KnownApp] as [string,KnownApp])));
const START_BY_NAME=new Map(Object.entries(START_MENU_NAMES).map(([k,v])=>[norm(k),v]));
const APP_NAME=/^[\p{L}\p{N} .+&_-]{1,60}$/u;

export type OpenTarget={kind:"known";app:KnownApp;label:string}|{kind:"start";name:string;label:string}|{kind:"url";url:string;browser?:KnownApp;label:string};

/** A web address the owner said ("youtube.com", "https://…"), as an https URL; null when it is not one. */
export function webAddress(text:string):string|null{
  const t=text.trim().replace(/[.،,]+$/,"");
  const withScheme=/^https?:\/\//i.test(t)?t:/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(t)?"https://"+t:null;
  if(!withScheme||/\s|["'<>`]/.test(withScheme)||withScheme.length>2048)return null;
  try{const u=new URL(withScheme);return u.protocol==="https:"||u.protocol==="http:"?u.toString():null;}catch{return null;}
}
/** What desktop.app.open will open for a payload {app?, url?} (a known program, a Start-menu name, or a web page). */
export function resolveOpenTarget(payload:{app?:unknown;url?:unknown}):OpenTarget{
  const appText=typeof payload.app==="string"?payload.app.trim():"";
  const urlText=typeof payload.url==="string"?payload.url.trim():"";
  const known=appText?KNOWN_BY_NAME.get(norm(appText)):undefined;
  if(urlText){
    const url=webAddress(urlText);if(!url)throw new Error("url must be an http(s) web address.");
    if(appText&&!(known&&KNOWN_APPS[known].browser))throw new Error("A web page opens in a browser: Chrome, Edge or Firefox.");
    return{kind:"url",url,...(known?{browser:known}:{}),label:url};
  }
  if(!appText)throw new Error("Say which program to open (payload.app) or which web page (payload.url).");
  if(known)return{kind:"known",app:known,label:KNOWN_APPS[known].label};
  const url=webAddress(appText);if(url)return{kind:"url",url,label:url};
  const mapped=START_BY_NAME.get(norm(appText));
  const name=mapped??appText.replace(/^(?:برنامج|تطبيق|app|program)\s+/i,"").trim();
  if(!APP_NAME.test(name))throw new Error("The program name may contain letters, numbers, spaces and . + & _ - only.");
  return{kind:"start",name,label:name};
}

const OPEN_VERB=/^(?:(?:يا\s+)?(?:ليان|جارفيس)[\s،,]+)?(?:لو سمحت\s+)?(?:افتح|إفتح|أفتح|شغل|شغّل|افتحلي|افتح لي|شغل لي|open|launch|start|run)\s+(?:لي\s+)?(?:برنامج|تطبيق|موقع|the\s+app|the\s+program|app|program)?\s*(.+)$/iu;
/**
 * A short "open X" request whose X is certainly something to open: a known program, a Start-menu
 * name LayanX knows, or a web address. Anything else ("open the report file") goes to the planner.
 */
export type OpenRequest={app?:string;url?:string;play?:string;label:string;windowTitle?:string};
export function openRequest(text:string):OpenRequest|null{
  return singleOpenRequest(text)??compoundOpenRequest(text);
}
function singleOpenRequest(text:string):OpenRequest|null{
  const t=text.trim();
  if(!t||t.length>90||t.includes("\n"))return null;
  const m=t.match(OPEN_VERB);if(!m)return null;
  let target=m[1]!.trim().replace(/[.،,!؟?]+$/,"").replace(/^the\s+/i,"");
  // «افتح المتصفح» / "open the browser": the default browser, on a search page.
  if(/^(?:المتصفح|متصفح|browser|web browser|الانترنت|الإنترنت)$/i.test(target))return{url:"https://www.google.com/",label:"https://www.google.com/"};
  // «متصفح جوجل كروم» / "the Chrome browser" is the browser itself.
  const bare=target.replace(/^(?:متصفح|browser)\s+/i,"").replace(/\s+(?:browser|متصفح)$/i,"");
  if(bare!==target&&KNOWN_BY_NAME.has(norm(bare)))target=bare;
  const known=KNOWN_BY_NAME.get(norm(target));
  if(known)return{app:target,label:KNOWN_APPS[known].label};
  const url=webAddress(target);if(url)return{url,label:url};
  const onBrowser=target.match(/^(.+?)\s+(?:في|على|ب|in|on|with)\s+(.+)$/i);
  if(onBrowser){const b=KNOWN_BY_NAME.get(norm(onBrowser[2]!));const u=webAddress(onBrowser[1]!);if(b&&KNOWN_APPS[b].browser&&u)return{app:onBrowser[2]!.trim(),url:u,label:u};}
  const mapped=START_BY_NAME.get(norm(target));
  if(mapped)return{app:mapped,label:mapped};
  return null;
}

/** Well-known sites by the names people say («يوتيوب», "gmail"). Only fixed https addresses. */
const SITES={
  youtube:{url:"https://www.youtube.com/",title:"YouTube"},google:{url:"https://www.google.com/",title:"Google"},
  gmail:{url:"https://mail.google.com/",title:"Gmail"},maps:{url:"https://www.google.com/maps",title:"Google Maps"},
  facebook:{url:"https://www.facebook.com/",title:"Facebook"},instagram:{url:"https://www.instagram.com/",title:"Instagram"},
  tiktok:{url:"https://www.tiktok.com/",title:"TikTok"},x:{url:"https://x.com/",title:"X"},
  whatsappweb:{url:"https://web.whatsapp.com/",title:"WhatsApp"},github:{url:"https://github.com/",title:"GitHub"},
  chatgpt:{url:"https://chatgpt.com/",title:"ChatGPT"}
} satisfies Record<string,{url:string;title:string}>;
const SITE_NAMES:Record<string,keyof typeof SITES>={
  "يوتيوب":"youtube","اليوتيوب":"youtube","يوتوب":"youtube","اليوتوب":"youtube","youtube":"youtube","موقع يوتيوب":"youtube",
  "جوجل":"google","قوقل":"google","غوغل":"google","google":"google","بحث جوجل":"google",
  "جيميل":"gmail","الجيميل":"gmail","gmail":"gmail","بريدي":"gmail",
  "خرائط جوجل":"maps","خرائط قوقل":"maps","الخرائط":"maps","google maps":"maps",
  "فيسبوك":"facebook","الفيسبوك":"facebook","فيس بوك":"facebook","facebook":"facebook",
  "انستقرام":"instagram","انستغرام":"instagram","الانستقرام":"instagram","انستا":"instagram","instagram":"instagram",
  "تيك توك":"tiktok","تيكتوك":"tiktok","tiktok":"tiktok","تويتر":"x","twitter":"x",
  "واتساب ويب":"whatsappweb","whatsapp web":"whatsappweb","جيت هب":"github","github":"github","شات جي بي تي":"chatgpt","chatgpt":"chatgpt"
};
const SITE_BY_NAME=new Map(Object.entries(SITE_NAMES).map(([k,v])=>[norm(k),v]));
const VERB_OPEN=/^(?:افتح|إفتح|أفتح|افتحلي|ادخل(?:\s+على)?|روح(?:\s+على|\s+ل)?|open|go to|launch|start|run)$/iu;
const VERB_PLAY=/^(?:شغل|شغّل|شغلي|play|اعرض)$/iu;
const MEDIA_WORDS=/(?:سوره|القران|قران|تلاوه|اغنيه|اغاني|نشيد|اناشيد|فيديو|مقطع|بودكاست|موسيقى|محاضره|خطبه|\bsong\b|\bmusic\b|\bvideo\b|\bpodcast\b|\bsurah\b|\bquran\b)/u;
const VERB_SEARCH=/^(?:ابحث|إبحث|دور|دوّر|دورلي|search)$/iu;
/**
 * «افتح كروم وافتح يوتيوب وشغّل سورة الكهف», "open chrome and search for gold prices": a short chain of
 * open / play / search steps that ends in ONE thing to open — a browser on a page. Planned without the
 * model (the model used to turn these into research or coding missions). Anything not understood in
 * full (two different programs, a file, an unknown verb) returns null and goes to the planner.
 */
function compoundOpenRequest(text:string):OpenRequest|null{
  const t=text.trim().replace(/^(?:(?:يا\s+)?(?:ليان|جارفيس)[\s،,]+)?(?:لو سمحت|من فضلك|please)\s*/iu,"");
  if(!t||t.length>240||t.includes("\n"))return null;
  // Split on «و/ثم» before a verb, commas, "and/then".
  const clauses=t.split(/\s*[،,;؛]\s*|\s+(?:ثم|بعدين|بعدها|and then|then|and)\s+|\s+و(?=\s*(?:افتح|إفتح|أفتح|ادخل|روح|شغل|شغّل|ابحث|إبحث|دور|دوّر|اعرض|ثم|تأكد|تاكد|تحقق))/iu)
    .map(c=>c.trim().replace(/^و\s*/u,"").replace(/^(?:ثم|بعدين)\s+/u,"").replace(/[.!؟?]+$/u,"").trim()).filter(Boolean)
    // "…and make sure it worked": the window check that follows the opening covers it.
    .filter(c=>!/^(?:تأكد|تاكد|تحقق|verify|confirm|check|make sure)(?:\s|$)/iu.test(c));
  if(clauses.length<1||clauses.length>4)return null;
  let anyBrowser=false;let browser:string|undefined;let site:keyof typeof SITES|undefined;let play:string|undefined;let search:string|undefined;let page:string|undefined;
  const onSite=(object:string)=>{ // "… على يوتيوب" / "… in youtube"
    const m=object.match(/^(.+?)\s+(?:على|في|من|ب|on|in|from)\s+(?:موقع\s+)?(\S+(?:\s+\S+)?)$/iu);
    if(m){const key=SITE_BY_NAME.get(norm(m[2]!));if(key){site=key;return m[1]!.trim();}}
    return object;
  };
  for(const clause of clauses){
    const m=clause.match(/^(\S+)(?:\s+(?:لي|لنا))?\s+(?:عن\s+|على\s+|for\s+)?([\s\S]+)$/u);
    if(!m)return null;
    const verb=m[1]!;let object=m[2]!.trim();
    // «افتح المتصفح» / "open the browser": the default browser.
    if(VERB_OPEN.test(verb)&&/^(?:ال)?متصفح$|^(?:the\s+|web\s+)?browser$|^(?:ال)?[اإ]نترنت$/iu.test(object)){anyBrowser=true;continue;}
    object=object.replace(/^(?:برنامج|تطبيق|موقع|متصفح|the\s+)\s*/iu,"").trim();
    // «ابحث في يوتيوب عن X» / "search youtube for X"
    const inSite=object.match(/^(?:في|على|on|in)?\s*(?:موقع\s+)?(\S+(?:\s+\S+)?)\s+(?:عن|for)\s+(.+)$/iu);
    if(inSite&&VERB_SEARCH.test(verb)){const key=SITE_BY_NAME.get(norm(inSite[1]!));if(key){site=key;object=inSite[2]!.trim();}}
    if(!object)return null;
    const known=KNOWN_BY_NAME.get(norm(object));
    const siteKey=SITE_BY_NAME.get(norm(object));
    const address=webAddress(object);
    if(VERB_OPEN.test(verb)||(VERB_PLAY.test(verb)&&(known||siteKey))){
      if(known){if(!KNOWN_APPS[known].browser)return null;if(browser&&norm(browser)!==norm(object))return null;browser=object;continue;}
      if(siteKey){site=siteKey;continue;}
      if(address){page=address;continue;}
      return null;
    }
    if(VERB_PLAY.test(verb)){object=onSite(object);if(object.length<2||object.length>150)return null;play=object;continue;}
    if(VERB_SEARCH.test(verb)){object=onSite(object);if(object.length<2||object.length>150)return null;search=object;continue;}
    return null;
  }
  // Exactly one destination: a played video, a search, a page or a site — or just the browser.
  if([play,search,page].filter(Boolean).length>1)return null;
  if(!browser&&!anyBrowser&&!site&&!play&&!search&&!page)return null;
  // «شغّل الاختبارات» is a development task and «ابحث عن أسعار الذهب» a research question: neither may turn into a web
  // page. "Play" goes to YouTube only with a named site/browser or a clear media word; "search" opens a
  // results page only when the owner also asked for a browser or a site.
  const opened=Boolean(browser||anyBrowser||site||page);
  if(play&&!opened&&!MEDIA_WORDS.test(norm(play)))return null;
  if(search&&!opened)return null;
  const browserApp=browser?KNOWN_BY_NAME.get(norm(browser)):undefined;
  const browserTitle=browserApp?KNOWN_APPS[browserApp].label:undefined;
  let url:string;let label:string;let windowTitle:string|undefined;
  if(play){url="https://www.youtube.com/results?search_query="+encodeURIComponent(play);label="YouTube: "+play;windowTitle="YouTube";}
  else if(search){
    const yt=site==="youtube";
    url=yt?"https://www.youtube.com/results?search_query="+encodeURIComponent(search):"https://www.google.com/search?q="+encodeURIComponent(search);
    label=(yt?"YouTube: ":"Google: ")+search;windowTitle=yt?"YouTube":"Google";
  }else if(page){url=page;label=page;windowTitle=browserTitle;}
  else if(site){url=SITES[site].url;label=SITES[site].title;windowTitle=SITES[site].title;}
  else if(browser)return{app:browser,label:browserTitle!,windowTitle:browserTitle};
  else{url=SITES.google.url;label=SITES.google.title;windowTitle=SITES.google.title;}
  return{...(browser?{app:browser}:{}),url,...(play?{play}:{}),label,...(windowTitle?{windowTitle}:{})};
}

/** First video id on a YouTube results page (the page embeds them as "videoId":"<11 chars>"). */
export function firstYouTubeVideoId(html:string):string|null{
  const m=html.match(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/)??html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
  return m?m[1]!:null;
}
