async function memberJoinDiag(env,event,detail){
 try{
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS member_join_diagnostics(id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,detail TEXT,created_at TEXT NOT NULL)").run();
  await env.DB.prepare("INSERT INTO member_join_diagnostics(event,detail,created_at) VALUES(?,?,?)").bind(event,String(detail||"").slice(0,500),new Date().toISOString()).run();
 }catch(e){console.error("member join diagnostics write failed",String(e));}
}

import { DurableObject } from "cloudflare:workers";
async function refreshWelcomeMemberStats(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS welcome_member_stats(id INTEGER PRIMARY KEY CHECK(id=1),channel_id TEXT NOT NULL,message_id TEXT NOT NULL,last_total INTEGER,last_online INTEGER,updated_at TEXT NOT NULL)").run();
 let current=await env.DB.prepare("SELECT channel_id,message_id,last_total,last_online,updated_at FROM welcome_member_stats WHERE id=1").first();
 if(!current){
  // Adopt the most recent welcome already sent by this bot, without reposting it.
  const channels=await discordApi(env,"/guilds/"+GUILD_ID+"/channels");
  const normalize=n=>String(n||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
  const intro=channels.status===200&&Array.isArray(channels.data)
   ?channels.data.find(c=>[0,5].includes(c.type)&&(String(c.id)==="1564527128253436005"||normalize(c.name)==="introductions")):null;
  if(!intro)return;
  const history=await discordApi(env,"/channels/"+intro.id+"/messages?limit=100");
  if(history.status!==200||!Array.isArray(history.data))return;
  const mostRecent=history.data.find(m=>m.author?.id===APPLICATION_ID &&
    Array.isArray(m.embeds)&&m.embeds.some(e=>e.title==="Welcome!"));
  if(!mostRecent)return;
  await env.DB.prepare("INSERT OR IGNORE INTO welcome_member_stats(id,channel_id,message_id,last_total,last_online,updated_at) VALUES(1,?,?,NULL,NULL,?)")
   .bind(intro.id,String(mostRecent.id),"1970-01-01T00:00:00Z").run();
  current=await env.DB.prepare("SELECT channel_id,message_id,last_total,last_online,updated_at FROM welcome_member_stats WHERE id=1").first();
 }
 if(!current||Date.now()-Date.parse(current.updated_at||"")<60000)return;
 const response=await discordApi(env,"/guilds/"+GUILD_ID+"?with_counts=true");
 if(response.status!==200)throw Error("Welcome count guild query HTTP "+response.status);
 const guild=response.data||{};
 const totalRaw=guild.approximate_member_count??guild.member_count;
 const onlineRaw=guild.approximate_presence_count;
 const total=totalRaw==null?null:Number(totalRaw),online=onlineRaw==null?null:Number(onlineRaw);
 const totalOk=total!==null&&Number.isFinite(total)&&total>=0;
 const onlineOk=online!==null&&Number.isFinite(online)&&online>=0;
 if(!totalOk&&!onlineOk)return;
 const stamp=new Date().toISOString();
 if((!totalOk||total===current.last_total)&&(!onlineOk||online===current.last_online)){
  await env.DB.prepare("UPDATE welcome_member_stats SET updated_at=? WHERE id=1").bind(stamp).run();return;
 }
 const result=await discordApi(env,"/channels/"+current.channel_id+"/messages/"+current.message_id);
 if(result.status!==200||!result.data?.embeds?.[0])throw Error("Welcome message cannot be retrieved: "+result.status);
 const old=result.data.embeds[0];
 const fields=(Array.isArray(old.fields)?old.fields:[]).filter(f=>!["👥 Server Members","🟢 Online Now"].includes(f.name));
 if(totalOk)fields.push({name:"👥 Server Members",value:total.toLocaleString("en-US"),inline:true});
 if(onlineOk)fields.push({name:"🟢 Online Now",value:online.toLocaleString("en-US"),inline:true});
 const embed={title:old.title,description:old.description,color:old.color,fields,footer:{text:"Member count updates automatically."},
  ...(old.author?{author:{name:old.author.name,...(old.author.icon_url?{icon_url:old.author.icon_url}:{})}}:{}),
  ...(old.thumbnail?.url?{thumbnail:{url:old.thumbnail.url}}:{}),
  ...(old.timestamp?{timestamp:old.timestamp}:{})};
 const edit=await discordApi(env,"/channels/"+current.channel_id+"/messages/"+current.message_id,"PATCH",{embeds:[embed],allowed_mentions:{parse:[]}});
 if(edit.status!==200)throw Error("Welcome count refresh HTTP "+edit.status);
 await env.DB.prepare("UPDATE welcome_member_stats SET last_total=?,last_online=?,updated_at=? WHERE id=1")
  .bind(totalOk?total:current.last_total,onlineOk?online:current.last_online,stamp).run();
}


async function ensureJoinTrackingTable(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS member_join_welcomes(user_id TEXT PRIMARY KEY,role_assigned INTEGER NOT NULL DEFAULT 0,welcome_sent INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,joined_at TEXT,welcome_message_id TEXT,welcome_channel_id TEXT,welcome_lease_until INTEGER NOT NULL DEFAULT 0)").run();
 const columns=await env.DB.prepare("PRAGMA table_info(member_join_welcomes)").all();
 for(const [name,definition] of [["joined_at","TEXT"],["welcome_message_id","TEXT"],["welcome_channel_id","TEXT"],["welcome_lease_until","INTEGER NOT NULL DEFAULT 0"]]){
  if(!(columns.results||[]).some(c=>c.name===name)){
   try{await env.DB.prepare("ALTER TABLE member_join_welcomes ADD COLUMN "+name+" "+definition).run();}
   catch(e){if(!String(e).toLowerCase().includes("duplicate column"))throw e;}
  }
 }
}
function joinChannel(channels,...names){
 const norm=n=>String(n||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
 return (channels||[]).find(c=>[0,5].includes(c.type)&&names.includes(norm(c.name)))||null;
}
function canonicalJoinTimestamp(value){
 const ms=Date.parse(String(value||""));
 return Number.isFinite(ms)?new Date(ms).toISOString():String(value||"");
}
// Send one branded welcome. Discord's native join message is suppressed separately.
async function handleMemberJoin(env,state,member){
 const user=member?.user;
 if(!env.DB||!user?.id||member.guild_id!==GUILD_ID||user.bot)return;
 await ensureJoinTrackingTable(env);
 const joinedAt=canonicalJoinTimestamp(member.joined_at);
 const prior=await env.DB.prepare("SELECT role_assigned,welcome_sent,joined_at,welcome_message_id,welcome_lease_until FROM member_join_welcomes WHERE user_id=?").bind(user.id).first();
 const sameJoin=!!(joinedAt&&canonicalJoinTimestamp(prior?.joined_at)===joinedAt);
 if(sameJoin&&prior.role_assigned&&prior.welcome_sent&&prior.welcome_message_id)return;
 const rr=await discordApi(env,"/guilds/"+GUILD_ID+"/roles");
 const initiate=rr.status===200&&Array.isArray(rr.data)?rr.data.find(r=>String(r.name||"").trim().toLowerCase()==="initiate"):null;
 let roleDone=!!(sameJoin&&prior?.role_assigned);
 if(initiate&&Array.isArray(member.roles)&&member.roles.includes(initiate.id))roleDone=true;
 if(!roleDone&&initiate){
  const result=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+user.id+"/roles/"+initiate.id,"PUT");
  roleDone=result.status===204;
  if(!roleDone)await memberJoinDiag(env,"role_failure","Initiate role HTTP "+result.status+" for "+user.id+" "+JSON.stringify(result.data||{}).slice(0,170));
 }else if(!initiate)await memberJoinDiag(env,"role_failure","Initiate role missing or roles HTTP "+rr.status);
 const claimTime=Date.now(),leaseUntil=claimTime+90000;
 const claim=await env.DB.prepare("INSERT INTO member_join_welcomes(user_id,role_assigned,welcome_sent,updated_at,joined_at,welcome_message_id,welcome_channel_id,welcome_lease_until) VALUES(?,?,0,?,?,NULL,NULL,?) ON CONFLICT(user_id) DO UPDATE SET role_assigned=excluded.role_assigned,welcome_sent=0,updated_at=excluded.updated_at,joined_at=excluded.joined_at,welcome_message_id=NULL,welcome_channel_id=NULL,welcome_lease_until=excluded.welcome_lease_until WHERE member_join_welcomes.joined_at IS NOT excluded.joined_at OR ((member_join_welcomes.welcome_sent=0 OR member_join_welcomes.welcome_message_id IS NULL) AND member_join_welcomes.welcome_lease_until<=?)")
  .bind(user.id,roleDone?1:0,new Date().toISOString(),joinedAt,leaseUntil,claimTime).run();
 if(Number(claim.meta?.changes||0)===0)return;
 const channels=await discordApi(env,"/guilds/"+GUILD_ID+"/channels");
 const intro=joinChannel(channels.status===200?channels.data:[],"introductions");
 if(!intro){
  await env.DB.prepare("UPDATE member_join_welcomes SET role_assigned=?,welcome_sent=0,welcome_lease_until=0,updated_at=? WHERE user_id=? AND joined_at=?").bind(roleDone?1:0,new Date().toISOString(),user.id,joinedAt).run();
  await memberJoinDiag(env,"welcome_failure","Could not find introductions channel; channels HTTP "+channels.status+" user "+user.id);return;
 }
 const guild=await discordApi(env,"/guilds/"+GUILD_ID+"?with_counts=true");
 const totalRaw=Number(state?.memberCount||0)>0?Number(state.memberCount):(guild.status===200?Number(guild.data?.approximate_member_count??guild.data?.member_count):0);
 const onlineRaw=guild.status===200?Number(guild.data?.approximate_presence_count):NaN;
 const guildName=guild.status===200?(guild.data?.name||"Shadow Syndicates"):"Shadow Syndicates";
 const fields=[{name:"Getting started",value:"💬 Visit <#1563067669479948299> to chat.\n🎭 Pick your roles in <#1564527127276290098>.",inline:false}];
 if(Number.isFinite(totalRaw)&&totalRaw>0)fields.push({name:"👥 Server Members",value:totalRaw.toLocaleString("en-US"),inline:true});
 if(Number.isFinite(onlineRaw)&&onlineRaw>=0)fields.push({name:"🟢 Online Now",value:onlineRaw.toLocaleString("en-US"),inline:true});
 const avatar=user.avatar?"https://cdn.discordapp.com/avatars/"+user.id+"/"+user.avatar+(String(user.avatar).startsWith("a_")?".gif":".png")+"?size=256":null;
 const guildIcon=guild.status===200&&guild.data?.icon?"https://cdn.discordapp.com/icons/"+GUILD_ID+"/"+guild.data.icon+(String(guild.data.icon).startsWith("a_")?".gif":".png")+"?size=64":null;
 const memberNumber=Number.isFinite(totalRaw)&&totalRaw>0?totalRaw.toLocaleString("en-US"):"new";
 const payload={allowed_mentions:{parse:[],users:[String(user.id)]},content:"👋 Welcome <@"+user.id+">!",embeds:[{author:{name:guildName,...(guildIcon?{icon_url:guildIcon}:{})},title:"Welcome!",description:"<@"+user.id+"> joined "+guildName+"!\nYou're member **#"+memberNumber+"**.",color:0x7c3aed,...(avatar?{thumbnail:{url:avatar}}:{}),fields,footer:{text:"Member count updates automatically."},timestamp:new Date().toISOString()}],components:[{type:1,components:[{type:2,style:1,label:"🎟️ Send a welcome sticker",custom_id:"welcome_wave:"+user.id}]}]};
 const sent=await discordApi(env,"/channels/"+intro.id+"/messages","POST",payload);
 if(sent.status!==200||!sent.data?.id){
  await env.DB.prepare("UPDATE member_join_welcomes SET role_assigned=?,welcome_sent=0,welcome_lease_until=0,updated_at=? WHERE user_id=? AND joined_at=?").bind(roleDone?1:0,new Date().toISOString(),user.id,joinedAt).run();
  await memberJoinDiag(env,"welcome_failure","Welcome message HTTP "+sent.status+" for "+user.id+" "+JSON.stringify(sent.data||{}).slice(0,180));return;
 }
 const now=new Date().toISOString();
 await env.DB.prepare("UPDATE member_join_welcomes SET role_assigned=?,welcome_sent=1,welcome_message_id=?,welcome_channel_id=?,welcome_lease_until=0,updated_at=? WHERE user_id=? AND joined_at=?")
  .bind(roleDone?1:0,String(sent.data.id),String(intro.id),now,user.id,joinedAt).run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS welcome_member_stats(id INTEGER PRIMARY KEY CHECK(id=1),channel_id TEXT NOT NULL,message_id TEXT NOT NULL,last_total INTEGER,last_online INTEGER,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("INSERT INTO welcome_member_stats(id,channel_id,message_id,last_total,last_online,updated_at) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET channel_id=excluded.channel_id,message_id=excluded.message_id,last_total=excluded.last_total,last_online=excluded.last_online,updated_at=excluded.updated_at")
  .bind(String(intro.id),String(sent.data.id),Number.isFinite(totalRaw)&&totalRaw>0?totalRaw:null,Number.isFinite(onlineRaw)&&onlineRaw>=0?onlineRaw:null,"1970-01-01T00:00:00Z").run();
 await memberJoinDiag(env,"join_result","user "+user.id+" role="+roleDone+" bot_welcome="+sent.data.id+" joined="+joinedAt);
}

// The Gateway can silently stall. Reconcile recently joined members from
// Discord REST to recover missed events and retry transient API failures.
async function reconcileRecentJoins(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 await ensureJoinTrackingTable(env);
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS join_reconcile_state(id INTEGER PRIMARY KEY CHECK(id=1),last_run INTEGER NOT NULL)").run();
 const now=Date.now(),prior=await env.DB.prepare("SELECT last_run FROM join_reconcile_state WHERE id=1").first();
 if(prior&&now-Number(prior.last_run)<120000)return;
 await env.DB.prepare("INSERT INTO join_reconcile_state(id,last_run) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_run=excluded.last_run").bind(now).run();
 let after="",seen=0,restored=0;
 for(let page=0;page<5;page++){
  const response=await discordApi(env,"/guilds/"+GUILD_ID+"/members?limit=1000"+(after?"&after="+after:""));
  if(response.status!==200||!Array.isArray(response.data)){
   await memberJoinDiag(env,"reconcile_error","List guild members HTTP "+response.status);
   return;
  }
  const members=response.data;
  for(const member of members){
   if(member?.user?.bot||!member?.user?.id||!member?.joined_at)continue;
   seen++;
   const joined=Date.parse(member.joined_at);
   if(!Number.isFinite(joined)||joined<now-90*60000||joined>now+60000)continue;
   const prior=await env.DB.prepare("SELECT joined_at,role_assigned,welcome_sent,welcome_message_id FROM member_join_welcomes WHERE user_id=?").bind(member.user.id).first();
   if(canonicalJoinTimestamp(prior?.joined_at)===canonicalJoinTimestamp(member.joined_at)&&prior.role_assigned&&prior.welcome_sent&&prior.welcome_message_id)continue;
   if(restored>=12)break;
   try{await handleMemberJoin(env,{memberCount:0},{...member,guild_id:GUILD_ID});restored++;}
   catch(e){await memberJoinDiag(env,"reconcile_error",String(e).slice(0,360));}
  }
  if(restored>=12||members.length<1000)break;
  after=members[members.length-1]?.user?.id||"";
  if(!after)break;
 }
 if(restored)await memberJoinDiag(env,"reconcile_restored","Recovered "+restored+" recent join(s); scanned "+seen+" members");
}

// Keep the two navigation links visible in the channel topic, without
// posting a second welcome message on every member join.
async function ensureIntroductionLinksAndStickerReplies(env,channels,intro){
 const general=joinChannel(channels,"general","general-chat");
 const roles=joinChannel(channels,"reaction-roles","reaction-role","choose-your-roles","choose-roles","roles");
 if(general&&roles){
  const guide="💬 General: https://discord.com/channels/"+GUILD_ID+"/"+general.id+" | 🎭 Reaction Roles: https://discord.com/channels/"+GUILD_ID+"/"+roles.id;
  const existing=String(intro.topic||"");
  const marker="🧭 Start here: ";
  const idx=existing.indexOf(marker);
  const prefix=idx>=0?existing.slice(0,idx).trimEnd():existing.trim();
  const next=(prefix?prefix+"\n\n":"")+marker+guide;
  if(next.length<=1024&&next!==existing){
   const patch=await discordApi(env,"/channels/"+intro.id,"PATCH",{topic:next});
   if(patch.status!==200)await memberJoinDiag(env,"welcome_links_error","Intro topic HTTP "+patch.status);
   else await memberJoinDiag(env,"welcome_links_enabled","General and Reaction Roles linked in introductions topic");
  }
 }else{
  await memberJoinDiag(env,"welcome_links_error","Missing channel: general="+Boolean(general)+" reactionRoles="+Boolean(roles));
 }
 // Native reply stickers require that ordinary members can send messages.
 // Preserve all other existing permission bits and overwrites.
 const everyone=(intro.permission_overwrites||[]).find(o=>o.id===GUILD_ID&&o.type===0);
 const SEND_MESSAGES=2048n;
 const allow=BigInt(everyone?.allow||"0"),deny=BigInt(everyone?.deny||"0");
 if(!(allow&SEND_MESSAGES)||(deny&SEND_MESSAGES)){
  const resp=await discordApi(env,"/channels/"+intro.id+"/permissions/"+GUILD_ID,"PUT",{
   type:0,allow:String(allow|SEND_MESSAGES),deny:String(deny&~SEND_MESSAGES)
  });
  if(resp.status===204)await memberJoinDiag(env,"sticker_reply_permissions","Enabled Send Messages for members in introductions");
  else await memberJoinDiag(env,"sticker_reply_error","Permission update HTTP "+resp.status+" "+JSON.stringify(resp.data||{}).slice(0,150));
 }
}

// These Discord system messages supply the native wave/sticker reply control;
// custom bot embeds cannot produce Discord's built-in sticker greeting UI.
async function configureNativeJoinGreeting(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS join_system_settings(id INTEGER PRIMARY KEY CHECK(id=1),last_checked INTEGER NOT NULL,status TEXT)").run();
 const now=Date.now(),prior=await env.DB.prepare("SELECT last_checked FROM join_system_settings WHERE id=1").first();
 if(prior&&now-Number(prior.last_checked)<15*60000)return;
 await env.DB.prepare("INSERT INTO join_system_settings(id,last_checked,status) VALUES(1,?,'checking') ON CONFLICT(id) DO UPDATE SET last_checked=excluded.last_checked").bind(now).run();
 const [cr,gr]=await Promise.all([discordApi(env,"/guilds/"+GUILD_ID+"/channels"),discordApi(env,"/guilds/"+GUILD_ID)]);
 const intro=joinChannel(cr.status===200?cr.data:[],"introductions");
 if(!intro||gr.status!==200){await memberJoinDiag(env,"system_welcome_error","Channels "+cr.status+" guild "+gr.status+" introductions="+Boolean(intro));return;}
 await ensureIntroductionLinksAndStickerReplies(env,cr.data,intro);
 const flags=Number(gr.data?.system_channel_flags||0),desired=flags|1;
 if(gr.data.system_channel_id===intro.id&&flags===desired){
  await env.DB.prepare("UPDATE join_system_settings SET status='enabled' WHERE id=1").run();return;
 }
 const patch=await discordApi(env,"/guilds/"+GUILD_ID,"PATCH",{system_channel_id:intro.id,system_channel_flags:desired});
 if(patch.status===200){
  await env.DB.prepare("UPDATE join_system_settings SET status='enabled' WHERE id=1").run();
  await memberJoinDiag(env,"system_welcome_enabled","Native join notice suppressed; bot welcome enabled in introductions");
 }else{
  await env.DB.prepare("UPDATE join_system_settings SET status=? WHERE id=1").bind("HTTP "+patch.status).run();
  await memberJoinDiag(env,"system_welcome_error","Guild settings HTTP "+patch.status+" "+JSON.stringify(patch.data||{}).slice(0,220));
 }
}

const SHADOW_LEAVE_LOG_CHANNEL = "1564527161216335902";
function shadowRoleIcon(name, position=0) {
 const n=String(name||"").toLowerCase();
 const amount=n.match(/\$?\s*(\d+(?:\.\d+)?)\s*(million|billion|m|b)\b/i);
 if(amount){
  const value=Number(amount[1])*(/^b|billion$/i.test(amount[2])?1000:1);
  if(value>=10000)return "🌌";
  if(value>=5000)return "🐉";
  if(value>=2000)return "👑";
  if(value>=1500)return "🏆";
  if(value>=1000)return "🏦";
  if(value>=550)return "💎";
  if(value>=350)return "💰";
  if(value>=200)return "💵";
  return "🪙";
 }
 if(/sovereign|owner|administrator|\badmin\b/.test(n))return "👑";
 if(/\bpremium\b/.test(n))return "💎";
 if(/\bvip\b|beta tester/.test(n))return "🏅";
 if(/syndicate/.test(n))return "🐺";
 if(/\binitiate\b/.test(n))return "🌙";
 if(/booster|boost/.test(n))return "🚀";
 if(/moderator|\bmod\b|staff|security/.test(n))return "🛡️";
 if(/tester|testing/.test(n))return "🧪";
 if(/verified/.test(n))return "✅";
 if(/event|carnival/.test(n))return "🎭";
 if(/giveaway|winner/.test(n))return "🎁";
 if(/android/.test(n))return "🤖";
 if(/ios|iphone|ipad|apple/.test(n))return "📱";
 if(/windows|desktop|pc/.test(n))return "🖥️";
 if(/xbox|playstation|console/.test(n))return "🎮";
 const palette=["🔮","🗝️","⚔️","🧿","🪄","🦊","⚡","🌀","🪬","🪽","🎯","✨","🦇","🌑","🎟️","🪙"];
 let h=0;for(const c of n)h=(h*31+c.charCodeAt(0))>>>0;
 return palette[(h+Number(position||0))%palette.length];
}
async function applyShadowRoleIcons(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS shadow_role_icon_setup(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL,updated_at TEXT NOT NULL,summary TEXT)").run();
 const prior=await env.DB.prepare("SELECT status,updated_at FROM shadow_role_icon_setup WHERE id=1").first();
 if(prior&&["done","partial"].includes(prior.status))return;
 if(prior?.status==="running"&&Date.now()-Date.parse(prior.updated_at||"")<120000)return;
 await env.DB.prepare("INSERT INTO shadow_role_icon_setup(id,status,updated_at,summary) VALUES(1,'running',?,NULL) ON CONFLICT(id) DO UPDATE SET status='running',updated_at=excluded.updated_at").bind(new Date().toISOString()).run();
 const response=await discordApi(env,"/guilds/"+GUILD_ID+"/roles");
 if(response.status!==200||!Array.isArray(response.data)){
  await env.DB.prepare("UPDATE shadow_role_icon_setup SET status='partial',updated_at=?,summary=? WHERE id=1").bind(new Date().toISOString(),"Could not list roles: HTTP "+response.status).run();return;
 }
 const roles=response.data.filter(r=>r&&r.id!==GUILD_ID&&!r.managed).sort((a,b)=>Number(a.position||0)-Number(b.position||0));
 const me=await discordApi(env,"/users/@me");
 const botMember=me.status===200&&me.data?.id?await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+me.data.id):{status:0,data:null};
 const botRoles=roles.filter(r=>(botMember.data?.roles||[]).includes(r.id)).map(r=>({name:r.name,id:r.id,position:r.position}));
 let added=0,existing=0,failed=0;const errors=[];
 for(const role of roles){
  if(role.icon||role.unicode_emoji){existing++;continue;}
  let result,attempt=0;
  do{
   result=await discordApi(env,"/guilds/"+GUILD_ID+"/roles/"+role.id,"PATCH",{unicode_emoji:shadowRoleIcon(role.name,role.position)});
   if(result.status!==429||attempt>=4)break;
   const wait=Math.min(5000,Math.max(500,Number(result.data?.retry_after||1)*1000));
   await new Promise(resolve=>setTimeout(resolve,wait));attempt++;
  }while(attempt<5);
  if(result.status===200){added++;}
  else{failed++;errors.push({name:role.name,id:role.id,position:role.position,status:result.status,response:result.data});}
  await new Promise(resolve=>setTimeout(resolve,550));
 }
 const summary=JSON.stringify({eligible:roles.length,added,alreadyIconed:existing,failed,botRolePositions:botRoles,errors:errors.slice(0,20)});
 await env.DB.prepare("UPDATE shadow_role_icon_setup SET status=?,updated_at=?,summary=? WHERE id=1").bind(failed?"partial":"done",new Date().toISOString(),summary).run();
 await memberJoinDiag(env,"role_icons_setup",summary);
}
async function queueShadowMemberLeave(env,user,eventSequence){
 if(!env.DB||!user?.id)return;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS member_leave_notifications(event_key TEXT PRIMARY KEY,user_id TEXT NOT NULL,display_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,message_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
 const eventKey=String(eventSequence||Date.now())+":"+String(user.id);
 const display=String(user.global_name||user.username||"A member").replace(/[@*_~<>\\]/g,"").slice(0,80)||"A member";
 await env.DB.prepare("INSERT OR IGNORE INTO member_leave_notifications(event_key,user_id,display_name,status,attempts,created_at,updated_at) VALUES(?,?,?,'pending',0,?,?)").bind(eventKey,String(user.id),display,new Date().toISOString(),new Date().toISOString()).run();
}
async function flushShadowMemberLeaveNotifications(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS member_leave_notifications(event_key TEXT PRIMARY KEY,user_id TEXT NOT NULL,display_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,message_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
 const pending=await env.DB.prepare("SELECT event_key,user_id,display_name,attempts FROM member_leave_notifications WHERE status='pending' AND attempts<5 ORDER BY created_at LIMIT 10").all();
 for(const item of pending.results||[]){
  const digest=await sha("member-left:"+item.event_key);
  const nonce=BigInt("0x"+digest.slice(0,18)).toString();
  const sent=await discordApi(env,"/channels/"+SHADOW_LEAVE_LOG_CHANNEL+"/messages","POST",{
   allowed_mentions:{parse:[]},nonce,enforce_nonce:true,
   embeds:[{title:"Member left",description:"**"+item.display_name+"** left Shadow Syndicate.",color:0x71368A,footer:{text:"Member leave notification"}}]
  });
  if(sent.status===200&&sent.data?.id){
   await env.DB.prepare("UPDATE member_leave_notifications SET status='sent',message_id=?,attempts=attempts+1,updated_at=? WHERE event_key=?").bind(String(sent.data.id),new Date().toISOString(),item.event_key).run();
  }else{
   await env.DB.prepare("UPDATE member_leave_notifications SET attempts=attempts+1,updated_at=? WHERE event_key=?").bind(new Date().toISOString(),item.event_key).run();
   await memberJoinDiag(env,"member_leave_notice_error","Channel "+SHADOW_LEAVE_LOG_CHANNEL+" HTTP "+sent.status+" for "+item.user_id);
  }
  await new Promise(resolve=>setTimeout(resolve,550));
 }
}
async function ensureShadowLeaveTestMessage(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS member_leave_test_message(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL DEFAULT 'pending',message_id TEXT,updated_at TEXT NOT NULL)").run();
 const prior=await env.DB.prepare("SELECT status,updated_at FROM member_leave_test_message WHERE id=1").first();
 if(prior?.status==="sent")return;
 if(prior?.status==="sending"&&Date.now()-Date.parse(prior.updated_at||"")<120000)return;
 await env.DB.prepare("INSERT INTO member_leave_test_message(id,status,updated_at) VALUES(1,'sending',?) ON CONFLICT(id) DO UPDATE SET status='sending',updated_at=excluded.updated_at").bind(new Date().toISOString()).run();
 const channel=await discordApi(env,"/channels/"+SHADOW_LEAVE_LOG_CHANNEL);
 if(channel.status!==200||channel.data?.guild_id!==GUILD_ID||![0,5].includes(channel.data?.type)){
  await env.DB.prepare("UPDATE member_leave_test_message SET status='pending',updated_at=? WHERE id=1").bind(new Date().toISOString()).run();
  await memberJoinDiag(env,"member_leave_test_error","Target channel unavailable or not a text channel; HTTP "+channel.status);return;
 }
 const digest=await sha("member-leave-setup-test:"+GUILD_ID+":"+SHADOW_LEAVE_LOG_CHANNEL);
 const nonce=BigInt("0x"+digest.slice(0,18)).toString();
 const result=await discordApi(env,"/channels/"+SHADOW_LEAVE_LOG_CHANNEL+"/messages","POST",{
  allowed_mentions:{parse:[]},nonce,enforce_nonce:true,
  embeds:[{title:"Member leave alerts are online",description:"This is a test message from the Syndicate Hub bot. Future posts here will let you know when someone leaves Shadow Syndicate.",color:0x71368A,footer:{text:"Setup test · no member leave occurred"}}]
 });
 if(result.status===200&&result.data?.id){
  await env.DB.prepare("UPDATE member_leave_test_message SET status='sent',message_id=?,updated_at=? WHERE id=1").bind(String(result.data.id),new Date().toISOString()).run();
  await memberJoinDiag(env,"member_leave_test_sent","Test message sent to "+SHADOW_LEAVE_LOG_CHANNEL);
 }else{
  await env.DB.prepare("UPDATE member_leave_test_message SET status='pending',updated_at=? WHERE id=1").bind(new Date().toISOString()).run();
  await memberJoinDiag(env,"member_leave_test_error","Test message HTTP "+result.status);
 }
}


async function ensureClubNightPollPreview(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 const channelId="1564527125896233073";
 const previousChannelId="1564527161216335902";
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS club_night_poll_preview(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL DEFAULT 'pending',message_id TEXT,updated_at TEXT NOT NULL,error TEXT,countdown_message_id TEXT)").run();
 try{await env.DB.prepare("ALTER TABLE club_night_poll_preview ADD COLUMN countdown_message_id TEXT").run();}catch(e){}
 const prior=await env.DB.prepare("SELECT status,message_id,countdown_message_id,updated_at FROM club_night_poll_preview WHERE id=1").first();
 const target=Date.UTC(2026,10,15,3,0,0),remaining=Math.max(0,target-Date.now());
 const days=Math.floor(remaining/86400000),hours=Math.floor((remaining%86400000)/3600000),minutes=Math.floor((remaining%3600000)/60000);
 const plural=(n,unit)=>n+" "+unit+(n===1?"":"s");
 const countdownContent=remaining===0?"✅ **The club status target time has arrived.**":"⏳ **Live countdown to Active status**\n"+plural(days,"day")+" · "+plural(hours,"hour")+" · "+plural(minutes,"minute")+" remaining";
 if(prior?.status==="sent"){
  if(prior.countdown_message_id){
   const updated=await discordApi(env,"/channels/"+channelId+"/messages/"+prior.countdown_message_id,"PATCH",{content:countdownContent,allowed_mentions:{parse:[]}});
   if(updated.status===200){await env.DB.prepare("UPDATE club_night_poll_preview SET updated_at=?,error=NULL WHERE id=1").bind(new Date().toISOString()).run();return;}
   if(updated.status!==404){await memberJoinDiag(env,"club_poll_countdown_error","Countdown update HTTP "+updated.status);return;}
  }
  const created=await discordApi(env,"/channels/"+channelId+"/messages","POST",{content:countdownContent,allowed_mentions:{parse:[]}});
  if(created.status===200&&created.data?.id)await env.DB.prepare("UPDATE club_night_poll_preview SET countdown_message_id=?,updated_at=?,error=NULL WHERE id=1").bind(String(created.data.id),new Date().toISOString()).run();
  else await memberJoinDiag(env,"club_poll_countdown_error","Countdown create HTTP "+created.status);
  return;
 }
 if(prior?.status==="sending"&&Date.now()-Date.parse(prior.updated_at||"")<120000)return;
 await env.DB.prepare("INSERT INTO club_night_poll_preview(id,status,updated_at,error) VALUES(1,'sending',?,NULL) ON CONFLICT(id) DO UPDATE SET status='sending',updated_at=excluded.updated_at,error=NULL").bind(new Date().toISOString()).run();
 for(const oldMessageId of [prior?.message_id,prior?.countdown_message_id].filter(Boolean))for(const oldChannelId of [channelId,previousChannelId]){
  const removed=await discordApi(env,"/channels/"+oldChannelId+"/messages/"+oldMessageId,"DELETE");
  if(removed.status!==204&&removed.status!==404){const error="Could not replace prior poll preview message: HTTP "+removed.status;await env.DB.prepare("UPDATE club_night_poll_preview SET status='pending',updated_at=?,error=? WHERE id=1").bind(new Date().toISOString(),error).run();await memberJoinDiag(env,"club_poll_preview_error",error);return;}
 }
 const channel=await discordApi(env,"/channels/"+channelId);
 if(channel.status!==200||channel.data?.guild_id!==GUILD_ID||![0,5].includes(channel.data?.type)){const error="Target announcements channel unavailable or not text: HTTP "+channel.status;await env.DB.prepare("UPDATE club_night_poll_preview SET status='pending',updated_at=?,error=? WHERE id=1").bind(new Date().toISOString(),error).run();await memberJoinDiag(env,"club_poll_preview_error",error);return;}
 const countdown=await discordApi(env,"/channels/"+channelId+"/messages","POST",{content:countdownContent,allowed_mentions:{parse:[]}});
 if(countdown.status!==200||!countdown.data?.id){const error="Live countdown post HTTP "+countdown.status;await env.DB.prepare("UPDATE club_night_poll_preview SET status='pending',updated_at=?,error=? WHERE id=1").bind(new Date().toISOString(),error).run();await memberJoinDiag(env,"club_poll_preview_error",error);return;}
 await env.DB.prepare("UPDATE club_night_poll_preview SET countdown_message_id=?,updated_at=? WHERE id=1").bind(String(countdown.data.id),new Date().toISOString()).run();
 const when="<t:1794711600:F>";
 const content="@everyone 🌧️☣️ **ACID RAIN EVENT** ☣️🌧️\nWe’re planning to set Shadow Syndicate’s club status to **Active** for the kickoff at "+when+". We’ll launch an **Acid Rain** event to get things rolling.\n\n*See the live countdown above.*";
 const digest=await sha("club-status-poll-announcement-v10:"+GUILD_ID+":"+channelId+":2026-11-14T22:00:00-05:00");
 const nonce=BigInt("0x"+digest.slice(0,18)).toString();
 const result=await discordApi(env,"/channels/"+channelId+"/messages","POST",{allowed_mentions:{parse:["everyone"]},nonce,enforce_nonce:true,content,poll:{question:{text:"Are you ready to set your club status to Active?"},answers:[{poll_media:{text:"Yes — I’ll set my status to Active",emoji:{name:"✅"}}},{poll_media:{text:"No — banished to Dark Realm, doomed to eternal torment!",emoji:{name:"❌"}}}],duration:24,allow_multiselect:false,layout_type:1}});
 if(result.status===200&&result.data?.id){await env.DB.prepare("UPDATE club_night_poll_preview SET status='sent',message_id=?,updated_at=?,error=NULL WHERE id=1").bind(String(result.data.id),new Date().toISOString()).run();await memberJoinDiag(env,"club_poll_preview_sent","Native poll posted to announcements with @everyone; message "+result.data.id);}
 else{const error="Poll preview post HTTP "+result.status+" "+JSON.stringify(result.data||{}).slice(0,300);await env.DB.prepare("UPDATE club_night_poll_preview SET status='pending',updated_at=?,error=? WHERE id=1").bind(new Date().toISOString(),error).run();await memberJoinDiag(env,"club_poll_preview_error",error);}
}

export class MemberJoinGateway extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.socket=null;this.heartbeatTimer=null;this.heartbeatMs=45000;this.waitingForAck=false;this.seq=null;this.session=null;this.memberCount=0;this.connectedAt=0;this.lastAckAt=0;this.lastReadyAt=0;}
 async fetch(){try{await memberJoinDiag(this.env,"gateway_start","scheduled binding invoked");await this.connect();return new Response("Gateway listener starting",{status:202});}catch(e){console.error("Discord member gateway connect failed",String(e));return new Response("Gateway listener unavailable",{status:503});}}
 async alarm(){try{await this.connect();}catch(e){console.error("Discord member gateway reconnect failed",String(e));await this.ctx.storage.setAlarm(Date.now()+15000);}}
 async connect(){
  if(this.socket&&(this.socket.readyState===0||this.socket.readyState===1)){
   const now=Date.now(),age=now-this.connectedAt;
   const stale=this.socket.readyState===0?age>30000:
    (this.lastReadyAt===0&&age>90000)||(this.lastAckAt>0&&now-this.lastAckAt>Math.max(120000,this.heartbeatMs*3));
   if(!stale)return;
   await memberJoinDiag(this.env,"gateway_stale","Reconnecting stalled socket age="+age+" state="+this.socket.readyState);
   try{this.socket.close(4000,"Gateway watchdog recovery");}catch{}
   this.socket=null;this.waitingForAck=false;
   if(this.heartbeatTimer){clearTimeout(this.heartbeatTimer);this.heartbeatTimer=null;}
   this.session=null;await this.ctx.storage.delete("discord_session");
  }
  const saved=await this.ctx.storage.get("discord_session")||null;this.session=saved;this.seq=saved?.seq??null;this.memberCount=Number(await this.ctx.storage.get("member_count")||0);
  const root=saved?.resume_gateway_url||"wss://gateway.discord.gg/",url=root+(root.includes("?")?"&":"?")+"v=10&encoding=json";
  await memberJoinDiag(this.env,"gateway_connect","Opening "+root);
  const ws=new WebSocket(url);this.socket=ws;this.connectedAt=Date.now();this.lastReadyAt=0;this.lastAckAt=0;
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
  if(p.op===11){this.waitingForAck=false;this.lastAckAt=Date.now();return;}if(p.op===1){this.waitingForAck=true;this.send(ws,{op:1,d:this.seq});return;}if(p.op===7){try{ws.close(4001,"Gateway requested reconnect");}catch{}return;}
  if(p.op===9){this.session=null;this.seq=null;await this.ctx.storage.delete("discord_session");setTimeout(()=>{if(ws===this.socket)try{ws.close(4002,"Invalid gateway session");}catch{}},1000);return;}
  if(p.op!==0)return;
  if(p.t==="RESUMED"){this.lastReadyAt=Date.now();this.ctx.waitUntil(memberJoinDiag(this.env,"gateway_resumed","Discord session resumed"));return;}
  if(p.t==="READY"){this.lastReadyAt=Date.now();this.ctx.waitUntil(memberJoinDiag(this.env,"gateway_ready","READY received; bot user "+String(p.d?.user?.id||"unknown")));this.session={session_id:p.d.session_id,resume_gateway_url:p.d.resume_gateway_url,seq:this.seq};await this.ctx.storage.put("discord_session",this.session);return;}
  if(p.t==="GUILD_CREATE"&&p.d?.id===GUILD_ID&&Number.isFinite(p.d.member_count)){this.memberCount=p.d.member_count;await this.ctx.storage.put("member_count",this.memberCount);return;}
  if(p.t==="GUILD_MEMBER_ADD"&&p.d?.guild_id===GUILD_ID){this.ctx.waitUntil(memberJoinDiag(this.env,"member_add","Received join for "+String(p.d?.user?.id||"unknown")));this.memberCount=Number(this.memberCount||0)+1;await this.ctx.storage.put("member_count",this.memberCount);p.d.memberCount=this.memberCount;this.ctx.waitUntil(handleMemberJoin(this.env,this,p.d).catch(e=>console.error("member join processing failed",String(e))));return;}
  if(p.t==="GUILD_MEMBER_REMOVE"&&p.d?.guild_id===GUILD_ID){
   this.memberCount=Math.max(0,Number(this.memberCount||0)-1);await this.ctx.storage.put("member_count",this.memberCount);
   if(p.d?.user?.id){
    this.ctx.waitUntil((async()=>{await ensureJoinTrackingTable(this.env);await this.env.DB.prepare("DELETE FROM member_join_welcomes WHERE user_id=?").bind(p.d.user.id).run();await memberJoinDiag(this.env,"member_remove","Cleared welcome state for "+p.d.user.id);})().catch(e=>console.error("member leave cleanup",String(e))));
    this.ctx.waitUntil(queueShadowMemberLeave(this.env,p.d.user,p.s).catch(e=>console.error("member leave queue",String(e))));
   }
   return;
  }
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
async function interactionBounded(promise,ms=650){
 let timer;
 const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms)});
 const value=await Promise.race([Promise.resolve(promise),timeout]);
 clearTimeout(timer);
 return value;
}
async function deferredComponentWork(i,env,ctx,work,updateOriginal=false){
 const acknowledgement=updateOriginal?{type:6}:{type:5,data:{flags:64}};
 ctx.waitUntil((async()=>{
  let result;
  try{result=await work()}catch(e){console.error("deferred component work",String(e));result=reply("Something went wrong. Please try again.")}
  let payload;
  try{payload=result instanceof Response?await result.json():result}catch(e){console.error("deferred component response parse",String(e));payload=null}
  const data=payload?.data||{content:"Could not load the requested information."};
  const followup=updateOriginal&&payload?.type!==7;
  const url=followup
   ?"https://discord.com/api/v10/webhooks/"+APPLICATION_ID+"/"+i.token+"?wait=true"
   :"https://discord.com/api/v10/webhooks/"+APPLICATION_ID+"/"+i.token+"/messages/@original";
  const body={
   ...(typeof data.content==="string"?{content:data.content}:{}),
   ...(Array.isArray(data.embeds)?{embeds:data.embeds}:{}),
   components:Array.isArray(data.components)?data.components:[],
   allowed_mentions:data.allowed_mentions||{parse:[]}
  };
  if(followup)body.flags=64;
  for(let attempt=0;attempt<3;attempt++){
   try{
    const r=await fetch(url,{method:followup?"POST":"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(6000)});
    if(r.ok)return;
    const detail=(await r.text()).slice(0,250);
    if((r.status===429||r.status>=500)&&attempt<2){
     let waitMs=250*(2**attempt);
     if(r.status===429){try{waitMs=Math.min(3000,Math.max(250,Math.ceil(Number(JSON.parse(detail).retry_after||0)*1000)||waitMs))}catch{}}
     await new Promise(resolve=>setTimeout(resolve,waitMs));
     continue;
    }
    console.error("deferred component response",r.status,detail);return;
   }catch(e){
    if(attempt<2){await new Promise(resolve=>setTimeout(resolve,250*(2**attempt)));continue}
    console.error("deferred component response network",String(e));
   }
  }
 })());
 return discordResponse(acknowledgement);
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
 const page=Number(match[2]);
 const updateOriginal=Boolean(i.message?.flags&64);
 if(match[1]==="windows")return deferredComponentWork(i,env,ctx,()=>executorWindowsInteraction(i,env,page),updateOriginal);
 return deferredComponentWork(i,env,ctx,async()=>{
  let body;
  try{body=await executorPlatformPayload(env,match[1],page);}
  catch(e){console.error("executor platform view",String(e));body={content:"Executor information could not be loaded. Try again shortly.",embeds:[],components:[executorPlatformButtons(match[1])]};}
  body.allowed_mentions={parse:[]};
  return {type:updateOriginal?7:4,data:{...body,...(updateOriginal?{}:{flags:64})}};
 },updateOriginal);
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


const ROBLOX_ACHIEVEMENT_ROLES = Object.freeze([
 {key:"badge_347118512651055",kind:"badge",source_id:"347118512651055",name:"Yard Rookie",emoji:"🎉",color:0x76539A},
 {key:"badge_4493384153488115",kind:"badge",source_id:"4493384153488115",name:"Bid Starter",emoji:"🔨",color:0x76539A},
 {key:"badge_2156807070186054",kind:"badge",source_id:"2156807070186054",name:"Seasoned Bidder",emoji:"⚖️",color:0x76539A},
 {key:"badge_968672732412664",kind:"badge",source_id:"968672732412664",name:"Auction Legend",emoji:"🏆",color:0x9169B5},
 {key:"badge_4420209178775261",kind:"badge",source_id:"4420209178775261",name:"First Fortune",emoji:"🪙",color:0xA27A3F},
 {key:"badge_293915234199352",kind:"badge",source_id:"293915234199352",name:"Golden Locker",emoji:"🔐",color:0xA27A3F},
 {key:"badge_2832471902565333",kind:"badge",source_id:"2832471902565333",name:"Midnight Appraiser",emoji:"🌙",color:0x76539A},
 {key:"badge_2044362288175197",kind:"badge",source_id:"2044362288175197",name:"Vault Architect",emoji:"🏦",color:0x9169B5},
 {key:"badge_2117324818051101",kind:"badge",source_id:"2117324818051101",name:"Mutation Scholar",emoji:"🧪",color:0x76539A},
 {key:"badge_2958892288718923",kind:"badge",source_id:"2958892288718923",name:"Gavel Keeper",emoji:"🏆",color:0x9169B5},
 {key:"badge_2243860338697823",kind:"badge",source_id:"2243860338697823",name:"Safecracker",emoji:"🔓",color:0x76539A},
 {key:"badge_2061046447793073",kind:"badge",source_id:"2061046447793073",name:"Star Grader",emoji:"🌟",color:0x9169B5},
 {key:"badge_2174958257257604",kind:"badge",source_id:"2174958257257604",name:"Pristine Find",emoji:"💎",color:0x76539A},
 {key:"badge_2384449047183669",kind:"badge",source_id:"2384449047183669",name:"Time Touched",emoji:"⏳",color:0x76539A},
 {key:"badge_826078039185539",kind:"badge",source_id:"826078039185539",name:"Wrecking Crew",emoji:"🚘",color:0x76539A},
 {key:"badge_3478268039149215",kind:"badge",source_id:"3478268039149215",name:"First Shift",emoji:"🌱",color:0x547B72},
 {key:"badge_2636869078828444",kind:"badge",source_id:"2636869078828444",name:"Yard Regular",emoji:"🪙",color:0x547B72},
 {key:"badge_4232052017572890",kind:"badge",source_id:"4232052017572890",name:"Yard Veteran",emoji:"🛠️",color:0x547B72},
 {key:"badge_2369744542087671",kind:"badge",source_id:"2369744542087671",name:"Yard Fixture",emoji:"🌃",color:0x547B72},
 {key:"badge_1711363422123520",kind:"badge",source_id:"1711363422123520",name:"Shadow Treasury",emoji:"💰",color:0xA27A3F},
 {key:"badge_709835839666354",kind:"badge",source_id:"709835839666354",name:"Nothing But Net",emoji:"🏀",color:0x547B72},
 {key:"badge_3295715232604647",kind:"badge",source_id:"3295715232604647",name:"Double Trouble",emoji:"🧬",color:0x76539A},
 {key:"badge_2820769736120374",kind:"badge",source_id:"2820769736120374",name:"Triple Threat",emoji:"🧬",color:0x76539A},
 {key:"badge_2726635232418986",kind:"badge",source_id:"2726635232418986",name:"Mutation Overload",emoji:"☣️",color:0x9169B5},
 {key:"badge_2119370661379569",kind:"badge",source_id:"2119370661379569",name:"Junkyard Archivist",emoji:"📚",color:0x547B72},
 {key:"badge_599586120872973",kind:"badge",source_id:"599586120872973",name:"Back Alley Archivist",emoji:"🗝️",color:0x547B72},
 {key:"badge_4322087043340422",kind:"badge",source_id:"4322087043340422",name:"Farmyard Forager",emoji:"🌿",color:0x547B72},
 {key:"badge_1542612394801402",kind:"badge",source_id:"1542612394801402",name:"Shipyard Salvager",emoji:"⚓",color:0x547B72},
 {key:"badge_1523977774949788",kind:"badge",source_id:"1523977774949788",name:"Lucky Beachcomber",emoji:"🏖️",color:0x547B72},
 {key:"badge_1951652142311679",kind:"badge",source_id:"1951652142311679",name:"Power Plant Specialist",emoji:"⚡",color:0x547B72},
 {key:"badge_4343718850734940",kind:"badge",source_id:"4343718850734940",name:"Business Bay Broker",emoji:"🏙️",color:0x547B72},
 {key:"badge_1748654945450203",kind:"badge",source_id:"1748654945450203",name:"Mine Cartographer",emoji:"⛏️",color:0x547B72},
 {key:"badge_3443940266061497",kind:"badge",source_id:"3443940266061497",name:"Cargo Captain",emoji:"🚢",color:0x547B72},
 {key:"badge_2779271482766260",kind:"badge",source_id:"2779271482766260",name:"Rail Runner",emoji:"🚂",color:0x547B72},
 {key:"badge_253397934063860",kind:"badge",source_id:"253397934063860",name:"Fish Finder",emoji:"🎣",color:0x547B72},
 {key:"badge_3416683540311532",kind:"badge",source_id:"3416683540311532",name:"Lost & Found Keeper",emoji:"🧳",color:0x547B72},
 {key:"badge_2991713882977619",kind:"badge",source_id:"2991713882977619",name:"Lost Ledger Keeper",emoji:"📜",color:0x547B72},
 {key:"pass_1883008475",kind:"gamepass",source_id:"1883008475",name:"Custom Ride",emoji:"🛻",color:0xA27A3F},
 {key:"pass_1875507163",kind:"gamepass",source_id:"1875507163",name:"Quick Seller",emoji:"💸",color:0xA27A3F},
 {key:"pass_1907078250",kind:"gamepass",source_id:"1907078250",name:"Plot Architect",emoji:"🏗️",color:0x76539A},
 {key:"pass_1874691200",kind:"gamepass",source_id:"1874691200",name:"Lucky Grader",emoji:"🍀",color:0x547B72},
 {key:"pass_1919438589",kind:"gamepass",source_id:"1919438589",name:"Gavel Collector",emoji:"🏆",color:0xA27A3F},
 {key:"pass_1874365193",kind:"gamepass",source_id:"1874365193",name:"Heavy Hauler",emoji:"🚚",color:0x76539A},
 {key:"pass_1874793187",kind:"gamepass",source_id:"1874793187",name:"Bottomless Pack",emoji:"🎒",color:0x76539A},
 {key:"pass_1875633189",kind:"gamepass",source_id:"1875633189",name:"Celebrity",emoji:"🌟",color:0xA27A3F},
 {key:"pass_1874943185",kind:"gamepass",source_id:"1874943185",name:"The Grand Exchange",emoji:"🛒",color:0xA27A3F},
 {key:"pass_1876311152",kind:"gamepass",source_id:"1876311152",name:"Deal Chaser",emoji:"⏱️",color:0x547B72}
]);


const LINK_ROBLOX_COMMAND = Object.freeze({
 name:"link-roblox",description:"Link your Roblox account for badge and gamepass roles",type:1,dm_permission:false
});
const UNLINK_ROBLOX_COMMAND = Object.freeze({
 name:"unlink-roblox",description:"Unlink Roblox and remove your achievement roles",type:1,dm_permission:false
});
const BIRTHDAY_COMMAND = Object.freeze({
 name:"birthday",
 description:"View a server member's saved birthday",
 type:1,
 dm_permission:false,
 options:[{type:6,name:"user",description:"Choose a server member",required:true}]
});

const enc = new TextEncoder();
const hexBytes = s => new Uint8Array(s.match(/../g).map(x=>parseInt(x,16)));
const sha = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s)))].map(x=>x.toString(16).padStart(2,"0")).join("");
const reply = (message,ephemeral=true) => new Response(JSON.stringify({type:4,data:{content:message,flags:ephemeral?64:0,allowed_mentions:{parse:[]}}}),{headers:{"content-type":"application/json"}});

