// Automatically maintained Discord status boards. Feed metadata is informational.
const EXECUTOR_CHANNEL = "1563812726118023228";
const EXECUTOR_FEED = "https://www.executors.online/api/executors";
function executorText(value, max = 180) {
 return String(value ?? "Unknown").replace(/[@*_`~<>\[\]\\]/g, "").slice(0, max);
}
function executorLink(value) {
 try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href.replace(/[()]/g, c => encodeURIComponent(c)) : null; } catch { return null; }
}
function executorNormalize(data) {
 if (!Array.isArray(data) || !data.length || data.length > 200) throw Error("Invalid executor feed");
 const rows = data.filter(x => x && typeof x.title === "string" && typeof x.platform === "string").map(x => ({
  title: executorText(x.title, 80), platform: executorText(x.platform === "Mac" ? "macOS" : x.platform, 40),
  version: executorText(x.version, 70), updatedDate: executorText(x.updatedDate, 90), rbxVersion: executorHash(x.rbxversion),
  updated: typeof x.updateStatus === "boolean" ? x.updateStatus : null,
  detected: typeof x.detected === "boolean" ? x.detected : null,
  unknown: x.unknown === true, possibleBanwave: x.possibleBanwave === true,
  reason: x.detectionReason ? executorText(x.detectionReason, 160) : null,
  website: executorLink(x.websitelink), discord: executorLink(x.discordlink),
  logo: executorLink(x.slug?.logo),
  kind: typeof x.extype === "string" ? (x.extype.endsWith("external") ? "External" : x.extype.endsWith("executor") ? "Internal" : null) : null,
  unc: typeof x.uncPercentage === "number" && x.uncPercentage >= 0 && x.uncPercentage <= 100 ? x.uncPercentage : null,
  sunc: typeof x.suncPercentage === "number" && x.suncPercentage >= 0 && x.suncPercentage <= 100 ? x.suncPercentage : null,
  price: x.free === true ? "Free" : executorText(x.cost || "Not listed", 70)
 }));
 if (!rows.length || rows.length !== data.length) throw Error("Incomplete executor feed");
 return rows.sort((a,b) => a.platform.localeCompare(b.platform) || a.title.localeCompare(b.title));
}
function executorReleaseTime(value) {
 const m = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4}) at (\d{1,2}):(\d{2}) (AM|PM) UTC$/);
 if (!m) return null;
 const hour = Number(m[4]) % 12 + (m[6] === "PM" ? 12 : 0);
 const ms = Date.UTC(Number(m[3]), Number(m[1])-1, Number(m[2]), hour, Number(m[5]));
 return Number.isFinite(ms) ? Math.floor(ms/1000) : null;
}
// Each tracker family counts once. Roblox client metadata checks builds, not detection.
const EXECUTOR_SOURCES = [
 {id:"weao",label:"WEAO",url:"https://weao.xyz/api/status/exploits",kind:"weao",group:"weao"},
 {id:"mirror",label:"Executors.Online",url:"https://www.executors.online/api/executors",kind:"weao",group:"weao"},
 {id:"independent",label:"RobloxExecutors",url:"https://www.robloxexecutors.com/api/v1/executors",kind:"independent",group:"independent"},
 {id:"windows",label:"Roblox Windows",url:"https://clientsettings.roblox.com/v2/client-version/WindowsPlayer/channel/LIVE",kind:"roblox",platform:"Windows"},
 {id:"mac",label:"Roblox macOS",url:"https://clientsettings.roblox.com/v2/client-version/MacPlayer/channel/LIVE",kind:"roblox",platform:"macOS"}
];
const executorIdentity = x => x.platform+":"+x.title.toLowerCase().replace(/[^a-z0-9]/g,"");
const executorVersionKey = v => String(v||"").trim().toLowerCase().replace(/^v(?=\d)/,"");
const executorHash = v => typeof v === "string" && /^version-[a-f0-9]{16}$/i.test(v) ? v.toLowerCase() : null;
function executorIndependent(data) {
 if (!data || !Array.isArray(data.executors) || !data.executors.length || data.executors.length>200) throw Error("Invalid independent tracker response");
 const platforms={WINDOWS:"Windows",MAC:"macOS",ANDROID:"Android",IOS:"iOS"};
 const rows=[];
 for(const e of data.executors) {
  if(!e || typeof e.name!=="string" || !Array.isArray(e.platforms))throw Error("Invalid independent executor");
  for(const p of e.platforms) {
   if(!platforms[p.platform] || !["WORKING","UPDATE_PENDING","DOWN","DISCONTINUED"].includes(p.status))throw Error("Unknown independent status");
   rows.push({title:executorText(e.name,80),platform:platforms[p.platform],version:executorText(p.executorVersion,70),
    updated:p.status==="WORKING",status:p.status,rbxVersion:executorHash(p.workingVersion),
    statusChangedAt:Number.isFinite(Date.parse(p.statusChangedAt))?p.statusChangedAt:null,
    website:executorLink(e.website),discord:executorLink(e.discord),logo:executorLink(e.logoUrl),
    price:e.priceModel==="FREE"?"Free":executorText(e.priceText||"Not listed",70),
    kind:e.kind==="INTERNAL"?"Internal":e.kind==="EXTERNAL"?"External":null});
  }
 }
 if(!rows.length || rows.length>400)throw Error("Empty or oversized independent tracker response");
 return rows;
}
async function executorReadJSON(url) {
 const r=await fetch(url,{headers:{Accept:"application/json","User-Agent":"WEAO-3PService"},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error("HTTP "+r.status);
 if(Number(r.headers.get("content-length")||0)>1000000)throw Error("Response too large");
 const reader=r.body.getReader();let size=0;const chunks=[];
 try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000)throw Error("Response too large");chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
async function executorCheckSource(env,source,checkedAt) {
 const prior=await env.DB.prepare("SELECT success_at,snapshot FROM executor_source_state WHERE source_id=?").bind(source.id).first();
 let data=null,error=null,successAt=prior?.success_at||null;
 try {
  const raw=await executorReadJSON(source.url);
  if(source.kind==="weao")data=executorNormalize(raw);
  else if(source.kind==="independent")data=executorIndependent(raw);
  else {const hash=executorHash(raw?.clientVersionUpload);if(!hash)throw Error("Invalid Roblox build response");data={hash,version:executorText(raw.version,70),platform:source.platform};}
  successAt=checkedAt;
 }catch(e){error=String(e).slice(0,200);if(prior?.snapshot){try{data=JSON.parse(prior.snapshot);}catch{data=null;}}console.error("executor source",source.id,error);}
 await env.DB.prepare("INSERT INTO executor_source_state(source_id,checked_at,success_at,snapshot,last_error) VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET checked_at=excluded.checked_at,success_at=excluded.success_at,snapshot=excluded.snapshot,last_error=excluded.last_error").bind(source.id,checkedAt,successAt,data?JSON.stringify(data):null,error).run();
 return {...source,data,error,checkedAt,successAt,fresh:!error&&!!data};
}
function executorCombine(sources,fallback=[]) {
 const byId=new Map(sources.map(s=>[s.id,s]));
 const direct=byId.get("weao"),mirror=byId.get("mirror"),independent=byId.get("independent");
 const primary=[direct,mirror].find(s=>s?.fresh&&Array.isArray(s.data)) || [direct,mirror].filter(s=>Array.isArray(s?.data)).sort((a,b)=>Date.parse(b.successAt)-Date.parse(a.successAt))[0];
 const base=primary?.data || fallback;
 const catalog=new Map(base.map(row=>[executorIdentity(row),{...row}]));
 const lookups=new Map(sources.filter(s=>Array.isArray(s.data)).map(s=>[s.id,new Map(s.data.map(row=>[executorIdentity(row),row]))]));
 for(const r of independent?.data||[])if(!catalog.has(executorIdentity(r)))catalog.set(executorIdentity(r),{...r,updatedDate:"Not published",detected:null,unknown:true,possibleBanwave:false,reason:null,unc:null,sunc:null});
 for(const [key,row] of catalog) {
  const reports=[];
  for(const source of [direct,mirror,independent].filter(Boolean)) {
   const match=lookups.get(source.id)?.get(key);if(match)reports.push({id:source.id,label:source.label,group:source.group,fresh:source.fresh,successAt:source.successAt,...match});
  }
  const current=reports.filter(r=>r.fresh);
  // A mirror is fallback evidence, never a second compatibility vote.
  const families=[...new Map([...current].reverse().map(r=>[r.group,r])).values()];
  const listedVersion=executorVersionKey(row.version);
  const sameRelease=families.filter(r=>listedVersion&&listedVersion!=="unknown"&&executorVersionKey(r.version)===listedVersion);
  const statuses=sameRelease.map(r=>r.updated).filter(v=>typeof v==="boolean");
  const versions=current.filter(r=>r.version&&r.version!=="Unknown").map(r=>executorVersionKey(r.version));
  const updateConflict=new Set(statuses).size>1;
  const versionConflict=new Set(versions).size>1;
  const weaoReports=current.filter(r=>r.group==="weao");
  const detectionVersionConflict=new Set(weaoReports.map(r=>executorVersionKey(r.version)).filter(v=>v&&v!=="unknown")).size>1;
  const detectionConflict=new Set(weaoReports.filter(r=>!r.unknown&&typeof r.detected==="boolean").map(r=>r.detected)).size>1 || detectionVersionConflict;
  const detectionReport=reports.find(r=>r.id==="weao"&&r.fresh)||reports.find(r=>r.id==="mirror"&&r.fresh)||reports.find(r=>r.group==="weao");
  const rb=byId.get(row.platform==="Windows"?"windows":row.platform==="macOS"?"mac":"");
  const hashes=sameRelease.map(r=>r.rbxVersion).filter(Boolean);
  const buildConflict=!!rb?.fresh&&sameRelease.some(r=>r.updated===true&&r.rbxVersion&&r.rbxVersion!==rb.data.hash);
  row.evidence={reports,currentGroups:new Set(current.map(r=>r.group)).size,updateConflict,versionConflict,detectionConflict,buildConflict,
   sameReleaseGroups:sameRelease.length,compatibilitySources:sameRelease.map(r=>r.id==="mirror"?"WEAO via mirror":r.label),
   otherReleaseReports:families.filter(r=>!sameRelease.includes(r)).map(r=>({label:r.id==="mirror"?"WEAO via mirror":r.label,version:r.version})),
   conflict:updateConflict||buildConflict,
   reportedUpdated:statuses.length?statuses.every(v=>v):null,
   detectionFresh:!!detectionReport?.fresh,detectionAt:detectionReport?.successAt||null,
   detectionSource:detectionReport?.id||null,detectionVersion:detectionReport?.version||null,
   detectionReason:detectionReport?.reason||null,detectionBanwave:!!detectionReport?.possibleBanwave,
   savedDetection:detectionReport&&!detectionReport.unknown?detectionReport.detected:null,
   detection:!detectionReport?.fresh||detectionReport.unknown||detectionConflict?null:detectionReport.detected,
   roblox:rb?.fresh&&hashes.length?{hash:rb.data.hash,version:rb.data.version,matches:hashes.every(h=>h===rb.data.hash)}:null};
  row.updated=row.evidence.conflict?null:row.evidence.reportedUpdated;
 }
 return [...catalog.values()].sort((a,b)=>a.platform.localeCompare(b.platform)||a.title.localeCompare(b.title));
}
function executorSourceLine(source) {
 const time=source.fresh?source.checkedAt:source.successAt;
 const stamp=time?" <t:"+Math.floor(Date.parse(time)/1000)+":R>":" · no saved data";
 return (source.fresh?"🟢 ":"🟠 ")+source.label+(source.fresh?" · checked":" · offline, last success")+stamp;
}

function executorBoards(rows,successAt,stale,checkedAt,sources=[]) {
 const trackedCount=rows.length;
 // Show every monitored executor, not only those passing the former undetected-only filter.
 const groups=new Map(),icons={Windows:"🖥️",Android:"📱",iOS:"🍎",macOS:"💻"};
 for(const row of rows){if(!groups.has(row.platform))groups.set(row.platform,[]);groups.get(row.platform).push(row);}
 if(!rows.length)groups.set("Executor status",[]);
 const boards=[];
 for(const [platform,entries] of groups){
  const sorted=[...entries].sort((a,b)=>Number(b.updated===true)-Number(a.updated===true)||a.title.localeCompare(b.title));
  const cards=sorted.map(x=>{
   const ev=x.evidence||{},unknown=ev.detection===null||ev.detection===undefined;
   const detection=ev.detectionConflict?"🟠 Detection reports conflict":unknown?"⚪ Current detection unknown":ev.detection?"🔴 Reported detected":"⚪ No detection currently reported";
   const update=ev.updateConflict?"🟠 STATUS REPORTS DISAGREE":ev.buildConflict?"🟠 REPORTED BUILD MISMATCH":x.updated===true?"🟢 REPORTED WORKING":x.updated===false?"🟠 NOT REPORTED WORKING":"⚪ COMPATIBILITY UNKNOWN";
   const release=executorReleaseTime(x.updatedDate);
   const scores=[Number.isFinite(x.unc)?"UNC **"+x.unc+"%**":null,Number.isFinite(x.sunc)?"sUNC **"+x.sunc+"%**":null].filter(Boolean).join("  ·  ");
   const links=[x.website?"[Official website]("+x.website+")":null,x.discord?"[Discord]("+x.discord+")":null].filter(Boolean).join("  •  ");
   const coverage=ev.sameReleaseGroups>=2?"2 families cover this release":ev.sameReleaseGroups===1?"1 family covers this release":"No live report for this release";
   const checks=[ev.updateConflict?"same-release status conflict":null,ev.buildConflict?"working claim differs from Roblox LIVE build":null].filter(Boolean);
   const reports=ev.reports||[];
   const versionDetails=ev.otherReleaseReports?.length?ev.otherReleaseReports.map(r=>r.label+" lists "+r.version).join(" / "):null;
   const detectionAt=ev.detectionAt?" <t:"+Math.floor(Date.parse(ev.detectionAt)/1000)+":R>":"";
   const description=[
    (x.kind?x.kind+"  ·  ":"")+x.price,"",
    "**"+update+"**  ·  "+detection,
    "Version **"+x.version+"**  ·  "+(release?"Released <t:"+release+":R>":"Release: "+x.updatedDate),scores||null,
    "**Compatibility:** "+coverage+(checks.length?" · ⚠️ "+checks.join(", "):ev.sameReleaseGroups>=2?" · reports agree":""),
    ev.compatibilitySources?.length?"↳ Basis: "+ev.compatibilitySources.join(" + "):null,
    versionDetails?"**Other release:** "+versionDetails+" · separate evidence":null,
    ev.roblox?"**Roblox LIVE:** "+(ev.roblox.matches?"reported build matches":"different build reported"):(["Windows","macOS"].includes(platform)?"**Roblox LIVE:** build check unavailable":null),
    "**Detection report:** "+(ev.detectionSource?(ev.detectionSource==="mirror"?"[WEAO via mirror](https://www.executors.online/executors)":"[WEAO](https://whatexpsare.online/)")+" · "+String(ev.detectionVersion||"Unknown"):"No source coverage"),
    ev.detectionAt?"↳ "+(ev.detectionFresh?"Feed retrieved":"Last retrieval")+detectionAt+(ev.detectionFresh?"":" · ⚠️ stale / offline"):null,
    "**Detection assessed:** time not published by source",
    !ev.detectionFresh&&typeof ev.savedDetection==="boolean"?"↳ Saved report: "+(ev.savedDetection?"reported detected":"no detection reported")+"; current status unknown":null,
    ev.detectionBanwave?"⚠️ "+(ev.detectionFresh?"Source reports possible ban wave":"Saved report mentioned possible ban wave"):null,ev.detectionReason?"Source note"+(ev.detectionFresh?"":" (saved)")+": "+ev.detectionReason:null,"",links||"Official links unavailable"
   ].filter(v=>v!==null).join("\n");
   return {title:x.title,...(x.website?{url:x.website}:{}),description,color:!ev.currentGroups?0x747F8D:ev.conflict||ev.detectionConflict?0xF0B232:ev.detection===true?0xED4245:x.updated===false?0xF0B232:0x9B72CF,...(x.logo?{thumbnail:{url:x.logo}}:{})};
  });
  const health=sources.map(executorSourceLine).join("\n");
  const headerText=(stale?"⚠️ **Primary tracker unavailable · saved data may be stale**\n":"")+"**"+entries.length+" executors listed**  ·  **"+trackedCount+" monitored**  ·  Every 5 min\n\n"+(entries.length?"":"**No executor data currently available from the trackers.**\n\n")+"The complete monitored catalog is shown, including reported working, detected, outdated, uncertain and conflicting entries. These are source reports, not guarantees of safety.\n\n"+health+"\n*Detection: WEAO only; mirror is the same source. Other checks cover compatibility. Retrieval time is not detection assessment time. No report guarantees safety.*";
  const pages=[[]];let pageChars=0;
  const reserve=headerText.length+400;
  for(const card of cards){const chars=card.title.length+card.description.length;if(chars+reserve>5800)throw Error("Executor card exceeds Discord size budget");if(pages.at(-1).length>=7||pageChars+chars+reserve>5800){pages.push([]);pageChars=0;}pages.at(-1).push(card);pageChars+=chars;}
  for(let p=0;p<pages.length;p++){
   const header={author:{name:"SYNDICATE HUB  /  EXECUTOR WATCH"},title:(icons[platform]||"📊")+" "+platform+(pages.length>1?"  •  "+(p+1)+" of "+pages.length:""),description:headerText,color:stale?0xF0B232:0x9B72CF};
   const last=pages[p].at(-1)||header;last.footer={text:"WEAO • Executors.Online • RobloxExecutors • Roblox | Working ≠ undetected • Detection assessment time unavailable"};last.timestamp=checkedAt;
   boards.push({key:platform+":"+p,payload:{allowed_mentions:{parse:[]},embeds:[header,...pages[p]],components:[{type:1,components:[
    {type:2,style:5,label:"WEAO",url:"https://whatexpsare.online/"},
    {type:2,style:5,label:"RobloxExecutors",url:"https://www.robloxexecutors.com/"},
    {type:2,style:5,label:"Mirror",url:"https://www.executors.online/executors"}
   ]}]}});
  }
 }
 return boards;
}

async function executorDiscord(env, path, method, body) {
 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch("https://discord.com/api/v10"+path,{method,headers:{Authorization:"Bot "+env.DISCORD_BOT_TOKEN,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  const data=await r.json().catch(()=>({}));
  if(r.status===429&&attempt<2&&Number(data.retry_after)>0&&Number(data.retry_after)<=15){await new Promise(resolve=>setTimeout(resolve,Math.ceil(Number(data.retry_after)*1000)+100));continue;}
  if(!r.ok&&r.status!==404)throw Error("Executor panel Discord HTTP "+r.status+": "+JSON.stringify(data).slice(0,1000));
  return {status:r.status,data};
 }
 throw Error("Discord retry limit");
}
async function refreshExecutorStatus(env) {
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS executor_feed_state(id INTEGER PRIMARY KEY CHECK(id=1),next_run INTEGER NOT NULL DEFAULT 0,success_at TEXT,snapshot TEXT,last_error TEXT,checked_at TEXT)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS executor_status_messages(panel_key TEXT PRIMARY KEY,message_id TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("INSERT OR IGNORE INTO executor_feed_state(id) VALUES(1)").run();
 const now = Date.now();
 const claim = await env.DB.prepare("UPDATE executor_feed_state SET next_run=? WHERE id=1 AND next_run<=?").bind(now+300000,now).run();
 if (!(claim.meta?.changes > 0)) return;
 const cached = await env.DB.prepare("SELECT * FROM executor_feed_state WHERE id=1").first();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS executor_source_state(source_id TEXT PRIMARY KEY,checked_at TEXT NOT NULL,success_at TEXT,snapshot TEXT,last_error TEXT)").run();
 const checkedAt = new Date().toISOString();
 const results = await Promise.allSettled(EXECUTOR_SOURCES.map(s=>executorCheckSource(env,s,checkedAt)));
 const sources = results.map((r,i)=>r.status==="fulfilled"?r.value:{...EXECUTOR_SOURCES[i],fresh:false,error:"Source check failed",data:null,checkedAt,successAt:null});
 let fallback=[];try{fallback=JSON.parse(cached.snapshot||"[]");}catch{}
 const rows=executorCombine(sources,fallback);
 const primaryLive=sources.some(s=>s.kind==="weao"&&s.fresh);
 const successAt=primaryLive?checkedAt:cached.success_at;
 const error=sources.filter(s=>s.error).map(s=>s.id+": "+s.error).join("; ")||null;
 await env.DB.prepare("UPDATE executor_feed_state SET success_at=?,snapshot=?,last_error=?,checked_at=? WHERE id=1").bind(successAt,JSON.stringify(rows),error,checkedAt).run();
 const boards=executorBoards(rows,successAt,!primaryLive,checkedAt,sources);
 for (const board of boards) {
  const key = EXECUTOR_CHANNEL + ":" + board.key;
  const prior = await env.DB.prepare("SELECT message_id FROM executor_status_messages WHERE panel_key=?").bind(key).first();
  let result;
  if (prior) {
   // Pace old-message edits and honor Discord retry_after before continuing.
   await new Promise(resolve=>setTimeout(resolve,2200));
   result = await executorDiscord(env,"/channels/"+EXECUTOR_CHANNEL+"/messages/"+prior.message_id,"PATCH",board.payload);
  }
  if (!prior || result.status === 404) {
   const digest = await sha(key);
   const nonce = BigInt("0x" + digest.slice(0,18)).toString();
   result = await executorDiscord(env,"/channels/"+EXECUTOR_CHANNEL+"/messages","POST",{...board.payload,nonce,enforce_nonce:true});
   if (result.status === 404 || !result.data.id) throw Error("Executor channel unavailable");
  }
  await env.DB.prepare("INSERT INTO executor_status_messages(panel_key,message_id,updated_at) VALUES(?,?,?) ON CONFLICT(panel_key) DO UPDATE SET message_id=excluded.message_id,updated_at=excluded.updated_at").bind(key,result.data.id || prior.message_id,checkedAt).run();
 }
 // Remove only obsolete messages created and recorded by this feature.
 const old = await env.DB.prepare("SELECT panel_key,message_id FROM executor_status_messages WHERE panel_key LIKE ?").bind(EXECUTOR_CHANNEL+":%").all();
 const active = new Set(boards.map(b=>EXECUTOR_CHANNEL+":"+b.key));
 for(const row of old.results || []) if(!active.has(row.panel_key)) {
  await executorDiscord(env,"/channels/"+EXECUTOR_CHANNEL+"/messages/"+row.message_id,"DELETE");
  await env.DB.prepare("DELETE FROM executor_status_messages WHERE panel_key=?").bind(row.panel_key).run();
 }
}

import { WorkerEntrypoint } from "cloudflare:workers";
const COMMANDS=[
 {name:"getkey",description:"Get your lifetime Syndicate Hub key",options:[{type:3,name:"roblox_id",description:"Your numeric Roblox User ID",required:true}]},
 {name:"online",description:"Show currently active Syndicate Hub users (admins only)",default_member_permissions:"8"},
 {name:"executions",description:"Show recent Syndicate Hub executions (admins only)",default_member_permissions:"8"},
 {name:"keys",description:"List active Syndicate Hub keys (admins only)",default_member_permissions:"8"},
 {name:"panel",description:"Post the permanent key generation panel (admins only)",default_member_permissions:"8"},
 {name:"revoke",description:"Revoke a Roblox User ID's key (admins only)",default_member_permissions:"8",options:[{type:3,name:"roblox_id",description:"Roblox User ID to revoke",required:true}]}
];
// Syndicate Hub Discord interactions Worker. Deploy separately with D1 binding DB,
// KEY_ISSUER service binding, DISCORD_BOT_TOKEN secret and the public key below.
// Do not place tokens in this source or a public repository.
const PUBLIC_KEY = "1eb2b56f7eaa6faf6180f687e9bca30369c0073718fd93247e743c36b5f1707b";
const GUILD_ID = "1563067666170646558";
const PREMIUM_ROLE_ID = "1564481287710974062";
const APPLICATION_ID = "1563150574805983252";
const enc = new TextEncoder();
const hexBytes = s => new Uint8Array(s.match(/../g).map(x=>parseInt(x,16)));
const sha = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s)))].map(x=>x.toString(16).padStart(2,"0")).join("");
const reply = (message,ephemeral=true) => new Response(JSON.stringify({type:4,data:{content:message,flags:ephemeral?64:0,allowed_mentions:{parse:[]}}}),{headers:{"content-type":"application/json"}});
async function validSignature(req,raw) {
 const signature=req.headers.get("X-Signature-Ed25519");
 const timestamp=req.headers.get("X-Signature-Timestamp");
 if(!signature||!timestamp||!/^[a-f0-9]{128}$/i.test(signature)||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
 try {
  const key=await crypto.subtle.importKey("raw",hexBytes(PUBLIC_KEY),{name:"Ed25519"},false,["verify"]);
  return await crypto.subtle.verify("Ed25519",key,hexBytes(signature),enc.encode(timestamp+raw));
 } catch {return false}
}
const isUserId = x => typeof x==="string" && /^[1-9][0-9]{0,19}$/.test(x);
const isAdmin = i => (BigInt(i.member?.permissions||"0") & 8n)!==0n;
// Read roles from each verified Discord interaction, including modal submission.
// No administrator bypass: lifetime generation requires this exact Premium role.
const hasPremiumRole = i => i.guild_id===GUILD_ID && Array.isArray(i.member?.roles)
 && i.member.roles.includes(PREMIUM_ROLE_ID);
const premiumRequired = () => reply("🔒 You need the **Premium** role to generate a lifetime key. You can use the Free Access panel for a 24-hour key.");
async function audit(env,kind,uid) {
 try {await env.DB.prepare("INSERT INTO auth_events(roblox_user_id,event_type,created_at) VALUES(?,?,?)").bind(uid||null,kind,new Date().toISOString()).run()}catch(e){console.error("audit",e)}
}
async function discordLog(env,channel,content) {
 const id=env[channel];if(!id||!env.DISCORD_BOT_TOKEN)return;
 try {await fetch("https://discord.com/api/v10/channels/"+id+"/messages",{method:"POST",headers:{"Authorization":"Bot "+env.DISCORD_BOT_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({content,allowed_mentions:{parse:[]}})})}catch(e){console.error("log",e)}
}
async function resolveRobloxAccount(input){
 const value=String(input||"").trim().replace(/^@/,"");
 if(isUserId(value))return {id:value,name:null};
 if(!/^[A-Za-z0-9_]{3,20}$/.test(value))return null;
 const endpoints=[
  async()=>{const r=await fetch("https://users.roblox.com/v1/usernames/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({usernames:[value],excludeBannedUsers:false}),signal:AbortSignal.timeout(4500)});if(!r.ok)throw Error("username HTTP "+r.status);const d=await r.json();return (d.data||[]).find(x=>x.name?.toLowerCase()===value.toLowerCase()&&isUserId(String(x.id)))},
  async()=>{const r=await fetch("https://users.roblox.com/v1/users/search?keyword="+encodeURIComponent(value)+"&limit=10",{signal:AbortSignal.timeout(4500)});if(!r.ok)throw Error("search HTTP "+r.status);const d=await r.json();return (d.data||[]).find(x=>x.name?.toLowerCase()===value.toLowerCase()&&isUserId(String(x.id)))}
 ];
 const results=await Promise.allSettled(endpoints.map(f=>f()));
 for(const result of results)if(result.status==="fulfilled"&&result.value)return {id:String(result.value.id),name:result.value.name};
 if(results.some(x=>x.status==="fulfilled"))return null;
 console.error("Roblox lookups unavailable",results.map(x=>String(x.reason)));
 throw Error("Roblox lookups unavailable");
}

const b64=x=>btoa(String.fromCharCode(...x)),unb64=x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
async function cipherKey(env){return crypto.subtle.importKey("raw",await crypto.subtle.digest("SHA-256",enc.encode("syndicate-vault:"+env.KEY_PEPPER)),{name:"AES-GCM"},false,["encrypt","decrypt"])}
async function encryptKey(env,key){const iv=crypto.getRandomValues(new Uint8Array(12));return {iv:b64(iv),cipher:b64(new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await cipherKey(env),enc.encode(key))))}}
function keyRemaining(expires){if(!expires)return "♾️ Lifetime access";const ms=Date.parse(expires)-Date.now();if(!Number.isFinite(ms))return "Expiration unavailable";if(ms<=0)return "Expired";const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),sec=Math.floor(ms%60000/1000);return (h? h+"h ":"")+m+"m "+sec+"s remaining";}
async function viewKey(i,env){
 const did=i.member?.user?.id;if(!did)return reply("Discord member information unavailable.");
 const row=await env.DB.prepare("SELECT m.key_hash,m.key_prefix,m.user_id,m.expires_at,v.cipher,v.iv FROM discord_key_issuance d JOIN member_keys m ON d.key_hash=m.key_hash LEFT JOIN discord_key_vault v ON v.key_hash=m.key_hash WHERE d.discord_user_id=? AND d.guild_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) ORDER BY d.issued_at DESC LIMIT 1").bind(did,GUILD_ID,new Date().toISOString()).first();
 if(!row)return hasPremiumRole(i)?modal(i):freeModal();
 
 if(!row.cipher)return reply("🔑 You have an active key for Roblox ID `"+row.user_id+"` (prefix `"+row.key_prefix+"`).\n**Time remaining:** "+keyRemaining(row.expires_at)+"\nThis key predates secure retrieval; your existing key remains unchanged. Please use your original copy or contact an administrator.");
 try{const plain=new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(row.iv)},await cipherKey(env),unb64(row.cipher)));if(await env.KEY_ISSUER.hashKey(plain)!==row.key_hash)throw Error("hash mismatch");return reply("🔑 **Your Existing Syndicate Hub Key**\nRoblox ID: `"+row.user_id+"`\n**Time remaining:** "+keyRemaining(row.expires_at)+(row.expires_at?"\n**Expires:** <t:"+Math.floor(Date.parse(row.expires_at)/1000)+":F>":"")+"\n**Copy:**\n```text\n"+plain+"\n```\n**Mobile — long press:** `"+plain+"`\nKeep it private.");}catch(e){console.error("key vault",e);return reply("Your key is active, but retrieval failed. It has not been changed.");}
}

async function getkey(i,env,overrideId,ctx) {
 if(!hasPremiumRole(i))return premiumRequired();
 const discordId=i.member?.user?.id;
 const input=String(overrideId||i.data?.options?.find(o=>o.name==="roblox_id")?.value||"");
 if(!discordId)return reply("Discord member information was unavailable.");
 let account;
 try{account=await resolveRobloxAccount(input)}catch(e){console.error("Roblox lookup",e);return reply("❌ Roblox username lookup is currently unavailable. Enter your **numeric Roblox User ID** instead (for example, `172474842`). Numeric IDs do not require a Roblox API lookup.")}
 if(!account)return reply("❌ Roblox account not found. Enter the exact **username** (not display name) or your numeric Roblox User ID.");
 const robloxId=account.id;
 const active=await env.DB.prepare("SELECT key_prefix FROM member_keys WHERE user_id=? AND revoked=0 AND (expires_at IS NULL OR expires_at>?) LIMIT 1").bind(robloxId,new Date().toISOString()).first();
 if(active)return reply("❌ An active key already exists for Roblox ID `"+robloxId+"`. Contact an administrator to revoke it before requesting another.");
 const existing=await env.DB.prepare("SELECT 1 FROM discord_key_issuance d JOIN member_keys m ON d.key_hash=m.key_hash WHERE d.discord_user_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(discordId,new Date().toISOString()).first();
 if(existing)return reply("❌ Your Discord account already has an active Syndicate Hub key.");
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 const hex=[...bytes].map(x=>x.toString(16).padStart(2,"0").toUpperCase()).join("");
 const key="SYND-"+hex.match(/.{8}/g).join("-");
 const digest=await env.KEY_ISSUER.hashKey(key);
 const now=new Date().toISOString();
 const secured=await encryptKey(env,key);
 try {
  await env.DB.batch([
   env.DB.prepare("INSERT INTO member_keys(key_hash,key_prefix,user_id,expires_at,revoked,created_at) VALUES(?,?,?,NULL,0,?)").bind(digest,key.slice(0,13),robloxId,now),
   env.DB.prepare("INSERT INTO discord_key_issuance(discord_user_id,guild_id,roblox_user_id,key_hash,issued_at,expires_at) VALUES(?,?,?,?,?,?)").bind(discordId,GUILD_ID,robloxId,digest,now,"LIFETIME"),
   env.DB.prepare("INSERT INTO discord_key_vault(key_hash,cipher,iv,created_at) VALUES(?,?,?,?)").bind(digest,secured.cipher,secured.iv,now)
  ]);
 }catch(e){console.error("issue",e);return reply("❌ Could not generate a key. An active key may already exist. Try again or contact an administrator.")}
 ctx.waitUntil(Promise.allSettled([ensureMemberIdRole(env,discordId,robloxId),audit(env,"key_issued",robloxId),discordLog(env,"KEY_LOG_CHANNEL_ID","🔑 Lifetime key issued • Discord <@"+discordId+"> • Roblox `"+robloxId+"` • Prefix `"+key.slice(0,13)+"`")]));
 return reply("🔑 **Syndicate Hub Lifetime Key**\nRoblox ID: `"+robloxId+"`"+(account.name?"\nUsername: `"+account.name+"`":"")+"\n**Your key (use the copy icon):**\n```text\n"+key+"\n```\n**📱 Mobile — press and hold to copy:**\n`"+key+"`\n**Keep this key private.** It remains valid until revoked.");
}

async function robloxDisplay(uid){
 try{
  const r=await fetch("https://users.roblox.com/v1/users/"+encodeURIComponent(uid));
  if(r.ok){const x=await r.json();return x.name||"Unknown user"}
 }catch(e){console.error("Roblox name lookup",e)}
 return "Username unavailable";
}
async function userLabels(rows,field){
 return Promise.all(rows.map(async x=>({...x,username:await robloxDisplay(String(x[field]))})));
}
async function onlineUsers(env){
 const cutoff=new Date(Date.now()-150000).toISOString();
 const r=await env.DB.prepare("SELECT user_id,MAX(last_seen) AS last_seen,COUNT(*) AS sessions FROM hub_sessions WHERE last_seen>=? GROUP BY user_id ORDER BY last_seen DESC LIMIT 30").bind(cutoff).all();
 const rows=await userLabels(r.results||[],"user_id");
 return reply(rows.length?"🟢 **Active Syndicate Hub users ("+rows.length+")**\n"+rows.map(x=>"• **"+x.username+"** • Roblox ID `"+x.user_id+"` • last seen <t:"+Math.floor(Date.parse(x.last_seen)/1000)+":R>").join("\n"):"No users currently active (last heartbeat within 150 seconds).");
}
async function recentExecutions(env){
 const r=await env.DB.prepare("SELECT roblox_user_id,created_at FROM auth_events WHERE event_type='hub_launch' ORDER BY created_at DESC LIMIT 15").all();
 const rows=await userLabels(r.results||[],"roblox_user_id");
 return reply(rows.length?"📋 **Recent Syndicate Hub executions**\n"+rows.map(x=>"• **"+x.username+"** • Roblox ID `"+x.roblox_user_id+"` • <t:"+Math.floor(Date.parse(x.created_at)/1000)+":R>").join("\n"):"No script executions recorded yet.");
}
async function sendExecutionLogs(env){
 const channel="1563495489662488587";
 if(!env.DISCORD_BOT_TOKEN)throw Error("Discord bot token unavailable");
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS discord_activity_cursor(id INTEGER PRIMARY KEY CHECK(id=1), last_row INTEGER NOT NULL)").run();
 const cursor=await env.DB.prepare("SELECT last_row FROM discord_activity_cursor WHERE id=1").first();
 if(!cursor){const max=await env.DB.prepare("SELECT COALESCE(MAX(id),0) AS n FROM auth_events").first();await env.DB.prepare("INSERT INTO discord_activity_cursor(id,last_row) VALUES(1,?)").bind(max.n).run();return;}
 const events=await env.DB.prepare("SELECT id,roblox_user_id,event_type,created_at FROM auth_events WHERE event_type IN ('hub_launch','hub_notification_test') AND id>? ORDER BY id ASC LIMIT 40").bind(cursor.last_row).all();
 for(const e of events.results||[]){
  let payload;
  if(e.event_type==="hub_notification_test"){
   payload={embeds:[{title:"✅ Execution Notifications Enabled",description:"Successful Syndicate Hub launches will appear here as detailed embeds.",color:2278750,footer:{text:"Syndicate Hub • Execution Logs"},timestamp:e.created_at}]};
  }else{
   const uid=String(e.roblox_user_id||"");
   const member=await env.DB.prepare("SELECT discord_user_id FROM discord_key_issuance WHERE roblox_user_id=? AND guild_id=? ORDER BY issued_at DESC LIMIT 1").bind(uid,GUILD_ID).first().catch(()=>null);
   const key=await env.DB.prepare("SELECT expires_at FROM member_keys WHERE user_id=? AND revoked=0 AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT 1").bind(uid,new Date().toISOString()).first().catch(()=>null);
   const username=await robloxDisplay(uid);
   let avatarUrl=null;
   try{
    const avatarResponse=await fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds="+encodeURIComponent(uid)+"&size=150x150&format=Png&isCircular=false",{signal:AbortSignal.timeout(3500)});
    if(avatarResponse.ok){
     const avatarData=await avatarResponse.json();
     const url=avatarData?.data?.[0]?.imageUrl;
     if(typeof url==="string"&&url.startsWith("https://"))avatarUrl=url;
    }
   }catch(error){console.error("Roblox avatar lookup unavailable",String(error))}

   const fields=[
    {name:"Discord User",value:member?.discord_user_id?"<@"+member.discord_user_id+">":"Not linked",inline:true},
    {name:"Roblox Username",value:String(username).slice(0,100),inline:true},
    {name:"Roblox User ID",value:"["+uid+"](https://www.roblox.com/users/"+uid+"/profile)",inline:true},
    {name:"Key Status",value:key?(key.expires_at?"Active / Verified • Free (24 Hours)":"Active / Verified • Lifetime"):"Verified at launch",inline:true},
    {name:"Game",value:"Storage Hunters",inline:true},
    {name:"Execution Status",value:"Successful",inline:true}
   ];
   payload={embeds:[{title:"✅ Script Executed",description:"A member successfully launched **Syndicate Hub** in Roblox.",color:10233776,fields,thumbnail:avatarUrl?{url:avatarUrl}:undefined,footer:{text:"Syndicate Hub • Execution Logs"},timestamp:e.created_at}]};
  }
  payload.allowed_mentions={parse:[]};
  const r=await fetch("https://discord.com/api/v10/channels/"+channel+"/messages",{method:"POST",headers:{"Authorization":"Bot "+env.DISCORD_BOT_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({...payload,nonce:String(e.id),enforce_nonce:true}),signal:AbortSignal.timeout(10000)});
  const result=await r.json().catch(()=>({}));
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS discord_execution_delivery(id INTEGER PRIMARY KEY CHECK(id=1),event_id INTEGER,status INTEGER,message_id TEXT,error TEXT,checked_at TEXT)").run();
  await env.DB.prepare("INSERT OR REPLACE INTO discord_execution_delivery(id,event_id,status,message_id,error,checked_at) VALUES(1,?,?,?,?,?)").bind(e.id,r.status,r.ok?result.id||null:null,r.ok?null:String(result.message||"Unknown Discord error").slice(0,500),new Date().toISOString()).run();
  if(!r.ok){console.error("execution notification rejected",{status:r.status,eventId:e.id});throw Error("Discord execution notification HTTP "+r.status);}
  await env.DB.prepare("UPDATE discord_activity_cursor SET last_row=? WHERE id=1").bind(e.id).run();
 }
}
async function listKeys(env) {
 const r=await env.DB.prepare("SELECT user_id,created_at,expires_at FROM member_keys WHERE revoked=0 AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT 15").bind(new Date().toISOString()).all();
 const rows=await userLabels(r.results||[],"user_id");
 return reply(rows.length?"🔑 **Active Syndicate Hub members**\n"+rows.map(x=>"• **"+x.username+"** • Roblox ID `"+x.user_id+"` • "+(x.expires_at?keyRemaining(x.expires_at)+" • Expires <t:"+Math.floor(Date.parse(x.expires_at)/1000)+":R>":"Lifetime access")).join("\n"):"No active keys.");
}
async function revoke(i,env) {
 const uid=String(i.data?.options?.find(o=>o.name==="roblox_id")?.value||"");
 if(!isUserId(uid))return reply("Enter a valid Roblox User ID.");
 const r=await env.DB.prepare("UPDATE member_keys SET revoked=1 WHERE user_id=? AND revoked=0").bind(uid).run();
 if(!(r.meta?.changes>0))return reply("No active key found for that Roblox ID.");
 await audit(env,"key_revoked",uid);
 await discordLog(env,"SECURITY_LOG_CHANNEL_ID","🚫 Key revoked • Roblox `"+uid+"` • by Discord <@"+i.member.user.id+">");
 return reply("✅ Revoked active key for Roblox ID `"+uid+"`.");
}
async function revokeOwnKey(i,env,ctx){
 const discordId=i.member?.user?.id;
 if(!discordId)return reply("Discord member information was unavailable.");
 const owned=await env.DB.prepare("SELECT m.key_hash,m.user_id FROM discord_key_issuance d JOIN member_keys m ON d.key_hash=m.key_hash WHERE d.discord_user_id=? AND d.guild_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) ORDER BY d.issued_at DESC LIMIT 1").bind(discordId,GUILD_ID,new Date().toISOString()).first();
 if(!owned)return reply("You don't have an active Syndicate Hub key issued to this Discord account.");
 const result=await env.DB.prepare("UPDATE member_keys SET revoked=1 WHERE key_hash=? AND revoked=0 AND EXISTS (SELECT 1 FROM discord_key_issuance WHERE key_hash=? AND discord_user_id=? AND guild_id=?)").bind(owned.key_hash,owned.key_hash,discordId,GUILD_ID).run();
 if(!(result.meta?.changes>0))return reply("Your key is already revoked or unavailable.");
 ctx.waitUntil(Promise.allSettled([audit(env,"key_self_revoked",owned.user_id),discordLog(env,"SECURITY_LOG_CHANNEL_ID","🚫 Member self-revoked key • Roblox `"+owned.user_id+"` • Discord <@"+discordId+">")]));
 return reply("✅ Your Syndicate Hub key has been revoked. Your running hub will shut down after its next verification check. You can generate a new key using the panel.");
}
function confirmOwnRevoke(){
 return new Response(JSON.stringify({type:4,data:{flags:64,content:"⚠️ **Revoke your Syndicate Hub key?** This will disable your current key and stop the hub at its next verification check. This only affects the key issued to your Discord account.",components:[{type:1,components:[{type:2,style:4,label:"Yes, Revoke My Key",custom_id:"syndicate_confirm_self_revoke"},{type:2,style:2,label:"Cancel",custom_id:"syndicate_cancel_self_revoke"}]}],allowed_mentions:{parse:[]}}}),{headers:{"content-type":"application/json"}});
}
function modal(i){if(!hasPremiumRole(i))return premiumRequired();return new Response(JSON.stringify({type:9,data:{custom_id:"syndicate_key_modal",title:"Generate Syndicate Hub Key",components:[{type:1,components:[{type:4,custom_id:"roblox_id",label:"Roblox Username or User ID",style:1,min_length:1,max_length:20,required:true,placeholder:"Username (not display name) or numeric ID"}]}]}}),{headers:{"content-type":"application/json"}})}
function keyAccessPanelPayload(){
 return {
  embeds:[{
   author:{name:"✦ SHADOW SYNDICATES  •  ELITE ACCESS"},
   title:"👑  THE PREMIUM VAULT",
   description:"**SYNDICATE HUB**  ·  Private Member Access\n\nWelcome to the Inner Circle. Choose your access tier below to unlock your private key.\n\n**━━━━━━━━━━  ✦  ━━━━━━━━━━**",
   color:0xE4B65D,
   fields:[
    {name:"💎  PREMIUM  ·  LIFETIME",value:"<@&1564481287710974062> members\n**♾️ No expiration**",inline:true},
    {name:"⏳  FREE  ·  24 HOURS",value:"Available to everyone\n**One-day access**",inline:true},
    {name:"🔐  YOUR ACCESS, SECURED",value:"One active key per Discord member and Roblox ID. Delivered **privately** — never share it.",inline:false}
   ],
   footer:{text:"SHADOW SYNDICATES  ✦  AUTHORIZED MEMBERS ONLY"}
  }],
  components:[
   {type:1,components:[
    {type:2,style:1,label:"Premium Lifetime",custom_id:"syndicate_generate_key",emoji:{name:"👑"}},
    {type:2,style:2,label:"Free 24-Hour Key",custom_id:"syndicate_free_generate",emoji:{name:"⏳"}}
   ]},
   {type:1,components:[
    {type:2,style:2,label:"View My Key",custom_id:"syndicate_free_view",emoji:{name:"🔑"}},
    {type:2,style:2,label:"Get Script",custom_id:"syndicate_get_script",emoji:{name:"📜"}},
    {type:2,style:4,label:"Revoke Key",custom_id:"syndicate_revoke_own_key",emoji:{name:"🚫"}}
   ]}
  ],
  allowed_mentions:{parse:[]}
 };
}
// Upgrade the existing bot-owned lifetime panel once, without posting duplicates.
async function syncExistingKeyAccessPanel(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS key_access_panel_layout(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,status TEXT NOT NULL,channel_id TEXT,message_id TEXT,checked_at TEXT NOT NULL)").run();
 const revision="premium-vault-minimal-v3";
 const current=await env.DB.prepare("SELECT revision,status,channel_id,message_id FROM key_access_panel_layout WHERE id=1").first();
 if(current?.revision===revision&&current.status==="updated")return;
 const panelId = current?.message_id;
 if(current?.channel_id==="1563145457910153319" && panelId){
  const direct=await discordApi(env,"/channels/"+current.channel_id+"/messages/"+panelId,"PATCH",keyAccessPanelPayload());
  if(direct.status===200){
   await env.DB.prepare("UPDATE key_access_panel_layout SET revision=?,status='updated',checked_at=? WHERE id=1").bind(revision,new Date().toISOString()).run();
   return;
  }
  if(direct.status!==404)throw Error("Premium panel edit failed: "+direct.status);
 }

 const listed=await discordApi(env,"/guilds/"+GUILD_ID+"/channels");
 if(listed.status!==200||!Array.isArray(listed.data))throw Error("Cannot find key panel channels: "+listed.status);
 const channels=listed.data.filter(c=>[0,5].includes(c.type)&&c.id!==FREE_PANEL_CHANNEL);
 channels.sort((a,b)=>Number(/premium|key|access/i.test(b.name||""))-Number(/premium|key|access/i.test(a.name||"")));
 for(const channel of channels.slice(0,25)){
  const response=await discordApi(env,"/channels/"+channel.id+"/messages?limit=100");
  if(response.status===403||response.status===404)continue;
  if(response.status!==200||!Array.isArray(response.data))throw Error("Cannot read key panels: "+response.status);
  const panel=response.data.find(message=>message.author?.id===APPLICATION_ID
   && message.components?.some(row=>row.components?.some(button=>button.custom_id==="syndicate_generate_key")));
  if(!panel)continue;
  const changed=await discordApi(env,"/channels/"+channel.id+"/messages/"+panel.id,"PATCH",keyAccessPanelPayload());
  if(changed.status!==200)throw Error("Cannot update key panel: "+changed.status);
  await env.DB.prepare("INSERT INTO key_access_panel_layout(id,revision,status,channel_id,message_id,checked_at) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status=excluded.status,channel_id=excluded.channel_id,message_id=excluded.message_id,checked_at=excluded.checked_at").bind(revision,"updated",channel.id,panel.id,new Date().toISOString()).run();
  return;
 }
 await env.DB.prepare("INSERT INTO key_access_panel_layout(id,revision,status,checked_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status=excluded.status,checked_at=excluded.checked_at").bind(revision,"not_found",new Date().toISOString()).run();
}
async function postPanel(i,env){
 const channel=i.channel_id;
 if(!channel)return reply("No channel found.");
 const payload=keyAccessPanelPayload();
 const r=await fetch("https://discord.com/api/v10/channels/"+channel+"/messages",{method:"POST",headers:{"Authorization":"Bot "+env.DISCORD_BOT_TOKEN,"Content-Type":"application/json"},body:JSON.stringify(payload)});
 if(!r.ok){console.error("panel",r.status,(await r.text()).slice(0,500));return reply("Could not post panel. Check bot permissions: View Channel, Send Messages, Embed Links.")}
 return reply("✅ Key-generation panel posted in this channel.");
}
const MANAGEMENT="1563207233112907878";
const managementButtons=[{type:1,components:[{type:2,style:1,label:"Active Users",custom_id:"mg_online"},{type:2,style:1,label:"Execution Logs",custom_id:"mg_logs"},{type:2,style:2,label:"Active Keys",custom_id:"mg_keys"}]},{type:1,components:[{type:2,style:4,label:"Revoke Key",custom_id:"mg_revoke"},{type:2,style:2,label:"Refresh",custom_id:"mg_refresh"}]}];
async function managementEmbed(env){
 const since=new Date(Date.now()-150000).toISOString(),now=new Date().toISOString();
 const a=await env.DB.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM hub_sessions WHERE last_seen>=?").bind(since).first();
 const b=await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_events WHERE event_type='hub_launch'").first();
 const c=await env.DB.prepare("SELECT COUNT(*) AS n FROM member_keys WHERE revoked=0 AND (expires_at IS NULL OR expires_at>?)").bind(now).first();
 return {title:"🛡️ SYNDICATE HUB • MANAGEMENT",description:"🟢 **Active users:** "+(a?.n||0)+"\n🚀 **Executions:** "+(b?.n||0)+"\n🔑 **Active keys:** "+(c?.n||0)+"\n\nAdministrator controls below.",color:8073395,footer:{text:"Online means a heartbeat within 150 seconds"},timestamp:now};
}
async function managementPost(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS management_panel(id INTEGER PRIMARY KEY CHECK(id=1),message_id TEXT NOT NULL)").run();
 const row=await env.DB.prepare("SELECT message_id FROM management_panel WHERE id=1").first();
 if(row)return;
 const r=await fetch("https://discord.com/api/v10/channels/"+MANAGEMENT+"/messages",{method:"POST",headers:{"Authorization":"Bot "+env.DISCORD_BOT_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({embeds:[await managementEmbed(env)],components:managementButtons})});
 if(!r.ok)throw Error("Management panel post failed: "+r.status+" "+(await r.text()).slice(0,200));
 const message=await r.json();
 await env.DB.prepare("INSERT OR IGNORE INTO management_panel(id,message_id) VALUES(1,?)").bind(message.id).run();
}
async function managementRefresh(env){
 const row=await env.DB.prepare("SELECT message_id FROM management_panel WHERE id=1").first();
 if(!row)return managementPost(env);
 const r=await fetch("https://discord.com/api/v10/channels/"+MANAGEMENT+"/messages/"+row.message_id,{method:"PATCH",headers:{"Authorization":"Bot "+env.DISCORD_BOT_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({embeds:[await managementEmbed(env)],components:managementButtons})});
 if(r.status===404){await env.DB.prepare("DELETE FROM management_panel WHERE id=1").run();return managementPost(env)}
 if(!r.ok)throw Error("Management refresh "+r.status);
}
async function revokeChoices(env,page=0){
 const now=new Date().toISOString(),offset=page*25;
 const r=await env.DB.prepare("SELECT DISTINCT user_id FROM member_keys WHERE revoked=0 AND (expires_at IS NULL OR expires_at>?) ORDER BY user_id LIMIT 26 OFFSET ?").bind(now,offset).all();
 const all=r.results||[],more=all.length>25,rows=await userLabels(all.slice(0,25),"user_id");
 if(!rows.length)return reply("No active keys to revoke.");
 const options=rows.map(x=>({label:String(x.username).slice(0,80),description:"Roblox ID: "+x.user_id,value:x.user_id}));
 const components=[{type:1,components:[{type:3,custom_id:"mg_select",placeholder:"Select members to revoke (up to 25)",min_values:1,max_values:options.length,options}]}];
 if(page>0||more)components.push({type:1,components:[...(page>0?[{type:2,style:2,label:"Previous",custom_id:"mg_page_"+(page-1)}]:[]),...(more?[{type:2,style:2,label:"Next",custom_id:"mg_page_"+(page+1)}]:[])]});
 return {type:4,data:{flags:64,content:"**Select one or more active members** to revoke. You will be asked to confirm before any keys are changed.",components}};
}
async function revokeSelection(i,env){
 const ids=[...new Set(i.data?.values||[])].filter(isUserId);
 if(!ids.length||ids.length>25)return reply("Invalid selection.");
 const now=new Date().toISOString();
 const placeholders=ids.map(()=>"?").join(",");
 const r=await env.DB.prepare("SELECT DISTINCT user_id FROM member_keys WHERE user_id IN ("+placeholders+") AND revoked=0 AND (expires_at IS NULL OR expires_at>?)").bind(...ids,now).all();
 const valid=(r.results||[]).map(x=>x.user_id);
 if(!valid.length)return reply("These members no longer have active keys.");
 const labels=await userLabels(valid.map(user_id=>({user_id})),"user_id");
 const details=labels.map(x=>"• **"+x.username+"** (`"+x.user_id+"`)").join("\n");
 const components=[{type:1,components:[{type:2,style:4,label:"Confirm Revoke ("+valid.length+")",custom_id:"mg_batch_confirm"},{type:2,style:2,label:"Cancel",custom_id:"mg_cancel"}]}];
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_revoke_pending(discord_id TEXT PRIMARY KEY,selection TEXT NOT NULL,created_at TEXT NOT NULL)").run();
 await env.DB.prepare("INSERT INTO admin_revoke_pending(discord_id,selection,created_at) VALUES(?,?,?) ON CONFLICT(discord_id) DO UPDATE SET selection=excluded.selection,created_at=excluded.created_at").bind(i.member.user.id,JSON.stringify(valid),now).run();
 return {type:4,data:{flags:64,content:"⚠️ **Confirm key revocation for "+valid.length+" member(s):**\n"+details+"\n\nThis will immediately revoke their active keys.",components}};
}
async function confirmBatchRevoke(i,env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_revoke_pending(discord_id TEXT PRIMARY KEY,selection TEXT NOT NULL,created_at TEXT NOT NULL)").run();
 const did=i.member.user.id;
 const pending=await env.DB.prepare("SELECT selection,created_at FROM admin_revoke_pending WHERE discord_id=?").bind(did).first();
 if(!pending||Date.now()-Date.parse(pending.created_at)>600000)return reply("Selection expired. Please choose members again.");
 let ids;try{ids=JSON.parse(pending.selection)}catch{return reply("Invalid selection.")}
 if(!Array.isArray(ids)||!ids.length||ids.length>25||!ids.every(isUserId))return reply("Invalid selection.");
 await env.DB.prepare("DELETE FROM admin_revoke_pending WHERE discord_id=?").bind(did).run();
 const now=new Date().toISOString(),params=ids.map(()=>"?").join(",");
 const result=await env.DB.prepare("UPDATE member_keys SET revoked=1 WHERE user_id IN ("+params+") AND revoked=0 AND (expires_at IS NULL OR expires_at>?)").bind(...ids,now).run();
 for(const id of ids)await audit(env,"key_revoked",id);
 try{await managementRefresh(env)}catch(e){console.error("post-revoke dashboard refresh",e)}
 return reply("✅ Revoked "+(result.meta?.changes||0)+" active key(s) for "+ids.length+" selected member(s).");
}

function discordResponse(value){
 if(value instanceof Response)return value;
 return new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});
}
async function delayedReply(i,env,ctx,work){
 ctx.waitUntil((async()=>{
  let response;
  try{response=await work()}catch(e){console.error("delayed interaction",e);response=reply("Something went wrong. Please try again.")}
  let payload;
  try{payload=response instanceof Response?await response.json():response}catch(e){console.error("delayed parse",e);payload=null}
  const data=payload?.data||{content:"Could not load the requested information."};
  const body={content:data.content||"Processing your request…",components:data.components||[],allowed_mentions:{parse:[]}};
  const url="https://discord.com/api/v10/webhooks/"+APPLICATION_ID+"/"+i.token+"/messages/@original";
  try{
   const r=await fetch(url,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   if(!r.ok)console.error("delayed response",r.status,(await r.text()).slice(0,250));
  }catch(e){console.error("delayed response network",e)}
 })());
 return discordResponse({type:5,data:{flags:64}});
}
async function deferredManagement(i,env,ctx){
 if(!isAdmin(i)||i.channel_id!==MANAGEMENT)return reply("Administrator-only panel.");
 return delayedReply(i,env,ctx,()=>managementAction(i,env));
}
async function managementAction(i,env){
 if(!isAdmin(i)||i.channel_id!==MANAGEMENT)return reply("This panel is for server administrators only.");
 const id=i.data.custom_id;
 if(id==="mg_online")return onlineUsers(env);
 if(id==="mg_logs")return recentExecutions(env);
 if(id==="mg_keys")return listKeys(env);
 if(id==="mg_refresh"){await managementRefresh(env);return reply("Dashboard refreshed.");}
 if(id==="mg_revoke")return revokeChoices(env);
 if(id.startsWith("mg_page_"))return revokeChoices(env,Math.max(0,Math.min(100,Number(id.slice(8))||0)));
 if(id==="mg_select")return revokeSelection(i,env);
 if(id==="mg_batch_confirm")return confirmBatchRevoke(i,env);
 if(id==="mg_cancel"){await env.DB.prepare("DELETE FROM admin_revoke_pending WHERE discord_id=?").bind(i.member.user.id).run();return reply("Cancelled. No keys were changed.");}
 if(id.startsWith("mg_confirm_")){
  const uid=id.slice(11);
  if(!isUserId(uid))return reply("Invalid Roblox ID.");
  const r=await env.DB.prepare("UPDATE member_keys SET revoked=1 WHERE user_id=? AND revoked=0").bind(uid).run();
  if(r.meta?.changes)await audit(env,"key_revoked",uid);
  return reply(r.meta?.changes?"Key revoked for Roblox ID "+uid+".":"No active key found.");
 }
 return reply("Unknown management action.");
}
async function managementModal(i){
 if(!isAdmin(i)||i.channel_id!==MANAGEMENT)return reply("Administrator only.");
 const uid=i.data.components?.flatMap(x=>x.components||[]).find(x=>x.custom_id==="uid")?.value;
 if(!isUserId(uid))return reply("Invalid Roblox ID.");
 return {type:4,data:{flags:64,content:"Revoke all active keys for Roblox ID **"+uid+"**?",components:[{type:1,components:[{type:2,style:4,label:"Confirm Revoke",custom_id:"mg_confirm_"+uid},{type:2,style:2,label:"Cancel",custom_id:"mg_cancel"}]}]}};
}

async function discordApi(env,path,method="GET",body){
 const r=await fetch("https://discord.com/api/v10"+path,{method,headers:{"Authorization":"Bot "+env.DISCORD_BOT_TOKEN,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,data:r.status===204?null:await r.json().catch(()=>null)};
}
async function ensureMemberIdRole(env,discordId,robloxId){
 if(!/^\d{1,20}$/.test(String(robloxId))||!/^\d{15,22}$/.test(String(discordId)))return;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS roblox_member_roles(discord_user_id TEXT PRIMARY KEY,roblox_user_id TEXT NOT NULL,role_id TEXT NOT NULL,created_at TEXT NOT NULL)").run();
 const old=await env.DB.prepare("SELECT role_id,roblox_user_id FROM roblox_member_roles WHERE discord_user_id=?").bind(discordId).first();
 if(old&&old.roblox_user_id!==robloxId)throw Error("Discord member already linked to another Roblox ID role");
 const member=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+discordId);
 if(member.status!==200)throw Error("Cannot verify guild membership: "+member.status);
 let roleId=old?.role_id;
 if(!roleId){
  const roles=await discordApi(env,"/guilds/"+GUILD_ID+"/roles");
  if(roles.status!==200)throw Error("Cannot list guild roles: "+roles.status);
  const matches=(roles.data||[]).filter(x=>x.name===String(robloxId)&&!x.managed);
  if(matches.length>1)throw Error("Multiple matching roles; cannot choose safely");
  if(matches.length===1)roleId=matches[0].id;
  else {
   const created=await discordApi(env,"/guilds/"+GUILD_ID+"/roles","POST",{name:String(robloxId),permissions:"0",mentionable:false,hoist:false});
   if(created.status!==200)throw Error("Cannot create Roblox ID role: "+created.status);
   roleId=created.data.id;
  }
 }
 const added=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+discordId+"/roles/"+roleId,"PUT");
 if(added.status!==204)throw Error("Cannot assign Roblox ID role: "+added.status);
 await env.DB.prepare("INSERT INTO roblox_member_roles(discord_user_id,roblox_user_id,role_id,created_at) VALUES(?,?,?,?) ON CONFLICT(discord_user_id) DO UPDATE SET roblox_user_id=excluded.roblox_user_id,role_id=excluded.role_id").bind(discordId,String(robloxId),roleId,new Date().toISOString()).run();
}
async function revokeDepartedMember(env,discordId){
 const rows=await env.DB.prepare("SELECT DISTINCT d.roblox_user_id FROM discord_key_issuance d JOIN member_keys m ON m.key_hash=d.key_hash WHERE d.discord_user_id=? AND d.guild_id=? AND m.revoked=0").bind(discordId,GUILD_ID).all();
 const result=await env.DB.prepare("UPDATE member_keys SET revoked=1 WHERE revoked=0 AND key_hash IN (SELECT key_hash FROM discord_key_issuance WHERE discord_user_id=? AND guild_id=?)").bind(discordId,GUILD_ID).run();
 for(const row of rows.results||[])await audit(env,"key_revoked_member_left",row.roblox_user_id);
 if(result.meta?.changes)await discordLog(env,"SECURITY_LOG_CHANNEL_ID","🚪 Member left Syndicate Hub Discord • <@"+discordId+"> • "+result.meta.changes+" key(s) automatically revoked.");
 return result.meta?.changes||0;
}
async function checkDepartedIssuances(env){
 const r=await env.DB.prepare("SELECT DISTINCT d.discord_user_id FROM discord_key_issuance d JOIN member_keys m ON m.key_hash=d.key_hash WHERE d.guild_id=? AND m.revoked=0 LIMIT 100").bind(GUILD_ID).all();
 for(const row of r.results||[]){
  try{
   const member=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+row.discord_user_id);
   if(member.status===404)await revokeDepartedMember(env,row.discord_user_id);
   else if(member.status!==200)console.error("membership lookup failed",member.status);
  }catch(e){console.error("membership check",e)}
 }
}

async function syncMemberRoles(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS roblox_member_roles(discord_user_id TEXT PRIMARY KEY,roblox_user_id TEXT NOT NULL,role_id TEXT NOT NULL,created_at TEXT NOT NULL)").run();
 const rows=await env.DB.prepare("SELECT discord_user_id,roblox_user_id,role_id FROM roblox_member_roles ORDER BY discord_user_id LIMIT 100").all();
 for(const x of rows.results||[]){
  try{
   const member=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+x.discord_user_id);
   if(member.status===404){
    const other=await env.DB.prepare("SELECT 1 FROM roblox_member_roles WHERE role_id=? AND discord_user_id<>? LIMIT 1").bind(x.role_id,x.discord_user_id).first();
    if(!other){
     const removed=await discordApi(env,"/guilds/"+GUILD_ID+"/roles/"+x.role_id,"DELETE");
     if(removed.status!==204&&removed.status!==404){console.error("role delete",removed.status);continue}
    }
    await env.DB.prepare("DELETE FROM roblox_member_roles WHERE discord_user_id=?").bind(x.discord_user_id).run();
   }
  }catch(e){console.error("member role sync",e)}
 }
}
async function backfillMemberRoles(env){
 const r=await env.DB.prepare("SELECT d.discord_user_id,d.roblox_user_id FROM discord_key_issuance d WHERE d.guild_id=? GROUP BY d.discord_user_id HAVING COUNT(DISTINCT d.roblox_user_id)=1 LIMIT 100").bind(GUILD_ID).all();
 for(const x of r.results||[]){
  try{await ensureMemberIdRole(env,x.discord_user_id,x.roblox_user_id)}catch(e){console.error("role backfill",x.discord_user_id,String(e))}
 }
}



const FREE_PANEL_CHANNEL="1564527144330334258";
function freeModal(){return new Response(JSON.stringify({type:9,data:{custom_id:"syndicate_free_modal",title:"Get 24-Hour Free Key",components:[{type:1,components:[{type:4,custom_id:"roblox_id",label:"Roblox Username or User ID",style:1,min_length:1,max_length:20,required:true}]}]}}),{headers:{"content-type":"application/json"}})}
async function freeAccessKey(i,env,input,ctx){
 const did=i.member?.user?.id;
 if(!did)return reply("Discord account unavailable.");
 let account;
 try{account=await resolveRobloxAccount(String(input||""))}catch(e){console.error("Free Roblox lookup",e);return reply("Roblox lookup unavailable. Enter your numeric Roblox User ID instead.")}
 if(!account)return reply("Roblox account not found. Use username (not display name) or numeric ID.");
 const rid=account.id,now=new Date().toISOString();
 const owner=await env.DB.prepare("SELECT d.discord_user_id FROM member_keys m LEFT JOIN discord_key_issuance d ON d.key_hash=m.key_hash WHERE m.user_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(rid,now).first();
 if(owner)return reply(owner.discord_user_id===did?"You already have an active key. Use View Key to retrieve it.":"An active key already exists for that Roblox account.");
 const active=await env.DB.prepare("SELECT m.user_id FROM discord_key_issuance d JOIN member_keys m ON m.key_hash=d.key_hash WHERE d.discord_user_id=? AND d.guild_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(did,GUILD_ID,now).first();
 if(active)return reply("You already have an active key for Roblox ID "+active.user_id+". Use View Key.");
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 const hex=[...bytes].map(x=>x.toString(16).padStart(2,"0").toUpperCase()).join("");
 const key="SYND-"+hex.match(/.{8}/g).join("-");
 const digest=await env.KEY_ISSUER.hashKey(key);
 const expires=new Date(Date.now()+86400000).toISOString();
 const secured=await encryptKey(env,key);
 try{await env.DB.batch([
 env.DB.prepare("INSERT INTO member_keys(key_hash,key_prefix,user_id,expires_at,revoked,created_at) VALUES(?,?,?,?,0,?)").bind(digest,key.slice(0,13),rid,expires,now),
 env.DB.prepare("INSERT INTO discord_key_issuance(discord_user_id,guild_id,roblox_user_id,key_hash,issued_at,expires_at) VALUES(?,?,?,?,?,?)").bind(did,GUILD_ID,rid,digest,now,expires),
 env.DB.prepare("INSERT INTO discord_key_vault(key_hash,cipher,iv,created_at) VALUES(?,?,?,?)").bind(digest,secured.cipher,secured.iv,now)
 ])}catch(e){console.error("free issue",e);return reply("Could not issue your key. Please try again.")}
 ctx.waitUntil(Promise.allSettled([ensureMemberIdRole(env,did,rid),audit(env,"free_key_issued",rid),discordLog(env,"KEY_LOG_CHANNEL_ID","Free 24-hour key issued • Discord <@"+did+"> • Roblox "+rid)]));
 return reply("🔑 **Syndicate Hub Free Key (24 Hours)**\nRoblox ID: "+rid+"\nTime remaining: "+keyRemaining(expires)+"\nExpires: <t:"+Math.floor(Date.parse(expires)/1000)+":F>\n**Copy:**\n"+String.fromCharCode(96,96,96)+"text\n"+key+"\n"+String.fromCharCode(96,96,96)+"\nMobile: "+String.fromCharCode(96)+key+String.fromCharCode(96)+"\nRequest another free key after expiration.");
}
async function postFreePanel(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS syndicate_free_panel(id INTEGER PRIMARY KEY CHECK(id=1),message_id TEXT NOT NULL,created_at TEXT NOT NULL)").run();
 const exists=await env.DB.prepare("SELECT message_id FROM syndicate_free_panel WHERE id=1").first();
 if(exists)return;
 const payload={embeds:[{title:"💜 SYNDICATE HUB | FREE ACCESS",description:"**Try Syndicate Hub free for 24 hours!**\n\nClick **Get Free Key** to generate a 24-hour key. Already have an active key? Choose **View Key** instead.\n\nKeys expire automatically after 24 hours. Request a new free key after expiry. Lifetime access is never downgraded.",color:8073395,footer:{text:"Syndicate Hub • Free 24-Hour Access"}}],components:[{type:1,components:[{type:2,style:1,label:"Get Free Key",custom_id:"syndicate_free_generate",emoji:{name:"🔑"}},{type:2,style:2,label:"View Key",custom_id:"syndicate_free_view"},{type:2,style:2,label:"Get Script",custom_id:"syndicate_get_script"}]}]};
 const r=await fetch("https://discord.com/api/v10/channels/"+FREE_PANEL_CHANNEL+"/messages",{method:"POST",headers:{"Authorization":"Bot "+env.DISCORD_BOT_TOKEN,"Content-Type":"application/json"},body:JSON.stringify(payload)});
 if(!r.ok)throw Error("Free panel post failed "+r.status+" "+(await r.text()).slice(0,250));
 const message=await r.json();
 await env.DB.prepare("INSERT OR IGNORE INTO syndicate_free_panel(id,message_id,created_at) VALUES(1,?,?)").bind(message.id,new Date().toISOString()).run();
}



const SCRIPT_UPDATES_CHANNEL = "1564527146922410136";
function scriptUpdatePayload(release) {
 if (!release || !/^[a-zA-Z0-9._-]{1,100}$/.test(release.id) ||
     typeof release.title !== "string" || !release.title.trim() || release.title.length > 180 ||
     typeof release.summary !== "string" || release.summary.length > 700 ||
     !/^[a-f0-9]{40}$/.test(release.commit) || !Number.isFinite(Date.parse(release.published_at))) {
  throw Error("Invalid script release");
 }
 const fields=[];
 for (const [key,label] of [["added","✨ NEW FEATURES"],["fixed","🛠️ FIXES"],["improved","⚡ IMPROVEMENTS"]]) {
  const items=release[key] ?? [];
  if (!Array.isArray(items) || items.length>8 || items.some(x=>typeof x!=="string"||!x.trim()||x.length>450)) throw Error("Invalid release section");
  if(items.length) {
   const value=items.map(x=>"• "+x).join("\n");
   if(value.length>1024) throw Error("Release section too long");
   fields.push({name:label,value,inline:false});
  }
 }
 if(!fields.length)throw Error("Empty release");
 fields.push({name:"↻ GET THE UPDATE",value:"Re-execute Syndicate Hub to load the latest script. Use **Get Script** below to copy the loader.",inline:false});
 return {
  allowed_mentions:{parse:[]},
  embeds:[{
   author:{name:"SYNDICATE HUB  •  OFFICIAL CHANGELOG"},
   title:"💜 "+release.title,
   description:"**STORAGE HUNTERS**  ·  `SCRIPT UPDATE`\n\n"+release.summary,
   color:0x9B59F6,fields,
   footer:{text:"Syndicate Hub • "+release.id+" • Build "+release.commit.slice(0,7)},
   timestamp:release.published_at
  }],
  components:[{type:1,components:[
   {type:2,style:1,label:"Get Script",custom_id:"syndicate_get_script",emoji:{name:"📜"}}
  ]}]
 };
}
async function sendScriptUpdates(env) {
 // A durable outbox lets release summaries be queued after a verified script update.
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS script_update_announcements(release_id TEXT PRIMARY KEY,commit_sha TEXT NOT NULL UNIQUE,release_json TEXT NOT NULL,created_at TEXT NOT NULL,sent_at TEXT,message_id TEXT,lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT)").run();
 const pending=await env.DB.prepare("SELECT * FROM script_update_announcements WHERE sent_at IS NULL AND lease_until<=? ORDER BY created_at LIMIT 3").bind(Date.now()).all();
 for(const row of pending.results||[]) {
  const claim=await env.DB.prepare("UPDATE script_update_announcements SET lease_until=? WHERE release_id=? AND sent_at IS NULL AND lease_until<=?").bind(Date.now()+180000,row.release_id,Date.now()).run();
  if(!claim.meta?.changes)continue;
  try {
   const release=JSON.parse(row.release_json);
   if(release.id!==row.release_id||release.commit!==row.commit_sha)throw Error("Release identity mismatch");
   const payload=scriptUpdatePayload(release);
   // Verify the destination belongs to this guild before sending.
   const channel=await executorDiscord(env,"/channels/"+SCRIPT_UPDATES_CHANNEL,"GET");
   if(channel.status!==200||channel.data.guild_id!==GUILD_ID)throw Error("Script updates channel unavailable or wrong server");
   const digest=await sha("script-update:"+row.release_id);
   const nonce=BigInt("0x"+digest.slice(0,18)).toString();
   const result=await executorDiscord(env,"/channels/"+SCRIPT_UPDATES_CHANNEL+"/messages","POST",{...payload,nonce,enforce_nonce:true});
   if(!result.data?.id)throw Error("Script update delivery failed: "+result.status);
   await env.DB.prepare("UPDATE script_update_announcements SET sent_at=?,message_id=?,last_error=NULL,lease_until=0 WHERE release_id=?").bind(new Date().toISOString(),result.data.id,row.release_id).run();
   console.log("Script update delivered",row.release_id,result.data.id);
  }catch(e) {
   await env.DB.prepare("UPDATE script_update_announcements SET last_error=?,lease_until=? WHERE release_id=? AND sent_at IS NULL").bind(String(e).slice(0,1000),Date.now()+60000,row.release_id).run();
   console.error("script update delivery",row.release_id,String(e));
  }
 }
}

export default {
 async scheduled(event,env,ctx){
  if(!env.DISCORD_BOT_TOKEN)return;
  ctx.waitUntil(sendScriptUpdates(env).catch(e=>console.error("script updates",String(e))));
  ctx.waitUntil(syncExistingKeyAccessPanel(env).catch(e=>console.error("key panel layout sync",String(e))));
  ctx.waitUntil(refreshExecutorStatus(env).catch(async e=>{console.error("executor status refresh",String(e));await env.DB.prepare("UPDATE executor_feed_state SET last_error=?,next_run=? WHERE id=1").bind("Panel delivery: "+String(e).slice(0,1400),Date.now()+60000).run();}));
  try{await sendExecutionLogs(env)}catch(e){console.error("execution logging",e)}
  try{await managementPost(env)}catch(e){console.error("management panel",e)}
  try{await postFreePanel(env)}catch(e){console.error("free panel",e)}
  try{await checkDepartedIssuances(env);await backfillMemberRoles(env);await syncMemberRoles(env)}catch(e){console.error("role maintenance",e)}
  const r=await fetch("https://discord.com/api/v10/applications/"+APPLICATION_ID+"/guilds/"+GUILD_ID+"/commands",{
   method:"PUT",headers:{"Authorization":"Bot "+env.DISCORD_BOT_TOKEN,"Content-Type":"application/json"},
   body:JSON.stringify(COMMANDS)
  });
  console.log("Discord command registration status",r.status);
  const resultText=(await r.clone().text()).slice(0,1200);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS discord_setup_status (id INTEGER PRIMARY KEY, status INTEGER, response TEXT, checked_at TEXT)").run();
  await env.DB.prepare("INSERT OR REPLACE INTO discord_setup_status (id,status,response,checked_at) VALUES (1,?,?,?)").bind(r.status,resultText,new Date().toISOString()).run();
  if(!r.ok)console.error("Discord command registration failed",r.status,(await r.text()).slice(0,500));
 },
 async fetch(req,env,ctx) {
  const url=new URL(req.url);
  if(req.method==="GET"&&url.pathname==="/health")return new Response(JSON.stringify({ok:true,app:APPLICATION_ID}),{headers:{"content-type":"application/json"}});
  if(req.method==="POST"&&url.pathname==="/internal/execution-flush"){
   const timestamp=req.headers.get("x-syndicate-timestamp")||"";
   const signature=req.headers.get("x-syndicate-signature")||"";
   if(!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>30000||!env.KEY_PEPPER)return new Response("Unauthorized",{status:401});
   const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(env.KEY_PEPPER),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
   const expected=[...new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(timestamp)))].map(x=>x.toString(16).padStart(2,"0")).join("");
   if(signature.length!==expected.length||!crypto.subtle.timingSafeEqual){if(signature!==expected)return new Response("Unauthorized",{status:401})}
   else if(signature!==expected)return new Response("Unauthorized",{status:401});
   try{await sendExecutionLogs(env);return new Response("OK")}catch(e){console.error("immediate execution flush",String(e));return new Response("Retry scheduled",{status:503})}
  }
  if(req.method!=="POST"||url.pathname!=="/discord/interactions")return new Response("Not found",{status:404});
  const raw=await req.text();
  if(!await validSignature(req,raw))return new Response("Invalid Discord signature",{status:401});
  let i;try{i=JSON.parse(raw)}catch{return new Response("Invalid JSON",{status:400})}
  if(i.type===1)return new Response(JSON.stringify({type:1}),{headers:{"content-type":"application/json"}});
  if(![2,3,5].includes(i.type)||i.guild_id!==GUILD_ID)return reply("This bot is only available in the Syndicate Hub server.");
  if(!env.DB||!env.KEY_ISSUER)return reply("Authentication service is not configured.");
  try {
   if(i.type===3&&i.data?.custom_id?.startsWith("mg_"))return discordResponse(await deferredManagement(i,env,ctx));
   if(i.type===5&&i.data?.custom_id==="mg_revoke_modal")return discordResponse(await managementModal(i));
   if(i.type===3&&i.data?.custom_id==="syndicate_free_generate"){const did=i.member?.user?.id;if(!did)return reply("Discord member unavailable.");const active=await env.DB.prepare("SELECT 1 FROM discord_key_issuance d JOIN member_keys m ON m.key_hash=d.key_hash WHERE d.discord_user_id=? AND d.guild_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(did,GUILD_ID,new Date().toISOString()).first();return active?delayedReply(i,env,ctx,()=>viewKey(i,env)):freeModal();}
   if(i.type===3&&i.data?.custom_id==="syndicate_free_view")return delayedReply(i,env,ctx,()=>viewKey(i,env));
   if(i.type===5&&i.data?.custom_id==="syndicate_free_modal"){const id=i.data.components?.flatMap(x=>x.components||[]).find(x=>x.custom_id==="roblox_id")?.value;return delayedReply(i,env,ctx,()=>freeAccessKey(i,env,id,ctx));}
   if(i.type===3&&i.data?.custom_id==="syndicate_generate_key"){
    const did=i.member?.user?.id;
    if(!did)return reply("Discord member information unavailable.");
    const active=await env.DB.prepare("SELECT 1 FROM discord_key_issuance d JOIN member_keys m ON m.key_hash=d.key_hash WHERE d.discord_user_id=? AND d.guild_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(did,GUILD_ID,new Date().toISOString()).first();
    if(!active)return modal(i);
    return delayedReply(i,env,ctx,()=>viewKey(i,env));
   }
   if(i.type===3&&i.data?.custom_id==="syndicate_revoke_own_key")return confirmOwnRevoke();
   if(i.type===3&&i.data?.custom_id==="syndicate_confirm_self_revoke")return await revokeOwnKey(i,env,ctx);
   if(i.type===3&&i.data?.custom_id==="syndicate_cancel_self_revoke")return reply("Cancelled. Your key is still active.");
   if(i.type===3&&i.data?.custom_id==="syndicate_get_script")return reply("📜 **Syndicate Hub — Get Script**\n\n**Desktop — copy from code block:**\n```lua\nloadstring(game:HttpGet(\"https://raw.githubusercontent.com/ThatOneThing91/Syndicate-Hub/main/StorageHunters\"))()\n```\n**📱 Mobile — press and hold to copy this separate line:**\n`loadstring(game:HttpGet(\"https://raw.githubusercontent.com/ThatOneThing91/Syndicate-Hub/main/StorageHunters\"))()`\n\nBoth options run the same script. An active member key is required.");
   if(i.type===5&&i.data?.custom_id==="syndicate_key_modal"){
    if(!hasPremiumRole(i))return premiumRequired();
    const id=i.data.components?.flatMap(x=>x.components||[]).find(x=>x.custom_id==="roblox_id")?.value;
    return delayedReply(i,env,ctx,()=>getkey(i,env,id,ctx));
   }
   switch(i.data?.name){
    case "getkey":return hasPremiumRole(i)?delayedReply(i,env,ctx,()=>getkey(i,env,undefined,ctx)):premiumRequired();
    case "panel":return isAdmin(i)?await postPanel(i,env):reply("Administrator permission required.");
    case "online":return isAdmin(i)?delayedReply(i,env,ctx,()=>onlineUsers(env)):reply("Administrator permission required.");
    case "executions":return isAdmin(i)?delayedReply(i,env,ctx,()=>recentExecutions(env)):reply("Administrator permission required.");
    case "keys":return isAdmin(i)?delayedReply(i,env,ctx,()=>listKeys(env)):reply("Administrator permission required.");
    case "revoke":return isAdmin(i)?await revoke(i,env):reply("Administrator permission required.");
    default:return reply("Unknown command.");
   }
  }catch(e){console.error("interaction",e);return reply("An internal error occurred. Please try again.")}
 }
};

export class ExecutionNotifier extends WorkerEntrypoint { async flush(){ await sendExecutionLogs(this.env); return true; } }


