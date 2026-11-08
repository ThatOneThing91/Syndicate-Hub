async function memberJoinDiag(env,event,detail){
 try{
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS member_join_diagnostics(id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,detail TEXT,created_at TEXT NOT NULL)").run();
  await env.DB.prepare("INSERT INTO member_join_diagnostics(event,detail,created_at) VALUES(?,?,?)").bind(event,String(detail||"").slice(0,500),new Date().toISOString()).run();
 }catch(e){console.error("member join diagnostics write failed",String(e));}
}

import { DurableObject } from "cloudflare:workers";
async function handleMemberJoin(env,state,member){
 const user=member?.user;if(!user?.id||member.guild_id!==GUILD_ID)return;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS member_join_welcomes(user_id TEXT PRIMARY KEY,role_assigned INTEGER NOT NULL DEFAULT 0,welcome_sent INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)").run();
 const prior=await env.DB.prepare("SELECT role_assigned,welcome_sent FROM member_join_welcomes WHERE user_id=?").bind(user.id).first();
 if(prior?.role_assigned&&prior?.welcome_sent)return;
 const [rr,cr,gr,mr]=await Promise.all([discordApi(env,"/guilds/"+GUILD_ID+"/roles"),discordApi(env,"/guilds/"+GUILD_ID+"/channels"),discordApi(env,"/guilds/"+GUILD_ID+"?with_counts=true"),discordApi(env,"/guilds/"+GUILD_ID+"/members?limit=1000")]);
 const initiate=rr.status===200&&Array.isArray(rr.data)?rr.data.find(r=>String(r.name||"").trim().toLowerCase()==="initiate"):null;
 let roleDone=!!prior?.role_assigned;
 if(!roleDone&&initiate){const r=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+user.id+"/roles/"+initiate.id,"PUT");roleDone=r.status===204;if(!roleDone)console.error("join role assignment failed",user.id,r.status,r.data);}
 else if(!initiate)console.error("join role assignment failed: Initiate role not found");
 const norm=n=>String(n||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
 const intro=cr.status===200&&Array.isArray(cr.data)?cr.data.find(c=>[0,5].includes(c.type)&&norm(c.name)==="introductions"):null;
 const general=cr.status===200&&Array.isArray(cr.data)?cr.data.find(c=>[0,5].includes(c.type)&&norm(c.name)==="general"):null;
 const reactionRoles=cr.status===200&&Array.isArray(cr.data)?cr.data.find(c=>[0,5].includes(c.type)&&["reaction-roles","reaction-role","roles"].includes(norm(c.name))):null;
 let welcomeDone=!!prior?.welcome_sent;
 if(!welcomeDone&&intro){
  const guild=gr.status===200?gr.data:{};
  const icon=guild.icon?"https://cdn.discordapp.com/icons/"+GUILD_ID+"/"+guild.icon+"."+(String(guild.icon).startsWith("a_")?"gif":"png")+"?size=128":null;
  const avatar=user.avatar?"https://cdn.discordapp.com/avatars/"+user.id+"/"+user.avatar+"."+(String(user.avatar).startsWith("a_")?"gif":"png")+"?size=256":"https://cdn.discordapp.com/embed/avatars/"+Number((BigInt(user.id)>>22n)%6n)+".png";
  const count=Number(Array.isArray(mr.data)?mr.data.length:(guild.approximate_member_count||state.memberCount||0));
  const description=["👋 Welcome to the server!","",...(count>0?["Member **#"+count+"**"]:[]),...(general?["Chat in <#"+general.id+">"]:[]),...(reactionRoles?["Choose your roles in <#"+reactionRoles.id+">"]:[])].join("\n");
  const embed={title:"Welcome!",description,color:0x9B72CF,author:{name:"Welcome to "+String(guild.name||"the server"),...(icon?{icon_url:icon}:{})},thumbnail:{url:avatar},footer:{text:"Glad you're here."},timestamp:new Date().toISOString()};
  const sent=await discordApi(env,"/channels/"+intro.id+"/messages","POST",{content:"<@"+user.id+"> just joined the server.",allowed_mentions:{parse:["users"],users:[user.id]},embeds:[embed]});
  welcomeDone=sent.status===200;if(!welcomeDone)console.error("join welcome message failed",user.id,sent.status,sent.data);
 }else if(!intro&&!welcomeDone)console.error("join welcome failed: introductions channel not found");
 await env.DB.prepare("INSERT INTO member_join_welcomes(user_id,role_assigned,welcome_sent,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET role_assigned=MAX(role_assigned,excluded.role_assigned),welcome_sent=MAX(welcome_sent,excluded.welcome_sent),updated_at=excluded.updated_at").bind(user.id,roleDone?1:0,welcomeDone?1:0,new Date().toISOString()).run();
}
export class MemberJoinGateway extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.socket=null;this.heartbeatTimer=null;this.heartbeatMs=45000;this.waitingForAck=false;this.seq=null;this.session=null;this.memberCount=0;}
 async fetch(){try{await memberJoinDiag(this.env,"gateway_start","scheduled binding invoked");await this.connect();return new Response("Gateway listener starting",{status:202});}catch(e){console.error("Discord member gateway connect failed",String(e));return new Response("Gateway listener unavailable",{status:503});}}
 async alarm(){try{await this.connect();}catch(e){console.error("Discord member gateway reconnect failed",String(e));await this.ctx.storage.setAlarm(Date.now()+15000);}}
 async connect(){
  if(this.socket&&(this.socket.readyState===0||this.socket.readyState===1))return;
  const saved=await this.ctx.storage.get("discord_session")||null;this.session=saved;this.seq=saved?.seq??null;this.memberCount=Number(await this.ctx.storage.get("member_count")||0);
  await memberJoinDiag(this.env,"gateway_connect","Opening "+root);
  const root=saved?.resume_gateway_url||"wss://gateway.discord.gg/",url=root+(root.includes("?")?"&":"?")+"v=10&encoding=json",ws=new WebSocket(url);this.socket=ws;
  ws.addEventListener("open",()=>this.ctx.waitUntil(memberJoinDiag(this.env,"gateway_open","WebSocket opened")));
  ws.addEventListener("message",e=>this.ctx.waitUntil(this.onMessage(ws,e.data).catch(x=>console.error("Discord gateway message error",String(x)))));
  ws.addEventListener("close",e=>{this.ctx.waitUntil(memberJoinDiag(this.env,"gateway_close",String(e.code)+" "+String(e.reason||"")));if(this.socket===ws)this.socket=null;if(this.heartbeatTimer){clearTimeout(this.heartbeatTimer);this.heartbeatTimer=null;}this.waitingForAck=false;this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now()+15000).catch(()=>{}));console.error("Discord gateway closed",e.code,e.reason||"");});
  ws.addEventListener("error",()=>{try{ws.close();}catch{}});
 }
 send(ws,p){if(ws===this.socket&&ws.readyState===1)ws.send(JSON.stringify(p));}
 scheduleHeartbeat(ws,delay){if(this.heartbeatTimer)clearTimeout(this.heartbeatTimer);this.heartbeatTimer=setTimeout(()=>{if(ws!==this.socket||ws.readyState!==1)return;if(this.waitingForAck){try{ws.close(4000,"Heartbeat acknowledgement timeout");}catch{}return;}this.waitingForAck=true;this.send(ws,{op:1,d:this.seq});this.scheduleHeartbeat(ws,this.heartbeatMs);},delay);}
 async onMessage(ws,raw){
  if(ws!==this.socket)return;const p=JSON.parse(typeof raw==="string"?raw:new TextDecoder().decode(raw));
  if(p.s!==null&&p.s!==undefined){this.seq=p.s;if(this.session){this.session.seq=this.seq;await this.ctx.storage.put("discord_session",this.session);}}
  if(p.op===10){this.ctx.waitUntil(memberJoinDiag(this.env,"gateway_hello","Received HELLO; identifying with intents 3"));this.heartbeatMs=Number(p.d?.heartbeat_interval)||45000;this.scheduleHeartbeat(ws,Math.floor(Math.random()*this.heartbeatMs));if(this.session?.session_id&&this.seq!==null)this.send(ws,{op:6,d:{token:this.env.DISCORD_BOT_TOKEN,session_id:this.session.session_id,seq:this.seq}});else this.send(ws,{op:2,d:{token:this.env.DISCORD_BOT_TOKEN,intents:3,properties:{os:"cloudflare-workers",browser:"syndicate-hub",device:"syndicate-hub"}}});return;}
  if(p.op===11){this.waitingForAck=false;return;}if(p.op===1){this.waitingForAck=true;this.send(ws,{op:1,d:this.seq});return;}if(p.op===7){try{ws.close(4001,"Gateway requested reconnect");}catch{}return;}
  if(p.op===9){this.session=null;this.seq=null;await this.ctx.storage.delete("discord_session");setTimeout(()=>{if(ws===this.socket)try{ws.close(4002,"Invalid gateway session");}catch{}},1000);return;}
  if(p.op!==0)return;
  if(p.t==="READY"){this.ctx.waitUntil(memberJoinDiag(this.env,"gateway_ready","READY received; bot user "+String(p.d?.user?.id||"unknown")));this.session={session_id:p.d.session_id,resume_gateway_url:p.d.resume_gateway_url,seq:this.seq};await this.ctx.storage.put("discord_session",this.session);return;}
  if(p.t==="GUILD_CREATE"&&p.d?.id===GUILD_ID&&Number.isFinite(p.d.member_count)){this.memberCount=p.d.member_count;await this.ctx.storage.put("member_count",this.memberCount);return;}
  if(p.t==="GUILD_MEMBER_ADD"&&p.d?.guild_id===GUILD_ID){this.ctx.waitUntil(memberJoinDiag(this.env,"member_add","Received join for "+String(p.d?.user?.id||"unknown")));this.memberCount=Number(this.memberCount||0)+1;await this.ctx.storage.put("member_count",this.memberCount);p.d.memberCount=this.memberCount;this.ctx.waitUntil(handleMemberJoin(this.env,this,p.d).catch(e=>console.error("member join processing failed",String(e))));return;}
  if(p.t==="GUILD_MEMBER_REMOVE"&&p.d?.guild_id===GUILD_ID){this.memberCount=Math.max(0,Number(this.memberCount||0)-1);await this.ctx.storage.put("member_count",this.memberCount);}
 }
}
// Automatically maintained Discord status boards. Feed metadata is informational.
const EXECUTOR_CHANNEL = "1563812726118023228";
const EXECUTOR_FEED = "https://weao.xyz/api/status/exploits";
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
 {id:"weao",label:"WEAO",url:EXECUTOR_FEED,kind:"weao",group:"weao"},
 {id:"windows",label:"Roblox Windows",url:"https://clientsettings.roblox.com/v2/client-version/WindowsPlayer/channel/LIVE",kind:"roblox",platform:"Windows"},
 {id:"mac",label:"Roblox macOS",url:"https://clientsettings.roblox.com/v2/client-version/MacPlayer/channel/LIVE",kind:"roblox",platform:"macOS"}
];
const executorIdentity = x => x.platform+":"+x.title.toLowerCase().replace(/[^a-z0-9]/g,"");
const executorVersionKey = v => String(v||"").trim().toLowerCase().replace(/^v(?=\d)/,"");
const executorHash = v => typeof v === "string" && /^version-[a-f0-9]{16}$/i.test(v) ? v.toLowerCase() : null;
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
  else {const hash=executorHash(raw?.clientVersionUpload);if(!hash)throw Error("Invalid Roblox build response");data={hash,version:executorText(raw.version,70),platform:source.platform};}
  successAt=checkedAt;
 }catch(e){error=String(e).slice(0,200);if(prior?.snapshot){try{data=JSON.parse(prior.snapshot);}catch{data=null;}}console.error("executor source",source.id,error);}
 await env.DB.prepare("INSERT INTO executor_source_state(source_id,checked_at,success_at,snapshot,last_error) VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET checked_at=excluded.checked_at,success_at=excluded.success_at,snapshot=excluded.snapshot,last_error=excluded.last_error").bind(source.id,checkedAt,successAt,data?JSON.stringify(data):null,error).run();
 return {...source,data,error,checkedAt,successAt,fresh:!error&&!!data};
}
function executorCombine(sources,fallback=[]) {
 const byId=new Map(sources.map(s=>[s.id,s]));
 const weao=byId.get("weao");
 const base=Array.isArray(weao?.data)?weao.data:fallback;
 const catalog=new Map(base.map(row=>[executorIdentity(row),{...row}]));
 const weaoLookup=new Map((weao?.data||[]).map(row=>[executorIdentity(row),row]));
 for(const [key,row] of catalog) {
  const report=weaoLookup.get(key);
  const reports=report?[{id:"weao",label:"WEAO",group:"weao",fresh:!!weao.fresh,successAt:weao.successAt,...report}]:[];
  const current=reports.filter(r=>r.fresh);
  const listedVersion=executorVersionKey(row.version);
  const sameRelease=current.filter(r=>listedVersion&&listedVersion!=="unknown"&&executorVersionKey(r.version)===listedVersion);
  const statuses=sameRelease.map(r=>r.updated).filter(v=>typeof v==="boolean");
  const detectionReport=reports[0]||null;
  const rb=byId.get(row.platform==="Windows"?"windows":row.platform==="macOS"?"mac":"");
  const buildConflict=!!rb?.fresh&&sameRelease.some(r=>r.updated===true&&r.rbxVersion&&r.rbxVersion!==rb.data.hash);
  row.evidence={reports,currentGroups:current.length?1:0,updateConflict:false,versionConflict:false,detectionConflict:false,buildConflict,
   sameReleaseGroups:sameRelease.length?1:0,compatibilitySources:sameRelease.length?["WEAO"]:[],
   otherReleaseReports:[],conflict:buildConflict,
   reportedUpdated:statuses.length?statuses.every(v=>v):null,
   detectionFresh:!!detectionReport?.fresh,detectionAt:detectionReport?.successAt||null,
   detectionSource:detectionReport?"weao":null,detectionVersion:detectionReport?.version||null,
   detectionReason:detectionReport?.reason||null,detectionBanwave:!!detectionReport?.possibleBanwave,
   savedDetection:detectionReport&&!detectionReport.unknown?detectionReport.detected:null,
   detection:!detectionReport?.fresh||detectionReport.unknown||typeof detectionReport.detected!=="boolean"?null:detectionReport.detected,
   roblox:rb?.fresh&&sameRelease.some(r=>r.rbxVersion)?{hash:rb.data.hash,version:rb.data.version,matches:sameRelease.filter(r=>r.rbxVersion).every(r=>r.rbxVersion===rb.data.hash)}:null};
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
 rows=rows.filter(row=>row.kind!=="External"&&!row.evidence?.reports?.some(report=>report.kind==="External"));
 const trackedCount=rows.length;
 // Filter both live and cached entries before grouping, counting, and pagination.
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
   const coverage=ev.sameReleaseGroups===1?"WEAO has a live report for this release":"No live WEAO report for this release";
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
    "**Detection report:** "+(ev.detectionSource?"[WEAO](https://weao.gg/)"+" · "+String(ev.detectionVersion||"Unknown"):"No source coverage"),
    ev.detectionAt?"↳ "+(ev.detectionFresh?"Feed retrieved":"Last retrieval")+detectionAt+(ev.detectionFresh?"":" · ⚠️ stale / offline"):null,
    "**Detection assessed:** time not published by source",
    !ev.detectionFresh&&typeof ev.savedDetection==="boolean"?"↳ Saved report: "+(ev.savedDetection?"reported detected":"no detection reported")+"; current status unknown":null,
    ev.detectionBanwave?"⚠️ "+(ev.detectionFresh?"Source reports possible ban wave":"Saved report mentioned possible ban wave"):null,ev.detectionReason?"Source note"+(ev.detectionFresh?"":" (saved)")+": "+ev.detectionReason:null,"",links||"Official links unavailable"
   ].filter(v=>v!==null).join("\n");
   return {title:x.title,...(x.website?{url:x.website}:{}),description,color:!ev.currentGroups?0x747F8D:ev.conflict||ev.detectionConflict?0xF0B232:ev.detection===true?0xED4245:x.updated===false?0xF0B232:0x9B72CF,...(x.logo?{thumbnail:{url:x.logo}}:{})};
  });
  const health=sources.map(executorSourceLine).join("\n");
  const headerText=(stale?"⚠️ **Primary tracker unavailable · saved data may be stale**\n":"")+"**"+entries.length+" executors listed**  ·  **"+trackedCount+" monitored**  ·  Every 5 min\n\n"+(entries.length?"":"**No executor data currently available from the trackers.**\n\n")+"External executors are hidden. WEAO is the only executor-status source; Roblox LIVE build checks are shown separately. Detection is source-reported and may be unknown.\n\n"+health+"\n*Detection reports come from WEAO. Missing or unknown reports remain unknown; Roblox LIVE checks cover client builds separately.*";
  const pages=[[]];let pageChars=0;
  const reserve=headerText.length+400;
  for(const card of cards){const chars=card.title.length+card.description.length;if(chars+reserve>5800)throw Error("Executor card exceeds Discord size budget");if(pages.at(-1).length>=7||pageChars+chars+reserve>5800){pages.push([]);pageChars=0;}pages.at(-1).push(card);pageChars+=chars;}
  for(let p=0;p<pages.length;p++){
   const header={author:{name:"SYNDICATE HUB  /  EXECUTOR WATCH"},title:(icons[platform]||"📊")+" "+platform+(pages.length>1?"  •  "+(p+1)+" of "+pages.length:""),description:headerText,color:stale?0xF0B232:0x9B72CF};
   const last=pages[p].at(-1)||header;last.footer={text:"WEAO • Roblox LIVE build checks | Working ≠ undetected • Detection assessment time unavailable"};last.timestamp=checkedAt;
   boards.push({key:platform+":"+p,payload:{allowed_mentions:{parse:[]},embeds:[header,...pages[p]],components:[{type:1,components:[
    {type:2,style:5,label:"WEAO",url:"https://weao.gg/"}
   ]}]}});
  }
 }
 return boards;
}