function birthdayDateLabel(month,day){
 return new Intl.DateTimeFormat("en-US",{month:"long",day:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(2000,Number(month)-1,Number(day))));
}
async function ensureBirthdayTable(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS community_birthdays(user_id TEXT PRIMARY KEY,birth_month INTEGER NOT NULL,birth_day INTEGER NOT NULL,updated_at TEXT NOT NULL)").run();
}
function birthdaySetModal(saved){
 const value=saved?String(saved.birth_month).padStart(2,"0")+"/"+String(saved.birth_day).padStart(2,"0"):"";
 return new Response(JSON.stringify({type:9,data:{custom_id:"syndicate_birthday_modal",title:"Set Your Birthday",components:[{type:1,components:[{type:4,custom_id:"birthday_mmdd",label:"Birthday (month/day)",style:1,min_length:3,max_length:5,required:true,placeholder:"MM/DD",...(value?{value}:{})}]}]}}),{headers:{"content-type":"application/json"}});
}
function birthdayEphemeral(content,components=[]){
 return new Response(JSON.stringify({type:4,data:{content,flags:64,components,allowed_mentions:{parse:[]}}}),{headers:{"content-type":"application/json"}});
}
async function birthdayRegisterButton(i,env){
 const userId=String(i.member?.user?.id||i.user?.id||"");
 if(!userId)return reply("I couldn't identify your Discord account.");
 let saved=null;
 try{saved=await interactionBounded((async()=>{await ensureBirthdayTable(env);return env.DB.prepare("SELECT birth_month,birth_day FROM community_birthdays WHERE user_id=?").bind(userId).first()})())}
 catch(e){console.error("birthday register lookup",String(e))}
 if(!saved)return birthdaySetModal(null);
 return birthdayEphemeral("Your saved birthday is **"+birthdayDateLabel(saved.birth_month,saved.birth_day)+"**.",[{type:1,components:[{type:2,style:1,label:"Change Birthday",custom_id:"syndicate_birthday_change"}]}]);
}
async function birthdayLookupCommand(i,env){
 const targetId=String(i.data?.options?.find(option=>option.name==="user")?.value||"");
 if(!/^\d{17,20}$/.test(targetId))return birthdayEphemeral("Choose a server member to look up.");
 await ensureBirthdayTable(env);
 const saved=await env.DB.prepare("SELECT birth_month,birth_day FROM community_birthdays WHERE user_id=?").bind(targetId).first();
 const target=i.data?.resolved?.users?.[targetId]||i.data?.resolved?.members?.[targetId]?.user;
 const name=target?.global_name||target?.username||("<@"+targetId+">");
 if(!saved)return birthdayEphemeral(name+" hasn't registered a birthday yet.");
 return birthdayEphemeral(name+"'s saved birthday is **"+birthdayDateLabel(saved.birth_month,saved.birth_day)+"**.");
}
async function welcomeWaveInteraction(i,env){
 const match=/^welcome_wave:(\d{17,20})$/.exec(String(i.data?.custom_id||""));
 if(!match)return reply("That welcome button is no longer valid.");
 const joinedUserId=match[1],welcomerId=String(i.member?.user?.id||i.user?.id||"");
 if(!welcomerId)return reply("I couldn't identify your Discord account.");
 if(String(i.channel_id)!==INTRO_WELCOME_CHANNEL_ID)return reply("That welcome button only works in #welcome.");
 return postCelebrationReply(i,env,{scope:"welcome",targetId:joinedUserId,actorId:welcomerId});
}
async function birthdayRemoveButton(i,env){
 const userId=String(i.member?.user?.id||i.user?.id||"");
 if(!userId)return reply("I couldn't identify your Discord account.");
 await ensureBirthdayTable(env);
 const saved=await env.DB.prepare("SELECT birth_month,birth_day FROM community_birthdays WHERE user_id=?").bind(userId).first();
 if(!saved)return reply("You don't have a saved birthday to remove.");
 await env.DB.prepare("DELETE FROM community_birthdays WHERE user_id=?").bind(userId).run();
 return reply("Your birthday ("+birthdayDateLabel(saved.birth_month,saved.birth_day)+") has been removed.");
}
async function birthdayChangeButton(i,env){
 const userId=String(i.member?.user?.id||i.user?.id||"");
 if(!userId)return reply("I couldn't identify your Discord account.");
 let saved=null;
 try{saved=await interactionBounded((async()=>{await ensureBirthdayTable(env);return env.DB.prepare("SELECT birth_month,birth_day FROM community_birthdays WHERE user_id=?").bind(userId).first()})())}
 catch(e){console.error("birthday change lookup",String(e))}
 return birthdaySetModal(saved||null);
}
async function birthdayModalSubmit(i,env){
 const userId=String(i.member?.user?.id||i.user?.id||"");
 if(!userId)return reply("I couldn't identify your Discord account.");
 const value=i.data.components?.flatMap(row=>row.components||[]).find(component=>component.custom_id==="birthday_mmdd")?.value||"";
 const match=/^\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*$/.exec(String(value));
 if(!match)return reply("Enter your birthday as **MM/DD** (for example, 04/23).");
 const month=Number(match[1]),day=Number(match[2]);
 if(month<1||month>12||day<1||day>new Date(Date.UTC(2000,month,0)).getUTCDate())return reply("That date doesn't look valid. Enter a real month and day as **MM/DD**.");
 await ensureBirthdayTable(env);
 await env.DB.prepare("INSERT INTO community_birthdays(user_id,birth_month,birth_day,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET birth_month=excluded.birth_month,birth_day=excluded.birth_day,updated_at=excluded.updated_at").bind(userId,month,day,new Date().toISOString()).run();
 return reply("Your birthday is saved as **"+birthdayDateLabel(month,day)+"**.");
}


