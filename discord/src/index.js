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
async function viewKey(i,env){
 const did=i.member?.user?.id;if(!did)return reply("Discord member information unavailable.");
 const row=await env.DB.prepare("SELECT m.key_hash,m.key_prefix,m.user_id,v.cipher,v.iv FROM discord_key_issuance d JOIN member_keys m ON d.key_hash=m.key_hash LEFT JOIN discord_key_vault v ON v.key_hash=m.key_hash WHERE d.discord_user_id=? AND d.guild_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) ORDER BY d.issued_at DESC LIMIT 1").bind(did,GUILD_ID,new Date().toISOString()).first();
 if(!row)return modal();
 
 if(!row.cipher)return reply("🔑 You have an active key for Roblox ID `"+row.user_id+"` (prefix `"+row.key_prefix+"`). It predates secure key retrieval, so the full key cannot be recovered from its hash. **Your existing key remains active and unchanged.** Please use your original copy or contact an administrator.");
 try{const plain=new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(row.iv)},await cipherKey(env),unb64(row.cipher)));if(await env.KEY_ISSUER.hashKey(plain)!==row.key_hash)throw Error("hash mismatch");return reply("🔑 **Your Existing Syndicate Hub Key**\nRoblox ID: `"+row.user_id+"`\n**Copy:**\n```text\n"+plain+"\n```\n**Mobile — long press:** `"+plain+"`\nKeep it private.");}catch(e){console.error("key vault",e);return reply("Your key is active, but retrieval failed. It has not been changed.");}
}

async function getkey(i,env,overrideId,ctx) {
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
  const content=e.event_type==="hub_notification_test"
   ?"✅ **Syndicate Hub execution notifications enabled.** Successful script launches will appear in this channel."
   :"🚀 **Syndicate Hub executed** • Roblox ID `"+e.roblox_user_id+"` • <https://www.roblox.com/users/"+e.roblox_user_id+"/profile> • <t:"+Math.floor(Date.parse(e.created_at)/1000)+":F>";
  const r=await fetch("https://discord.com/api/v10/channels/"+channel+"/messages",{method:"POST",headers:{"Authorization":"Bot "+env.DISCORD_BOT_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({content,allowed_mentions:{parse:[]},nonce:String(e.id),enforce_nonce:true}),signal:AbortSignal.timeout(10000)});
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
 return reply(rows.length?"🔑 **Active Syndicate Hub members**\n"+rows.map(x=>"• **"+x.username+"** • Roblox ID `"+x.user_id+"` • "+(x.expires_at?"Expires <t:"+Math.floor(Date.parse(x.expires_at)/1000)+":R>":"Lifetime access")).join("\n"):"No active keys.");
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
function modal(){return new Response(JSON.stringify({type:9,data:{custom_id:"syndicate_key_modal",title:"Generate Syndicate Hub Key",components:[{type:1,components:[{type:4,custom_id:"roblox_id",label:"Roblox Username or User ID",style:1,min_length:1,max_length:20,required:true,placeholder:"Username (not display name) or numeric ID"}]}]}}),{headers:{"content-type":"application/json"}})}
async function postPanel(i,env){
 const channel=i.channel_id;
 if(!channel)return reply("No channel found.");
 const payload={embeds:[{title:"🔑 SYNDICATE HUB | KEY ACCESS",description:"**Unlock Your Lifetime Access**\n\nClick **View Key** to privately retrieve your active key. If you do not have one, enter your Roblox username or User ID to generate one.\n\n**One active key per member and Roblox ID.** Your key will only be shown to you.",color:8073395,footer:{text:"Syndicate Hub • Private key delivery"}}],components:[{type:1,components:[{type:2,style:1,label:"View Key",custom_id:"syndicate_generate_key",emoji:{name:"🔑"}},{type:2,style:2,label:"Get Script",custom_id:"syndicate_get_script",emoji:{name:"📜"}},{type:2,style:4,label:"Revoke My Key",custom_id:"syndicate_revoke_own_key",emoji:{name:"🚫"}}]}]};
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

export default {
 async scheduled(event,env,ctx){
  if(!env.DISCORD_BOT_TOKEN)return;
  try{await sendExecutionLogs(env)}catch(e){console.error("execution logging",e)}
  try{await managementPost(env)}catch(e){console.error("management panel",e)}
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
   if(i.type===3&&i.data?.custom_id==="syndicate_generate_key"){
    const did=i.member?.user?.id;
    if(!did)return reply("Discord member information unavailable.");
    const active=await env.DB.prepare("SELECT 1 FROM discord_key_issuance d JOIN member_keys m ON m.key_hash=d.key_hash WHERE d.discord_user_id=? AND d.guild_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(did,GUILD_ID,new Date().toISOString()).first();
    if(!active)return modal();
    return delayedReply(i,env,ctx,()=>viewKey(i,env));
   }
   if(i.type===3&&i.data?.custom_id==="syndicate_revoke_own_key")return confirmOwnRevoke();
   if(i.type===3&&i.data?.custom_id==="syndicate_confirm_self_revoke")return await revokeOwnKey(i,env,ctx);
   if(i.type===3&&i.data?.custom_id==="syndicate_cancel_self_revoke")return reply("Cancelled. Your key is still active.");
   if(i.type===3&&i.data?.custom_id==="syndicate_get_script")return reply("📜 **Syndicate Hub — Get Script**\n\n**Desktop — copy from code block:**\n```lua\nloadstring(game:HttpGet(\"https://raw.githubusercontent.com/ThatOneThing91/Syndicate-Hub/main/StorageHunters\"))()\n```\n**📱 Mobile — press and hold to copy this separate line:**\n`loadstring(game:HttpGet(\"https://raw.githubusercontent.com/ThatOneThing91/Syndicate-Hub/main/StorageHunters\"))()`\n\nBoth options run the same script. An active member key is required.");
   if(i.type===5&&i.data?.custom_id==="syndicate_key_modal"){
    const id=i.data.components?.flatMap(x=>x.components||[]).find(x=>x.custom_id==="roblox_id")?.value;
    return delayedReply(i,env,ctx,()=>getkey(i,env,id,ctx));
   }
   switch(i.data?.name){
    case "getkey":return delayedReply(i,env,ctx,()=>getkey(i,env,undefined,ctx));
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