const EXECUTOR_PLATFORMS=[
 {key:"windows",platform:"Windows",emoji:"🖥️"},
 {key:"android",platform:"Android",emoji:"📱"},
 {key:"ios",platform:"iOS",emoji:"🍎"},
 {key:"mac",platform:"macOS",emoji:"💻"}
];
function executorVisibleRows(rows){
 return rows.filter(row=>row.kind!=="External"&&!row.evidence?.reports?.some(report=>report.kind==="External"));
}
function executorPlatformButtons(selected){
 return {type:1,components:EXECUTOR_PLATFORMS.map(p=>({type:2,style:p.key===selected?1:2,label:p.platform,emoji:{name:p.emoji},custom_id:"syndicate_executor_"+p.key+"_0"}))};
}
function executorMenuBoard(rows,checkedAt,stale){
 const visible=executorVisibleRows(rows);
 return {key:"menu",payload:{allowed_mentions:{parse:[]},embeds:[{
  author:{name:"SYNDICATE HUB  /  EXECUTOR WATCH"},title:"Executor Status",
  description:"Choose your platform below to view its executor information privately.\n\n"+EXECUTOR_PLATFORMS.map(p=>p.emoji+" **"+p.platform+"** · "+visible.filter(r=>r.platform===p.platform).length+" listed").join("\n")+"\n\nExternal executors are hidden. Status information refreshes every 5 minutes."+(stale?"\n⚠️ Primary tracker unavailable; saved data may be stale.":""),
  color:stale?0xF0B232:0x9B72CF,footer:{text:"Source reports do not guarantee safety."},timestamp:checkedAt
 }],components:[executorPlatformButtons(null)]}};
}
async function executorPlatformPayload(env,key,page=0){
 const platform=EXECUTOR_PLATFORMS.find(p=>p.key===key);
 if(!platform)return {content:"Choose a platform from the executor menu.",embeds:[],components:[]};
 const cached=await env.DB.prepare("SELECT success_at,snapshot,checked_at FROM executor_feed_state WHERE id=1").first();
 if(!cached?.snapshot)return {content:"Executor information is still loading. Try again shortly.",embeds:[],components:[executorPlatformButtons(key)]};
 const snapshot=JSON.parse(cached.snapshot);
 if(!Array.isArray(snapshot))throw Error("Invalid executor snapshot");
 const now=Date.now();
 const recent=Number.isFinite(Date.parse(cached.checked_at))&&now-Date.parse(cached.checked_at)<600000;
 const saved=await env.DB.prepare("SELECT source_id,checked_at,success_at,last_error FROM executor_source_state").all();
 const sources=EXECUTOR_SOURCES.map(source=>{
  const state=(saved.results||[]).find(s=>s.source_id===source.id);
  return {...source,checkedAt:state?.checked_at,successAt:state?.success_at,error:state?.last_error,fresh:recent&&!!state?.success_at&&!state.last_error&&state.success_at===state.checked_at};
 });
 const rows=executorVisibleRows(snapshot).filter(row=>row.platform===platform.platform);
 if(!rows.length)return {content:"No non-external executors are currently listed for "+platform.platform+".",embeds:[],components:[executorPlatformButtons(key)],allowed_mentions:{parse:[]}};
 const stale=!recent||!sources.some(s=>s.kind==="weao"&&s.fresh);
 const boards=executorBoards(rows,cached.success_at,stale,cached.checked_at,sources);
 const selected=Math.max(0,Math.min(boards.length-1,Number.isInteger(page)?page:0));
 const payload={...boards[selected].payload,content:"",components:[executorPlatformButtons(key)]};
 if(boards.length>1)payload.components.push({type:1,components:[
  {type:2,style:2,label:"Previous",custom_id:"syndicate_executor_nav_"+key+"_"+Math.max(0,selected-1),disabled:selected===0},
  {type:2,style:2,label:"Page "+(selected+1)+" / "+boards.length,custom_id:"syndicate_executor_page",disabled:true},
  {type:2,style:2,label:"Next",custom_id:"syndicate_executor_nav_"+key+"_"+(selected+1),disabled:selected===boards.length-1}
 ]});
 return payload;
}
async function cacheWindowsExecutorPages(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS executor_windows_pages(page INTEGER PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
 const first=await executorPlatformPayload(env,"windows",0);
 const pageLabel=first.components?.[1]?.components?.find(b=>/^Page [0-9]+ \/ [0-9]+$/.test(b.label||""))?.label;
 const count=pageLabel?Number(pageLabel.split(" / ")[1]):1;
 if(!Number.isInteger(count)||count<1||count>100)throw Error("Invalid Windows executor page count");
 const payloads=[first];
 for(let page=1;page<count;page++)payloads.push(await executorPlatformPayload(env,"windows",page));
 for(const payload of payloads){
  const ids=(payload.components||[]).flatMap(row=>row.components||[]).map(button=>button.custom_id).filter(Boolean);
  if(new Set(ids).size!==ids.length)throw Error("Duplicate Windows result button IDs");
 }
 const updatedAt=new Date().toISOString();
 const statements=payloads.map((payload,page)=>env.DB.prepare("INSERT INTO executor_windows_pages(page,payload,updated_at) VALUES(?,?,?) ON CONFLICT(page) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(page,JSON.stringify(payload),updatedAt));
 statements.push(env.DB.prepare("DELETE FROM executor_windows_pages WHERE page>=?").bind(count));
 await env.DB.batch(statements);
}
async function executorWindowsInteraction(i,env,page){
 let body;
 try{
  const saved=await env.DB.prepare("SELECT payload FROM executor_windows_pages ORDER BY ABS(page-?) LIMIT 1").bind(page).first();
  body=saved?.payload?JSON.parse(saved.payload):await executorPlatformPayload(env,"windows",page);
 }catch(e){
  console.error("Windows executor result",String(e));
  body={content:"Windows information could not be loaded. Tap Windows to try again.",embeds:[],components:[executorPlatformButtons("windows")]};
 }
 body.allowed_mentions={parse:[]};
 return discordResponse({type:i.message?.flags&64?7:4,data:{...body,...(i.message?.flags&64?{}:{flags:64})}});
}

function executorPlatformInteraction(i,env,ctx){
 const match=/^syndicate_executor_(?:nav_)?(windows|android|ios|mac)_([0-9]{1,3})$/.exec(i.data?.custom_id||"");
 if(!match)return reply("Choose a platform from the executor menu.");
 if(match[1]==="windows")return executorWindowsInteraction(i,env,Number(match[2]));
 ctx.waitUntil((async()=>{
  let body;
  try{body=await executorPlatformPayload(env,match[1],Number(match[2]));}
  catch(e){console.error("executor platform view",String(e));body={content:"Executor information could not be loaded. Try again shortly.",embeds:[],components:[executorPlatformButtons(match[1])]};}
  body.allowed_mentions={parse:[]};
  const r=await fetch("https://discord.com/api/v10/webhooks/"+APPLICATION_ID+"/"+i.token+"/messages/@original",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  if(!r.ok)console.error("executor platform response",r.status);
 })().catch(e=>console.error("executor platform delivery",String(e))));
 return discordResponse(i.message?.flags&64?{type:6}:{type:5,data:{flags:64}});
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
 await cacheWindowsExecutorPages(env);
 const boards=[executorMenuBoard(rows,checkedAt,!primaryLive)];
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
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS executor_display_state(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,board_count INTEGER NOT NULL,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("INSERT INTO executor_display_state(id,revision,board_count,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,board_count=excluded.board_count,updated_at=excluded.updated_at").bind("platform-menu-windows-buttons-v3",boards.length,new Date().toISOString()).run();
}

import { WorkerEntrypoint } from "cloudflare:workers";
// Syndicate Hub Discord interactions Worker. Deploy separately with D1 binding DB,
// KEY_ISSUER service binding, DISCORD_BOT_TOKEN secret and the public key below.
// Do not place tokens in this source or a public repository.
const PUBLIC_KEY = "1eb2b56f7eaa6faf6180f687e9bca30369c0073718fd93247e743c36b5f1707b";
const GUILD_ID = "1563067666170646558";
const PREMIUM_ROLE_ID = "1564481287710974062";
const APPLICATION_ID = "1563150574805983252";
const PURGE_COMMAND = Object.freeze({
 name:"purge",
 description:"Delete recent messages in this channel",
 type:1,
 dm_permission:false,
 default_member_permissions:"8192",
 options:[
  {type:4,name:"amount",description:"Number of messages to delete",required:true,min_value:1,max_value:100},
  {type:6,name:"user",description:"Only delete messages from this user",required:false}
 ]
});
const ROLE_COMMAND = Object.freeze({
 name:"role",
 description:"Add or remove a role for a server member",
 type:1,
 dm_permission:false,
 default_member_permissions:"268435456",
 options:[
  {type:3,name:"action",description:"Choose whether to add or remove the role",required:true,choices:[
   {name:"Add",value:"add"},
   {name:"Remove",value:"remove"}
  ]},
  {type:6,name:"member",description:"Choose the server member",required:true},
  {type:3,name:"role",description:"Search the available roles",required:true,autocomplete:true}
 ]
});
const CLOSE_COMMAND = Object.freeze({
 name:"close",
 description:"Close this premium support ticket",
 type:1,
 dm_permission:false,
 default_member_permissions:"8192"
});
const VERIFIED_COMMAND = Object.freeze({
 name:"verified",
 description:"Give the premium role to the member in this ticket",
 type:1,
 dm_permission:false,
 default_member_permissions:"268435456"
});
const PAYMENT_COMMAND = Object.freeze({
 name:"payment",
 description:"Post a Premium payment option in this ticket",
 type:1,
 dm_permission:false,
 default_member_permissions:"268435456",
 options:[{type:3,name:"method",description:"Choose the payment method",required:true,choices:[
  {name:"Cash App",value:"cash_app"},
  {name:"PayPal",value:"paypal"},
  {name:"Bitcoin",value:"bitcoin"},
  {name:"Apple Pay",value:"apple_pay"}
 ]}]
});

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
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS hub_execution_versions(event_id INTEGER PRIMARY KEY,version TEXT NOT NULL)").run();
 const r=await env.DB.prepare("SELECT e.roblox_user_id,e.created_at,v.version FROM auth_events e LEFT JOIN hub_execution_versions v ON v.event_id=e.id WHERE e.event_type='hub_launch' ORDER BY e.created_at DESC LIMIT 15").all();
 const rows=await userLabels(r.results||[],"roblox_user_id");
 return reply(rows.length?"📋 **Recent Syndicate Hub executions**\n"+rows.map(x=>"• **"+x.username+"** • Roblox ID `"+x.roblox_user_id+"` • Version `"+(x.version||"Unknown")+"` • <t:"+Math.floor(Date.parse(x.created_at)/1000)+":R>").join("\n"):"No script executions recorded yet.");
}
const EXECUTION_LOGS_PAUSED=false; // Discord execution notifications enabled
async function sendExecutionLogs(env){
 const channel="1563495489662488587";
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS hub_execution_versions(event_id INTEGER PRIMARY KEY,version TEXT NOT NULL)").run();
 if(EXECUTION_LOGS_PAUSED){
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS discord_activity_cursor(id INTEGER PRIMARY KEY CHECK(id=1), last_row INTEGER NOT NULL)").run();
  const max=await env.DB.prepare("SELECT COALESCE(MAX(id),0) AS n FROM auth_events").first();
  await env.DB.prepare("INSERT OR REPLACE INTO discord_activity_cursor(id,last_row) VALUES(1,?)").bind(max?.n||0).run();
  return;
 }
 if(!env.DISCORD_BOT_TOKEN)throw Error("Discord bot token unavailable");
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS discord_activity_cursor(id INTEGER PRIMARY KEY CHECK(id=1), last_row INTEGER NOT NULL)").run();
 const cursor=await env.DB.prepare("SELECT last_row FROM discord_activity_cursor WHERE id=1").first();
 if(!cursor){const max=await env.DB.prepare("SELECT COALESCE(MAX(id),0) AS n FROM auth_events").first();await env.DB.prepare("INSERT INTO discord_activity_cursor(id,last_row) VALUES(1,?)").bind(max.n).run();return;}
 const events=await env.DB.prepare("SELECT e.id,e.roblox_user_id,e.event_type,e.created_at,v.version FROM auth_events e LEFT JOIN hub_execution_versions v ON v.event_id=e.id WHERE e.event_type IN ('hub_launch','hub_notification_test') AND e.id>? ORDER BY e.id ASC LIMIT 40").bind(cursor.last_row).all();
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
    {name:"Hub Version",value:String(e.version||"Unknown").slice(0,32),inline:true},
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
const PREMIUM_PAYMENT_OPTIONS=[
 {label:"Cash App",value:"cash_app"},
 {label:"PayPal",value:"paypal"},
 {label:"Apple Pay",value:"apple_pay"},
 {label:"Bitcoin",value:"bitcoin"}
];
async function ensurePremiumSupportTables(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS premium_support_tickets(discord_user_id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,payment_method TEXT)").run();
 const columns=await env.DB.prepare("PRAGMA table_info(premium_support_tickets)").all();
 if(!(columns.results||[]).some(column=>column.name==="payment_method"))await env.DB.prepare("ALTER TABLE premium_support_tickets ADD COLUMN payment_method TEXT").run();
}
function ticketOpeningPayload(userId,paymentMethod){
 const method=PREMIUM_PAYMENT_OPTIONS.find(option=>option.value===paymentMethod);
 const description="$10 · Lifetime Premium\n\n"+(method?"Payment option: **"+method.label+"**\n\n":"Choose a payment option below.\n\n")+"A staff member will be with you shortly.";
 return {
  content:"<@"+userId+">",
  embeds:[{title:"Premium Pricing",description,color:0x9B72CF}],
  components:[
   {type:1,components:[{type:3,custom_id:"syndicate_premium_payment_select",placeholder:"Choose a payment option",min_values:1,max_values:1,options:PREMIUM_PAYMENT_OPTIONS}]},
   {type:1,components:[{type:2,style:2,label:"Close Ticket",custom_id:"syndicate_premium_ticket_close"}]}
  ],
  allowed_mentions:{users:[userId]}
 };
}
async function createPremiumTicket(i,env){
 const user=i.member?.user;
 const userId=user?.id;
 if(!userId)return reply("I couldn't identify your Discord account.");
 await ensurePremiumSupportTables(env);
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS premium_ticket_locks(discord_user_id TEXT PRIMARY KEY,lease_until INTEGER NOT NULL)").run();
 const now=Date.now();
 const locked=await env.DB.prepare("INSERT INTO premium_ticket_locks(discord_user_id,lease_until) VALUES(?,?) ON CONFLICT(discord_user_id) DO UPDATE SET lease_until=excluded.lease_until WHERE premium_ticket_locks.lease_until<=?").bind(userId,now+60000,now).run();
 if(!locked.meta?.changes)return reply("Your premium request is already being set up. Try again in a moment.");
 try{
  const existing=await env.DB.prepare("SELECT channel_id FROM premium_support_tickets WHERE discord_user_id=? AND status='open'").bind(userId).first();
  if(existing){
   const current=await discordApi(env,"/channels/"+existing.channel_id);
   if(current.status===200)return reply("You already have an open premium request: <#"+existing.channel_id+">");
   if(current.status!==404)throw Error("Could not check your existing premium request: "+current.status);
   await env.DB.prepare("DELETE FROM premium_support_tickets WHERE discord_user_id=?").bind(userId).run();
  }
  const channels=await discordApi(env,"/guilds/"+GUILD_ID+"/channels");
  if(channels.status!==200||!Array.isArray(channels.data))throw Error("Could not list server channels: "+channels.status);
  const categories=channels.data.filter(c=>c.type===4&&/(staff|support|ticket)/i.test(c.name||""));
  const parent=categories.length===1?categories[0]:null;
  const me=await discordApi(env,"/users/@me");
  if(me.status!==200||!me.data?.id)throw Error("Could not verify the bot account.");
  const VIEW=1024, SEND=2048, HISTORY=65536, ATTACH=32768;
  const allow=String(VIEW|SEND|HISTORY|ATTACH);
  const channelBody={
   name:"premium-"+String(user.username||"member").toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,65),
   type:0,topic:"Private premium access request for Discord user "+userId,
   ...(parent?{parent_id:parent.id}:{}),
   permission_overwrites:[
    {id:GUILD_ID,type:0,allow:"0",deny:String(VIEW)},
    {id:userId,type:1,allow,deny:"0"},
    {id:me.data.id,type:1,allow,deny:"0"}
   ]
  };
  const created=await discordApi(env,"/guilds/"+GUILD_ID+"/channels","POST",channelBody);
  if(created.status!==201||!created.data?.id)throw Error("Could not create the private premium request channel: "+created.status);
  const channelId=created.data.id;
  try{
   const intro=await discordApi(env,"/channels/"+channelId+"/messages","POST",ticketOpeningPayload(userId,null));
   if(![200,201].includes(intro.status))throw Error("Ticket channel was created, but its opening message failed: "+intro.status);
   await env.DB.prepare("INSERT INTO premium_support_tickets(discord_user_id,channel_id,status,created_at,payment_method) VALUES(?,?,'open',?,NULL) ON CONFLICT(discord_user_id) DO UPDATE SET channel_id=excluded.channel_id,status='open',created_at=excluded.created_at,payment_method=NULL").bind(userId,channelId,new Date().toISOString()).run();
  }catch(e){
   await discordApi(env,"/channels/"+channelId,"DELETE");
   throw e;
  }
  return reply("Your private premium request is ready: <#"+channelId+">");
 }finally{
  await env.DB.prepare("DELETE FROM premium_ticket_locks WHERE discord_user_id=?").bind(userId).run();
 }
}
async function selectPremiumPayment(i,env){
 const userId=i.member?.user?.id,channelId=i.channel_id;
 const value=i.data?.values?.[0];
 const option=PREMIUM_PAYMENT_OPTIONS.find(item=>item.value===value);
 if(!userId||!channelId||!option)return reply("Choose a payment option from this ticket.");
 await ensurePremiumSupportTables(env);
 const ticket=await env.DB.prepare("SELECT discord_user_id,status FROM premium_support_tickets WHERE channel_id=?").bind(channelId).first();
 if(!ticket||ticket.status!=="open")return reply("This ticket is no longer active.");
 if(ticket.discord_user_id!==userId)return reply("Only the person who opened this ticket can choose the payment option.");
 await env.DB.prepare("UPDATE premium_support_tickets SET payment_method=? WHERE channel_id=? AND status='open'").bind(option.value,channelId).run();
 return discordResponse({type:7,data:ticketOpeningPayload(userId,option.value)});
}
function confirmPremiumTicketClose(){
 return {type:4,data:{flags:64,content:"Close this ticket?",components:[{type:1,components:[{type:2,style:4,label:"Close Ticket",custom_id:"syndicate_premium_ticket_confirm_close"},{type:2,style:2,label:"Keep Open",custom_id:"syndicate_premium_ticket_cancel_close"}]}]}};
}
async function archivePremiumTicket(i,env){
 const userId=i.member?.user?.id,channelId=i.channel_id;
 if(!userId||!channelId)return reply("I couldn't identify this ticket.");
 await ensurePremiumSupportTables(env);
 const ticket=await env.DB.prepare("SELECT discord_user_id,status FROM premium_support_tickets WHERE channel_id=?").bind(channelId).first();
 const channel=await discordApi(env,"/channels/"+channelId);
 if(channel.status!==200||channel.data?.guild_id!==GUILD_ID)return reply("This channel isn't an open premium ticket.");
 const ownerId=ticket?.discord_user_id||String(channel.data.topic||"").match(/^Private premium access request for Discord user ([1-9][0-9]{14,21})$/)?.[1];
 if(!ownerId)return reply("This channel isn't a premium ticket.");
 if(ownerId!==userId&&!hasManageMessages(i))return reply("Only the ticket owner or a moderator can close this ticket.");
 if(ticket?.status==="closed")return reply("Ticket already closed.");
 const denied=await discordApi(env,"/channels/"+channelId+"/permissions/"+ownerId,"PUT",{type:1,allow:"0",deny:"3072"});
 if(denied.status!==204)throw Error("Could not lock the closed ticket: "+denied.status);
 const closedName=("closed-"+String(channel.data.name||"premium-ticket").replace(/^closed-/,"")).slice(0,100);
 const renamed=await discordApi(env,"/channels/"+channelId,"PATCH",{name:closedName});
 if(renamed.status!==200)throw Error("Ticket was locked but could not be marked closed: "+renamed.status);
 await env.DB.prepare("UPDATE premium_support_tickets SET status='closed' WHERE channel_id=?").bind(channelId).run();
 return reply("Ticket closed.");
}
async function deletePremiumTicket(i,env){
 const userId=i.member?.user?.id,channelId=i.channel_id;
 if(!userId||!channelId)return reply("I couldn't identify this ticket.");
 if(!hasManageMessages(i))return reply("Only moderators can use /close.");
 await ensurePremiumSupportTables(env);
 const ticket=await env.DB.prepare("SELECT discord_user_id FROM premium_support_tickets WHERE channel_id=?").bind(channelId).first();
 const channel=await discordApi(env,"/channels/"+channelId);
 if(channel.status!==200||channel.data?.guild_id!==GUILD_ID)return reply("This channel isn't a premium ticket.");
 const ownerMatch=String(channel.data.topic||"").match(/^Private premium access request for Discord user ([1-9][0-9]{14,21})$/);
 if(!ticket&&!ownerMatch)return reply("This channel isn't a premium ticket.");
 const deleted=await discordApi(env,"/channels/"+channelId,"DELETE");
 if(deleted.status!==204&&deleted.status!==404)throw Error("Could not delete this ticket: "+deleted.status);
 await env.DB.prepare("DELETE FROM premium_support_tickets WHERE channel_id=?").bind(channelId).run();
 return reply("Ticket closed.");
}
function keyAccessPanelPayload(){
 return {
  "embeds": [
    {
      "title": "Syndicate Hub • Premium",
      "description": "Lifetime access for Premium members.\n\nUse **Get Key** to create your key or retrieve your existing one. Your key is shown privately.\n\nSee the current script features in <#1564527153108750366>.",
      "color": 8414381
    }
  ],
  "components": [
    {
      "type": 1,
      "components": [
        {
          "type": 2,
          "style": 1,
          "label": "Get Key",
          "custom_id": "syndicate_generate_key"
        },
        {
          "type": 2,
          "style": 2,
          "label": "Get Script",
          "custom_id": "syndicate_get_script"
        },
        {
          "type": 2,
          "style": 2,
          "label": "Revoke Key",
          "custom_id": "syndicate_revoke_own_key"
        },
      ]
    }
  ],
  "allowed_mentions": {
    "parse": []
  }
};
}
// Upgrade the existing bot-owned lifetime panel once, without posting duplicates.
async function syncExistingKeyAccessPanel(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS key_access_panel_layout(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,status TEXT NOT NULL,channel_id TEXT,message_id TEXT,checked_at TEXT NOT NULL)").run();
 const revision="premium-features-ticket-v8-remove-premium-button";
 const current=await env.DB.prepare("SELECT revision,status,channel_id,message_id FROM key_access_panel_layout WHERE id=1").first();
 if(current?.revision===revision&&current.status==="updated")return;
 const channelName="💎・premium-script";
 const renamed=await discordApi(env,"/channels/1563145457910153319","PATCH",{name:channelName});
 if(renamed.status!==200||renamed.data?.name!==channelName)throw Error("Premium script channel rename failed: "+renamed.status);
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
async function delayedReply(i,env,ctx,work,ephemeral=true){
 ctx.waitUntil((async()=>{
  let response;
  try{response=await work()}catch(e){console.error("delayed interaction",e);response=reply("Something went wrong. Please try again.")}
  let payload;
  try{payload=response instanceof Response?await response.json():response}catch(e){console.error("delayed parse",e);payload=null}
  const data=payload?.data||{content:"Could not load the requested information."};
  const body={
   ...(typeof data.content==="string"?{content:data.content}:{}),
   ...(Array.isArray(data.embeds)?{embeds:data.embeds}:{}),
   components:data.components||[],
   allowed_mentions:data.allowed_mentions||{parse:[]}
  };
  const url="https://discord.com/api/v10/webhooks/"+APPLICATION_ID+"/"+i.token+"/messages/@original";
  try{
   const r=await fetch(url,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   if(!r.ok)console.error("delayed response",r.status,(await r.text()).slice(0,250));
  }catch(e){console.error("delayed response network",e)}
 })());
 return discordResponse({type:5,data:ephemeral?{flags:64}:{}});
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
 if(owner)return reply(owner.discord_user_id===did?"You already have an active key. Use Get Key to retrieve it.":"An active key already exists for that Roblox account.");
 const active=await env.DB.prepare("SELECT m.user_id FROM discord_key_issuance d JOIN member_keys m ON m.key_hash=d.key_hash WHERE d.discord_user_id=? AND d.guild_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(did,GUILD_ID,now).first();
 if(active)return reply("You already have an active key for Roblox ID "+active.user_id+". Use Get Key.");
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
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS syndicate_free_panel_layout(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,message_id TEXT NOT NULL,channel_name TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
 const revision="free-features-ticket-v3";
 const current=await env.DB.prepare("SELECT revision FROM syndicate_free_panel_layout WHERE id=1").first();
 if(current?.revision===revision)return;
 const exists=await env.DB.prepare("SELECT message_id FROM syndicate_free_panel WHERE id=1").first();
 const payload={"embeds":[{"title":"Syndicate Hub • Free Access","description":"Free access for 24 hours.\n\nUse **Get Key** to create your key or retrieve your existing one. Your key is shown privately.\n\nYou can request a new key after yours expires.\n\nSee the current script features in <#1564527153108750366>.","color":8414381}],"components":[{"type":1,"components":[{"type":2,"style":1,"label":"Get Key","custom_id":"syndicate_free_generate"},{"type":2,"style":2,"label":"Get Script","custom_id":"syndicate_get_script"},{"type":2,"style":2,"label":"Revoke Key","custom_id":"syndicate_revoke_own_key"},{"type":2,"style":3,"label":"Get Premium","custom_id":"syndicate_premium_ticket"}]}],"allowed_mentions":{"parse":[]}};
 let result;
 if(exists){
  result=await discordApi(env,"/channels/"+FREE_PANEL_CHANNEL+"/messages/"+exists.message_id,"PATCH",payload);
  if(result.status!==200&&result.status!==404)throw Error("Free panel edit failed: "+result.status);
 }
 if(!exists||result.status===404){
  result=await discordApi(env,"/channels/"+FREE_PANEL_CHANNEL+"/messages","POST",payload);
  if(result.status!==200&&result.status!==201)throw Error("Free panel post failed: "+result.status);
 }
 if(!result.data?.id)throw Error("Free panel message ID unavailable");
 await env.DB.prepare("INSERT INTO syndicate_free_panel(id,message_id,created_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET message_id=excluded.message_id").bind(result.data.id,new Date().toISOString()).run();
 const channelName="📜・script";
 const channel=await discordApi(env,"/channels/"+FREE_PANEL_CHANNEL,"PATCH",{name:channelName});
 if(channel.status!==200||channel.data?.name!==channelName)throw Error("Script channel rename failed: "+channel.status);
 await env.DB.prepare("INSERT INTO syndicate_free_panel_layout(id,revision,message_id,channel_name,updated_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,message_id=excluded.message_id,channel_name=excluded.channel_name,updated_at=excluded.updated_at").bind(revision,result.data.id,channel.data.name,new Date().toISOString()).run();
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


const PLATFORM_CHANNEL = "1564527127276290098";
const PLATFORM_CHOICES = Object.freeze([
 {key:"ios",name:"iOS",emoji:"🍎",color:0xB48AE0},
 {key:"android",name:"Android",emoji:"🤖",color:0x57C785},
 {key:"pc",name:"PC",emoji:"🖥️",color:0x6EA8FE}
]);
function platformPayload() {
 return {allowed_mentions:{parse:[]},embeds:[{
  author:{name:"SYNDICATE HUB  /  COMMUNITY"},
  title:"💜 Choose Your Platform",
  description:"Choose your platform below.",
  color:0x9966CC,
  fields:PLATFORM_CHOICES.map(p=>({name:p.emoji+" "+p.name,value:"Tap below to add or remove your role.",inline:true})),
  footer:{text:"Syndicate Hub • Your platforms, your choice"}
 }],components:[{type:1,components:PLATFORM_CHOICES.map(p=>({
  type:2,style:2,label:p.name,emoji:{name:p.emoji},custom_id:"syndicate_platform_"+p.key
 }))}]};
}
async function platformDiscord(env,path,method="GET",body) {
 const r=await fetch("https://discord.com/api/v10"+path,{
  method,headers:{Authorization:"Bot "+env.DISCORD_BOT_TOKEN,...(body?{"Content-Type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)
 });
 const data=r.status===204?null:await r.json().catch(()=>null);
 if(!r.ok)throw Error("Platform roles Discord HTTP "+r.status+": "+String(data?.message||"Request failed"));
 return {status:r.status,data};
}
async function ensurePlatformPanel(env) {
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS platform_role_panel(channel_id TEXT PRIMARY KEY,message_id TEXT,role_map TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending',lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("INSERT OR IGNORE INTO platform_role_panel(channel_id,updated_at) VALUES(?,?)").bind(PLATFORM_CHANNEL,new Date().toISOString()).run();
 const claim=await env.DB.prepare("UPDATE platform_role_panel SET lease_until=? WHERE channel_id=? AND status!='ready' AND lease_until<=?").bind(Date.now()+180000,PLATFORM_CHANNEL,Date.now()).run();
 if(!claim.meta?.changes)return;
 try {
  const channel=(await platformDiscord(env,"/channels/"+PLATFORM_CHANNEL)).data;
  if(channel.guild_id!==GUILD_ID||![0,5].includes(channel.type))throw Error("Platform channel is not a text channel in this server.");
  const roles=(await platformDiscord(env,"/guilds/"+GUILD_ID+"/roles")).data;
  const me=(await platformDiscord(env,"/users/@me")).data;
  const bot=(await platformDiscord(env,"/guilds/"+GUILD_ID+"/members/"+me.id)).data;
  const botRoles=roles.filter(r=>bot.roles.includes(r.id));
  const botTop=Math.max(0,...botRoles.map(r=>r.position));
  const permissions=botRoles.reduce((bits,r)=>bits|BigInt(r.permissions||"0"),0n);
  if(!(permissions&8n)&&!(permissions&268435456n))throw Error("Bot needs Manage Roles.");
  const mapping={};
  for(const platform of PLATFORM_CHOICES) {
   const matches=roles.filter(r=>r.name.toLowerCase()===platform.name.toLowerCase());
   if(matches.length>1)throw Error("Multiple "+platform.name+" roles exist; cannot select one.");
   let role=matches[0];
   if(role&&(role.managed||BigInt(role.permissions||"0")!==0n||role.position>=botTop))throw Error(platform.name+" must be a permission-free role below the bot's highest role.");
   if(!role) {
    role=(await platformDiscord(env,"/guilds/"+GUILD_ID+"/roles","POST",{
     name:platform.name,color:platform.color,permissions:"0",hoist:false,mentionable:false
    })).data;
   }
   mapping[platform.key]=role.id;
  }
  await env.DB.prepare("UPDATE platform_role_panel SET role_map=?,updated_at=? WHERE channel_id=?").bind(JSON.stringify(mapping),new Date().toISOString(),PLATFORM_CHANNEL).run();
  const prior=await env.DB.prepare("SELECT message_id FROM platform_role_panel WHERE channel_id=?").bind(PLATFORM_CHANNEL).first();
  let messageId=prior?.message_id;
  if(!messageId) {
   // Recover a prior panel if Discord accepted it before a database write failed.
   const recent=(await platformDiscord(env,"/channels/"+PLATFORM_CHANNEL+"/messages?limit=100")).data;
   const previous=recent.find(m=>m.author?.id===me.id&&m.components?.some(row=>row.components?.some(b=>b.custom_id==="syndicate_platform_ios")));
   if(previous)messageId=previous.id;
  }
  if(messageId)await platformDiscord(env,"/channels/"+PLATFORM_CHANNEL+"/messages/"+messageId,"PATCH",platformPayload());
  else {
   const digest=await sha("platform-panel:"+GUILD_ID+":"+PLATFORM_CHANNEL);
   const message=await platformDiscord(env,"/channels/"+PLATFORM_CHANNEL+"/messages","POST",{
    ...platformPayload(),nonce:BigInt("0x"+digest.slice(0,18)).toString(),enforce_nonce:true
   });
   messageId=message.data.id;
  }
  await env.DB.prepare("UPDATE platform_role_panel SET message_id=?,status='ready',last_error=NULL,lease_until=0,updated_at=? WHERE channel_id=?").bind(messageId,new Date().toISOString(),PLATFORM_CHANNEL).run();
 }catch(e){
  await env.DB.prepare("UPDATE platform_role_panel SET status='error',last_error=?,lease_until=?,updated_at=? WHERE channel_id=?").bind(String(e).slice(0,1000),Date.now()+60000,new Date().toISOString(),PLATFORM_CHANNEL).run();
  throw e;
 }
}
async function togglePlatformRole(i,env) {
 const platform=PLATFORM_CHOICES.find(p=>"syndicate_platform_"+p.key===i.data?.custom_id);
 if(!platform||i.guild_id!==GUILD_ID||i.channel_id!==PLATFORM_CHANNEL||!/^\d{15,22}$/.test(i.member?.user?.id||""))return reply("This platform button is not available here.");
 const panel=await env.DB.prepare("SELECT message_id,role_map,status FROM platform_role_panel WHERE channel_id=?").bind(PLATFORM_CHANNEL).first();
 if(panel?.status!=="ready"||panel.message_id!==i.message?.id)return reply("Please use the current platform role panel.");
 const roleId=JSON.parse(panel.role_map)[platform.key];
 if(!/^\d{15,22}$/.test(roleId||""))return reply("This platform role is not configured yet.");
 const lock=i.member.user.id+":"+roleId, ticket=crypto.randomUUID();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS platform_role_locks(lock_key TEXT PRIMARY KEY,ticket TEXT NOT NULL,expires_at INTEGER NOT NULL)").run();
 const claim=await env.DB.prepare("INSERT INTO platform_role_locks(lock_key,ticket,expires_at) VALUES(?,?,?) ON CONFLICT(lock_key) DO UPDATE SET ticket=excluded.ticket,expires_at=excluded.expires_at WHERE platform_role_locks.expires_at<=?").bind(lock,ticket,Date.now()+45000,Date.now()).run();
 if(!claim.meta?.changes)return reply("Your platform role is already being updated. Give it a moment.");
 try {
  const roles=(await platformDiscord(env,"/guilds/"+GUILD_ID+"/roles")).data;
  const role=roles.find(r=>r.id===roleId);
  if(!role||role.managed||BigInt(role.permissions||"0")!==0n||role.name.toLowerCase()!==platform.name.toLowerCase())return reply("This platform role changed. Ask an administrator to check the panel.");
  const member=(await platformDiscord(env,"/guilds/"+GUILD_ID+"/members/"+i.member.user.id)).data;
  const remove=member.roles.includes(roleId);
  await platformDiscord(env,"/guilds/"+GUILD_ID+"/members/"+i.member.user.id+"/roles/"+roleId,remove?"DELETE":"PUT");
  return reply(platform.emoji+" **"+platform.name+"** role "+(remove?"removed":"added")+". You can select multiple platforms.");
 }catch(e){
  console.error("platform role toggle",String(e));
  return reply("I couldn't update that role. Please try again; if it continues, an administrator should check my Manage Roles permission and role position.");
 }finally{
  await env.DB.prepare("DELETE FROM platform_role_locks WHERE lock_key=? AND ticket=?").bind(lock,ticket).run();
 }
}


const VIP_ROLE_ID = "1563210797780303983";
const BETA_HUB_CATEGORY_ID = "1563112370950246440";
const BETA_INVITE_CODE = "6K2qGPpuEH";
const hasVipAccess = i => i.guild_id===GUILD_ID &&
 (isAdmin(i)||Array.isArray(i.member?.roles)&&i.member.roles.includes(VIP_ROLE_ID));

const MANAGE_MESSAGES_PERMISSION = 8192n;
const MANAGE_ROLES_PERMISSION = 268435456n;
const hasManageRoles = i => {
 const permissions=BigInt(i.member?.permissions||"0");
 return i.guild_id===GUILD_ID&&((permissions&8n)!==0n||(permissions&MANAGE_ROLES_PERMISSION)!==0n);
};
const hasManageMessages = i => {
 const permissions=BigInt(i.member?.permissions||"0");
 return i.guild_id===GUILD_ID && ((permissions&8n)!==0n || (permissions&MANAGE_MESSAGES_PERMISSION)!==0n);
};
const interactionOptions = i => {
 const options=i.data?.options||[];
 return options.find(option=>option.type===1)?.options||options;
};
const interactionOption = (i,name) => interactionOptions(i).find(option=>option.name===name);
function purgeMessageTimestamp(message) {
 const parsed=Date.parse(message?.timestamp||"");
 if(Number.isFinite(parsed))return parsed;
 try{return Number((BigInt(String(message.id))>>22n)+1420070400000n)}catch{return 0}
}
async function purgeDiscord(env,path,method="GET",body) {
 for(let attempt=0;attempt<3;attempt++){
  const result=await discordApi(env,path,method,body);
  if(result.status!==429||attempt===2)return result;
  const retry=Number(result.data?.retry_after);
  await new Promise(resolve=>setTimeout(resolve,Math.min(5000,Math.max(250,Number.isFinite(retry)?retry*1000:1000))));
 }
}
async function purgeMessages(i,env) {
 if(!hasManageMessages(i))return reply("⛔ You need Manage Messages permission to use /purge.");
 const amount=Number(interactionOption(i,"amount")?.value);
 if(!Number.isInteger(amount)||amount<1||amount>100)return reply("Choose a purge amount from 1 to 100.");
 const userId=String(interactionOption(i,"user")?.value||"");
 if(userId&&!isUserId(userId))return reply("That user could not be resolved.");
 const channelId=String(i.channel_id||"");
 if(!isUserId(channelId))return reply("This command can only run inside a Discord text channel.");
 const selected=[];
 let before="";
 const pages=userId?20:1;
 for(let page=0;page<pages&&selected.length<amount;page++){
  const query="/channels/"+channelId+"/messages?limit=100"+(before?"&before="+encodeURIComponent(before):"");
  const result=await purgeDiscord(env,query);
  if(result.status!==200||!Array.isArray(result.data))return reply("I couldn't read this channel's messages. Check my View Channel and Read Message History permissions.");
  const batch=result.data;
  if(!batch.length)break;
  for(const message of batch){
   if(!userId||message.author?.id===userId)selected.push(message);
   if(selected.length>=amount)break;
  }
  before=batch[batch.length-1]?.id||"";
  if(batch.length<100)break;
 }
 if(!selected.length)return reply(userId?"No messages from <@"+userId+"> were found in the recent history I scanned.":"There were no messages to purge in this channel.");
 const cutoff=Date.now()-14*24*60*60*1000;
 const recent=[],individual=[];
 for(const message of selected){
  if(purgeMessageTimestamp(message)>=cutoff)recent.push(message);
  else individual.push(message);
 }
 let deleted=0,failed=0;
 const deleteIndividually=async message=>{
  const result=await purgeDiscord(env,"/channels/"+channelId+"/messages/"+message.id,"DELETE");
  if(result.status===204||result.status===200){deleted++;return}
  failed++;
 };
 for(let index=0;index<recent.length;index+=100){
  const chunk=recent.slice(index,index+100);
  if(chunk.length<2){
   for(const message of chunk)await deleteIndividually(message);
   continue;
  }
  const result=await purgeDiscord(env,"/channels/"+channelId+"/messages/bulk-delete","POST",{messages:chunk.map(message=>message.id)});
  if(result.status===204||result.status===200)deleted+=chunk.length;
  else for(const message of chunk)await deleteIndividually(message);
 }
 for(const message of individual)await deleteIndividually(message);
 const scope=userId?" from <@"+userId+">":"";
 const suffix=failed?" "+failed+" message(s) could not be deleted; check my Manage Messages permission.":"";
 return reply("🧹 Deleted **"+deleted+"** message"+(deleted===1?"":"s")+scope+"."+suffix);
}

function autocompleteResponse(choices=[]){
 return new Response(JSON.stringify({type:8,data:{choices}}),{headers:{"content-type":"application/json"}});
}
async function roleAssignmentContext(env){
 const roles=(await platformDiscord(env,"/guilds/"+GUILD_ID+"/roles")).data;
 const me=(await platformDiscord(env,"/users/@me")).data;
 const member=(await platformDiscord(env,"/guilds/"+GUILD_ID+"/members/"+me.id)).data;
 const positions=new Map(roles.map(role=>[role.id,Number(role.position)||0]));
 const botPosition=Math.max(0,...(member.roles||[]).map(id=>positions.get(id)||0));
 return {roles,botPosition};
}
async function verifyTicketMember(i,env){
 if(!hasManageRoles(i))return reply("⛔ You need Manage Roles permission to use /verified.");
 const channelId=i.channel_id;
 if(!channelId)return reply("Use /verified inside the member's premium ticket.");
 await ensurePremiumSupportTables(env);
 const ticket=await env.DB.prepare("SELECT discord_user_id,status FROM premium_support_tickets WHERE channel_id=?").bind(channelId).first();
 if(!ticket||ticket.status!=="open")return reply("Use /verified inside an open premium ticket.");
 const memberId=ticket.discord_user_id;
 const member=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+memberId);
 if(member.status!==200)return reply("The ticket owner is no longer in the server.");
 let context;
 try{context=await roleAssignmentContext(env)}catch(e){console.error("verified role setup",String(e));return reply("I couldn't check the role setup. Check that I have Manage Roles permission.");}
 const vip=context.roles.find(role=>role.id===VIP_ROLE_ID);
 const premium=context.roles.find(role=>role.id===PREMIUM_ROLE_ID);
 const canManage=role=>role&&!role.managed&&(BigInt(role.permissions||"0")&8n)===0n&&Number(role.position)<context.botPosition;
 if(!canManage(vip)||!canManage(premium))return reply("I can't manage the VIP or Premium role. Check that both are below my highest role and aren't administrator or integration-managed roles.");
 const currentRoles=Array.isArray(member.data?.roles)?member.data.roles:[];
 const alreadyPremium=currentRoles.includes(PREMIUM_ROLE_ID);
 const hasVip=currentRoles.includes(VIP_ROLE_ID);
 if(alreadyPremium&&!hasVip)return reply("That member is already verified.");
 if(!alreadyPremium){
  const added=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+memberId+"/roles/"+PREMIUM_ROLE_ID,"PUT");
  if(added.status!==204)return reply("I couldn't add the Premium role. Check my Manage Roles permission and role position.");
 }
 if(hasVip){
  const removed=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+memberId+"/roles/"+VIP_ROLE_ID,"DELETE");
  if(removed.status!==204){
   if(!alreadyPremium){
    const rollback=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+memberId+"/roles/"+PREMIUM_ROLE_ID,"DELETE");
    if(rollback.status!==204)console.error("verified role rollback",rollback.status,memberId);
   }
   return reply("I couldn't remove the VIP role, so the role change was rolled back where possible.");
  }
 }
 return {
  type:4,
  data:{
   embeds:[{
    title:"Welcome to Premium",
    description:"Congratulations <@"+memberId+">, you’re now a Premium member!\n\nThank you for your contribution. You now have access to <#1563145457910153319>.",
    color:0x9B72CF,
    footer:{text:"Syndicate Hub • Premium access"}
   }],
   allowed_mentions:{users:[memberId]}
  }
 };
}
async function sendPremiumPaymentLink(i,env){
 if(!hasManageRoles(i))return reply("⛔ You need Manage Roles permission to use /payment.");
 const channelId=i.channel_id;
 if(!channelId)return reply("Use /payment inside the member's premium ticket.");
 await ensurePremiumSupportTables(env);
 const ticket=await env.DB.prepare("SELECT discord_user_id,status FROM premium_support_tickets WHERE channel_id=?").bind(channelId).first();
 if(!ticket||ticket.status!=="open")return reply("Use /payment inside an open premium ticket.");
 const method=String(interactionOption(i,"method")?.value||"");
 const cashAppLink="https://cash.app/pay/link/5naenms2";
 const methods={
  cash_app:{name:"Cash App",link:cashAppLink,button:"Pay $10 with Cash App",note:""},
  paypal:{name:"PayPal",link:"https://www.paypal.me/ThatOneThing91/10",button:"Pay $10 with PayPal",note:""},
 }
 if(method==="bitcoin"){
  const posted=await discordApi(env,"/channels/"+channelId+"/messages","POST",{
   content:"<@"+ticket.discord_user_id+">",
   embeds:[{
    title:"Bitcoin Payment · $10",
    description:"Send $10 worth of Bitcoin on the Bitcoin network. After paying, reply here so staff can confirm your payment.",
    fields:[
     {name:"Bitcoin Address",value:"`3LxMtojegenRhbhJ4Y4aPCzHJ8ckzwWxVd`",inline:false},
     {name:"Bitcoin Address",value:"```\n3LxMtojegenRhbhJ4Y4aPCzHJ8ckzwWxVd\n```",inline:false}
    ],
    color:0x9B72CF
   }],
   allowed_mentions:{users:[ticket.discord_user_id]}
  });
  if(![200,201].includes(posted.status))return reply("I couldn't post the Bitcoin address. Check the bot's permissions in this ticket.");
  return reply("Bitcoin payment details posted in this ticket.");
 }
 if(method==="apple_pay"){
  const posted=await discordApi(env,"/channels/"+channelId+"/messages","POST",{
   content:"<@"+ticket.discord_user_id+">",
   embeds:[{
    title:"Apple Cash Payment · $10",
    description:"Before paying, text **260-827-7610** to confirm it’s the right account and avoid sending money to the wrong person.\n\nAfter paying, reply here so a staff member can confirm.",
    color:0x9B72CF
   }],
   allowed_mentions:{users:[ticket.discord_user_id]}
  });
  if(![200,201].includes(posted.status))return reply("I couldn't post the Apple Cash details. Check the bot's permissions in this ticket.");
  return reply("Apple Cash payment details posted in this ticket.");
 }
 const payment=methods[method];
 if(!payment)return reply("Choose a payment method.");
 const posted=await discordApi(env,"/channels/"+channelId+"/messages","POST",{
  content:"<@"+ticket.discord_user_id+">",
  embeds:[{
   title:"Premium Payment · $10",
   description:"Send $10 for lifetime Premium using "+payment.name+". "+(payment.note?payment.note+" ":"")+"\n\n[Open payment link]("+payment.link+")\n\nAfter paying, reply here so staff can confirm your payment.",
   color:0x9B72CF
  }],
  components:[{type:1,components:[{type:2,style:5,label:payment.button,url:payment.link}]}],
  allowed_mentions:{users:[ticket.discord_user_id]}
 });
 if(![200,201].includes(posted.status))return reply("I couldn't post the payment link. Check the bot's permissions in this ticket.");
 return reply(payment.name+" payment link posted in this ticket.");
}
async function roleAutocomplete(i,env){
 if(!hasManageRoles(i))return autocompleteResponse();
 try{
  const options=interactionOptions(i),focused=options.find(option=>option.focused),query=String(focused?.value||"").toLowerCase();
  const {roles,botPosition}=await roleAssignmentContext(env);
  const choices=roles.filter(role=>role.id!==GUILD_ID&&!role.managed&&Number(role.position)<botPosition
   &&(BigInt(role.permissions||"0")&8n)===0n
   &&String(role.name||"").toLowerCase().includes(query))
   .sort((a,b)=>(Number(b.position)||0)-(Number(a.position)||0)||a.name.localeCompare(b.name))
   .slice(0,25).map(role=>({name:String(role.name).slice(0,100),value:role.id}));
  return autocompleteResponse(choices);
 }catch(e){console.error("role autocomplete",String(e));return autocompleteResponse();}
}
async function addRoleToMember(i,env){
 if(!hasManageRoles(i))return reply("⛔ You need Manage Roles permission to use /role add.");
 const memberId=String(interactionOption(i,"member")?.value||"");
 const roleId=String(interactionOption(i,"role")?.value||"");
 if(!isUserId(memberId)||!isUserId(roleId))return reply("Choose a server member and a role from the lists.");
 let context;
 try{context=await roleAssignmentContext(env)}catch(e){console.error("role assignment setup",String(e));return reply("I couldn't load the available roles. Check that I have Manage Roles permission.");}
 const role=context.roles.find(item=>item.id===roleId);
 if(!role)return reply("That role is no longer available. Run /role add again and select a role from the list.");
 if(role.id===GUILD_ID||role.managed||(BigInt(role.permissions||"0")&8n)!==0n||Number(role.position)>=context.botPosition)
  return reply("I can't assign that role. Choose an unmanaged, non-administrator role below my highest role.");
 const target=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+memberId);
 if(target.status!==200)return reply("That member isn't currently in this server.");
 const assigned=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+memberId+"/roles/"+roleId,"PUT");
 if(assigned.status!==204)return reply("I couldn't assign that role. Check that I have Manage Roles permission and that my role is above it.");
 return reply("✅ Added <@&"+roleId+"> to <@"+memberId+">.");
}
async function removeRoleFromMember(i,env){
 if(!hasManageRoles(i))return reply("⛔ You need Manage Roles permission to use /role remove.");
 const memberId=String(interactionOption(i,"member")?.value||"");
 const roleId=String(interactionOption(i,"role")?.value||"");
 if(!isUserId(memberId)||!isUserId(roleId))return reply("Choose a server member and a role from the lists.");
 let context;
 try{context=await roleAssignmentContext(env)}catch(e){console.error("role removal setup",String(e));return reply("I couldn't load the available roles. Check that I have Manage Roles permission.");}
 const role=context.roles.find(item=>item.id===roleId);
 if(!role)return reply("That role is no longer available. Run /role remove again and select a role from the list.");
 if(role.id===GUILD_ID||role.managed||(BigInt(role.permissions||"0")&8n)===8n||Number(role.position)>=context.botPosition)
  return reply("I can't remove that role. Choose an unmanaged, non-administrator role below my highest role.");
 const target=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+memberId);
 if(target.status!==200)return reply("That member isn't currently in this server.");
 if(!Array.isArray(target.data?.roles)||!target.data.roles.includes(roleId))return reply("That member doesn't have this role.");
 const removed=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+memberId+"/roles/"+roleId,"DELETE");
 if(removed.status!==204)return reply("I couldn't remove that role. Check that I have Manage Roles permission and that my role is above it.");
 return reply("✅ Removed <@&"+roleId+"> from <@"+memberId+">.");
}

function needsBetaAccess(i) {
 if(i.type===2)return i.data?.name==="getkey";
 if(i.type===5)return ["syndicate_key_modal","syndicate_free_modal"].includes(i.data?.custom_id);
 return i.type===3&&["syndicate_generate_key","syndicate_free_generate","syndicate_free_view","syndicate_get_script","syndicate_revoke_own_key","syndicate_confirm_self_revoke"].includes(i.data?.custom_id);
}
function betaOverwrites(channel,roles,botId,accessRoleId=VIP_ROLE_ID) {
 const VIEW=1024n;
 const allowedRoles=new Set(roles.filter(r=>r.tags?.bot_id||(BigInt(r.permissions||"0")&8n)!==0n
   ||["Sovereign","Enforcer"].includes(r.name)).map(r=>r.id));
 allowedRoles.add(accessRoleId);
 const overwrites=(channel.permission_overwrites||[]).map(o=>({...o,allow:String(o.allow||"0"),deny:String(o.deny||"0")}));
 for(const o of overwrites){
  if(o.id===GUILD_ID&&o.type===0){o.allow=String(BigInt(o.allow)&~VIEW);o.deny=String(BigInt(o.deny)|VIEW);}
  else if(o.type===0&&allowedRoles.has(o.id)||o.type===1&&o.id===botId){o.allow=String(BigInt(o.allow)|VIEW);o.deny=String(BigInt(o.deny)&~VIEW);}
  else {o.allow=String(BigInt(o.allow)&~VIEW);}
 }
 if(!overwrites.some(o=>o.type===0&&o.id===GUILD_ID))overwrites.push({id:GUILD_ID,type:0,allow:"0",deny:"1024"});
 if(!overwrites.some(o=>o.type===0&&o.id===accessRoleId))overwrites.push({id:accessRoleId,type:0,allow:"1024",deny:"0"});
 if(!overwrites.some(o=>o.type===1&&o.id===botId))overwrites.push({id:botId,type:1,allow:"1024",deny:"0"});
 return overwrites;
}
async function ensureBetaHubAccess(env) {
 const revision="vip-hub-access-v2";
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS beta_hub_access(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,status TEXT NOT NULL,backup TEXT,details TEXT,last_error TEXT,lease_until INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("INSERT OR IGNORE INTO beta_hub_access(id,revision,status,updated_at) VALUES(1,?,'pending',?)").bind(revision,new Date().toISOString()).run();
 const claim=await env.DB.prepare("UPDATE beta_hub_access SET lease_until=? WHERE id=1 AND (revision!=? OR status!='ready') AND lease_until<=?").bind(Date.now()+180000,revision,Date.now()).run();
 if(!claim.meta?.changes)return;
 try {
  const roles=(await platformDiscord(env,"/guilds/"+GUILD_ID+"/roles")).data;
  const beta=roles.find(r=>r.id===VIP_ROLE_ID);
  if(!beta||beta.managed||beta.name.toLowerCase()!=="vip")throw Error("VIP role could not be verified.");
  const me=(await platformDiscord(env,"/users/@me")).data;
  const channels=(await platformDiscord(env,"/guilds/"+GUILD_ID+"/channels")).data;
  const category=channels.find(c=>c.id===BETA_HUB_CATEGORY_ID);
  if(!category||category.type!==4||!category.name.toLowerCase().includes("syndicate"))throw Error("Syndicate Hub category could not be verified.");
  const affected=channels.filter(c=>c.id===BETA_HUB_CATEGORY_ID||c.parent_id===BETA_HUB_CATEGORY_ID);
  const invite=(await platformDiscord(env,"/invites/"+BETA_INVITE_CODE+"?with_counts=true")).data;
  if(invite.guild?.id!==GUILD_ID)throw Error("The supplied invite is for another server.");
  const inviteRoles=invite.roles||[];
  const grantsBeta=inviteRoles.some(r=>r.id===VIP_ROLE_ID)||(invite.role_ids||[]).includes(VIP_ROLE_ID);
  await env.DB.prepare("UPDATE beta_hub_access SET backup=COALESCE(backup,?),updated_at=? WHERE id=1").bind(JSON.stringify(affected),new Date().toISOString()).run();
  const modified=[];
  for(const channel of affected) {
   const requiredRole=channel.id==="1563145457910153319"?PREMIUM_ROLE_ID:VIP_ROLE_ID;
   const overwrites=betaOverwrites(channel,roles,me.id,requiredRole);
   const changed=(await platformDiscord(env,"/channels/"+channel.id,"PATCH",{permission_overwrites:overwrites})).data;
   const everyone=changed.permission_overwrites?.find(o=>o.id===GUILD_ID&&o.type===0);
   const betaOverwrite=changed.permission_overwrites?.find(o=>o.id===requiredRole&&o.type===0);
   if(!(BigInt(everyone?.deny||"0")&1024n)||!(BigInt(betaOverwrite?.allow||"0")&1024n))throw Error("Could not confirm channel visibility for "+channel.id);
   modified.push({id:channel.id,name:channel.name});
  }
  const details={invite:BETA_INVITE_CODE,invite_roles:inviteRoles.map(r=>({id:r.id,name:r.name})),grants_beta:grantsBeta,beta_role_id:beta.id,channels:modified};
  await env.DB.prepare("UPDATE beta_hub_access SET revision=?,status='ready',details=?,last_error=NULL,lease_until=0,updated_at=? WHERE id=1").bind(revision,JSON.stringify(details),new Date().toISOString()).run();
 }catch(e){
  await env.DB.prepare("UPDATE beta_hub_access SET status='error',last_error=?,lease_until=?,updated_at=? WHERE id=1").bind(String(e).slice(0,1500),Date.now()+60000,new Date().toISOString()).run();
  throw e;
 }
}


async function ensurePremiumChannelAndRemoveCommands(env) {
 const revision="premium-only-buttons-v12-payment-method-selector";
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS premium_channel_setup(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,status TEXT NOT NULL,backup TEXT,details TEXT,last_error TEXT,lease_until INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("INSERT OR IGNORE INTO premium_channel_setup(id,revision,status,updated_at) VALUES(1,?,'pending',?)").bind(revision,new Date().toISOString()).run();
 const claim=await env.DB.prepare("UPDATE premium_channel_setup SET lease_until=? WHERE id=1 AND (revision!=? OR status!='ready') AND lease_until<=?").bind(Date.now()+180000,revision,Date.now()).run();
 if(!claim.meta?.changes)return;
 try {
  const globalPath="/applications/"+APPLICATION_ID+"/commands";
  const guildPath="/applications/"+APPLICATION_ID+"/guilds/"+GUILD_ID+"/commands";
  await platformDiscord(env,globalPath,"PUT",[]);
  await platformDiscord(env,guildPath,"PUT",[PURGE_COMMAND,ROLE_COMMAND,CLOSE_COMMAND,VERIFIED_COMMAND,PAYMENT_COMMAND]);
  const globalCommands=(await platformDiscord(env,globalPath)).data;
  const guildCommands=(await platformDiscord(env,guildPath)).data;
  if(!Array.isArray(globalCommands)||globalCommands.length)throw Error("Global slash command removal was not confirmed.");
  if(!Array.isArray(guildCommands))throw Error("Guild slash command registration was not confirmed.");
  const purgeCommand=guildCommands.find(command=>command.name==="purge"&&command.type===1);
  const roleCommand=guildCommands.find(command=>command.name==="role"&&command.type===1);
  const closeCommand=guildCommands.find(command=>command.name==="close"&&command.type===1);
  const verifiedCommand=guildCommands.find(command=>command.name==="verified"&&command.type===1);
  const paymentCommand=guildCommands.find(command=>command.name==="payment"&&command.type===1);
  if(!purgeCommand)throw Error("Purge slash command registration was not confirmed.");
  if(!roleCommand)throw Error("Role slash command registration was not confirmed.");
  if(!closeCommand)throw Error("Close slash command registration was not confirmed.");
  if(!verifiedCommand)throw Error("Verified slash command registration was not confirmed.");
  if(!paymentCommand)throw Error("Payment slash command registration was not confirmed.");
  const channel=(await platformDiscord(env,"/channels/1563145457910153319")).data;
  if(channel.guild_id!==GUILD_ID)throw Error("Premium channel is not in this server.");
  const roles=(await platformDiscord(env,"/guilds/"+GUILD_ID+"/roles")).data;
  const premium=roles.find(r=>r.id===PREMIUM_ROLE_ID);
  if(!premium||premium.managed||premium.name.toLowerCase()!=="premium")throw Error("Premium role could not be verified.");
  const me=(await platformDiscord(env,"/users/@me")).data;
  await env.DB.prepare("UPDATE premium_channel_setup SET backup=COALESCE(backup,?),updated_at=? WHERE id=1").bind(JSON.stringify(channel.permission_overwrites||[]),new Date().toISOString()).run();
  const overwrites=betaOverwrites(channel,roles,me.id,PREMIUM_ROLE_ID);
  const changed=(await platformDiscord(env,"/channels/"+channel.id,"PATCH",{permission_overwrites:overwrites})).data;
  const everyone=changed.permission_overwrites?.find(o=>o.type===0&&o.id===GUILD_ID);
  const premiumOverwrite=changed.permission_overwrites?.find(o=>o.type===0&&o.id===PREMIUM_ROLE_ID);
  const beta=changed.permission_overwrites?.find(o=>o.type===0&&o.id===VIP_ROLE_ID);
  if(!(BigInt(everyone?.deny||"0")&1024n)||!(BigInt(premiumOverwrite?.allow||"0")&1024n)
   ||BigInt(beta?.allow||"0")&1024n)throw Error("Premium-only channel visibility was not confirmed.");
  const details={channel_id:channel.id,channel_name:channel.name,required_role:premium.id,global_commands:globalCommands.length,guild_commands:guildCommands.length,purge_command_id:purgeCommand.id};
  await env.DB.prepare("UPDATE premium_channel_setup SET revision=?,status='ready',details=?,last_error=NULL,lease_until=0,updated_at=? WHERE id=1").bind(revision,JSON.stringify(details),new Date().toISOString()).run();
 }catch(e){
  await env.DB.prepare("UPDATE premium_channel_setup SET status='error',last_error=?,lease_until=?,updated_at=? WHERE id=1").bind(String(e).slice(0,1500),Date.now()+60000,new Date().toISOString()).run();
  throw e;
 }
}
async function maintainCommunitySetup(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS community_setup(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,status TEXT NOT NULL,details TEXT,last_error TEXT,updated_at TEXT NOT NULL)").run();
 const revision="introductions-custom-welcome-and-join-role-v2";
 const saved=await env.DB.prepare("SELECT revision,status FROM community_setup WHERE id=1").first();
 if(saved?.revision===revision&&saved.status==="ready")return;
 const channels=await discordApi(env,"/guilds/"+GUILD_ID+"/channels");
 if(channels.status!==200||!Array.isArray(channels.data))throw Error("Could not load server channels: "+channels.status);
 const normalize=name=>String(name||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
 const introductions=channels.data.filter(c=>[0,5].includes(c.type)&&normalize(c.name)==="introductions");
 if(introductions.length!==1)throw Error("Expected one introductions channel; found "+introductions.length);
 const guild=await discordApi(env,"/guilds/"+GUILD_ID+"?with_counts=false");
 if(guild.status!==200)throw Error("Could not read server settings: "+guild.status);
 const suppressJoin=Number(guild.data.system_channel_flags||0)|1;
 if(guild.data.system_channel_id!==introductions[0].id||Number(guild.data.system_channel_flags||0)!==suppressJoin){
  const changed=await discordApi(env,"/guilds/"+GUILD_ID,"PATCH",{system_channel_id:introductions[0].id,system_channel_flags:suppressJoin});
  if(changed.status!==200||changed.data?.system_channel_id!==introductions[0].id||!(Number(changed.data?.system_channel_flags||0)&1))throw Error("Could not configure introductions for custom join welcomes: "+changed.status);
 }
 const club=channels.data.filter(c=>[0,5].includes(c.type)&&normalize(c.name)==="club-members");
 if(club.length>1)throw Error("More than one club members channel matched; leaving them untouched.");
 if(club.length===1){
  const removed=await discordApi(env,"/channels/"+club[0].id,"DELETE");
  if(removed.status!==204)throw Error("Could not delete the club members channel: "+removed.status);
 }
 const details={introductions_channel_id:introductions[0].id,join_notices:"discord_system_channel",deleted_club_channel_id:club[0]?.id||null};
 await env.DB.prepare("INSERT INTO community_setup(id,revision,status,details,last_error,updated_at) VALUES(1,?,'ready',?,NULL,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status='ready',details=excluded.details,last_error=NULL,updated_at=excluded.updated_at").bind(revision,JSON.stringify(details),new Date().toISOString()).run();
}
async function maintainFeatureChannel(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS feature_channel_maintenance(id INTEGER PRIMARY KEY CHECK(id=1),snapshot TEXT,status TEXT NOT NULL,details TEXT,last_error TEXT,updated_at TEXT NOT NULL)").run();
 const state=await env.DB.prepare("SELECT snapshot,status,details FROM feature_channel_maintenance WHERE id=1").first();
 const revision="features-current-5.23-v1";
 if(state?.status==="completed"&&JSON.parse(state.details||"{}").revision===revision)return;
 if(!state?.snapshot)throw Error("Feature channel snapshot unavailable");
 try{
  const snapshot=JSON.parse(state.snapshot);
  const featureId="1564527153108750366";
  const messageId="1566059206811848775";
  const expected=snapshot.messages.find(m=>m.id===messageId);
  if(!expected||snapshot.features.id!==featureId||snapshot.changelog.id!==SCRIPT_UPDATES_CHANNEL)throw Error("Unexpected channel snapshot");
  const channel=await discordApi(env,"/channels/"+featureId);
  if(channel.status!==200||channel.data.guild_id!==GUILD_ID)throw Error("Features channel unavailable or wrong server");
  const message=await discordApi(env,"/channels/"+featureId+"/messages/"+messageId);
  const content="💜 SYNDICATE HUB — STORAGE HUNTERS\n\n**AUCTION FARMING**\n• Garage priorities, retries, affordability checks, and vehicle-full stop\n• Auto Bid, Pause Auction, and Lost & Found collection\n\n**UNLOADING**\n• Instant Unload and Auto Unload When Full\n• Manual Unload spawns your vehicle before moving to your unload pad\n• Draggable sale-rate badge for Manual Unload\n\n**SHOP**\n• Auto Wash, Auto Repair, and Auto Open Safes\n• Daily reward and Museum gift collection\n• Auto Buy drinks with stock, prices, and restock timer\n• Continuous Auto Drink and one-tap Luck 1, 2, 3 + Rush\n• Auto Shop Offers with a minimum offer setting\n\n**GRADING & QUICK SELL**\n• Grade All or Grade Selected with separate filters\n• Sell Selected / Keep Selected by rarity, mutation, and drink/potion\n• Quick Sell Preset, Keep All Mutations, and accessory sale control\n• Protects favorites, worn items, consumables, seeds, rods, crates, and safes\n• Sales in batches of 200, pawn-rate trigger, and queue-item restore\n• Live sale rate, countdown, filter diagnostics, and scroll-position memory\n\n**PLOT & GARDEN**\n• Load, place, and pick up plot potions\n• Auto Plant, Auto Water, and Auto Harvest\n• Launch separate Plot Studio tools\n\n**EVENTS**\n• Auto Trick or Treat, Grave Digger, and Auto Cauldron\n• Zombie Collector and Turn In Zombies\n• Halloween Market rolls, including x5\n\n**ACTIVITIES & TOOLS**\n• Auto Basketball, Auto Fishing, Hay Knocker, Tree Knocker, and Police Auction\n• Favorite Toggle, Ore Deposit, and Instant Auction Entry\n• Mobile jump button size control\n\n**MENU & ACCESS**\n• Draggable, resizable menu with a collapsible sidebar and minimize icon\n• Touch, controller, mouse, and keyboard support\n• Accent colors, transparency, animated sky, and pixel stars\n• Comma key menu toggle and confirmation before closing\n• Free 24-hour and Premium lifetime key access";
  if(message.status!==200||message.data.author?.id!==APPLICATION_ID)throw Error("Features message unavailable or wrong author");
  if(message.data.content!==expected.content&&message.data.content!==content)throw Error("Features message changed since inspection");
  const changed=await discordApi(env,"/channels/"+featureId+"/messages/"+messageId,"PATCH",{content,allowed_mentions:{parse:[]}});
  if(changed.status!==200||changed.data.content!==content)throw Error("Feature list update was not confirmed");
  const channelName="📋・features";
  const renamed=await discordApi(env,"/channels/"+featureId,"PATCH",{name:channelName});
  if(renamed.status!==200||renamed.data.name!==channelName)throw Error("Features channel rename was not confirmed");
  const changelog=await discordApi(env,"/channels/"+SCRIPT_UPDATES_CHANNEL);
  if(changelog.status===200){
   if(changelog.data.guild_id!==GUILD_ID||changelog.data.id!==snapshot.changelog.id||changelog.data.name!==snapshot.changelog.name)throw Error("Changelog identity changed");
   const removed=await discordApi(env,"/channels/"+SCRIPT_UPDATES_CHANNEL,"DELETE");
   if(removed.status!==200&&removed.status!==204)throw Error("Changelog deletion failed: "+removed.status);
  }else if(changelog.status!==404)throw Error("Changelog lookup failed: "+changelog.status);
  const verified=await discordApi(env,"/channels/"+SCRIPT_UPDATES_CHANNEL);
  if(verified.status!==404)throw Error("Changelog deletion was not confirmed");
  const details={revision,feature_channel:featureId,channel_name:channelName,message_id:messageId,content_length:content.length,changelog_channel:SCRIPT_UPDATES_CHANNEL,changelog_deleted:true};
  await env.DB.prepare("UPDATE feature_channel_maintenance SET status='completed',details=?,last_error=NULL,updated_at=? WHERE id=1").bind(JSON.stringify(details),new Date().toISOString()).run();
 }catch(e){
  await env.DB.prepare("UPDATE feature_channel_maintenance SET status='error',last_error=?,updated_at=? WHERE id=1").bind(String(e).slice(0,1200),new Date().toISOString()).run();
  throw e;
 }
}

async function removeObsoleteGetKeyDescription(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS bot_description_updates(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,status TEXT NOT NULL,before_description TEXT,after_description TEXT,last_error TEXT,updated_at TEXT NOT NULL)").run();
 const revision="remove-getkey-reference-v2";
 const previous=await env.DB.prepare("SELECT revision,status FROM bot_description_updates WHERE id=1").first();
 if(previous?.revision===revision&&previous.status==="completed")return;
 try{
  const app=await discordApi(env,"/applications/@me");
  if(app.status!==200||app.data?.id!==APPLICATION_ID||typeof app.data.description!=="string")throw Error("Cannot verify bot application description");
  const before=app.data.description;
  const after=/^(?:`?\/getkey`?|the Get Key button)$/i.test(before.trim())?"":before.replace(/<\/getkey(?::[0-9]+)?>|`\/getkey`|\/getkey\b/gi,"the Get Key button");
  if(after!==before){
   const result=await discordApi(env,"/applications/@me","PATCH",{description:after});
   if(result.status!==200||result.data?.id!==APPLICATION_ID||result.data?.description!==after)throw Error("Bot description edit failed: "+result.status);
  }
  const verified=await discordApi(env,"/applications/@me");
  if(verified.status!==200||verified.data?.id!==APPLICATION_ID||verified.data.description!==after||/\/getkey\b/i.test(verified.data.description))throw Error("Bot description update was not confirmed");
  await env.DB.prepare("INSERT INTO bot_description_updates(id,revision,status,before_description,after_description,updated_at) VALUES(1,?,'completed',?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status=excluded.status,before_description=excluded.before_description,after_description=excluded.after_description,last_error=NULL,updated_at=excluded.updated_at").bind(revision,before,after,new Date().toISOString()).run();
 }catch(e){
  await env.DB.prepare("INSERT INTO bot_description_updates(id,revision,status,last_error,updated_at) VALUES(1,?,'error',?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status=excluded.status,last_error=excluded.last_error,updated_at=excluded.updated_at").bind(revision,String(e).slice(0,1200),new Date().toISOString()).run();
  throw e;
 }
}


const ROBLOX_UPDATES_CHANNEL = "1563199116182425690";
const ROBLOX_RELEASE_INDEX = "https://create.roblox.com/docs/release-notes";
const ROBLOX_NEWSROOM_INDEXES = [
 "https://about.roblox.com/newsroom?filter=news",
 "https://about.roblox.com/newsroom?filter=product",
 "https://about.roblox.com/newsroom?filter=community"
];
const ROBLOX_FEED_REVISION = "official-roblox-updates-v1";

function robloxDecodeHtml(value) {
 return String(value ?? "")
  .replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
  .replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}
function robloxPlainText(value,max=1000) {
 return robloxDecodeHtml(String(value ?? "").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim()).slice(0,max);
}
function robloxShortText(value,max=190,sentenceCount=1) {
 const text=robloxPlainText(value,2500).replace(/\([^)]*\)/g," ").replace(/\s+/g," ").trim();
 if(!text)return "";
 const sentences=text.match(/[^.!?]+[.!?](?=\s|$)/g)||[text];
 let short=sentences.slice(0,sentenceCount).join(" ").trim();
 if(short.length>max) {
  short=short.slice(0,max-1).replace(/\s+\S*$/,"").trimEnd()+"…";
 }
 return short;
}
function robloxSafeUrl(value,base) {
 try {
  const u=new URL(String(value),base);
  return u.protocol==="https:"&&!u.username&&!u.password?u.href:null;
 } catch { return null; }
}
async function robloxFetchText(url,maxBytes=900000) {
 const r=await fetch(url,{headers:{Accept:"text/html,application/xhtml+xml","User-Agent":"Syndicate-Hub-Roblox-Updates/1.0"},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error("HTTP "+r.status+" for "+url);
 const length=Number(r.headers.get("content-length")||0);
 if(length>maxBytes)throw Error("Response too large for "+url);
 const text=await r.text();
 if(text.length>maxBytes)throw Error("Response too large for "+url);
 return text;
}
function robloxNextData(html) {
 const match=String(html).match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
 if(!match)throw Error("Roblox release page did not expose structured data");
 try { return JSON.parse(match[1]); } catch { throw Error("Roblox release structured data was invalid"); }
}
function robloxReleaseVersions(html) {
 const found=new Set();
 for(const match of String(html).matchAll(/\/release-notes\/release-notes-(\d+)/g))found.add(Number(match[1]));
 return [...found].filter(Number.isFinite).sort((a,b)=>b-a).slice(0,4);
}
function robloxMeta(html,name) {
 const safe=String(name).replace(/[^a-zA-Z0-9:_-]/g,"");
 const match=String(html).match(new RegExp("<meta[^>]+(?:property|name)=[\"']"+safe+"[\"'][^>]+content=[\"']([^\"']*)[\"'][^>]*>","i"));
 return match?robloxPlainText(match[1],1400):"";
}
function robloxReleaseEmbed(item) {
 const notes=(item.fields||[]).flatMap(field=>String(field.value||"").split("\n"))
  .map(line=>robloxShortText(line.replace(/^•\s*/,""),190,1))
  .filter(Boolean).slice(0,5);
 return {
  author:{name:"SYNDICATE HUB  /  ROBLOX UPDATES"},
  title:item.title.slice(0,256),url:item.url,
  description:"Quick version of the latest Roblox changes. Open the official notes for the full list.",
  fields:notes.length?[{name:"Quick summary",value:notes.map(note=>"• "+note).join("\n"),inline:false}]:[],
  color:0x9B72CF,
  footer:{text:"Roblox Creator Hub · official source"}
 };
}
function robloxNewsEmbed(item) {
 return {
  author:{name:"SYNDICATE HUB  /  ROBLOX UPDATES"},
  title:item.title.slice(0,256),url:item.url,
  description:robloxShortText(item.description||"Official Roblox Newsroom announcement.",420,2),
  color:0x9B72CF,
  footer:{text:"Roblox Newsroom · official source"},
  ...(item.published_at?{timestamp:item.published_at}:{})
 };
}
async function robloxReleaseItems() {
 const index=await robloxFetchText(ROBLOX_RELEASE_INDEX);
 const versions=robloxReleaseVersions(index);
 if(!versions.length)throw Error("No Roblox release note versions found");
 const queue=[...versions];
 const seen=new Set(),items=[];
 while(queue.length&&seen.size<4) {
  const version=queue.shift();
  if(seen.has(version))continue;
  seen.add(version);
  const url=ROBLOX_RELEASE_INDEX+"/release-notes-"+version;
  try {
   const data=robloxNextData(await robloxFetchText(url))?.props?.pageProps?.data?.releaseNoteContents;
   if(!data||!Array.isArray(data.content))continue;
   const notes=[];
   for(const note of data.content) {
    const text=robloxShortText(note?.ReleaseNotesText,190,1);
    if(!text)continue;
    notes.push("• "+text);
    if(notes.length>=5)break;
   }
   const fields=notes.length?[{name:"Quick summary",value:notes.join("\n")}]:[];
   if(!fields.length)continue;
   const title=robloxPlainText(data.title||("Release notes for "+version),256);
   items.push({key:"release:"+version,source:"release_notes",title,url,fields,order:version,published_at:null});
   const next=String(data.next||"").match(/release-notes-(\d+)/);
   if(next&&!seen.has(Number(next[1])))queue.push(Number(next[1]));
  } catch(e) {
   console.error("Roblox release page",version,String(e));
  }
 }
 return items;
}
async function robloxNewsroomItems() {
 const urls=new Set();
 const sourceErrors=[];
 for(const index of ROBLOX_NEWSROOM_INDEXES) {
  try {
   const html=await robloxFetchText(index);
   for(const match of String(html).matchAll(/href=["'](\/newsroom\/20\d{2}\/\d{2}\/[a-z0-9-]+)["']/gi))urls.add(match[1]);
  } catch(e) { sourceErrors.push(String(e).slice(0,180)); }
 }
 const items=[];
 for(const path of [...urls].slice(0,8)) {
  const url=robloxSafeUrl(path,"https://about.roblox.com");
  if(!url)continue;
  try {
   const html=await robloxFetchText(url);
   const title=robloxMeta(html,"og:title");
   if(!title)continue;
   const description=robloxMeta(html,"og:description")||"Official Roblox Newsroom announcement.";
   const published=robloxMeta(html,"article:published_time");
   const publishedAt=Number.isFinite(Date.parse(published))?new Date(published).toISOString():null;
   items.push({key:"newsroom:"+path,source:"newsroom",title,url,description,published_at:publishedAt,order:publishedAt?Date.parse(publishedAt):0});
  } catch(e) { sourceErrors.push(String(e).slice(0,180)); }
 }
 items._sourceErrors=sourceErrors;
 return items;
}
async function robloxPostItem(env,item) {
 const channel=await discordApi(env,"/channels/"+ROBLOX_UPDATES_CHANNEL);
 if(channel.status!==200||channel.data?.guild_id!==GUILD_ID||![0,5].includes(channel.data?.type))throw Error("Roblox updates channel is unavailable or is not a text/news channel");
 const digest=await sha("roblox-feed:"+item.key);
 const nonce=BigInt("0x"+digest.slice(0,18)).toString();
 const payload={allowed_mentions:{parse:[]},embeds:[item.source==="release_notes"?robloxReleaseEmbed(item):robloxNewsEmbed(item)],nonce,enforce_nonce:true};
 const result=await discordApi(env,"/channels/"+ROBLOX_UPDATES_CHANNEL+"/messages","POST",payload);
 if(result.status!==200||!result.data?.id)throw Error("Roblox update message failed: "+result.status);
 return result.data.id;
}
async function refreshRobloxUpdates(env) {
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS roblox_feed_items(item_key TEXT PRIMARY KEY,source TEXT NOT NULL,title TEXT NOT NULL,url TEXT NOT NULL,published_at TEXT,posted_at TEXT,message_id TEXT)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS roblox_feed_state(id INTEGER PRIMARY KEY CHECK(id=1),next_run INTEGER NOT NULL DEFAULT 0,initialized INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("INSERT OR IGNORE INTO roblox_feed_state(id,next_run,initialized,lease_until,updated_at) VALUES(1,0,0,0,?)").bind(new Date().toISOString()).run();
 const now=Date.now();
 const state=await env.DB.prepare("SELECT next_run,initialized,lease_until FROM roblox_feed_state WHERE id=1").first();
 if(Number(state?.next_run||0)>now||Number(state?.lease_until||0)>now)return;
 const claim=await env.DB.prepare("UPDATE roblox_feed_state SET lease_until=?,updated_at=? WHERE id=1 AND next_run<=? AND lease_until<=?").bind(now+180000,new Date().toISOString(),now,now).run();
 if(!claim.meta?.changes)return;
 try {
  const channel=await discordApi(env,"/channels/"+ROBLOX_UPDATES_CHANNEL);
  if(channel.status!==200||channel.data?.guild_id!==GUILD_ID||![0,5].includes(channel.data?.type))throw Error("Roblox updates channel is unavailable or is not a text/news channel");
  const results=await Promise.allSettled([robloxReleaseItems(),robloxNewsroomItems()]);
  const release=results[0].status==="fulfilled"?results[0].value:[];
  const newsroom=results[1].status==="fulfilled"?results[1].value:[];
  const errors=results.filter(x=>x.status==="rejected").map(x=>String(x.reason).slice(0,180));
  if(newsroom._sourceErrors?.length)errors.push(...newsroom._sourceErrors);
  const items=[...release,...newsroom].filter(x=>x&&x.key&&x.title&&x.url);
  if(!items.length)throw Error("No official Roblox updates were found"+(errors.length?": "+errors.join(" | "):""));
  const existingRows=await env.DB.prepare("SELECT item_key,message_id FROM roblox_feed_items").all();
  const existing=new Map((existingRows.results||[]).map(row=>[row.item_key,row]));
  for(const item of items) {
   await env.DB.prepare("INSERT OR IGNORE INTO roblox_feed_items(item_key,source,title,url,published_at,posted_at,message_id) VALUES(?,?,?,?,?,?,?)").bind(item.key,item.source,item.title,item.url,item.published_at,null,null).run();
  }
  const pending=items.filter(item=>!existing.has(item.key)||existing.get(item.key).message_id===null);
  const isFirst=!Number(state?.initialized);
  const publishLimit=isFirst?2:8;
  const ordered=pending.sort((a,b)=>Number(b.order||0)-Number(a.order||0));
  let selected=[];
  if(isFirst) {
   for(const source of ["release_notes","newsroom"]) {
    const candidate=ordered.find(item=>item.source===source);
    if(candidate)selected.push(candidate);
   }
   for(const candidate of ordered) {
    if(selected.length>=publishLimit)break;
    if(!selected.includes(candidate))selected.push(candidate);
   }
  } else selected=ordered.slice(0,publishLimit);
  const selectedKeys=new Set(selected.map(item=>item.key));
  for(const item of pending) {
   if(selectedKeys.has(item.key))continue;
   if(isFirst)await env.DB.prepare("UPDATE roblox_feed_items SET posted_at=?,message_id=COALESCE(message_id,'suppressed') WHERE item_key=? AND message_id IS NULL").bind(new Date().toISOString(),item.key).run();
  }
  for(const item of selected) {
   const messageId=await robloxPostItem(env,item);
   await env.DB.prepare("UPDATE roblox_feed_items SET posted_at=?,message_id=? WHERE item_key=?").bind(new Date().toISOString(),messageId,item.key).run();
  }
  await env.DB.prepare("UPDATE roblox_feed_state SET initialized=1,next_run=?,lease_until=0,last_error=?,updated_at=? WHERE id=1").bind(now+600000,errors.length?errors.join(" | ").slice(0,1500):null,new Date().toISOString()).run();
 } catch(e) {
  await env.DB.prepare("UPDATE roblox_feed_state SET next_run=?,lease_until=0,last_error=?,updated_at=? WHERE id=1").bind(now+60000,String(e).slice(0,1500),new Date().toISOString()).run();
  throw e;
 }
}

export default {
 async scheduled(event,env,ctx){
  if(!env.DISCORD_BOT_TOKEN)return;
  ctx.waitUntil(memberJoinDiag(env,"scheduled","Cron handler ran").catch(()=>{}));
  if(env.MEMBER_JOIN_GATEWAY)ctx.waitUntil(env.MEMBER_JOIN_GATEWAY.getByName("member-join-listener").fetch("https://internal/start",{method:"POST"}).catch(e=>console.error("member gateway start",String(e))));
  ctx.waitUntil(removeObsoleteGetKeyDescription(env).catch(e=>console.error("bot description update",String(e))));
  ctx.waitUntil(maintainFeatureChannel(env).catch(e=>console.error("features maintenance",String(e))));
  ctx.waitUntil(ensurePremiumChannelAndRemoveCommands(env).catch(e=>console.error("premium channel setup",String(e))));
  ctx.waitUntil(ensureBetaHubAccess(env).catch(e=>console.error("beta hub access",String(e))));
  ctx.waitUntil(ensurePlatformPanel(env).catch(e=>console.error("platform panel",String(e))));
  ctx.waitUntil(syncExistingKeyAccessPanel(env).catch(e=>console.error("key panel layout sync",String(e))));
  ctx.waitUntil(maintainCommunitySetup(env).catch(e=>console.error("community setup",String(e))));

  ctx.waitUntil(refreshExecutorStatus(env).catch(async e=>{console.error("executor status refresh",String(e));await env.DB.prepare("UPDATE executor_feed_state SET last_error=?,next_run=? WHERE id=1").bind("Panel delivery: "+String(e).slice(0,1400),Date.now()+60000).run();}));
  ctx.waitUntil(refreshRobloxUpdates(env).catch(e=>console.error("Roblox updates",String(e))));
  try{await sendExecutionLogs(env)}catch(e){console.error("execution logging",e)}
  try{await managementPost(env)}catch(e){console.error("management panel",e)}
  try{await postFreePanel(env)}catch(e){console.error("free panel",e)}
  try{await checkDepartedIssuances(env);await backfillMemberRoles(env);await syncMemberRoles(env)}catch(e){console.error("role maintenance",e)}

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
  if(![2,3,4,5].includes(i.type)||i.guild_id!==GUILD_ID)return reply("This bot is only available in the Syndicate Hub server.");
  if(i.type===4){if(i.data?.name==="role")return roleAutocomplete(i,env);return autocompleteResponse();}
  if(i.type===2){
   if(i.data?.name==="purge")return delayedReply(i,env,ctx,()=>purgeMessages(i,env));
   if(i.data?.name==="role"&&interactionOption(i,"action")?.value==="add")return delayedReply(i,env,ctx,()=>addRoleToMember(i,env));
   if(i.data?.name==="role"&&interactionOption(i,"action")?.value==="remove")return delayedReply(i,env,ctx,()=>removeRoleFromMember(i,env));
   if(i.data?.name==="close")return delayedReply(i,env,ctx,()=>deletePremiumTicket(i,env));
   if(i.data?.name==="verified")return delayedReply(i,env,ctx,()=>verifyTicketMember(i,env),false);
   if(i.data?.name==="payment")return delayedReply(i,env,ctx,()=>sendPremiumPaymentLink(i,env));
   return reply("That slash command is not available.");
  }
  if(needsBetaAccess(i)&&!hasVipAccess(i))return reply("🔒 The VIP role is required to access Syndicate Hub keys. Use the hub’s Discord invite or ask staff for help.");
  if(!env.DB||!env.KEY_ISSUER)return reply("Authentication service is not configured.");
   ctx.waitUntil(ensurePremiumChannelAndRemoveCommands(env).catch(e=>console.error("premium command setup",String(e))));
  try {
   if(i.type===3&&i.data?.custom_id?.startsWith("syndicate_executor_"))return executorPlatformInteraction(i,env,ctx);
   if(i.type===3&&i.data?.custom_id?.startsWith("syndicate_platform_"))return delayedReply(i,env,ctx,()=>togglePlatformRole(i,env));
   if(i.type===3&&i.data?.custom_id?.startsWith("mg_"))return discordResponse(await deferredManagement(i,env,ctx));
   if(i.type===5&&i.data?.custom_id==="mg_revoke_modal")return discordResponse(await managementModal(i));
   if(i.type===3&&i.data?.custom_id==="syndicate_premium_ticket")return delayedReply(i,env,ctx,()=>createPremiumTicket(i,env));
   if(i.type===3&&i.data?.custom_id==="syndicate_premium_payment_select")return selectPremiumPayment(i,env);
   if(i.type===3&&i.data?.custom_id==="syndicate_premium_ticket_close")return discordResponse(confirmPremiumTicketClose());
   if(i.type===3&&i.data?.custom_id==="syndicate_premium_ticket_cancel_close")return reply("Your ticket is still open.");
   if(i.type===3&&i.data?.custom_id==="syndicate_premium_ticket_confirm_close")return delayedReply(i,env,ctx,()=>archivePremiumTicket(i,env));
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
   return reply("Please use the server panels and buttons.");
  }catch(e){console.error("interaction",e);return reply("An internal error occurred. Please try again.")}
 }
};

export class ExecutionNotifier extends WorkerEntrypoint { async flush(){ await sendExecutionLogs(this.env); return true; } }