const CELEBRATION_TIME_ZONE="America/New_York";
const CELEBRATION_WELCOME_PROMPTS=["🎉 {actor} is rolling out the confetti for {target}—welcome to the crew! 🥳","👋 {actor} brought the big wave: {target}, we're glad you're here! 🌟","🎊 The welcome committee has arrived! {actor} cheers for {target}! 🙌","✨ New friend alert! {actor} is saving a spot in the crew for {target}! 💜","🥳 {actor} says the party is better now that {target} is here! 🎈","🚀 {actor} is launching a big welcome for {target}! Make yourself at home! 🌙","🎈 Confetti in the chat! {actor} gives {target} the warmest welcome! 🎉","🪩 The dance floor is open: {actor} welcomes {target} to the crew! 💃","🌟 A fresh face and a fresh reason to celebrate—welcome, {target}! —{actor} 🎊","💜 {actor} is sending {target} a whole storm of good vibes. Welcome aboard! ✨","🎤 Mic check! {actor} has one message for {target}: welcome to the family! 🎶","🧁 A sweet welcome for {target}, served with extra sprinkles by {actor}! 🍬","🐺 The pack grows stronger! {actor} welcomes {target} to Shadow Syndicate! 🌙","🎆 Lights up, music on—{actor} is celebrating {target}'s arrival! 🎵","🛸 {actor} has beamed {target} straight into the coolest corner of the server! 👾","🌈 Good people, good times, and now {target}! {actor} says welcome! 💫","🏆 First-class welcome incoming: {actor} is cheering for {target}! 🎉","🎇 The welcome fireworks are all for {target}, courtesy of {actor}! ✨","🧭 {actor} points {target} toward good chats and great company. Welcome! 🗺️","☀️ The server just got brighter—{actor} welcomes {target} with a sunny wave! 🌻","🎮 Player joined! {actor} says {target} has unlocked the welcome party! 🕹️","💌 A little note from {actor}: {target}, we're happy you found us! 💜","🎺 Cue the fanfare! {actor} gives {target} a triumphant welcome! 🥁","🦋 A new connection takes flight—welcome to the crew, {target}! —{actor} 🌷","🧨 Big entrance energy! {actor} is making some noise for {target}! 🎊","🍰 Welcome cake is on the table! {actor} saved the first slice for {target}! 🎂","🌌 From the stars to our server, {actor} welcomes {target} to the Syndicate! ✨","🤝 {actor} is offering {target} a handshake, a high five, and a warm welcome! 🙌","🎨 A new color joins the canvas—{actor} welcomes {target} to the community! 🖌️","🔔 Ding ding! {actor} announces that {target} has officially joined the fun! 🎉","🧸 Cozy seat, friendly faces, warm welcome: {actor} is glad you're here, {target}! 🫶","🎹 The welcome soundtrack starts now—{actor} is cheering for {target}! 🎶","🏮 Lanterns glowing and chat sparkling—{actor} welcomes {target}! ✨","🍿 The show is better with {target} in the audience. Welcome, from {actor}! 🎟️","🛡️ {actor} welcomes {target} to the crew. Your next adventure starts here! ⚔️","🎐 A little breeze, a big hello—{actor} is waving to {target}! 🌬️","🪄 A new friend appears! {actor} welcomes {target} with a little server magic! ✨","📣 Everybody say hello! {actor} is celebrating our newest member, {target}! 🎉","🌺 Fresh blooms and friendly hellos—{actor} welcomes {target} to the garden! 🌼","🧭 Adventure buddies acquired: {actor} welcomes {target} to the journey! 🥾"];
const CELEBRATION_BIRTHDAY_PROMPTS=["🎂 {actor} is sending {target} a whole parade of birthday wishes! 🥳","🎉 Make room for the cake! {actor} is celebrating {target} today! 🎈","🌟 Today gets an extra sparkle because it's {target}'s birthday! —{actor} ✨","🥳 {actor} hopes {target}'s birthday is packed with laughs, treats, and good surprises! 🎁","🎁 A birthday bundle of good vibes is headed to {target}, from {actor}! 💜","🍰 The sweetest day deserves the sweetest wishes—happy birthday, {target}! —{actor} 🧁","🎈 {actor} is floating birthday balloons all the way to {target}! 🎉","🌙 One more trip around the sun, one brighter day for {target}! Happy birthday! —{actor} ☀️","🎊 Birthday alert! {actor} is cheering extra loudly for {target}! 📣","🎤 Today's headliner is {target}! {actor} wishes you a show-stopping birthday! 🎶","🪩 The birthday dance floor belongs to {target}! Celebrate big! —{actor} 💃","🚀 {actor} wishes {target} a birthday that launches straight into an amazing year! 🌠","🧁 Sprinkle count: infinite. Birthday wishes: all for {target}! —{actor} 🍬","🐺 The whole pack sends birthday love to {target}! With cheers from {actor}! 🌙","🎆 Birthday fireworks for {target}! {actor} hopes every wish comes true! ✨","💜 {actor} is wrapping {target}'s day in friendship, laughter, and birthday magic! 🎁","🎮 Achievement unlocked: another awesome year for {target}! Happy birthday! —{actor} 🏆","🌈 Here's to bright plans, kind people, and a brilliant birthday for {target}! —{actor} 💫","🎺 Cue the birthday fanfare for {target}! {actor} is celebrating you today! 🥁","☀️ Sending {target} sunshine, smiles, and a very happy birthday! —{actor} 🌻","🧨 Birthday energy: maximum! {actor} hopes {target} has the best day ever! 🎊","🍕 Cake first, wishes second, more cake after that—happy birthday, {target}! —{actor} 🍰","🛸 Birthday wishes beamed to {target} from across the galaxy! —{actor} 👾","🦋 May {target}'s next chapter be colorful, calm, and full of good surprises! Happy birthday! —{actor} 🌷","🏆 Today's award for being legendary goes to {target}! Happy birthday, from {actor}! 🥇","📸 Freeze the moment: it's {target}'s day to shine! Birthday love from {actor}! ✨","🎹 A new birthday song just dropped, starring {target}! —{actor} 🎶","🍓 Sending {target} a basket of sweet birthday wishes! —{actor} 🍒","🪄 One birthday wish, a little magic, and a year of possibilities for {target}! —{actor} ✨","🏮 May {target}'s birthday glow long after the candles go out! —{actor} 🌟","🤝 Another year of you is worth celebrating. Happy birthday, {target}! —{actor} 💜","🧸 Sending cozy hugs and giant birthday cheer to {target}! —{actor} 🫶","🎨 This day is your masterpiece, {target}! Happy birthday, with love from {actor}! 🖌️","🔔 Ding ding! It's {target}'s birthday—time for cake and celebration! —{actor} 🎂","🧭 Here's to {target}'s next great adventure around the sun! Happy birthday! —{actor} 🗺️","🌺 Hope {target}'s birthday blooms into a wonderful year! —{actor} 🌼","🎟️ Front row seats to the birthday celebration: reserved for {target}! —{actor} 🍿","⚔️ New year, new quests, same legendary {target}. Happy birthday! —{actor} 🛡️","🎐 May the breeze carry birthday wishes and good luck to {target}! —{actor} 🌬️","🎈 {actor} is raising a toast (and a balloon) to {target}! Happy birthday! 🥤"];
let celebrationStickerCache=null,celebrationStickerCacheAt=0;
async function ensureCelebrationTables(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS celebration_rotation(scope TEXT PRIMARY KEY,items_json TEXT NOT NULL,cursor INTEGER NOT NULL,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS celebration_reply_claims(source_message_id TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(source_message_id,actor_id))").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS community_birthday_sends(year INTEGER NOT NULL,user_id TEXT NOT NULL,channel_id TEXT NOT NULL,message_id TEXT NOT NULL,sent_at TEXT NOT NULL,PRIMARY KEY(year,user_id))").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS birthday_scheduler_lock(id INTEGER PRIMARY KEY CHECK(id=1),lease_until INTEGER NOT NULL)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS community_birthday_embed_upgrades(message_id TEXT PRIMARY KEY,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS community_birthday_reply_scans(announcement_id TEXT PRIMARY KEY,scanned_at TEXT NOT NULL)").run();
}
function shuffleCelebration(items){
 const copy=[...items];
 for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]]}
 return copy;
}
async function nextCelebrationItem(env,scope,items){
 const now=new Date().toISOString(), deck=JSON.stringify(shuffleCelebration(items));
 await env.DB.prepare("INSERT OR IGNORE INTO celebration_rotation(scope,items_json,cursor,updated_at) VALUES(?,?, -1, ?)").bind(scope,deck,now).run();
 const row=await env.DB.prepare("UPDATE celebration_rotation SET cursor=(cursor+1)%?,updated_at=? WHERE scope=? RETURNING items_json,cursor").bind(items.length,now,scope).first();
 if(!row)return items[Math.floor(Math.random()*items.length)];
 let active;
 try{active=JSON.parse(row.items_json)}catch{active=items}
 if(!Array.isArray(active)||active.length!==items.length)active=shuffleCelebration(items);
 return active[row.cursor]||items[Math.floor(Math.random()*items.length)];
}
async function currentCelebrationStickers(env){
 if(celebrationStickerCache&&Date.now()-celebrationStickerCacheAt<60000)return celebrationStickerCache;
 const result=await discordApi(env,"/guilds/"+GUILD_ID+"/stickers");
 if(result.status!==200||!Array.isArray(result.data)){celebrationStickerCache=[];celebrationStickerCacheAt=Date.now();return []}
 const all=result.data.filter(item=>item?.id&&item.available!==false);
 const festive=all.filter(item=>/celebr|birthday|welcome|party|confetti|congrats|congrat|cake|yay|hype|dance|wave|hello|cheer|sparkle/i.test(String(item.name||"")+" "+String(item.tags||"")));
 celebrationStickerCache=festive.length?festive:all;
 celebrationStickerCacheAt=Date.now();
 return celebrationStickerCache;
}
async function nextCelebrationSticker(env,scope){
 const stickers=await currentCelebrationStickers(env);
 if(!stickers.length){console.warn("no available guild stickers for celebration",scope);return null;}
 const ids=stickers.map(item=>String(item.id));
 return nextCelebrationItem(env,"sticker:"+scope,ids);
}
function makeCelebrationEmbed(scope,description,fromLabel){
 const birthday=scope==="birthday";
 return {
  color:birthday?0xF6BD60:0x8B5CF6,
  author:{name:birthday?"A Birthday Wish from "+fromLabel:"A Welcome from "+fromLabel},
  title:birthday?"🎂 Happy Birthday! 🎂":"🎉 Welcome to the Crew! 🎉",
  description,
  fields:birthday?[
   {name:"🎁 Make a wish",value:"May your next trip around the sun bring great memories and good surprises.",inline:false}
  ]:[],
  footer:{text:birthday?"Wishing you an amazing year ahead • Shadow Syndicate":"Glad you're here • Shadow Syndicate"},
  timestamp:new Date().toISOString()
 };
}
async function sendCelebrationMessage(env,channelId,payload,stickerId){
 const body={...payload};
 if(stickerId)body.sticker_ids=[String(stickerId)];
 const result=await discordApi(env,"/channels/"+channelId+"/messages","POST",body);
 if(stickerId&&result.status>=400){
  console.error("celebration sticker rejected",JSON.stringify({status:result.status,error:result.data,stickerId,channelId}));
  delete body.sticker_ids;
  const fallback=await discordApi(env,"/channels/"+channelId+"/messages","POST",body);
  return {...fallback,stickerRejected:true,stickerError:result.data};
 }
 return {...result,stickerRejected:false};
}
async function postCelebrationReply(i,env,{scope,targetId,actorId}){
 if(!env.DB)return reply("Celebrations are temporarily unavailable.");
 await ensureCelebrationTables(env);
 const sourceId=String(i.message?.id||"");
 if(!/^\d{17,20}$/.test(sourceId))return reply("That celebration button is no longer valid.");
 const claim=await env.DB.prepare("INSERT OR IGNORE INTO celebration_reply_claims(source_message_id,actor_id,created_at) VALUES(?,?,?)").bind(sourceId,actorId,new Date().toISOString()).run();
 if(!(claim?.meta?.changes>0))return reply("You already posted a celebration on this message.");
 try{
  const templates=scope==="birthday"?CELEBRATION_BIRTHDAY_PROMPTS:CELEBRATION_WELCOME_PROMPTS;
  const template=await nextCelebrationItem(env,"prompts:"+scope,templates);
  const actorLabel=String(i.member?.user?.global_name||i.member?.user?.username||i.user?.global_name||i.user?.username||"A friend");
  const description=template.replaceAll("{actor}",actorLabel).replaceAll("{target}","you");
  const content=scope==="birthday"?"🎂 Happy birthday, <@"+targetId+">! 🎉":description+" 🎊";
  const sticker=await nextCelebrationSticker(env,scope);
  const payload={content,allowed_mentions:{parse:[],users:[targetId]}};
  if(scope==="birthday")payload.embeds=[makeCelebrationEmbed(scope,description,actorLabel)];
  const posted=await sendCelebrationMessage(env,i.channel_id,payload,sticker);
  if(posted.status!==200||!posted.data?.id)throw Error("Discord rejected the celebration post ("+posted.status+").");
  return reply(posted.stickerRejected?"Your message posted, but Discord rejected the sticker. Check the bot's sticker permissions and the server's available stickers.":!sticker?"Your message posted, but this server has no available stickers for the bot to send yet.":"Celebration posted with a sticker!");
 }catch(e){
  await env.DB.prepare("DELETE FROM celebration_reply_claims WHERE source_message_id=? AND actor_id=?").bind(sourceId,actorId).run().catch(()=>{});
  console.error("celebration reply",String(e));
  return reply("I couldn't post the celebration. Please try again.");
 }
}
async function birthdayCelebrationInteraction(i,env){
 const match=/^birthday_celebrate:(\d{17,20}):(\d{4})$/.exec(String(i.data?.custom_id||""));
 if(!match)return reply("That birthday button is no longer valid.");
 if(!env.DB)return reply("Celebrations are temporarily unavailable.");
 await ensureCelebrationTables(env);
 const userId=match[1],year=Number(match[2]);
 const sent=await env.DB.prepare("SELECT channel_id,message_id FROM community_birthday_sends WHERE year=? AND user_id=?").bind(year,userId).first();
 if(!sent||String(sent.channel_id)!==String(i.channel_id)||String(sent.message_id)!==String(i.message?.id))return reply("That birthday celebration button has expired.");
 const actorId=String(i.member?.user?.id||i.user?.id||"");
 if(!actorId)return reply("I couldn't identify your Discord account.");
 return postCelebrationReply(i,env,{scope:"birthday",targetId:userId,actorId});
}
function birthdayLocalNow(date=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:CELEBRATION_TIME_ZONE,year:"numeric",month:"numeric",day:"numeric",hour:"numeric",hourCycle:"h23"}).formatToParts(date).map(part=>[part.type,part.value]));
 return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),hour:Number(parts.hour)};
}
async function birthdayAnnouncementChannel(env){
 const channels=await discordApi(env,"/guilds/"+GUILD_ID+"/channels");
 if(channels.status===200&&Array.isArray(channels.data)){
  const found=joinChannel(channels.data,"birthdays","birthday","birthday-announcements","birthday-celebrations","birthday-wishes","celebrations","general");
  if(found)return String(found.id);
 }
 return "1564527128253436005";
}
async function acquireBirthdaySchedulerLock(env,nowMs){
 const until=nowMs+10*60*1000;
 const row=await env.DB.prepare("INSERT INTO birthday_scheduler_lock(id,lease_until) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE birthday_scheduler_lock.lease_until<? RETURNING id").bind(until,nowMs).first();
 return row?until:null;
}
async function upgradeBirthdayAnnouncementEmbeds(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 await ensureBirthdayTable(env);
 await ensureCelebrationTables(env);
 const local=birthdayLocalNow();
 const pending=await env.DB.prepare("SELECT s.user_id,s.channel_id,s.message_id FROM community_birthday_sends s WHERE s.year=? AND date(s.sent_at)=date('now')").bind(local.year).all();
 for(const row of pending?.results||[]){
  const userId=String(row.user_id||""),channelId=String(row.channel_id||""),messageId=String(row.message_id||"");
  if(!/^\d{17,20}$/.test(userId)||!/^\d{17,20}$/.test(channelId)||!/^\d{17,20}$/.test(messageId))continue;
  try{
   const path="/channels/"+channelId+"/messages/"+messageId;
   const current=await discordApi(env,path);
   if(current.status!==200||!current.data?.id)continue;
   const message=current.data;
   if(!Array.isArray(message.embeds)||message.embeds.length===0){
    const template=await nextCelebrationItem(env,"prompts:birthday",CELEBRATION_BIRTHDAY_PROMPTS);
    const description=template.replaceAll("{actor}","The Syndicate crew").replaceAll("{target}","you");
    const patched=await discordApi(env,path,"PATCH",{
     content:"🎂 Happy birthday, <@"+userId+">! 🎉",
     embeds:[makeCelebrationEmbed("birthday",description,"The Syndicate crew")],
     components:Array.isArray(message.components)?message.components:[],
     allowed_mentions:{parse:[],users:[userId]}
    });
    if(patched.status!==200||!patched.data?.id)continue;
   }
   await env.DB.prepare("INSERT OR IGNORE INTO community_birthday_embed_upgrades(message_id,updated_at) VALUES(?,?)").bind(messageId,new Date().toISOString()).run();
   const scanned=await env.DB.prepare("SELECT announcement_id FROM community_birthday_reply_scans WHERE announcement_id=?").bind(messageId).first();
   if(scanned)continue;
   const recent=await discordApi(env,"/channels/"+channelId+"/messages?limit=100");
   if(recent.status!==200||!Array.isArray(recent.data))continue;
   for(const replyMessage of recent.data){
    if(replyMessage.author?.bot!==true||String(replyMessage.id)===messageId||BigInt(String(replyMessage.id||"0"))<=BigInt(messageId))continue;
    const oldContent=String(replyMessage.content||"");
    if(!(oldContent.includes("<@"+userId+">")||oldContent.includes("<@!"+userId+">"))||!/birthday|cake|wish|sun|balloon|celebrat|candles/i.test(oldContent))continue;
    if(Array.isArray(replyMessage.embeds)&&replyMessage.embeds.length)continue;
    const description=oldContent.replaceAll("<@!"+userId+">","you").replaceAll("<@"+userId+">","you").replace(/—\s*The Syndicate crew/gi,"").trim();
    const patchedReply=await discordApi(env,"/channels/"+channelId+"/messages/"+replyMessage.id,"PATCH",{
     content:"🎂 Happy birthday, <@"+userId+">! 🎉",
     embeds:[makeCelebrationEmbed("birthday",description||"The Syndicate crew wishes you a very happy birthday!","The Syndicate crew")],
     components:Array.isArray(replyMessage.components)?replyMessage.components:[],
     allowed_mentions:{parse:[],users:[userId]}
    });
    if(patchedReply.status!==200||!patchedReply.data?.id)throw Error("Could not upgrade birthday reply message.");
    await env.DB.prepare("INSERT OR IGNORE INTO community_birthday_embed_upgrades(message_id,updated_at) VALUES(?,?)").bind(String(replyMessage.id),new Date().toISOString()).run();
   }
   await env.DB.prepare("INSERT OR IGNORE INTO community_birthday_reply_scans(announcement_id,scanned_at) VALUES(?,?)").bind(messageId,new Date().toISOString()).run();
   console.log("Birthday embeds checked",userId,channelId,messageId);
  }catch(e){console.error("birthday embed upgrade",userId,String(e))}
 }
}
async function sendBirthdayAnnouncements(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 await ensureBirthdayTable(env);
 await ensureCelebrationTables(env);
 const local=birthdayLocalNow();
 if(local.hour<9)return;
 const lease=await acquireBirthdaySchedulerLock(env,Date.now());
 if(!lease)return;
 try{
  const birthdays=await env.DB.prepare("SELECT user_id FROM community_birthdays WHERE birth_month=? AND birth_day=?").bind(local.month,local.day).all();
  const rows=birthdays?.results||[];
  if(!rows.length)return;
  const channelId=await birthdayAnnouncementChannel(env);
  for(const row of rows){
   const userId=String(row.user_id||"");
   if(!/^\d{17,20}$/.test(userId))continue;
   const already=await env.DB.prepare("SELECT message_id FROM community_birthday_sends WHERE year=? AND user_id=?").bind(local.year,userId).first();
   if(already)continue;
   try{
    const template=await nextCelebrationItem(env,"prompts:birthday",CELEBRATION_BIRTHDAY_PROMPTS);
    const description=template.replaceAll("{actor}","The Syndicate crew").replaceAll("{target}","you");
    const content="🎂 Happy birthday, <@"+userId+">! 🎉";
    const sticker=await nextCelebrationSticker(env,"birthday");
    const body={content,embeds:[makeCelebrationEmbed("birthday",description,"The Syndicate crew")],allowed_mentions:{parse:[],users:[userId]},components:[{type:1,components:[{type:2,style:2,label:"Send a birthday wish",custom_id:"birthday_celebrate:"+userId+":"+local.year}]}],nonce:String(local.year)+userId,enforce_nonce:true};
    const posted=await sendCelebrationMessage(env,channelId,body,sticker);
    if(posted.status!==200||!posted.data?.id)throw Error("Discord rejected birthday post ("+posted.status+").");
    await env.DB.prepare("INSERT OR IGNORE INTO community_birthday_sends(year,user_id,channel_id,message_id,sent_at) VALUES(?,?,?,?,?)").bind(local.year,userId,channelId,String(posted.data.id),new Date().toISOString()).run();
    console.log("Birthday announcement posted",userId,local.year,channelId);
   }catch(e){console.error("birthday announcement",userId,String(e))}
  }
 }finally{
  await env.DB.prepare("UPDATE birthday_scheduler_lock SET lease_until=0 WHERE id=1 AND lease_until=?").bind(lease).run().catch(()=>{});
 }
}



const CLUB_EVENTS_CHANNEL="1564527132720234556";
const LEGACY_ACID_EVENT="acid_rain_20261110_2330";
async function ensureClubEventTables(env){
 if(!env.DB)throw Error("Event database is unavailable");
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS club_events(event_id TEXT PRIMARY KEY,host_id TEXT,channel_id TEXT NOT NULL,message_id TEXT,start_unix INTEGER,location TEXT,profile_url TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL,ended_at TEXT)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS club_event_participants(event_id TEXT NOT NULL,discord_user_id TEXT NOT NULL,username TEXT NOT NULL,joined_at TEXT NOT NULL,PRIMARY KEY(event_id,discord_user_id))").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS club_event_panels(channel_id TEXT PRIMARY KEY,message_id TEXT NOT NULL,created_at TEXT NOT NULL)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS club_event_host_profiles(discord_user_id TEXT PRIMARY KEY,roblox_username TEXT NOT NULL,roblox_user_id TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS club_event_setup(key TEXT PRIMARY KEY,value TEXT NOT NULL)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS club_event_cleanup(event_id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,message_id TEXT NOT NULL,queued_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT)").run();
 await env.DB.prepare("INSERT OR IGNORE INTO club_events(event_id,host_id,channel_id,message_id,start_unix,location,profile_url,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(LEGACY_ACID_EVENT,null,CLUB_EVENTS_CHANNEL,"1569912342442024971",1794371400,"festivesillygirls server",null,"active","2026-11-11T03:11:10.164Z").run();
}
async function clubEventModal(i,env,eventType="acid"){
 const kind=eventType==="bunker"||eventType==="dual"?eventType:"acid";
 const userId=i.member?.user?.id||i.user?.id;
 let savedUsername="";
 if(userId&&env.DB){try{const saved=await interactionBounded(env.DB.prepare("SELECT roblox_username FROM club_event_host_profiles WHERE discord_user_id=?").bind(userId).first());if(/^[A-Za-z0-9_]{3,20}$/.test(String(saved?.roblox_username||"")))savedUsername=String(saved.roblox_username)}catch(error){console.error("Saved event username lookup",String(error))}}
 const field=(id,label,placeholder,max=120,defaultValue)=>({type:1,components:[{type:4,custom_id:id,label,style:1,required:true,placeholder,min_length:1,max_length:max,...(defaultValue!==undefined?{value:defaultValue}:{})}]});
 return discordResponse({type:9,data:{custom_id:"club_event_create_modal:"+kind,title:kind==="bunker"?"Create Military Bunker Event":kind==="dual"?"Create Dual Event":"Create Acid Rain Event",components:[
  field("event_username","Roblox username (not display name)","RobloxUsername",20,savedUsername||undefined),
  field("event_hours","Hours until start","0",4,"0"),
  field("event_minutes","Additional minutes until start","0",2,"0")
 ]}});
}
function clubEventInput(i,id){const field=(i.data?.components||[]).flatMap(row=>row.components||[]).find(x=>x.custom_id===id);return String(field?.value||"").trim();}
function clubEventActions(eventId,ended=false){return [{type:1,components:[
 {type:2,style:3,custom_id:"club_event_join:"+eventId,label:"Join event",emoji:{name:"✅"},disabled:ended},
 {type:2,style:2,custom_id:"club_event_view:"+eventId,label:"See Participants",emoji:{name:"👥"}},
 {type:2,style:4,custom_id:"club_event_end:"+eventId,label:"End Event",disabled:ended}
]}];}
async function createClubEvent(i,env){
 await ensureClubEventTables(env);
 if(i.channel_id!==CLUB_EVENTS_CHANNEL)return reply("Create events from the Club Events channel.");
 const host=i.member?.user||i.user;if(!host?.id)return reply("Could not identify the event host.");
 const customId=String(i.data?.custom_id||""),kind=customId.endsWith(":bunker")?"bunker":customId.endsWith(":dual")?"dual":"acid";
 const username=clubEventInput(i,"event_username").replace(/^@/,"");
 const hoursText=clubEventInput(i,"event_hours"),minutesText=clubEventInput(i,"event_minutes");
 if(!/^[A-Za-z0-9_]{3,20}$/.test(username))return reply("Enter your Roblox **username** (3–20 letters, numbers, or underscores), not your display name or profile URL.");
 if(!/^\d{1,4}$/.test(hoursText)||!/^\d{1,2}$/.test(minutesText))return reply("Enter whole numbers for hours and minutes.");
 const hours=Number(hoursText),minutes=Number(minutesText);
 if(hours>1440||minutes>59)return reply("Use 0–1440 hours and 0–59 additional minutes.");
 const totalMinutes=hours*60+minutes;
 if(totalMinutes<1||totalMinutes>60*24*60)return reply("Set the start at least one minute from now and no more than 60 days away.");
 const start=Math.floor(Date.now()/1000)+totalMinutes*60;
 const existing=await env.DB.prepare("SELECT event_id FROM club_events WHERE host_id=? AND status IN ('active','creating') LIMIT 1").bind(host.id).first();
 if(existing)return reply("You already have an open event. End that event before creating another.");
 let robloxUser;
 try{
  const lookup=await fetch("https://users.roblox.com/v1/usernames/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({usernames:[username],excludeBannedUsers:false}),signal:AbortSignal.timeout(8000)});
  if(!lookup.ok)return reply("Roblox username verification is temporarily unavailable. Please try again in a moment.");
  const payload=await lookup.json();
  robloxUser=Array.isArray(payload?.data)?payload.data.find(x=>String(x.requestedUsername||x.name||"").toLowerCase()===username.toLowerCase()&&/^\d{1,20}$/.test(String(x.id||""))&&/^[A-Za-z0-9_]{3,20}$/.test(String(x.name||""))):null;
 }catch(error){console.error("Club event Roblox username resolution",String(error));return reply("Couldn't verify that Roblox username right now. Please try again.");}
 if(!robloxUser)return reply("That Roblox **username** wasn't found. Check the account username (not its display name) and try again.");
 const robloxId=String(robloxUser.id),robloxName=String(robloxUser.name),robloxProfile="https://www.roblox.com/users/"+robloxId+"/profile";
 const eventId=kind+"_"+Math.floor(Date.now()/1000).toString(36)+"_"+crypto.randomUUID().replace(/-/g,"").slice(0,12),now=new Date().toISOString();
 const eventName=kind==="bunker"?"MILITARY BUNKER • MILITARY BASE":kind==="dual"?"ACID RAIN + MILITARY BUNKER • MILITARY BASE":"ACID RAIN";
 const eventTitle=kind==="bunker"?"🪖 CLUB EVENT: MILITARY BUNKER":kind==="dual"?"⚔️ CLUB EVENT: ACID RAIN + MILITARY BUNKER":"☣️ CLUB EVENT: ACID RAIN";
 const eventDescription=kind==="bunker"?"The Military Base Bunker is opening! Hosted by <@"+host.id+">.\n\n**Sign up below** and add the host's Roblox account before the event begins.":kind==="dual"?"Acid Rain and the Military Base Bunker are opening together! Hosted by <@"+host.id+">.\n\n**Sign up below** and add the host's Roblox account before the event begins.":"Acid Rain is back! Hosted by <@"+host.id+">.\n\n**Sign up below** and add the host's Roblox account before the event begins.";
 await env.DB.prepare("INSERT INTO club_events(event_id,host_id,channel_id,start_unix,location,profile_url,status,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(eventId,host.id,CLUB_EVENTS_CHANNEL,start,kind==="bunker"?"Military Base Bunker":kind==="dual"?"Acid Rain + Military Base Bunker":"Acid Rain",robloxProfile,"creating",now).run();
 const payload={content:"@everyone",allowed_mentions:{parse:["everyone"]},embeds:[{title:eventTitle,description:eventDescription,color:kind==="bunker"?0x596B88:0x9B72CF,fields:[
  {name:"Starts",value:"<t:"+start+":F> · <t:"+start+":R>",inline:false},
  {name:"Event",value:eventName,inline:true},{name:"Host",value:"<@"+host.id+">",inline:true},
  {name:"Add the host on Roblox",value:"[Add @"+robloxName+" on Roblox]("+robloxProfile+")",inline:false},
  {name:"Participants",value:"0 people signed up",inline:true}
 ],footer:{text:"Shadow Syndicate • Club Events"}}],components:clubEventActions(eventId)};
 const posted=await discordApi(env,"/channels/"+CLUB_EVENTS_CHANNEL+"/messages","POST",payload);
 if(![200,201].includes(posted.status)||!posted.data?.id){await env.DB.prepare("UPDATE club_events SET status='failed' WHERE event_id=?").bind(eventId).run();return reply("Could not post your event. Please try again.");}
 await env.DB.prepare("UPDATE club_events SET status='active',message_id=? WHERE event_id=?").bind(String(posted.data.id),eventId).run();
 try{await env.DB.prepare("INSERT INTO club_event_host_profiles(discord_user_id,roblox_username,roblox_user_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(discord_user_id) DO UPDATE SET roblox_username=excluded.roblox_username,roblox_user_id=excluded.roblox_user_id,updated_at=excluded.updated_at").bind(host.id,robloxName,robloxId,new Date().toISOString()).run()}catch(error){console.error("Save event host Roblox username",String(error))}
 const eventLabel=kind==="bunker"?"Military Bunker":kind==="dual"?"Dual Event (Acid Rain + Military Bunker)":"Acid Rain";
 return reply("✅ Your "+eventLabel+" event is live! [View the announcement](https://discord.com/channels/"+GUILD_ID+"/"+CLUB_EVENTS_CHANNEL+"/"+posted.data.id+"). The signup and End Event buttons are ready.");
}

async function endClubEvent(i,env,eventId){
 await ensureClubEventTables(env);
 const event=await env.DB.prepare("SELECT * FROM club_events WHERE event_id=?").bind(eventId).first();
 if(!event)return reply("This event is not registered.");
 if(event.channel_id!==i.channel_id||event.message_id!==i.message?.id)return reply("Use the End Event button on the original event announcement.");
 const userId=i.member?.user?.id||i.user?.id;
 if(userId!==event.host_id&&!hasManageMessages(i))return reply("Only the event creator or server staff can end this event.");
 if(event.status==="ended")return reply("This event has already ended.");
 if(event.status!=="active")return reply("This event cannot be ended right now.");
 const endedAt=new Date().toISOString();
 await env.DB.prepare("UPDATE club_events SET status='ended',ended_at=? WHERE event_id=? AND status='active'").bind(endedAt,eventId).run();
 await env.DB.prepare("INSERT OR REPLACE INTO club_event_cleanup(event_id,channel_id,message_id,queued_at,attempts,last_error) VALUES(?,?,?,?,0,NULL)")
  .bind(eventId,event.channel_id,event.message_id,endedAt).run();
 let removed;
 try{removed=await discordApi(env,"/channels/"+event.channel_id+"/messages/"+event.message_id,"DELETE");}
 catch(error){removed={status:0,data:String(error)};}
 if(removed?.status===204||removed?.status===404){
  await env.DB.prepare("DELETE FROM club_event_cleanup WHERE event_id=?").bind(eventId).run();
  return reply("🔒 Event ended and its announcement was deleted.");
 }
 const error=removed?.status?"Discord delete HTTP "+removed.status:String(removed?.data||"Delete failed").slice(0,500);
 await env.DB.prepare("UPDATE club_event_cleanup SET attempts=attempts+1,last_error=? WHERE event_id=?").bind(error,eventId).run();
 return reply("🔒 Event ended. Discord couldn't remove the announcement yet; the bot will keep retrying until it's deleted.");
}
async function cleanupEndedClubEvents(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 await ensureClubEventTables(env);
 const pending=await env.DB.prepare("SELECT event_id,channel_id,message_id FROM club_event_cleanup ORDER BY queued_at LIMIT 20").all();
 for(const event of pending?.results||[]){
  try{
   const result=await discordApi(env,"/channels/"+event.channel_id+"/messages/"+event.message_id,"DELETE");
   if(result.status===204||result.status===404){
    await env.DB.prepare("DELETE FROM club_event_cleanup WHERE event_id=?").bind(event.event_id).run();
   }else{
    await env.DB.prepare("UPDATE club_event_cleanup SET attempts=attempts+1,last_error=? WHERE event_id=?").bind("Discord delete HTTP "+result.status,event.event_id).run();
   }
  }catch(error){
   await env.DB.prepare("UPDATE club_event_cleanup SET attempts=attempts+1,last_error=? WHERE event_id=?").bind(String(error).slice(0,500),event.event_id).run();
  }
 }
}
async function ensureClubEventPanel(env){
 await ensureClubEventTables(env);
 const channel=CLUB_EVENTS_CHANNEL;
 const panelPayload={embeds:[{title:"☣️ Create an Acid Rain Event",description:"Want to host an Acid Rain event? Tap **Create Acid Rain** and fill in your Roblox username and how many hours and minutes until the event starts. The bot finds and links your profile automatically, then remembers your username for next time.\n\nUse **Create Bunker Event** for the Military Base Bunker or **Host Dual Event** to run Acid Rain and the Bunker together.\n\nYour announcement will be posted here with **Join event**, **See Participants**, and **End Event** buttons. Everyone can sign up; only the host or staff can end it.\n\n**Enter the time until start in hours and minutes.** One active event per host. New event announcements ping @everyone. Please only create events you're hosting.",color:0x9B72CF,footer:{text:"Shadow Syndicate • Club Events"}}],
  components:[{type:1,components:[
   {type:2,style:1,custom_id:"club_event_create:acid",label:"Create Acid Rain",emoji:{name:"☣️"}},
   {type:2,style:2,custom_id:"club_event_create:bunker",label:"Create Bunker Event",emoji:{name:"🪖"}},
   {type:2,style:3,custom_id:"club_event_create:dual",label:"Host Dual Event",emoji:{name:"⚔️"}}
  ]}],allowed_mentions:{parse:[]}};
 const known=await env.DB.prepare("SELECT message_id FROM club_event_panels WHERE channel_id=?").bind(channel).first();
 let messageId=known?.message_id?String(known.message_id):"";
 if(messageId){
  const current=await discordApi(env,"/channels/"+channel+"/messages/"+messageId);
  if(current.status===200){const patched=await discordApi(env,"/channels/"+channel+"/messages/"+messageId,"PATCH",panelPayload);if(patched.status!==200)throw Error("Club Event creator panel update HTTP "+patched.status);}
  else if(current.status===404)messageId="";
  else throw Error("Club Event creator panel lookup HTTP "+current.status);
 }
 if(!messageId){const sent=await discordApi(env,"/channels/"+channel+"/messages","POST",panelPayload);if(![200,201].includes(sent.status)||!sent.data?.id)throw Error("Club Event creator panel send HTTP "+sent.status);messageId=String(sent.data.id);}
 await env.DB.prepare("INSERT INTO club_event_panels(channel_id,message_id,created_at) VALUES(?,?,?) ON CONFLICT(channel_id) DO UPDATE SET message_id=excluded.message_id,created_at=excluded.created_at").bind(channel,messageId,new Date().toISOString()).run();
 const done=await env.DB.prepare("SELECT value FROM club_event_setup WHERE key='legacy_end_button'").first();
 if(!done){
  const event=await env.DB.prepare("SELECT * FROM club_events WHERE event_id=?").bind(LEGACY_ACID_EVENT).first();
  if(event?.message_id){
   const existing=await discordApi(env,"/channels/"+channel+"/messages/"+event.message_id);
   if(existing.status===200){
    const rows=Array.isArray(existing.data?.components)?existing.data.components.map(x=>({...x,components:[...(x.components||[])]})):[];
    const hasEnd=rows.some(x=>x.components?.some(c=>c.custom_id==="club_event_end:"+LEGACY_ACID_EVENT));
    if(!hasEnd){const row=rows.find(x=>x.type===1&&x.components?.some(c=>c.custom_id==="club_event_join:"+LEGACY_ACID_EVENT));if(row){if(row.components.length<5)row.components.push({type:2,style:4,label:"End Event",custom_id:"club_event_end:"+LEGACY_ACID_EVENT,disabled:event.status!=="active"});else rows.push({type:1,components:[{type:2,style:4,label:"End Event",custom_id:"club_event_end:"+LEGACY_ACID_EVENT,disabled:event.status!=="active"}]});const patch=await discordApi(env,"/channels/"+channel+"/messages/"+event.message_id,"PATCH",{components:rows});if(patch.status!==200)throw Error("Legacy End Event button could not be added: "+patch.status);}}
   }
  }
  await env.DB.prepare("INSERT OR REPLACE INTO club_event_setup(key,value) VALUES('legacy_end_button','installed')").run();
 }
}

async function joinClubEvent(i,env,eventId){
 await ensureClubEventTables(env);
 const event=await env.DB.prepare("SELECT status,channel_id,message_id FROM club_events WHERE event_id=?").bind(eventId).first();
 if(!event||event.channel_id!==i.channel_id||event.message_id!==i.message?.id)return reply("This event is unavailable.");
 if(event.status!=='active')return reply("This event has ended. Sign-ups are closed.");
 const user=i.member?.user||i.user;
 if(!user?.id)return reply("Discord member information is unavailable.");
 if(!env.DB)return reply("The event sign-up list is unavailable right now.");
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS club_event_participants(event_id TEXT NOT NULL,discord_user_id TEXT NOT NULL,username TEXT NOT NULL,joined_at TEXT NOT NULL,PRIMARY KEY(event_id,discord_user_id))").run();
 const result=await env.DB.prepare("INSERT OR IGNORE INTO club_event_participants(event_id,discord_user_id,username,joined_at) VALUES(?,?,?,?)").bind(eventId,user.id,String(user.global_name||user.username||"Discord member").slice(0,100),new Date().toISOString()).run();
 const row=await env.DB.prepare("SELECT COUNT(*) AS participant_count FROM club_event_participants WHERE event_id=?").bind(eventId).first();
 const count=Number(row?.participant_count||0);
 const current=i.message?.embeds?.[0];
 if(current&&i.message?.id&&i.channel_id){
  const fields=(Array.isArray(current.fields)?current.fields:[]).map(f=>({name:String(f.name||""),value:String(f.value||""),...(f.inline?{inline:true}:{})}));
  const label=count+" "+(count===1?"person":"people")+" signed up";
  const participantField=fields.find(f=>f.name.toLowerCase()==="participants");
  if(participantField)participantField.value=label;else fields.push({name:"Participants",value:label,inline:true});
  const updated={...(current.title?{title:current.title}:{}),...(current.description?{description:current.description}:{}),...(Number.isFinite(current.color)?{color:current.color}:{}),fields};
  if(current.footer?.text)updated.footer={text:current.footer.text,...(current.footer.icon_url?{icon_url:current.footer.icon_url}:{})};
  try{const edited=await discordApi(env,"/channels/"+i.channel_id+"/messages/"+i.message.id,"PATCH",{embeds:[updated]});if(edited.status<200||edited.status>=300)console.error("event participant count update",edited.status)}catch(e){console.error("event participant count update",String(e))}
 }
 const added=Number(result?.meta?.changes||0)>0;
 return reply((added?"You’re signed up for this event. ":"You’re already on the participant list. ")+"Current participants: "+count+".");
}
async function viewClubEventParticipants(i,env,eventId,requestedPage){
 await ensureClubEventTables(env);
 if(!env.DB)return reply("The event participant list is unavailable right now.");
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS club_event_participants(event_id TEXT NOT NULL,discord_user_id TEXT NOT NULL,username TEXT NOT NULL,joined_at TEXT NOT NULL,PRIMARY KEY(event_id,discord_user_id))").run();
 const totalRow=await env.DB.prepare("SELECT COUNT(*) AS n FROM club_event_participants WHERE event_id=?").bind(eventId).first();
 const total=Number(totalRow?.n||0),pageSize=20;
 const page=Math.max(0,Math.min(Math.max(0,Math.ceil(total/pageSize)-1),Number(requestedPage)||0));
 const result=await env.DB.prepare("SELECT discord_user_id,username FROM club_event_participants WHERE event_id=? ORDER BY joined_at ASC LIMIT ? OFFSET ?").bind(eventId,pageSize,page*pageSize).all();
 const people=Array.isArray(result?.results)?result.results:[];
 const entries=people.map((person,j)=>String(page*pageSize+j+1)+". <@"+String(person.discord_user_id)+">");
 const event=await env.DB.prepare("SELECT status FROM club_events WHERE event_id=?").bind(eventId).first();
 const eventLabel=eventId.startsWith("dual_")?"Acid Rain + Military Bunker":eventId.startsWith("bunker_")?"Military Bunker":"Acid Rain";
 const title=eventLabel+" • Participants"+(event?.status==="ended"?" (Ended)":"");
 const description=(total?String(total)+" "+(total===1?"person has":"people have")+" signed up.\n\n"+entries.join("\n"):"No participants have signed up yet.")+(event?.status==="ended"?"\n\n**This event has ended.**":"\n\nUse **Join event** on the announcement to sign up.");
 const buttons=[];
 if(page>0)buttons.push({type:2,style:2,label:"Previous",custom_id:"club_event_view:"+eventId+":"+(page-1)});
 if((page+1)*pageSize<total)buttons.push({type:2,style:2,label:"Next",custom_id:"club_event_view:"+eventId+":"+(page+1)});
 return discordResponse({type:4,data:{
  flags:64,
  embeds:[{title,description,color:0x9B72CF,footer:{text:"Page "+(page+1)+" of "+Math.max(1,Math.ceil(total/pageSize))+" • Visible only to you"}}],
  ...(buttons.length?{components:[{type:1,components:buttons}]}:{}),
  allowed_mentions:{parse:[]}
 }});
}

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
const OWNER_DISCORD_ID = "251135432459419648";
// Always recognize the server owner even if Discord omits permission bits on an interaction.
const isAdmin = i => String(i.member?.user?.id||i.user?.id||"")===OWNER_DISCORD_ID || (BigInt(i.member?.permissions||"0") & 8n)!==0n;
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
 if(!env.KEY_ISSUER?.hashKey)return reply("The key verification service is unavailable right now. Your active key is unchanged.");
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
 const active=await env.DB.prepare("SELECT key_hash,key_prefix FROM member_keys WHERE user_id=? AND revoked=0 AND (expires_at IS NULL OR expires_at>?) LIMIT 1").bind(robloxId,new Date().toISOString()).first();
 if(active){
  const owner=await env.DB.prepare("SELECT 1 AS owned FROM discord_key_issuance WHERE key_hash=? AND discord_user_id=? AND guild_id=? LIMIT 1").bind(active.key_hash,discordId,GUILD_ID).first();
  if(owner)return viewKey(i,env);
  return reply("❌ An active key already exists for Roblox ID `"+robloxId+"`. Contact an administrator to revoke it before requesting another.");
 }
 const existing=await env.DB.prepare("SELECT 1 FROM discord_key_issuance d JOIN member_keys m ON d.key_hash=m.key_hash WHERE d.discord_user_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(discordId,new Date().toISOString()).first();
 if(existing)return reply("❌ Your Discord account already has an active Syndicate Hub key.");
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 const hex=[...bytes].map(x=>x.toString(16).padStart(2,"0").toUpperCase()).join("");
 const key="SYND-"+hex.match(/.{8}/g).join("-");
 let digest;
 try{digest=await env.KEY_ISSUER.hashKey(key)}catch(e){console.error("key issuer hash",String(e));return reply("The key service is unavailable, so no key was created. Please try again shortly.")}
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
async function listKeys(env,page=0) {
 try {
  const pageSize=6,now=new Date().toISOString();
  const count=await env.DB.prepare("SELECT COUNT(*) AS total FROM member_keys WHERE revoked=0 AND (expires_at IS NULL OR expires_at>?)").bind(now).first();
  const total=Number(count?.total||0);
  if(!total)return reply("No active keys.");
  const pages=Math.max(1,Math.ceil(total/pageSize));
  page=Math.max(0,Math.min(pages-1,Math.floor(Number(page)||0)));
  const r=await env.DB.prepare("SELECT m.key_hash,m.user_id,m.key_prefix,m.created_at,m.expires_at,v.cipher,v.iv FROM member_keys m LEFT JOIN discord_key_vault v ON v.key_hash=m.key_hash WHERE m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) ORDER BY m.created_at DESC LIMIT ? OFFSET ?").bind(now,pageSize,page*pageSize).all();
  const rows=await userLabels(r.results||[],"user_id");
  const lines=[];
  for(const x of rows){
   let secret="Key unavailable — retrieve it from the member's Get Key button.";
   if(x.cipher&&x.iv&&env.KEY_ISSUER?.hashKey){
    try{
     const plain=new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(x.iv)},await cipherKey(env),unb64(x.cipher)));
     if(await env.KEY_ISSUER.hashKey(plain)===x.key_hash)secret="Key: `"+plain+"`";
     else throw Error("key hash mismatch");
    }catch(e){console.error("admin key decrypt",String(e));}
   }
   lines.push("• **"+x.username+"** • Roblox ID `"+x.user_id+"`\n  "+secret+" • "+(x.expires_at?keyRemaining(x.expires_at)+" • Expires <t:"+Math.floor(Date.parse(x.expires_at)/1000)+":R>":"Lifetime access"));
  }
  const components=pages>1?[{type:1,components:[
   ...(page>0?[{type:2,style:2,label:"Previous",custom_id:"mg_keys_page_"+(page-1)}]:[]),
   ...(page<pages-1?[{type:2,style:2,label:"Next",custom_id:"mg_keys_page_"+(page+1)}]:[])
  ]}]:[];
  return new Response(JSON.stringify({type:4,data:{content:"🔑 **Active Syndicate Hub keys** • Page "+(page+1)+"/"+pages+"\n"+lines.join("\n")+"\n\nOnly administrators can see this private list. Members can retrieve their own key with **Get Key**.",flags:64,components,allowed_mentions:{parse:[]}}}),{headers:{"content-type":"application/json"}});
 }catch(e){
  console.error("active key list",String(e));
  return reply("I couldn't load the active-key list. No keys were changed; try again shortly.");
 }
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
  for(let attempt=0;attempt<3;attempt++){
   try{
    const r=await fetch(url,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(6000)});
    if(r.ok)return;
    const detail=(await r.text()).slice(0,250);
    if((r.status===429||r.status>=500)&&attempt<2){
     let waitMs=250*(2**attempt);
     if(r.status===429){try{waitMs=Math.min(3000,Math.max(250,Math.ceil(Number(JSON.parse(detail).retry_after||0)*1000)||waitMs))}catch{}}
     await new Promise(resolve=>setTimeout(resolve,waitMs));
     continue;
    }
    console.error("delayed response",r.status,detail);
    return;
   }catch(e){
    if(attempt<2){await new Promise(resolve=>setTimeout(resolve,250*(2**attempt)));continue}
    console.error("delayed response network",e);
   }
  }
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
 if(id==="mg_keys")return listKeys(env,0);
 if(id.startsWith("mg_keys_page_"))return listKeys(env,Number(id.slice(13))||0);
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
async function discordRoleMembershipApi(env,path,method){
 let result;
 for(let attempt=0;attempt<5;attempt++){
  result=await discordApi(env,path,method);
  if(result.status!==429){
   await new Promise(resolve=>setTimeout(resolve,150));
   return result;
  }
  const delay=Math.max(500,Math.min(10000,Number(result.data?.retry_after||1)*1000));
  await new Promise(resolve=>setTimeout(resolve,delay));
 }
 return result;
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

async function ensureRobloxLinkTables(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS roblox_link_states(state TEXT PRIMARY KEY,discord_user_id TEXT NOT NULL,code_verifier TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS roblox_discord_links(discord_user_id TEXT PRIMARY KEY,roblox_user_id TEXT NOT NULL UNIQUE,roblox_username TEXT NOT NULL,refresh_cipher TEXT NOT NULL,refresh_iv TEXT NOT NULL,original_nickname TEXT,next_sync_at TEXT NOT NULL,sync_started_at TEXT,sync_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
}
function randomBase64Url(length){
 const bytes=crypto.getRandomValues(new Uint8Array(length));
 let binary="";for(const b of bytes)binary+=String.fromCharCode(b);
 return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function decodeBase64Url(value){
 const normalized=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
 const padded=normalized+"=".repeat((4-normalized.length%4)%4);
 const binary=atob(padded);
 return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function bytesToBase64Url(bytes){
 let binary="";for(const b of bytes)binary+=String.fromCharCode(b);
 return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
async function robloxTokenCryptoKey(env){
 if(!env.KEY_PEPPER)throw Error("Token encryption key is unavailable");
 const material=await crypto.subtle.importKey("raw",enc.encode(env.KEY_PEPPER),"HKDF",false,["deriveKey"]);
 return crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt:enc.encode("syndicate-roblox-link-v1"),info:enc.encode("refresh-token")},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function encryptRobloxRefreshToken(env,token){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await robloxTokenCryptoKey(env);
 const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,enc.encode(String(token)));
 return {cipher:bytesToBase64Url(new Uint8Array(cipher)),iv:bytesToBase64Url(iv)};
}
async function decryptRobloxRefreshToken(env,cipher,iv){
 const key=await robloxTokenCryptoKey(env);
 const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:decodeBase64Url(iv)},key,decodeBase64Url(cipher));
 return new TextDecoder().decode(plain);
}
function robloxOAuthConfig(env){
 return {clientId:String(env.ROBLOX_CLIENT_ID||""),clientSecret:String(env.ROBLOX_CLIENT_SECRET||""),redirectUri:"https://syndicate-roblox-auth.pages.dev/roblox/oauth/callback"};
}
function linkRobloxResponse(content,url){
 const data={content,flags:64,allowed_mentions:{parse:[]},components:url?[{type:1,components:[{type:2,style:5,label:"Connect Roblox",url}]}]:[]};
 return new Response(JSON.stringify({type:4,data}),{headers:{"content-type":"application/json"}});
}
async function beginRobloxLink(i,env){
 const did=String(i.member?.user?.id||i.user?.id||"");
 if(!did)return reply("I couldn't identify your Discord account.");
 await ensureRobloxLinkTables(env);
 const existing=await env.DB.prepare("SELECT roblox_username FROM roblox_discord_links WHERE discord_user_id=?").bind(did).first();
 if(existing)return reply("Your Discord account is already linked to Roblox username "+String(existing.roblox_username).replace(/[*_~|]/g,"")+". Use /unlink-roblox before linking another account.");
 const config=robloxOAuthConfig(env);
 if(!config.clientId||!config.clientSecret)return reply("Roblox account linking is not configured yet. The server owner needs to register the Roblox OAuth app and add its client ID and secret to the Syndicate Discord Worker.");
 const state=randomBase64Url(32),verifier=randomBase64Url(48);
 const digest=await crypto.subtle.digest("SHA-256",enc.encode(verifier));
 const challenge=bytesToBase64Url(new Uint8Array(digest));
 const now=new Date(),expires=new Date(now.getTime()+10*60*1000).toISOString();
 await env.DB.prepare("DELETE FROM roblox_link_states WHERE expires_at<=?").bind(now.toISOString()).run();
 await env.DB.prepare("INSERT INTO roblox_link_states(state,discord_user_id,code_verifier,expires_at,created_at) VALUES(?,?,?,?,?)").bind(state,did,verifier,expires,now.toISOString()).run();
 const authorize=new URL("https://apis.roblox.com/oauth/v1/authorize");
 authorize.searchParams.set("client_id",config.clientId);
 authorize.searchParams.set("redirect_uri",config.redirectUri);
 authorize.searchParams.set("scope","openid profile user.inventory-item:read");
 authorize.searchParams.set("response_type","code");
 authorize.searchParams.set("state",state);
 authorize.searchParams.set("code_challenge",challenge);
 authorize.searchParams.set("code_challenge_method","S256");
 authorize.searchParams.set("prompt","consent");
 return linkRobloxResponse("Connect your Roblox account to verify badges and gamepasses. Roblox will show the permissions before you approve. The bot will then set your server nickname to your Roblox username.",authorize.toString());
}
async function robloxOAuthToken(env,fields){
 const config=robloxOAuthConfig(env);
 const body=new URLSearchParams({...fields,client_id:config.clientId,client_secret:config.clientSecret});
 const response=await fetch("https://apis.roblox.com/oauth/v1/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body.toString(),signal:AbortSignal.timeout(15000)});
 const data=await response.json().catch(()=>null);
 if(!response.ok||!data?.access_token)throw Error("Roblox authorization failed (HTTP "+response.status+").");
 return data;
}
function robloxHtmlPage(title,message,status=200){
 const safe=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
 const html="<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>"+safe(title)+"</title><style>body{margin:0;background:#18121f;color:#f7f2ff;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{max-width:560px;margin:24px;padding:28px;border:1px solid #60447a;border-radius:18px;background:#241b2c;box-shadow:0 12px 40px #0007}h1{color:#c7a7ee;margin-top:0}p{line-height:1.6}</style></head><body><main class=\"card\"><h1>"+safe(title)+"</h1><p>"+safe(message)+"</p><p>You can close this tab and return to Discord.</p></main></body></html>";
 return new Response(html,{status,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
}
async function robloxInventoryOwnership(accessToken,robloxUserId){
 const badgeIds=ROBLOX_ACHIEVEMENT_ROLES.filter(x=>x.kind==="badge").map(x=>x.source_id);
 const passIds=ROBLOX_ACHIEVEMENT_ROLES.filter(x=>x.kind==="gamepass").map(x=>x.source_id);
 const targetIds=new Set([...badgeIds,...passIds]);
 const url=new URL("https://apis.roblox.com/cloud/v2/users/"+encodeURIComponent(robloxUserId)+"/inventory-items");
 url.searchParams.set("filter","badgeIds="+badgeIds.join(",")+";gamePassIds="+passIds.join(","));
 url.searchParams.set("maxPageSize","100");
 const owned=new Set();let pageToken="";
 for(let page=0;page<5;page++){
  if(pageToken)url.searchParams.set("pageToken",pageToken);
  const response=await fetch(url.toString(),{headers:{Authorization:"Bearer "+accessToken},signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!Array.isArray(data?.inventoryItems))throw Error("Roblox inventory read failed (HTTP "+response.status+"). Confirm the inventory permission was approved.");
  for(const item of data.inventoryItems){
   const candidates=[
    item?.assetDetails?.assetId,item?.badgeDetails?.badgeId,item?.badgeDetails?.id,
    item?.gamePassDetails?.gamePassId,item?.gamePassDetails?.id,item?.passDetails?.gamePassId,
    item?.passDetails?.id,item?.assetId,item?.badgeId,item?.gamePassId
   ];
   for(const candidate of candidates){const id=String(candidate??"");if(targetIds.has(id))owned.add(id);}
  }
  pageToken=String(data.nextPageToken||"");
  if(!pageToken||!data.inventoryItems.length)break;
 }
 return owned;
}
async function syncRobloxMember(env,link,accessToken){
 const discordId=String(link.discord_user_id),robloxId=String(link.roblox_user_id),username=String(link.roblox_username);
 const member=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+discordId);
 if(member.status!==200)throw Error("Discord member lookup failed (HTTP "+member.status+").");
 const owned=await robloxInventoryOwnership(accessToken,robloxId);
 const catalog=await env.DB.prepare("SELECT role_key,kind,source_id,role_id FROM roblox_achievement_role_catalog").all();
 const byKey=new Map((catalog.results||[]).map(x=>[x.role_key,x]));
 let added=0,removed=0;
 const currentRoles=new Set((member.data.roles||[]).map(String));
 for(const def of ROBLOX_ACHIEVEMENT_ROLES){
  const row=byKey.get(def.key);
  if(!row?.role_id)continue;
  const has=owned.has(def.source_id),assigned=currentRoles.has(String(row.role_id));
  if(has&&!assigned){
   const result=await discordRoleMembershipApi(env,"/guilds/"+GUILD_ID+"/members/"+discordId+"/roles/"+row.role_id,"PUT");
   if(result.status!==204)throw Error("Could not assign role "+def.name+" (HTTP "+result.status+").");
   added++;
  }else if(!has&&assigned){
   const result=await discordRoleMembershipApi(env,"/guilds/"+GUILD_ID+"/members/"+discordId+"/roles/"+row.role_id,"DELETE");
   if(result.status!==204)throw Error("Could not remove role "+def.name+" (HTTP "+result.status+").");
   removed++;
  }
 }
 let nicknameUpdated=false,nicknameError=null;
 if(member.data.nick!==username){
  const changed=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+discordId,"PATCH",{nick:username});
  if(changed.status===200)nicknameUpdated=true;
  else nicknameError="Nickname update could not be applied (HTTP "+changed.status+"); achievement role checks succeeded.";
 }
 return {owned:owned.size,added,removed,nicknameUpdated,nicknameError};
}
async function robloxOAuthCallback(request,env){
 if(!env.DB)return robloxHtmlPage("Setup unavailable","The account-link service is not configured.",503);
 await ensureRobloxLinkTables(env);
 const url=new URL(request.url);
 const oauthError=url.searchParams.get("error");
 if(oauthError)return robloxHtmlPage("Link cancelled","Roblox authorization was not completed. You can run /link-roblox in Discord to try again.");
 const state=String(url.searchParams.get("state")||""),code=String(url.searchParams.get("code")||"");
 if(!/^[A-Za-z0-9_-]{32,100}$/.test(state)||!code)return robloxHtmlPage("Invalid link","The link expired or could not be verified. Start again with /link-roblox.",400);
 const pending=await env.DB.prepare("SELECT discord_user_id,code_verifier,expires_at FROM roblox_link_states WHERE state=?").bind(state).first();
 if(!pending||Date.parse(pending.expires_at)<=Date.now())return robloxHtmlPage("Link expired","Start again with /link-roblox in Discord.",400);
 const deleted=await env.DB.prepare("DELETE FROM roblox_link_states WHERE state=?").bind(state).run();
 if(!deleted.meta?.changes)return robloxHtmlPage("Link already used","Start a new link from Discord.",400);
 const config=robloxOAuthConfig(env);
 if(!config.clientId||!config.clientSecret)return robloxHtmlPage("Setup unavailable","The Roblox OAuth app is not configured yet.",503);
 try{
  const tokens=await robloxOAuthToken(env,{grant_type:"authorization_code",code,code_verifier:pending.code_verifier,redirect_uri:config.redirectUri});
  const profileResponse=await fetch("https://apis.roblox.com/oauth/v1/userinfo",{headers:{Authorization:"Bearer "+tokens.access_token},signal:AbortSignal.timeout(15000)});
  const profile=await profileResponse.json().catch(()=>null);
  if(!profileResponse.ok||!/^\d{1,20}$/.test(String(profile?.sub||"")))throw Error("Roblox could not confirm the account identity.");
  const robloxId=String(profile.sub),username=String(profile.preferred_username||"").trim();
  if(!username||username.length>32)throw Error("Roblox did not provide a valid username.");
  const existingRoblox=await env.DB.prepare("SELECT discord_user_id FROM roblox_discord_links WHERE roblox_user_id=?").bind(robloxId).first();
  if(existingRoblox&&String(existingRoblox.discord_user_id)!==String(pending.discord_user_id))return robloxHtmlPage("Account already linked","This Roblox account is already linked to another Discord account. Contact a server administrator if you believe this is an error.",409);
  const existingDiscord=await env.DB.prepare("SELECT roblox_user_id FROM roblox_discord_links WHERE discord_user_id=?").bind(pending.discord_user_id).first();
  if(existingDiscord&&String(existingDiscord.roblox_user_id)!==robloxId)return robloxHtmlPage("Discord already linked","Unlink the existing Roblox account with /unlink-roblox before linking another one.",409);
  const guildMember=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+pending.discord_user_id);
  if(guildMember.status!==200)return robloxHtmlPage("Discord member not found","Return to the Shadow Syndicate server and start the link again.",404);
  const prior=await env.DB.prepare("SELECT original_nickname FROM roblox_discord_links WHERE discord_user_id=?").bind(pending.discord_user_id).first();
  const originalNickname=prior?prior.original_nickname:(guildMember.data.nick??null);
  if(!tokens.refresh_token)throw Error("Roblox did not issue a refresh token.");
  const secured=await encryptRobloxRefreshToken(env,tokens.refresh_token);
  const now=new Date(),stamp=now.toISOString(),next=new Date(now.getTime()+60000).toISOString();
  await env.DB.prepare("INSERT INTO roblox_discord_links(discord_user_id,roblox_user_id,roblox_username,refresh_cipher,refresh_iv,original_nickname,next_sync_at,sync_started_at,sync_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,NULL,NULL,?,?) ON CONFLICT(discord_user_id) DO UPDATE SET roblox_user_id=excluded.roblox_user_id,roblox_username=excluded.roblox_username,refresh_cipher=excluded.refresh_cipher,refresh_iv=excluded.refresh_iv,next_sync_at=excluded.next_sync_at,sync_started_at=NULL,sync_error=NULL,updated_at=excluded.updated_at").bind(String(pending.discord_user_id),robloxId,username,secured.cipher,secured.iv,originalNickname,next,stamp,stamp).run();
  let result;
  try{
   const roleSetup=await env.DB.prepare("SELECT status FROM roblox_achievement_role_setup WHERE id=1").first();
   if(roleSetup?.status!=="ready"){
    const nick=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+pending.discord_user_id,"PATCH",{nick:username});
    const nickNote=nick.status===200?"Your Discord nickname is now set to "+username+".":"The Roblox account is linked; Discord did not allow the nickname change.";
    await env.DB.prepare("UPDATE roblox_discord_links SET next_sync_at=?,sync_error=?,updated_at=? WHERE discord_user_id=?").bind(new Date(Date.now()+60000).toISOString(),nick.status===200?null:"Nickname update failed with HTTP "+nick.status,new Date().toISOString(),String(pending.discord_user_id)).run();
    return robloxHtmlPage("Roblox linked",nickNote+" Badge and gamepass roles will sync once the role setup finishes, then refresh automatically about every 15 minutes.");
   }
   result=await syncRobloxMember(env,{discord_user_id:String(pending.discord_user_id),roblox_user_id:robloxId,roblox_username:username},tokens.access_token);
   await env.DB.prepare("UPDATE roblox_discord_links SET next_sync_at=?,sync_error=?,updated_at=? WHERE discord_user_id=?").bind(new Date(Date.now()+15*60*1000).toISOString(),result.nicknameError,new Date().toISOString(),String(pending.discord_user_id)).run();
   const nickNote=result.nicknameUpdated?"Your Discord nickname is now set to "+username+".":result.nicknameError?"The Roblox account is linked, but Discord blocked the nickname change.":"Your Discord nickname already matches your Roblox username.";
   return robloxHtmlPage("Roblox linked",nickNote+" The bot found "+result.owned+" matching badge or gamepass item(s), assigned "+result.added+" role(s), and will refresh the roles about every 15 minutes.");
  }catch(e){
   await env.DB.prepare("UPDATE roblox_discord_links SET next_sync_at=?,sync_error=?,updated_at=? WHERE discord_user_id=?").bind(new Date(Date.now()+5*60*1000).toISOString(),String(e).slice(0,500),new Date().toISOString(),String(pending.discord_user_id)).run();
   return robloxHtmlPage("Roblox linked; inventory sync needs attention","Your Roblox username was verified. The automatic role check could not finish yet. Confirm that you approved Roblox inventory access, then try again or contact the server owner. The bot will retry automatically.");
  }
 }catch(e){
  console.error("Roblox OAuth callback",String(e));
  return robloxHtmlPage("Could not finish linking","The Roblox connection did not finish. Return to Discord and start a fresh /link-roblox request.",502);
 }
}
async function unlinkRobloxAccount(i,env){
 const did=String(i.member?.user?.id||i.user?.id||"");
 if(!did)return reply("I couldn't identify your Discord account.");
 await ensureRobloxLinkTables(env);
 const link=await env.DB.prepare("SELECT roblox_user_id,roblox_username,refresh_cipher,refresh_iv,original_nickname FROM roblox_discord_links WHERE discord_user_id=?").bind(did).first();
 if(!link)return reply("There is no Roblox account linked to your Discord account.");
 const catalog=await env.DB.prepare("SELECT role_id FROM roblox_achievement_role_catalog").all();
 const member=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+did);
 if(member.status===200){
  const existing=new Set((member.data.roles||[]).map(String));
  for(const row of catalog.results||[])if(row.role_id&&existing.has(String(row.role_id))){
   const removed=await discordRoleMembershipApi(env,"/guilds/"+GUILD_ID+"/members/"+did+"/roles/"+row.role_id,"DELETE");
   if(removed.status!==204)console.error("Roblox unlink role removal",removed.status,row.role_id);
  }
  const restored=await discordApi(env,"/guilds/"+GUILD_ID+"/members/"+did,"PATCH",{nick:link.original_nickname||null});
  if(restored.status!==200)console.error("Roblox unlink nickname restore",restored.status);
 }
 try{
  const refresh=await decryptRobloxRefreshToken(env,link.refresh_cipher,link.refresh_iv);
  const config=robloxOAuthConfig(env);
  await fetch("https://apis.roblox.com/oauth/v1/token/revoke",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({token:refresh,client_id:config.clientId,client_secret:config.clientSecret}).toString()});
 }catch(e){console.error("Roblox token revoke",String(e))}
 await env.DB.prepare("DELETE FROM roblox_discord_links WHERE discord_user_id=?").bind(did).run();
 return reply("Your Roblox account was unlinked. Achievement roles were removed, and your previous Discord nickname was restored.");
}
async function syncLinkedRobloxAccounts(env){
 if(!env.DB||!env.ROBLOX_CLIENT_ID||!env.ROBLOX_CLIENT_SECRET)return;
 await ensureRobloxLinkTables(env);
 const roleState=await env.DB.prepare("SELECT status FROM roblox_achievement_role_setup WHERE id=1").first();
 if(roleState?.status!=="ready")return;
 const now=Date.now(),stamp=new Date(now).toISOString();
 const rows=await env.DB.prepare("SELECT discord_user_id,roblox_user_id,roblox_username,refresh_cipher,refresh_iv FROM roblox_discord_links WHERE next_sync_at<=? AND (sync_started_at IS NULL OR sync_started_at<=?) ORDER BY next_sync_at LIMIT 5").bind(stamp,new Date(now-10*60*1000).toISOString()).all();
 for(const row of rows.results||[]){
  const claim=await env.DB.prepare("UPDATE roblox_discord_links SET sync_started_at=?,updated_at=? WHERE discord_user_id=? AND next_sync_at<=? AND (sync_started_at IS NULL OR sync_started_at<=?)").bind(stamp,stamp,row.discord_user_id,stamp,new Date(now-10*60*1000).toISOString()).run();
  if(!claim.meta?.changes)continue;
  try{
   const refresh=await decryptRobloxRefreshToken(env,row.refresh_cipher,row.refresh_iv);
   const tokens=await robloxOAuthToken(env,{grant_type:"refresh_token",refresh_token:refresh});
   if(!tokens.refresh_token)throw Error("Roblox did not rotate the refresh token.");
   const secured=await encryptRobloxRefreshToken(env,tokens.refresh_token);
   await env.DB.prepare("UPDATE roblox_discord_links SET refresh_cipher=?,refresh_iv=?,updated_at=? WHERE discord_user_id=?").bind(secured.cipher,secured.iv,new Date().toISOString(),row.discord_user_id).run();
   const syncResult=await syncRobloxMember(env,row,tokens.access_token);
   const next=new Date(Date.now()+15*60*1000).toISOString();
   await env.DB.prepare("UPDATE roblox_discord_links SET next_sync_at=?,sync_started_at=NULL,sync_error=?,updated_at=? WHERE discord_user_id=?").bind(next,syncResult.nicknameError,new Date().toISOString(),row.discord_user_id).run();
  }catch(e){
   const next=new Date(Date.now()+30*60*1000).toISOString();
   await env.DB.prepare("UPDATE roblox_discord_links SET next_sync_at=?,sync_started_at=NULL,sync_error=?,updated_at=? WHERE discord_user_id=?").bind(next,String(e).slice(0,500),new Date().toISOString(),row.discord_user_id).run();
   console.error("Roblox automatic sync",row.discord_user_id,String(e));
  }
 }
}
async function ensureRobloxAchievementRoles(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS roblox_achievement_role_catalog(role_key TEXT PRIMARY KEY,kind TEXT NOT NULL,source_id TEXT NOT NULL,role_name TEXT NOT NULL,role_id TEXT,emoji TEXT NOT NULL,color INTEGER NOT NULL,updated_at TEXT NOT NULL,UNIQUE(kind,source_id))").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS roblox_achievement_role_setup(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL DEFAULT 'pending',completed INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("INSERT OR IGNORE INTO roblox_achievement_role_setup(id,status,updated_at) VALUES(1,'pending',?)").bind(new Date().toISOString()).run();
 const now=Date.now();
 const claim=await env.DB.prepare("UPDATE roblox_achievement_role_setup SET status='running',lease_until=?,updated_at=? WHERE id=1 AND status!='ready' AND lease_until<=?").bind(now+55000,new Date(now).toISOString(),now).run();
 if(!claim.meta?.changes)return;
 try{
  const stamp=new Date().toISOString();
  await env.DB.batch(ROBLOX_ACHIEVEMENT_ROLES.map(d=>env.DB.prepare("INSERT INTO roblox_achievement_role_catalog(role_key,kind,source_id,role_name,emoji,color,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(role_key) DO UPDATE SET kind=excluded.kind,source_id=excluded.source_id,role_name=excluded.role_name,emoji=excluded.emoji,color=excluded.color,updated_at=excluded.updated_at").bind(d.key,d.kind,d.source_id,d.name,d.emoji,d.color,stamp)));
  const existing=await discordApi(env,"/guilds/"+GUILD_ID+"/roles");
  if(existing.status!==200||!Array.isArray(existing.data))throw Error("Could not list server roles (HTTP "+existing.status+").");
  const allRoles=existing.data;
  const mapped=await env.DB.prepare("SELECT role_key,role_id FROM roblox_achievement_role_catalog").all();
  const ids=new Map((mapped.results||[]).map(r=>[r.role_key,r.role_id]));
  const pending=ROBLOX_ACHIEVEMENT_ROLES.filter(d=>!ids.get(d.key)||!allRoles.some(r=>String(r.id)===String(ids.get(d.key))));
  let made=0;
  for(const d of pending){
   const matches=allRoles.filter(r=>r.name===d.name&&!r.managed);
   if(matches.length>1)throw Error("More than one role named "+d.name+"; leaving it unchanged.");
   let role=matches[0]||null;
   if(!role){
    let created=await discordApi(env,"/guilds/"+GUILD_ID+"/roles","POST",{name:d.name,permissions:"0",color:d.color,hoist:false,mentionable:false});
    for(let retry=0;created.status===429&&retry<3;retry++){
     await new Promise(resolve=>setTimeout(resolve,Math.max(500,Number(created.data?.retry_after||1)*1000)));
     created=await discordApi(env,"/guilds/"+GUILD_ID+"/roles","POST",{name:d.name,permissions:"0",color:d.color,hoist:false,mentionable:false});
    }
    if(created.status!==200||!created.data?.id)throw Error("Could not create "+d.name+" (HTTP "+created.status+"): "+String(created.data?.message||""));
    role=created.data;
    allRoles.push(role);
    made++;
    await new Promise(resolve=>setTimeout(resolve,450));
   }
   await env.DB.prepare("UPDATE roblox_achievement_role_catalog SET role_id=?,updated_at=? WHERE role_key=?").bind(String(role.id),new Date().toISOString(),d.key).run();
   if(made>=32)break;
  }
  const refreshed=await env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN role_id IS NOT NULL THEN 1 ELSE 0 END) AS completed FROM roblox_achievement_role_catalog").first();
  const complete=Number(refreshed?.completed||0),total=ROBLOX_ACHIEVEMENT_ROLES.length;
  const status=complete===total?"ready":"running";
  await env.DB.prepare("UPDATE roblox_achievement_role_setup SET status=?,completed=?,total=?,lease_until=0,last_error=NULL,updated_at=? WHERE id=1").bind(status,complete,total,new Date().toISOString()).run();
  if(status==="ready")await cleanupLegacyNetWorthRoles(env,allRoles);
 }catch(e){
  await env.DB.prepare("UPDATE roblox_achievement_role_setup SET status='error',lease_until=?,last_error=?,updated_at=? WHERE id=1").bind(Date.now()+60000,String(e).slice(0,900),new Date().toISOString()).run();
  console.error("Roblox achievement roles",String(e));
 }
}
async function cleanupLegacyNetWorthRoles(env,roles){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS roblox_legacy_networth_cleanup(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL DEFAULT 'pending',removed INTEGER NOT NULL DEFAULT 0,last_error TEXT,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("INSERT OR IGNORE INTO roblox_legacy_networth_cleanup(id,status,updated_at) VALUES(1,'pending',?)").bind(new Date().toISOString()).run();
 const state=await env.DB.prepare("SELECT status FROM roblox_legacy_networth_cleanup WHERE id=1").first();
 if(state?.status==="done")return;
 const targets=new Set();
 for(let m=100;m<=500;m+=25)targets.add(m);
 for(let m=550;m<=1000;m+=50)targets.add(m);
 for(const m of [1500,2000,5000,10000])targets.add(m);
 const normalize=s=>String(s||"").toLowerCase().replace(/,/g,"").replace(/million/g,"m").replace(/billion/g,"b").replace(/[^a-z0-9$]+/g," ").trim();
 const legacyNames=new Set(["millionaire","elite collector","treasure baron","storage mogul","wealthy elite","fortune hunter","diamond tycoon","vault master","syndicate tycoon","fortune legend","storage emperor","ultra wealthy","billionaire elite","billionaire","starter stash","growing stash","high roller","storage tycoon"]);
 const targetRole=role=>{
  const name=normalize(role.name);
  if(legacyNames.has(name))return true;
  if(!/(net\s*worth|networth|total\s*worth)/.test(name))return false;
  const values=[];
  for(const match of name.matchAll(/\$?\s*(\d+(?:\.\d+)?)\s*(m|b)\b/g)){
   const n=Number(match[1])*(match[2]==="b"?1000:1);
   if(Number.isFinite(n))values.push(n);
  }
  for(const match of name.matchAll(/\$?\s*(\d{1,3}(?:\d{3}){2,4})\b/g)){
   const n=Number(match[1]);
   if(Number.isFinite(n))values.push(n/1000000);
  }
  return values.some(v=>targets.has(v));
 };
 let removed=0;const failures=[];
 for(const role of roles){
  if(!role||role.managed||role.id===GUILD_ID||!targetRole(role))continue;
  const result=await discordApi(env,"/guilds/"+GUILD_ID+"/roles/"+role.id,"DELETE");
  if(result.status===204||result.status===404)removed++;
  else {
   failures.push(String(role.name)+" ["+String(role.id)+"] HTTP "+result.status+" at role position "+String(role.position??"unknown"));
   console.error("Legacy net-worth role cleanup",role.name,result.status);
  }
  await new Promise(resolve=>setTimeout(resolve,350));
 }
 const cleanupStatus=failures.length?"error":"done";
 await env.DB.prepare("UPDATE roblox_legacy_networth_cleanup SET status=?,removed=removed+?,last_error=?,updated_at=? WHERE id=1").bind(cleanupStatus,removed,failures.length?failures.join("; ").slice(0,900):null,new Date().toISOString()).run();
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
 const owner=await env.DB.prepare("SELECT d.discord_user_id,d.guild_id FROM member_keys m LEFT JOIN discord_key_issuance d ON d.key_hash=m.key_hash WHERE m.user_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(rid,now).first();
 if(owner){
  if(owner.discord_user_id===did&&owner.guild_id===GUILD_ID)return viewKey(i,env);
  return reply(owner.discord_user_id===did?"You already have an active key. Use Get Key to retrieve it.":"An active key already exists for that Roblox account.");
 }
 const active=await env.DB.prepare("SELECT m.user_id FROM discord_key_issuance d JOIN member_keys m ON m.key_hash=d.key_hash WHERE d.discord_user_id=? AND d.guild_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(did,GUILD_ID,now).first();
 if(active)return reply("You already have an active key for Roblox ID "+active.user_id+". Use Get Key.");
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 const hex=[...bytes].map(x=>x.toString(16).padStart(2,"0").toUpperCase()).join("");
 const key="SYND-"+hex.match(/.{8}/g).join("-");
 let digest;
 try{digest=await env.KEY_ISSUER.hashKey(key)}catch(e){console.error("key issuer hash",String(e));return reply("The key service is unavailable, so no key was created. Please try again shortly.")}
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
 return i.guild_id===GUILD_ID&&(isAdmin(i)||(permissions&MANAGE_ROLES_PERMISSION)!==0n);
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
  let inviteRoles=[],grantsBeta=false,inviteStatus="unavailable",inviteError=null;
  try {
   const invite=(await platformDiscord(env,"/invites/"+BETA_INVITE_CODE+"?with_counts=true")).data;
   if(invite?.guild?.id===GUILD_ID){
    inviteRoles=invite.roles||[];
    grantsBeta=inviteRoles.some(r=>r.id===VIP_ROLE_ID)||(invite.role_ids||[]).includes(VIP_ROLE_ID);
    inviteStatus="verified";
   }else inviteStatus="missing_or_expired";
  }catch(e){
   inviteError=String(e).slice(0,180);
   console.warn("VIP hub invite check",inviteError);
  }
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
  const details={invite:BETA_INVITE_CODE,invite_status:inviteStatus,invite_error:inviteError,invite_roles:inviteRoles.map(r=>({id:r.id,name:r.name})),grants_beta:grantsBeta,beta_role_id:beta.id,channels:modified};
  await env.DB.prepare("UPDATE beta_hub_access SET revision=?,status='ready',details=?,last_error=NULL,lease_until=0,updated_at=? WHERE id=1").bind(revision,JSON.stringify(details),new Date().toISOString()).run();
 }catch(e){
  await env.DB.prepare("UPDATE beta_hub_access SET status='error',last_error=?,lease_until=?,updated_at=? WHERE id=1").bind(String(e).slice(0,1500),Date.now()+60000,new Date().toISOString()).run();
  throw e;
 }
}


async function ensurePremiumChannelAndRemoveCommands(env) {
 const revision="premium-only-buttons-v14-birthday-command";
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS premium_channel_setup(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,status TEXT NOT NULL,backup TEXT,details TEXT,last_error TEXT,lease_until INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("INSERT OR IGNORE INTO premium_channel_setup(id,revision,status,updated_at) VALUES(1,?,'pending',?)").bind(revision,new Date().toISOString()).run();
 const claim=await env.DB.prepare("UPDATE premium_channel_setup SET lease_until=? WHERE id=1 AND (revision!=? OR status!='ready') AND lease_until<=?").bind(Date.now()+180000,revision,Date.now()).run();
 if(!claim.meta?.changes)return;
 try {
  const globalPath="/applications/"+APPLICATION_ID+"/commands";
  const guildPath="/applications/"+APPLICATION_ID+"/guilds/"+GUILD_ID+"/commands";
  await platformDiscord(env,globalPath,"PUT",[]);
  await platformDiscord(env,guildPath,"PUT",[PURGE_COMMAND,ROLE_COMMAND,CLOSE_COMMAND,VERIFIED_COMMAND,PAYMENT_COMMAND,LINK_ROBLOX_COMMAND,UNLINK_ROBLOX_COMMAND,BIRTHDAY_COMMAND]);
  const globalCommands=(await platformDiscord(env,globalPath)).data;
  const guildCommands=(await platformDiscord(env,guildPath)).data;
  if(!Array.isArray(globalCommands)||globalCommands.length)throw Error("Global slash command removal was not confirmed.");
  if(!Array.isArray(guildCommands))throw Error("Guild slash command registration was not confirmed.");
  const purgeCommand=guildCommands.find(command=>command.name==="purge"&&command.type===1);
  const roleCommand=guildCommands.find(command=>command.name==="role"&&command.type===1);
  const closeCommand=guildCommands.find(command=>command.name==="close"&&command.type===1);
  const verifiedCommand=guildCommands.find(command=>command.name==="verified"&&command.type===1);
  const paymentCommand=guildCommands.find(command=>command.name==="payment"&&command.type===1);
  const linkRobloxCommand=guildCommands.find(command=>command.name==="link-roblox"&&command.type===1);
  const unlinkRobloxCommand=guildCommands.find(command=>command.name==="unlink-roblox"&&command.type===1);
  const birthdayCommand=guildCommands.find(command=>command.name==="birthday"&&command.type===1);
  if(!purgeCommand)throw Error("Purge slash command registration was not confirmed.");
  if(!roleCommand)throw Error("Role slash command registration was not confirmed.");
  if(!closeCommand)throw Error("Close slash command registration was not confirmed.");
  if(!verifiedCommand)throw Error("Verified slash command registration was not confirmed.");
  if(!paymentCommand)throw Error("Payment slash command registration was not confirmed.");
  if(!linkRobloxCommand)throw Error("Roblox link command registration was not confirmed.");
  if(!unlinkRobloxCommand)throw Error("Roblox unlink command registration was not confirmed.");
  if(!birthdayCommand)throw Error("Birthday slash command registration was not confirmed.");
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
  const details={channel_id:channel.id,channel_name:channel.name,required_role:premium.id,global_commands:globalCommands.length,guild_commands:guildCommands.length,purge_command_id:purgeCommand.id,birthday_command_id:birthdayCommand.id};
  await env.DB.prepare("UPDATE premium_channel_setup SET revision=?,status='ready',details=?,last_error=NULL,lease_until=0,updated_at=? WHERE id=1").bind(revision,JSON.stringify(details),new Date().toISOString()).run();
 }catch(e){
  await env.DB.prepare("UPDATE premium_channel_setup SET status='error',last_error=?,lease_until=?,updated_at=? WHERE id=1").bind(String(e).slice(0,1500),Date.now()+60000,new Date().toISOString()).run();
  throw e;
 }
}
async function maintainCommunitySetup(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS community_setup(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,status TEXT NOT NULL,details TEXT,last_error TEXT,updated_at TEXT NOT NULL)").run();
 const revision="introductions-bot-welcome-and-join-role-v3";
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
  if(changed.status!==200||changed.data?.system_channel_id!==introductions[0].id||((Number(changed.data?.system_channel_flags||0)&1)===0))throw Error("Could not suppress native introductions welcome: "+changed.status);
 }
 const club=channels.data.filter(c=>[0,5].includes(c.type)&&normalize(c.name)==="club-members");
 if(club.length>1)throw Error("More than one club members channel matched; leaving them untouched.");
 if(club.length===1){
  const removed=await discordApi(env,"/channels/"+club[0].id,"DELETE");
  if(removed.status!==204)throw Error("Could not delete the club members channel: "+removed.status);
 }
 const details={introductions_channel_id:introductions[0].id,join_notices:"discord_native_system_channel_sticker_replies",deleted_club_channel_id:club[0]?.id||null};
 await env.DB.prepare("INSERT INTO community_setup(id,revision,status,details,last_error,updated_at) VALUES(1,?,'ready',?,NULL,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status='ready',details=excluded.details,last_error=NULL,updated_at=excluded.updated_at").bind(revision,JSON.stringify(details),new Date().toISOString()).run();
}
async function cleanupUnwantedReleaseMessage(env){
 const releaseId="5.89";
 const commitSha="ac3fd75b08843dec87b7bf33c735d4c1d7cc2e9d";
 const channelId="1564527153108750366";
 const messageId="1571830482025447560";
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS script_announcement_cleanup(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL,last_error TEXT,updated_at TEXT NOT NULL)").run();
 const prior=await env.DB.prepare("SELECT status FROM script_announcement_cleanup WHERE id=1").first();
 if(prior?.status==="completed")return;
 try{
  const row=await env.DB.prepare("SELECT commit_sha,message_id FROM script_update_announcements WHERE release_id=?").bind(releaseId).first();
  if(!row||row.commit_sha!==commitSha||row.message_id!==messageId)throw Error("Unexpected release announcement record");
  const channel=await discordApi(env,"/channels/"+channelId);
  if(channel.status!==200||channel.data.guild_id!==GUILD_ID)throw Error("Features channel unavailable or wrong server");
  const message=await discordApi(env,"/channels/"+channelId+"/messages/"+messageId);
  if(message.status===200){
   const footer=String(message.data.embeds?.[0]?.footer?.text||"");
   if(message.data.author?.id!==APPLICATION_ID||!footer.includes(releaseId)||!footer.includes(commitSha.slice(0,7)))throw Error("Release message identity did not match");
   const removed=await discordApi(env,"/channels/"+channelId+"/messages/"+messageId,"DELETE");
   if(removed.status!==200&&removed.status!==204)throw Error("Release message deletion failed: "+removed.status);
  }else if(message.status!==404)throw Error("Release message lookup failed: "+message.status);
  const verified=await discordApi(env,"/channels/"+channelId+"/messages/"+messageId);
  if(verified.status!==404)throw Error("Release message deletion was not confirmed");
  const stamp=new Date().toISOString();
  await env.DB.prepare("INSERT INTO script_announcement_cleanup(id,status,last_error,updated_at) VALUES(1,'completed',NULL,?) ON CONFLICT(id) DO UPDATE SET status='completed',last_error=NULL,updated_at=excluded.updated_at").bind(stamp).run();
  await env.DB.prepare("UPDATE script_update_announcements SET last_error=?,lease_until=0 WHERE release_id=? AND commit_sha=?").bind("Removed at user request; individual release posts disabled.",releaseId,commitSha).run();
 }catch(e){
  await env.DB.prepare("INSERT INTO script_announcement_cleanup(id,status,last_error,updated_at) VALUES(1,'error',?,?) ON CONFLICT(id) DO UPDATE SET status='error',last_error=excluded.last_error,updated_at=excluded.updated_at").bind(String(e).slice(0,1000),new Date().toISOString()).run();
  throw e;
 }
}
async function maintainFeatureChannel(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS feature_channel_maintenance(id INTEGER PRIMARY KEY CHECK(id=1),snapshot TEXT,status TEXT NOT NULL,details TEXT,last_error TEXT,updated_at TEXT NOT NULL)").run();
 const state=await env.DB.prepare("SELECT snapshot,status,details FROM feature_channel_maintenance WHERE id=1").first();
 const revision="features-current-2026-11-16-v3";
 if(state?.status==="completed"&&JSON.parse(state.details||"{}").revision===revision)return;
 if(!state?.snapshot)throw Error("Feature channel snapshot unavailable");
 try{
  const snapshot=JSON.parse(state.snapshot);
  const featureId="1564527153108750366";
  const messageId="1566059206811848775";
  const expected=snapshot.messages.find(m=>m.id===messageId);
  if(!expected||snapshot.features.id!==featureId)throw Error("Unexpected features snapshot");
  const channel=await discordApi(env,"/channels/"+featureId);
  if(channel.status!==200||channel.data.guild_id!==GUILD_ID)throw Error("Features channel unavailable or wrong server");
  const message=await discordApi(env,"/channels/"+featureId+"/messages/"+messageId);
  const content="💜 SYNDICATE HUB — STORAGE HUNTERS\n\n**AUCTION & FARMING**\n• Automated auction runs with garage and tier priorities, retries, affordability checks, and inventory-full stops\n• Auto Bid, Pause Auction, Instant Auction Entry, and Lost & Found collection\n• Military Base auction area and expanded garage selections\n• Auto Plant, Water, Harvest, and selected one-click activities\n\n**SHOP & POTIONS**\n• Auto Wash, Auto Repair, Daily Rewards, Museum gifts, and Shop Offers with a minimum discount setting\n• Separate Auto Buy and Auto Drink lists; drink stock, prices, restock timer, and one-tap Luck/Rush actions\n\n**QUICK SELL & GRADING**\n• Independent Quick Sell and Grading filters with Sell Selected or Keep Selected\n• Filter by rarity, mutations, event mutations, and consumables\n• Protects seeds, cleaning sprays, fishing rods, crates, safes, consumables, worn accessories, and favorites\n• Batch selling, manual sale-rate control, auto-unload options, and filter diagnostics\n\n**PLOT & ACTIVITIES**\n• Garden automation and potion placement; move selected potions to your truck\n• Plot Studio tools for saving and loading builds\n• Auto Basketball, Fishing, Obby, King of the Hill, and Hay Collector\n• Carnival x1/x5 rolls teleport beside the Monkey, retry while the booth is busy, and restore your starting spot when stopped or inventory is full\n• Quest Auto Continue teleports beside the NPC before accepting and restores your starting spot when stopped\n\n**MENU & ACCESS**\n• Draggable, resizable menu with collapsible sidebar, minimize button, and mobile-friendly controls\n• Touch, controller, mouse, and keyboard support; adjustable colors, transparency, animated sky, and pixel stars\n• Main Automation and Preset 2.0 quick setups\n• Free 24-hour and Premium lifetime key access";
  if(message.status!==200||message.data.author?.id!==APPLICATION_ID)throw Error("Features message unavailable or wrong author");
  const changed=await discordApi(env,"/channels/"+featureId+"/messages/"+messageId,"PATCH",{content,allowed_mentions:{parse:[]}});
  if(changed.status!==200||changed.data.content!==content)throw Error("Feature list update was not confirmed");
  const channelName="📋・features";
  const renamed=await discordApi(env,"/channels/"+featureId,"PATCH",{name:channelName});
  if(renamed.status!==200||renamed.data.name!==channelName)throw Error("Features channel rename was not confirmed");
  const details={revision,feature_channel:featureId,channel_name:channelName,message_id:messageId,content_length:content.length,release_posts:"disabled"};
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


async function ensureSuggestionsChannel(e){
 if(!e.DB||!e.DISCORD_BOT_TOKEN)return;
 await e.DB.prepare("CREATE TABLE IF NOT EXISTS suggestions_channel_setup(id INTEGER PRIMARY KEY CHECK(id=1),channel_id TEXT,message_id TEXT,status TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
 if((await e.DB.prepare("SELECT message_id FROM suggestions_channel_setup WHERE id=1").first())?.message_id)return;
 const norm=n=>String(n||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
 const r=await discordApi(e,"/guilds/"+GUILD_ID+"/channels");
 if(r.status!==200||!Array.isArray(r.data))throw Error("Could not list channels: "+r.status);
 const cat=r.data.find(c=>c.type===4&&norm(c.name)==="club-headquarters");
 if(!cat)throw Error("Club Headquarters category not found");
 let ch=r.data.find(c=>c.type===0&&c.parent_id===cat.id&&norm(c.name)==="suggestions");
 if(!ch){const n=await discordApi(e,"/guilds/"+GUILD_ID+"/channels","POST",{name:"💡・suggestions",type:0,parent_id:cat.id,permission_overwrites:cat.permission_overwrites||[]});if(![200,201].includes(n.status)||!n.data?.id)throw Error("Channel create failed: "+n.status);ch=n.data;}
 const h=await discordApi(e,"/channels/"+ch.id+"/messages?limit=50");
 const old=h.status===200&&Array.isArray(h.data)?h.data.find(m=>m.author?.id===APPLICATION_ID&&m.embeds?.some(x=>x.title==="💡 Suggestions & Event Times")):null;
 if(old){await e.DB.prepare("INSERT OR REPLACE INTO suggestions_channel_setup(id,channel_id,message_id,status,updated_at) VALUES(1,?,?,?,?)").bind(ch.id,old.id,"posted",new Date().toISOString()).run();return;}
 const m=await discordApi(e,"/channels/"+ch.id+"/messages","POST",{embeds:[{title:"💡 Suggestions & Event Times",description:"Have an idea for an event time, a Bunker or Acid event, or the server in general? Drop it here! All suggestions are welcome. We’ll review them and do our best to make requests happen. Thanks for helping us make the server better.",color:0x7655D8,footer:{text:"Shadow Syndicate • Community Suggestions"}}]});
 if(![200,201].includes(m.status)||!m.data?.id)throw Error("Embed post failed: "+m.status);
 await e.DB.prepare("INSERT OR REPLACE INTO suggestions_channel_setup(id,channel_id,message_id,status,updated_at) VALUES(1,?,?,?,?)").bind(ch.id,m.data.id,"posted",new Date().toISOString()).run();
}
 const INTRO_WELCOME_CHANNEL_ID="1564527128253436005";
async function ensureCommunityIntroChannels(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS community_intro_setup(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
 const channelsResult=await discordApi(env,"/guilds/"+GUILD_ID+"/channels");
 if(channelsResult.status!==200||!Array.isArray(channelsResult.data))throw Error("Could not read guild channels ("+channelsResult.status+").");
 const channels=channelsResult.data;
 const welcome=channels.find(channel=>String(channel.id)===INTRO_WELCOME_CHANNEL_ID);
 if(welcome&&welcome.name!=="👋・welcome"){
  const renamed=await discordApi(env,"/channels/"+welcome.id,"PATCH",{name:"👋・welcome",topic:"Server welcomes and member updates. Use 💜・introductions to share a longer intro."});
  if(renamed.status!==200)throw Error("Could not rename welcome channel ("+renamed.status+"): "+JSON.stringify(renamed.data));
  welcome.name="👋・welcome";
 }
 const normalizeIntroChannel=n=>String(n||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
 let intro=channels.find(channel=>channel.type===0&&normalizeIntroChannel(channel.name)==="introductions");
 if(intro&&intro.name!=="💜・introductions"){
  const renamed=await discordApi(env,"/channels/"+intro.id,"PATCH",{name:"💜・introductions",topic:"Share a little about yourself with the crew. Every prompt is optional except your name or nickname."});
  if(renamed.status!==200)throw Error("Could not style introductions channel ("+renamed.status+"): "+JSON.stringify(renamed.data));
  intro.name="💜・introductions";
 }
 if(!intro){
  const channelBody={name:"💜・introductions",type:0,topic:"Share a little about yourself with the crew. Every prompt is optional except your name or nickname.",...(welcome?.parent_id?{parent_id:welcome.parent_id}:{})};
  const created=await discordApi(env,"/guilds/"+GUILD_ID+"/channels","POST",channelBody);
  if(![200,201].includes(created.status)||!created.data?.id)throw Error("Could not create introductions channel ("+created.status+"): "+JSON.stringify(created.data));
  intro=created.data;
 }
 let petPhotos=channels.find(channel=>channel.type===0&&normalizeIntroChannel(channel.name)==="pet-pictures");
 if(petPhotos&&petPhotos.name!=="🐾・pet-pictures"){
  const renamed=await discordApi(env,"/channels/"+petPhotos.id,"PATCH",{name:"🐾・pet-pictures",topic:"🐾 Pet tax! Share photos of your pets here. Please keep personal information out of photo captions."});
  if(renamed.status!==200)throw Error("Could not style pet-pictures channel ("+renamed.status+"): "+JSON.stringify(renamed.data));
  petPhotos.name="🐾・pet-pictures";
 }
 if(!petPhotos){
  const channelBody={name:"🐾・pet-pictures",type:0,topic:"🐾 Pet tax! Share photos of your pets here. Please keep personal information out of photo captions.",...(intro?.parent_id?{parent_id:intro.parent_id}:{})};
  const created=await discordApi(env,"/guilds/"+GUILD_ID+"/channels","POST",channelBody);
  if(![200,201].includes(created.status)||!created.data?.id)throw Error("Could not create pet-pictures channel ("+created.status+"): "+JSON.stringify(created.data));
  petPhotos=created.data;
 }
 await env.DB.prepare("INSERT INTO community_intro_setup(key,value,updated_at) VALUES('channel_id',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(String(intro.id),new Date().toISOString()).run();

 const rolesChannel=channels.find(c=>c.type===0&&(String(c.id)==="1564527127276290098"||normalizeIntroChannel(c.name)==="reaction-roles"));
 if(!rolesChannel)throw Error("Reaction Roles not found; keeping the previous panel unchanged.");
 const put=async(key,value)=>env.DB.prepare("INSERT INTO community_intro_setup(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key,String(value),new Date().toISOString()).run();
 const oldPanel=await env.DB.prepare("SELECT value FROM community_intro_setup WHERE key='panel_id'").first();
 const oldLocation=await env.DB.prepare("SELECT value FROM community_intro_setup WHERE key='panel_channel_id'").first();
 const revision=await env.DB.prepare("SELECT value FROM community_intro_setup WHERE key='panel_revision'").first();
 const currentRevision="intro-studio-20261118-v2";
 await put("pet_channel_id",petPhotos.id);
 const panel={embeds:[{
  color:0x8555D9,author:{name:"SHADOW SYNDICATE • COMMUNITY"},
  title:"💜 Your Story Starts Here",
  description:"Everyone has a story, and this is where yours begins.\n\nBuild your own member spotlight, section by section. Talk about your favorite games, music, hobbies, personality, pets, and whatever else makes you **you**.\n\n**Save as you go. Preview before publishing. Edit whenever you want.**",
  fields:[
   {name:"🪪 About You",value:"Name, pronouns, a personal bio, broad location and languages.",inline:false},
   {name:"🎮 Interests & Games",value:"Games, hobbies, music, movies, books and creative interests.",inline:false},
   {name:"💖 Your Favorites",value:"Food, colors, fandoms, comforts and current obsessions.",inline:false},
   {name:"✨ The Fun Stuff",value:"Fun facts, pets, talents, conversation starters and anything else.",inline:false},
   {name:"🐾 Pet Gallery",value:"Upload up to ten pet pictures with a personal message. Your photos and tag go to <#"+petPhotos.id+">.",inline:false}
  ],
  footer:{text:"Only a name or nickname is required • Everything else is your choice"}
 }],components:[{type:1,components:[
  {type:2,style:1,label:"💜 Build My Introduction",custom_id:"intro_studio_open"},
  {type:2,style:2,label:"🐾 Share Pet Photos",custom_id:"intro_pet_open"}
 ]}],allowed_mentions:{parse:[]}};
 let posted=null;
 if(oldPanel?.value&&String(oldLocation?.value||"")===String(rolesChannel.id)){
  const found=await discordApi(env,"/channels/"+rolesChannel.id+"/messages/"+oldPanel.value);
  if(found.status===200&&found.data?.author?.id===APPLICATION_ID){
   posted=revision?.value===currentRevision?{status:200,data:{id:oldPanel.value}}:
    await discordApi(env,"/channels/"+rolesChannel.id+"/messages/"+oldPanel.value,"PATCH",panel);
  }
 }
 if(!posted||posted.status!==200||!posted.data?.id)posted=await discordApi(env,"/channels/"+rolesChannel.id+"/messages","POST",panel);
 if(![200,201].includes(posted.status)||!posted.data?.id)throw Error("Introduction panel post HTTP "+posted.status);
 await put("panel_channel_id",rolesChannel.id);
 await put("panel_id",posted.data.id);
 await put("panel_revision",currentRevision);
 if(oldPanel?.value&&String(oldLocation?.value||intro.id)!==String(rolesChannel.id)){
  const legacy=await discordApi(env,"/channels/"+intro.id+"/messages/"+oldPanel.value);
  if(legacy.status===200&&legacy.data?.author?.id===APPLICATION_ID&&legacy.data.components?.some(row=>row.components?.some(b=>b.custom_id==="long_intro_open"))){
   const removed=await discordApi(env,"/channels/"+intro.id+"/messages/"+oldPanel.value,"DELETE");
   if(![200,204,404].includes(removed.status))console.error("Old introduction panel removal HTTP",removed.status);
  }
 }

}
function longIntroModal(){
 const fields=[
  ["intro_name","Name / nickname",true,"What should we call you?"],
  ["intro_pronouns","Pronouns",false,"Optional"],
  ["intro_interests","Hobbies & top games",false,"What do you enjoy doing or playing?"],
  ["intro_likes","Likes & favorites",false,"Music, snacks, colors, anything"],
  ["intro_extras","Fun facts, pets & languages",false,"Optional lines: Fun fact: … | Pets: … | From (region): … | Languages: …"]
 ];
 return new Response(JSON.stringify({type:9,data:{custom_id:"long_intro_submit",title:"Your Introduction",components:fields.map(([id,label,required,placeholder],index)=>({type:1,components:[{type:4,custom_id:id,label,style:index>=2?2:1,required,min_length:required?1:0,max_length:index>=2?300:80,placeholder}]}))}}),{headers:{"content-type":"application/json"}});
}
async function openLongIntro(i,env){
 if(!env.DB)return reply("The intro form is temporarily unavailable.");
 const saved=await env.DB.prepare("SELECT value FROM community_intro_setup WHERE key='channel_id'").first();
 if(!saved||String(i.channel_id)!==String(saved.value))return reply("Please use the introduction form in #introductions.");
 return longIntroModal();
}
async function submitLongIntro(i,env){
 if(!env.DB)return reply("The intro form is temporarily unavailable.");
 const saved=await env.DB.prepare("SELECT value FROM community_intro_setup WHERE key='channel_id'").first();
 const channelId=String(saved?.value||"");
 if(!channelId||String(i.channel_id)!==channelId)return reply("Please submit the form from #introductions.");
 const user=i.member?.user||i.user;
 if(!user?.id)return reply("I couldn't identify your Discord account.");
 const values=Object.fromEntries((i.data.components||[]).flatMap(row=>row.components||[]).map(component=>[component.custom_id,String(component.value||"").trim()]));
 const name=values.intro_name?.slice(0,80);
 if(!name)return reply("Add a name or nickname before submitting.");
 const sections=[
  ["🪪 Name / nickname",name],
  ["💬 Pronouns",values.intro_pronouns],
  ["🎮 Hobbies & top games",values.intro_interests],
  ["💜 Likes & favorites",values.intro_likes]
 ].filter(([,value])=>String(value||"").trim());
 const extraLabels={fun:"✨ Fun fact",pet:"🐾 Pets",from:"🌎 Where you’re from",region:"🌎 Where you’re from",language:"🗣️ Languages"};
 const extras=String(values.intro_extras||"").split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 for(const line of extras){
  const match=/^(fun\s*fact|pets?|from(?:\s*\([^)]*\))?|region|languages?)\s*:\s*(.+)$/i.exec(line);
  if(match){const key=match[1].toLowerCase().split(/[\s(]/)[0].replace(/s$/,"");sections.push([extraLabels[key]||"✨ Fun fact",match[2].slice(0,300)]);}
  else sections.push(["✨ Extra details",line.slice(0,300)]);
 }
 const cleanName=name.replace(/[*_~`|]/g,"");
 const introDescription="Welcome, **"+cleanName+"**! Here’s a little about them:\n\n"+sections.map(([label,value])=>"### "+label+"\n"+String(value).slice(0,300)).join("\n\n");
 const payload={content:"<@"+user.id+"> shared an introduction 💜",embeds:[{color:0x8B5CF6,author:{name:"A new face in the Syndicate"},description:introDescription,...(user.avatar?{thumbnail:{url:"https://cdn.discordapp.com/avatars/"+user.id+"/"+user.avatar+".png?size=128"}}:{}),footer:{text:"Shadow Syndicate • Say hi and make them feel welcome"},timestamp:new Date().toISOString()}],allowed_mentions:{parse:[],users:[String(user.id)]}};
 const posted=await discordApi(env,"/channels/"+channelId+"/messages","POST",payload);
 if(posted.status!==200||!posted.data?.id)throw Error("Could not post introduction ("+posted.status+"): "+JSON.stringify(posted.data));
 return reply("Your intro is up in #introductions 💜");
}



// Introduction Studio — independent questions, private drafts and editable profiles.
const INTRO_SECTIONS={
 about:{title:"🪪 About Me",fields:[
  ["name","Name or nickname","What should we call you?",true,80,1],
  ["pronouns","Pronouns","Optional — only if you want to share.",false,80,1],
  ["bio","Describe yourself","Tell everyone a little about yourself.",false,650,2],
  ["region","Where you're from (broadly)","Country, state or region, not an address.",false,140,1],
  ["languages","Languages you speak","Which languages do you know?",false,160,1]]},
 interests:{title:"🎮 Interests & Games",fields:[
  ["games","Favorite games","Roblox, other games, genres, anything!",false,320,2],
  ["hobbies","Hobbies & pastimes","What do you love doing?",false,320,2],
  ["music","Music & artists","Songs, artists, genres and playlists.",false,320,2],
  ["watching","Movies, shows & books","Your favorites or recent discoveries.",false,320,2],
  ["creative","Your creative side","Art, writing, building, sports, projects...",false,320,2]]},
 favorites:{title:"💖 Favorites",fields:[
  ["food","Favorite food & snacks","Something you could eat any day.",false,250,2],
  ["colors","Colors & aesthetics","Your colors, styles or vibes.",false,250,2],
  ["characters","Characters & fandoms","Favorite characters and communities.",false,250,2],
  ["comfort","Little things you love","What makes your day better?",false,250,2],
  ["current","Currently obsessed with","What are you enjoying lately?",false,250,2]]},
 extras:{title:"✨ Fun Facts & Pets",fields:[
  ["funfact","A fun fact about you","Something unexpected or memorable.",false,320,2],
  ["pets","Your pets","Names, types and personalities.",false,320,2],
  ["talent","Talents & quirks","Hidden talents or funny habits.",false,320,2],
  ["askme","Ask me about...","A great conversation starter.",false,320,2],
  ["anything","Anything else?","Make this introduction your own!",false,450,2]]}
};
const INTRO_ORDER=["about","interests","favorites","extras"];
const INTRO_LABELS={
 name:"🪪 Name / nickname",pronouns:"💬 Pronouns",bio:"📝 A little about me",region:"🌎 From",
 languages:"🗣️ Languages",games:"🎮 Favorite games",hobbies:"🧩 Hobbies",music:"🎧 Music",
 watching:"🎬 Movies, shows & books",creative:"🎨 Creative interests",
 food:"🍿 Food & snacks",colors:"🎨 Colors & aesthetic",characters:"🌟 Characters & fandoms",
 comfort:"🌷 Things I love",current:"⚡ Current obsession",funfact:"✨ Fun fact",
 pets:"🐾 My pets",talent:"🌈 Talents & quirks",askme:"💬 Ask me about",anything:"💌 One more thing"
};
async function introTable(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS community_intro_drafts(user_id TEXT PRIMARY KEY,data TEXT NOT NULL DEFAULT '{}',post_id TEXT,post_hash TEXT,publish_lease_until INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)").run();
}
function introUser(i){return i.member?.user||i.user;}
async function introDraft(env,userId){
 await introTable(env);
 const row=await env.DB.prepare("SELECT * FROM community_intro_drafts WHERE user_id=?").bind(userId).first();
 let data={};try{data=JSON.parse(row?.data||"{}")}catch{}
 return {row,data:data&&typeof data==="object"&&!Array.isArray(data)?data:{}};
}
function introButtons(){
 return [
  {type:1,components:[
   {type:2,style:2,label:"🪪 About Me",custom_id:"intro_edit:about"},
   {type:2,style:2,label:"🎮 Interests",custom_id:"intro_edit:interests"},
   {type:2,style:2,label:"💖 Favorites",custom_id:"intro_edit:favorites"},
   {type:2,style:2,label:"✨ Fun & Pets",custom_id:"intro_edit:extras"}]},
  {type:1,components:[
   {type:2,style:2,label:"👀 Preview",custom_id:"intro_preview"},
   {type:2,style:3,label:"✅ Publish / Update",custom_id:"intro_publish"},
   {type:2,style:4,label:"🗑 Reset Draft",custom_id:"intro_reset"},
   {type:2,style:2,label:"🐾 Pet Photos",custom_id:"intro_pet_open"}]}
 ];
}
function introReply(content,embeds=[]){
 return discordResponse({type:4,data:{content,embeds,components:introButtons(),flags:64,allowed_mentions:{parse:[]}}});
}
function introEscape(value,max=230){
 return String(value||"").trim().slice(0,max).replace(/@/g,"＠").replace(/([\\*_~\x60|>])/g,"\\$1");
}
function introEmbeds(user,data,preview=false){
 const name=introEscape(data.name||"New Member",65);
 const avatar=user?.avatar?"https://cdn.discordapp.com/avatars/"+user.id+"/"+user.avatar+".png?size=256":"https://cdn.discordapp.com/embed/avatars/0.png";
 const layouts=[
  {key:"about",title:"💜 Meet "+name,color:0x8955DD,description:"There's more to everyone than a username. Here's their story."},
  {key:"interests",title:"🎮 Games, Hobbies & Creativity",color:0x7157C7,description:"A look at the worlds and activities they enjoy."},
  {key:"favorites",title:"💖 A Few Favorite Things",color:0xB36AD0,description:"The little things that make them smile."},
  {key:"extras",title:"✨ Beyond the Username",color:0x9066CF,description:"Fun facts, pets and conversation starters."}
 ];
 const output=[];
 for(const layout of layouts){
  const fields=INTRO_SECTIONS[layout.key].fields.filter(([id])=>String(data[id]||"").trim())
   .map(([id])=>({name:INTRO_LABELS[id],value:introEscape(data[id],id==="bio"?390:195)||"—",inline:false}));
  if(layout.key!=="about"&&!fields.length)continue;
  output.push({title:layout.title,description:layout.description,color:layout.color,fields,
   ...(layout.key==="about"?{
     author:{name:preview?"INTRODUCTION PREVIEW":"SHADOW SYNDICATE  •  MEMBER INTRODUCTION",icon_url:avatar},
     thumbnail:{url:avatar},
     footer:{text:"💜 Say hello, find common interests and make a new friend!"},
     timestamp:new Date().toISOString()
    }:{})});
 }
 return output;
}
async function introModal(i,env,section){
 const spec=INTRO_SECTIONS[section];if(!spec)return reply("This section is unavailable.");
 const user=introUser(i);if(!user?.id)return reply("Could not identify your account.");
 const {data}=await introDraft(env,user.id);
 const components=spec.fields.map(([id,label,required,placeholder,max,style])=>({
  type:18,label,component:{type:4,custom_id:id,style,required,max_length:max,
   min_length:required?1:0,placeholder,...(data[id]?{value:String(data[id]).slice(0,max)}:{})}
 }));
 return discordResponse({type:9,data:{custom_id:"intro_save:"+section,title:spec.title.slice(0,45),components}});
}
function introPhotoModal(){
 return discordResponse({type:9,data:{custom_id:"intro_pet_submit",title:"🐾 Share Your Pet Photos",components:[
  {type:18,label:"Pet names (optional)",component:{type:4,custom_id:"pet_names",style:1,required:false,max_length:140,placeholder:"Who are we looking at?"}},
  {type:18,label:"Your message / photo caption",description:"Give your pictures a personal touch.",component:{type:4,custom_id:"pet_caption",style:2,required:false,max_length:650,placeholder:"Tell us about your pets or a funny story."}},
  {type:18,label:"Upload pet photos",description:"1–10 pictures, up to 45 MB total. All photos post in one gallery.",
   component:{type:19,custom_id:"pet_files",min_values:1,max_values:10,file_types:["image"],required:true}}
 ]}});
}
function introValues(i){
 const result={};
 for(const item of i.data?.components||[]){
  for(const child of [item.component,...(item.components||[])].filter(Boolean)){
   if(child.custom_id&&typeof child.value==="string")result[child.custom_id]=child.value.trim();
   else if(child.custom_id&&Array.isArray(child.values))result[child.custom_id]=child.values;
  }
 }
 return result;
}
async function introHome(i,env){
 const user=introUser(i);if(!user?.id)return reply("Could not identify your Discord account.");
 const {data,row}=await introDraft(env,user.id);
 const progress=INTRO_ORDER.map(section=>{
  const spec=INTRO_SECTIONS[section];
  const count=spec.fields.filter(([id])=>String(data[id]||"").trim()).length;
  return (count?"✅":"▫️")+" **"+spec.title+"** — "+count+" / "+spec.fields.length+" prompts";
 }).join("\n");
 return introReply("Welcome to your private introduction studio. Complete whichever sections you'd like, preview, and publish when you're ready.",[
  {title:"💜 Your Introduction Studio",color:0x8955DD,
   description:progress+"\n\n**Your answers save automatically between sections.** Everything except your name or nickname is optional.",
   footer:{text:row?.post_id?"Already introduced? Publishing will edit your existing post.":"Preview your profile before sharing it with the server."}}
 ]);
}
async function introSave(i,env,section){
 const user=introUser(i),spec=INTRO_SECTIONS[section];
 if(!user?.id||!spec)return reply("That section could not be saved.");
 const vals=introValues(i),{data}=await introDraft(env,user.id);
 for(const [id] of spec.fields)if(Object.prototype.hasOwnProperty.call(vals,id))data[id]=String(vals[id]||"").trim();
 if(section==="about"&&!String(data.name||"").trim())return introReply("Add a name or nickname in the **About Me** section first.");
 await env.DB.prepare("INSERT INTO community_intro_drafts(user_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at")
  .bind(user.id,JSON.stringify(data),new Date().toISOString()).run();
 return introReply("✅ **"+spec.title+"** saved! Continue with another section, or preview your profile.");
}
async function introPreview(i,env){
 const user=introUser(i);if(!user?.id)return reply("Could not identify your Discord account.");
 const {data}=await introDraft(env,user.id);
 if(!String(data.name||"").trim())return introReply("Start in **🪪 About Me** and add your name or nickname.");
 return introReply("👀 **Only you can see this preview.** Edit any section or publish when you like the result.",introEmbeds(user,data,true));
}
async function introReset(i,env){
 const user=introUser(i);if(!user?.id)return reply("Could not identify your Discord account.");
 await introTable(env);
 await env.DB.prepare("UPDATE community_intro_drafts SET data='{}',updated_at=? WHERE user_id=?").bind(new Date().toISOString(),user.id).run();
 return introReply("🗑 Your draft is cleared. Any introduction you've already published will stay in the channel.");
}



async function introPublish(i,env){
 const user=introUser(i);if(!user?.id)return reply("Could not identify your Discord account.");
 const {row,data}=await introDraft(env,user.id);
 if(!String(data.name||"").trim())return introReply("Please add a name or nickname in **🪪 About Me** first.");
 const saved=await env.DB.prepare("SELECT value FROM community_intro_setup WHERE key='channel_id'").first();
 const channel=String(saved?.value||"");
 if(!/^\d{15,22}$/.test(channel))return introReply("Introductions aren't configured yet. Please try again.");
 const hash=JSON.stringify(data);
 if(row?.post_id&&row.post_hash===hash)return introReply("💜 Your introduction is already published and up to date! Feel free to edit any section.");
 // Prevent accidental duplicate posts from quick double-taps.
 const lease=await env.DB.prepare("UPDATE community_intro_drafts SET publish_lease_until=? WHERE user_id=? AND publish_lease_until<?")
  .bind(Date.now()+75000,user.id,Date.now()).run();
 if(Number(lease.meta?.changes||0)!==1)return introReply("Your introduction is being published already. Check the channel in a moment.");
 try{
  const payload={content:"💜 <@"+user.id+"> shared their introduction!",
   embeds:introEmbeds(user,data),allowed_mentions:{parse:[],users:[String(user.id)]}};
  let sent=null;
  if(row?.post_id){
   sent=await discordApi(env,"/channels/"+channel+"/messages/"+row.post_id,"PATCH",payload);
   if(sent.status===404)sent=null;
  }
  if(!sent)sent=await discordApi(env,"/channels/"+channel+"/messages","POST",payload);
  if(![200,201].includes(sent.status)||!sent.data?.id)throw Error("Introduction post HTTP "+sent.status+" "+JSON.stringify(sent.data).slice(0,200));
  await env.DB.prepare("UPDATE community_intro_drafts SET post_id=?,post_hash=?,publish_lease_until=0,updated_at=? WHERE user_id=?")
   .bind(String(sent.data.id),hash,new Date().toISOString(),user.id).run();
  return introReply("✅ **Introduction "+(row?.post_id&&row.post_id===sent.data.id?"updated":"published")+"!**\nhttps://discord.com/channels/"+GUILD_ID+"/"+channel+"/"+sent.data.id+"\n\nYou can update it without creating duplicates.");
 }catch(e){
  console.error("intro publish error",String(e));
  await env.DB.prepare("UPDATE community_intro_drafts SET publish_lease_until=0 WHERE user_id=?").bind(user.id).run();
  return introReply("Couldn't publish just now. Your draft is still saved — please try again.");
 }
}
async function introPetSubmit(i,env){
 const user=introUser(i);if(!user?.id)return reply("Could not identify your Discord account.");
 const saved=await env.DB.prepare("SELECT value FROM community_intro_setup WHERE key='pet_channel_id'").first();
 const channel=String(saved?.value||"");
 if(!/^\d{15,22}$/.test(channel))return reply("Pet Pictures isn't configured yet.");
 const values=introValues(i),ids=Array.isArray(values.pet_files)?values.pet_files:[];
 const resolved=i.data?.resolved?.attachments||{};
 if(ids.length<1||ids.length>10||new Set(ids).size!==ids.length)return reply("Please choose between 1 and 10 different pet pictures.");
 const attachments=ids.map(id=>resolved[id]);
 if(attachments.some(a=>!a))return reply("Discord didn't provide every selected photo. Please try the upload again.");
 const allowedExt=new Set(["jpg","jpeg","png","gif","webp","heic","heif","avif"]);
 const mimeForExt={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",gif:"image/gif",webp:"image/webp",heic:"image/heic",heif:"image/heif",avif:"image/avif"};
 let bytesExpected=0;
 const checked=[];
 for(const photo of attachments){
  let uri;try{uri=new URL(String(photo.url||""))}catch{return reply("One of the photos had an invalid upload URL.");}
  const ext=String(photo.filename||"").split(".").pop().toLowerCase();
  const type=String(photo.content_type||mimeForExt[ext]||"").toLowerCase();
  const size=Number(photo.size||0);
  if(uri.protocol!=="https:"||!["cdn.discordapp.com","media.discordapp.net"].includes(uri.hostname)||
    !allowedExt.has(ext)||!type.startsWith("image/")||!Number.isFinite(size)||size<=0||size>20*1024*1024)
   return reply("Please select JPG, PNG, GIF, WebP, HEIC or AVIF pictures, each under 20 MB.");
  bytesExpected+=size;
  checked.push({url:String(photo.url),type,ext,size});
 }
 // One Discord gallery keeps the caption and every picture together. Limit total
 // request size to stay beneath Cloudflare Worker memory/runtime limits.
 if(bytesExpected>45*1024*1024)return reply("Your pictures total more than 45 MB. Please share them in two smaller uploads so none get lost.");
 const names=introEscape(values.pet_names,140),caption=introEscape(values.pet_caption,600);
 let loaded;
 try{
  loaded=await Promise.all(checked.map(async(photo,index)=>{
   const response=await fetch(photo.url,{redirect:"error",signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error("Photo "+(index+1)+" unavailable: HTTP "+response.status);
   const body=await response.arrayBuffer();
   if(body.byteLength>20*1024*1024||!body.byteLength)throw Error("Photo "+(index+1)+" invalid size");
   return {body,type:photo.type,filename:"pet-photo-"+(index+1)+"."+photo.ext};
  }));
 }catch(e){
  console.error("pet gallery downloads",String(e));
  return reply("Discord couldn't retrieve every photo. Nothing was posted; please try the upload again.");
 }
 const form=new FormData(),fileRecords=[];
 for(let index=0;index<loaded.length;index++){
  const file=loaded[index];
  form.append("files["+index+"]",new Blob([file.body],{type:file.type}),file.filename);
  fileRecords.push({id:index,filename:file.filename});
 }
 const payload={
  content:"🐾 Pet photos from <@"+user.id+">!",
  embeds:[{title:"🐾 Meet the Pets",color:0xAC72D8,
   description:(names?"**Meet "+names+"**\n\n":"")+(caption||"A little pet happiness for the crew!"),
   footer:{text:"Shadow Syndicate • Pet Pictures • "+loaded.length+" photo"+(loaded.length===1?"":"s")},
   timestamp:new Date().toISOString()}],
  attachments:fileRecords,allowed_mentions:{parse:[],users:[String(user.id)]}
 };
 form.append("payload_json",JSON.stringify(payload));
 try{
  const response=await fetch("https://discord.com/api/v10/channels/"+channel+"/messages",{
   method:"POST",headers:{Authorization:"Bot "+env.DISCORD_BOT_TOKEN},body:form,
   signal:AbortSignal.timeout(15000)});
  const result=await response.json().catch(()=>null);
  if(![200,201].includes(response.status)||!result?.id){
   console.error("pet gallery rejected",response.status,JSON.stringify(result).slice(0,350));
   return reply("Discord couldn't post the photo gallery ("+response.status+"). Nothing was confirmed as posted. Please try again.");
  }
  return reply("🐾 **All "+loaded.length+" photos were posted together!**\nhttps://discord.com/channels/"+GUILD_ID+"/"+channel+"/"+result.id+"\nYour caption and Discord tag are included.");
 }catch(e){
  console.error("pet gallery post",String(e));
  return reply("Discord did not confirm the photo gallery. Please check #pet-pictures before retrying to avoid duplicate pictures.");
 }
}
async function introStudioDiagnostics(env){
 if(!env.DB||!env.DISCORD_BOT_TOKEN)return;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS community_intro_diagnostics(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL,details TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
 const existing=await env.DB.prepare("SELECT status,updated_at FROM community_intro_diagnostics WHERE id=1").first();
 if(existing?.status==="ready"&&Date.now()-Date.parse(existing.updated_at)<10*60*1000)return;
 const read=async(key)=>(await env.DB.prepare("SELECT value FROM community_intro_setup WHERE key=?").bind(key).first())?.value;
 const panelId=await read("panel_id"),panelChannel=await read("panel_channel_id"),introChannel=await read("channel_id"),petChannel=await read("pet_channel_id");
 const checks={};
 const snowflake=s=>/^\d{15,22}$/.test(String(s||""));
 if(snowflake(panelId)&&snowflake(panelChannel)){
  const response=await discordApi(env,"/channels/"+panelChannel+"/messages/"+panelId);
  checks.panel=response.status===200&&response.data?.author?.id===APPLICATION_ID&&
    response.data?.components?.some(row=>row.components?.some(button=>button.custom_id==="intro_studio_open"))&&
    response.data?.components?.some(row=>row.components?.some(button=>button.custom_id==="intro_pet_open"))? "ok":"HTTP "+response.status+" / incorrect panel";
 }else checks.panel="not configured";
 for(const [key,id] of [["introductions",introChannel],["pet_pictures",petChannel]]){
  if(!snowflake(id)){checks[key]="not configured";continue;}
  const r=await discordApi(env,"/channels/"+id);
  checks[key]=r.status===200&&String(r.data?.guild_id)===String(GUILD_ID)?"ok":"HTTP "+r.status;
 }
 const introModalValid=INTRO_ORDER.every(key=>INTRO_SECTIONS[key].fields.length===5);
 const petPayload=await introPhotoModal().json();
 const petComponent=petPayload.data?.components?.find(c=>c.component?.type===19)?.component;
 checks.forms=introModalValid&&petComponent?.max_values===10&&petComponent?.file_types?.includes("image")?"ok":"invalid form configuration";
 const status=Object.values(checks).every(x=>x==="ok")?"ready":"error";
 await env.DB.prepare("INSERT INTO community_intro_diagnostics(id,status,details,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,details=excluded.details,updated_at=excluded.updated_at")
  .bind(status,JSON.stringify(checks),new Date().toISOString()).run();
 if(status!=="ready")console.error("intro studio diagnostics",JSON.stringify(checks));
}


export default {
async scheduled(event,env,ctx){
  if(!env.DISCORD_BOT_TOKEN)return;
  ctx.waitUntil((async()=>{await sendBirthdayAnnouncements(env);await upgradeBirthdayAnnouncementEmbeds(env)})().catch(e=>console.error("birthday scheduler",String(e))));
  ctx.waitUntil(ensureSuggestionsChannel(env).catch(e=>console.error("suggestions channel setup",String(e))));
  ctx.waitUntil(ensureCommunityIntroChannels(env).catch(e=>console.error("introductions setup",String(e))));
  ctx.waitUntil(introStudioDiagnostics(env).catch(e=>console.error("introductions diagnostics",String(e))));
  ctx.waitUntil(memberJoinDiag(env,"scheduled","Cron handler ran").catch(()=>{}));
  ctx.waitUntil(ensureClubNightPollPreview(env).catch(e=>console.error("club night poll preview",String(e))));
  ctx.waitUntil(applyShadowRoleIcons(env).catch(e=>console.error("role icon setup",String(e))));
  ctx.waitUntil(ensureRobloxAchievementRoles(env).catch(e=>console.error("Roblox role catalog",String(e))));

  ctx.waitUntil(syncLinkedRobloxAccounts(env).catch(e=>console.error("Roblox account sync",String(e))));
  ctx.waitUntil(flushShadowMemberLeaveNotifications(env).catch(e=>console.error("member leave notifications",String(e))));
  ctx.waitUntil(ensureShadowLeaveTestMessage(env).catch(e=>console.error("member leave test message",String(e))));
  // Native Discord welcome is authoritative; don't edit legacy custom welcome embeds.
  ctx.waitUntil(reconcileRecentJoins(env).catch(e=>console.error("join reconciliation",String(e))));
  ctx.waitUntil(configureNativeJoinGreeting(env).catch(e=>console.error("native welcome settings",String(e))));
  ctx.waitUntil(ensureClubEventPanel(env).catch(e=>console.error('club event panel',String(e))));
  ctx.waitUntil(cleanupEndedClubEvents(env).catch(e=>console.error("ended event cleanup",String(e))));
  if(env.MEMBER_JOIN_GATEWAY)ctx.waitUntil(env.MEMBER_JOIN_GATEWAY.getByName("member-join-listener").fetch("https://internal/start",{method:"POST"}).catch(e=>console.error("member gateway start",String(e))));
  ctx.waitUntil(removeObsoleteGetKeyDescription(env).catch(e=>console.error("bot description update",String(e))));
  ctx.waitUntil(maintainFeatureChannel(env).catch(e=>console.error("features maintenance",String(e))));
  // Script release details belong in the single maintained Features message.
  ctx.waitUntil(cleanupUnwantedReleaseMessage(env).catch(e=>console.error("release message cleanup",String(e))));
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
  if(req.method==="GET"&&url.pathname==="/roblox/oauth/callback")return robloxOAuthCallback(req,env);
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
   if(i.data?.name==="birthday")return delayedReply(i,env,ctx,()=>birthdayLookupCommand(i,env));
   if(i.data?.name==="purge")return delayedReply(i,env,ctx,()=>purgeMessages(i,env));
   if(i.data?.name==="role"&&interactionOption(i,"action")?.value==="add")return delayedReply(i,env,ctx,()=>addRoleToMember(i,env));
   if(i.data?.name==="role"&&interactionOption(i,"action")?.value==="remove")return delayedReply(i,env,ctx,()=>removeRoleFromMember(i,env));
   if(i.data?.name==="close")return delayedReply(i,env,ctx,()=>deletePremiumTicket(i,env));
   if(i.data?.name==="verified")return delayedReply(i,env,ctx,()=>verifyTicketMember(i,env),false);
   if(i.data?.name==="payment")return delayedReply(i,env,ctx,()=>sendPremiumPaymentLink(i,env));
   if(i.data?.name==="link-roblox")return delayedReply(i,env,ctx,()=>beginRobloxLink(i,env));
   if(i.data?.name==="unlink-roblox")return delayedReply(i,env,ctx,()=>unlinkRobloxAccount(i,env));
   return reply("That slash command is not available.");
  }
  const eventCreateId=String(i.data?.custom_id||"");
  const createEventMatch=/^club_event_create:(acid|bunker|dual)$/.exec(eventCreateId);
  if(i.type===3&&(eventCreateId==="club_event_create"||createEventMatch)){
   if(i.channel_id!==CLUB_EVENTS_CHANNEL)return reply("Use the Club Events channel to create an event.");
   return clubEventModal(i,env,createEventMatch?.[1]||"acid");
  }
  if(i.type===5&&(eventCreateId==="club_event_create_modal"||/^club_event_create_modal:(acid|bunker|dual)$/.test(eventCreateId))){
   if(i.channel_id!==CLUB_EVENTS_CHANNEL)return reply("Submit event forms in the Club Events channel.");
   if(!env.DB)return reply("The event service is temporarily unavailable.");
   return delayedReply(i,env,ctx,()=>createClubEvent(i,env));
  }
  const birthdayId=String(i.data?.custom_id||"");
  if(i.type===3&&birthdayId==="syndicate_birthday_register"){
   try{return await birthdayRegisterButton(i,env)}catch(e){console.error("birthday register button",e);return reply("Birthday service is temporarily unavailable. Please try again.")}
  }
  if(i.type===3&&birthdayId==="syndicate_birthday_change"){
   try{return await birthdayChangeButton(i,env)}catch(e){console.error("birthday change button",e);return reply("Birthday service is temporarily unavailable. Please try again.")}
  }
  if(i.type===3&&birthdayId==="syndicate_birthday_remove")return delayedReply(i,env,ctx,()=>birthdayRemoveButton(i,env));
  if(i.type===5&&birthdayId==="syndicate_birthday_modal")return delayedReply(i,env,ctx,()=>birthdayModalSubmit(i,env));
  if(needsBetaAccess(i)&&!hasVipAccess(i))return reply("🔒 The VIP role is required to access Syndicate Hub keys. Use the hub’s Discord invite or ask staff for help.");
  if(!env.DB)return reply("The bot database is temporarily unavailable.");
   ctx.waitUntil(ensurePremiumChannelAndRemoveCommands(env).catch(e=>console.error("premium command setup",String(e))));
  try {
   if(i.type===3&&i.data?.custom_id?.startsWith("birthday_celebrate:"))return delayedReply(i,env,ctx,()=>birthdayCelebrationInteraction(i,env));
   if(i.type===3&&i.data?.custom_id?.startsWith("welcome_wave:"))return delayedReply(i,env,ctx,()=>welcomeWaveInteraction(i,env));
   if(i.type===3&&["long_intro_open","intro_studio_open"].includes(i.data?.custom_id))return delayedReply(i,env,ctx,()=>introHome(i,env));
   if(i.type===3&&i.data?.custom_id?.startsWith("intro_edit:"))return await introModal(i,env,i.data.custom_id.slice(11));
   if(i.type===3&&i.data?.custom_id==="intro_pet_open")return introPhotoModal();
   if(i.type===3&&i.data?.custom_id==="intro_preview")return delayedReply(i,env,ctx,()=>introPreview(i,env));
   if(i.type===3&&i.data?.custom_id==="intro_publish")return delayedReply(i,env,ctx,()=>introPublish(i,env));
   if(i.type===3&&i.data?.custom_id==="intro_reset")return delayedReply(i,env,ctx,()=>introReset(i,env));
   if(i.type===5&&i.data?.custom_id?.startsWith("intro_save:"))return delayedReply(i,env,ctx,()=>introSave(i,env,i.data.custom_id.slice(11)));
   if(i.type===5&&i.data?.custom_id==="intro_pet_submit")return delayedReply(i,env,ctx,()=>introPetSubmit(i,env));
   if(i.type===5&&i.data?.custom_id==="long_intro_submit")return delayedReply(i,env,ctx,()=>submitLongIntro(i,env));
   if(i.type===3&&i.data?.custom_id?.startsWith("club_event_end:")){
    const eventId=String(i.data.custom_id.slice("club_event_end:".length));
    if(!/^[A-Za-z0-9_-]{1,60}$/.test(eventId))return reply("Invalid event.");
    return delayedReply(i,env,ctx,()=>endClubEvent(i,env,eventId));
   }
   if(i.type===3&&i.data?.custom_id?.startsWith("club_event_join:")){const eventId=String(i.data.custom_id.slice("club_event_join:".length));if(!/^[A-Za-z0-9_-]{1,60}$/.test(eventId))return reply("Invalid event sign-up button.");return delayedReply(i,env,ctx,()=>joinClubEvent(i,env,eventId));}
   if(i.type===3&&i.data?.custom_id?.startsWith("club_event_view:")){const match=/^club_event_view:([A-Za-z0-9_-]{1,60})(?::([0-9]{1,4}))?$/.exec(i.data.custom_id);if(!match)return reply("Invalid participant-list button.");return delayedReply(i,env,ctx,()=>viewClubEventParticipants(i,env,match[1],Number(match[2]||0)));}
   if(i.type===3&&i.data?.custom_id?.startsWith("syndicate_executor_"))return executorPlatformInteraction(i,env,ctx);
   if(i.type===3&&i.data?.custom_id?.startsWith("syndicate_platform_"))return delayedReply(i,env,ctx,()=>togglePlatformRole(i,env));
   if(i.type===3&&i.data?.custom_id?.startsWith("mg_"))return discordResponse(await deferredManagement(i,env,ctx));
   if(i.type===5&&i.data?.custom_id==="mg_revoke_modal")return discordResponse(await managementModal(i));
   if(i.type===3&&i.data?.custom_id==="syndicate_premium_ticket")return delayedReply(i,env,ctx,()=>createPremiumTicket(i,env));
   if(i.type===3&&i.data?.custom_id==="syndicate_premium_payment_select")return deferredComponentWork(i,env,ctx,()=>selectPremiumPayment(i,env),true);
   if(i.type===3&&i.data?.custom_id==="syndicate_premium_ticket_close")return discordResponse(confirmPremiumTicketClose());
   if(i.type===3&&i.data?.custom_id==="syndicate_premium_ticket_cancel_close")return reply("Your ticket is still open.");
   if(i.type===3&&i.data?.custom_id==="syndicate_premium_ticket_confirm_close")return delayedReply(i,env,ctx,()=>archivePremiumTicket(i,env));
   if(i.type===3&&i.data?.custom_id==="syndicate_free_generate"){const did=i.member?.user?.id;if(!did)return reply("Discord member unavailable.");const active=await interactionBounded(env.DB.prepare("SELECT 1 FROM discord_key_issuance d JOIN member_keys m ON m.key_hash=d.key_hash WHERE d.discord_user_id=? AND d.guild_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(did,GUILD_ID,new Date().toISOString()).first());return active?delayedReply(i,env,ctx,()=>viewKey(i,env)):freeModal();}
   if(i.type===3&&i.data?.custom_id==="syndicate_free_view")return delayedReply(i,env,ctx,()=>viewKey(i,env));
   if(i.type===5&&i.data?.custom_id==="syndicate_free_modal"){const id=i.data.components?.flatMap(x=>x.components||[]).find(x=>x.custom_id==="roblox_id")?.value;return delayedReply(i,env,ctx,()=>freeAccessKey(i,env,id,ctx));}
   if(i.type===3&&i.data?.custom_id==="syndicate_generate_key"){
    const did=i.member?.user?.id;
    if(!did)return reply("Discord member information unavailable.");
    const active=await interactionBounded(env.DB.prepare("SELECT 1 FROM discord_key_issuance d JOIN member_keys m ON m.key_hash=d.key_hash WHERE d.discord_user_id=? AND d.guild_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(did,GUILD_ID,new Date().toISOString()).first());
    if(!active)return modal(i);
    return delayedReply(i,env,ctx,()=>viewKey(i,env));
   }
   if(i.type===3&&i.data?.custom_id==="syndicate_revoke_own_key")return confirmOwnRevoke();
   if(i.type===3&&i.data?.custom_id==="syndicate_confirm_self_revoke")return delayedReply(i,env,ctx,()=>revokeOwnKey(i,env,ctx));
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


