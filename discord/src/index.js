const COMMANDS=[
 {name:"getkey",description:"Get your lifetime Syndicate Hub key",options:[{type:3,name:"roblox_id",description:"Your numeric Roblox User ID",required:true}]},
 {name:"keys",description:"List active Syndicate Hub keys (admins only)",default_member_permissions:"8"},
 {name:"panel",description:"Post the permanent key generation panel (admins only)",default_member_permissions:"8"},
 {name:"revoke",description:"Revoke a Roblox User ID's key (admins only)",default_member_permissions:"8",options:[{type:3,name:"roblox_id",description:"Roblox User ID to revoke",required:true}]}
];
// Syndicate Hub Discord interactions Worker. Deploy separately with D1 binding DB,
// KEY_PEPPER secret, DISCORD_BOT_TOKEN secret and the public key below.
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
 const r=await fetch("https://users.roblox.com/v1/usernames/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({usernames:[value],excludeBannedUsers:false}),signal:AbortSignal.timeout(2500)});
 if(!r.ok)throw new Error("Roblox lookup HTTP "+r.status);
 const data=await r.json();
 const account=data?.data?.[0];
 if(!account?.id||!isUserId(String(account.id)))return null;
 return {id:String(account.id),name:account.name};
}
async function getkey(i,env,overrideId) {
 const discordId=i.member?.user?.id;
 const input=String(overrideId||i.data?.options?.find(o=>o.name==="roblox_id")?.value||"");
 if(!discordId)return reply("Discord member information was unavailable.");
 let account;
 try{account=await resolveRobloxAccount(input)}catch(e){console.error("Roblox lookup",e);return reply("❌ Roblox username lookup is temporarily unavailable. Please try your numeric Roblox User ID instead.")}
 if(!account)return reply("❌ Roblox account not found. Enter the exact **username** (not display name) or your numeric Roblox User ID.");
 const robloxId=account.id;
 const active=await env.DB.prepare("SELECT key_prefix FROM member_keys WHERE user_id=? AND revoked=0 AND (expires_at IS NULL OR expires_at>?) LIMIT 1").bind(robloxId,new Date().toISOString()).first();
 if(active)return reply("❌ An active key already exists for Roblox ID `"+robloxId+"`. Contact an administrator to revoke it before requesting another.");
 const existing=await env.DB.prepare("SELECT 1 FROM discord_key_issuance d JOIN member_keys m ON d.key_hash=m.key_hash WHERE d.discord_user_id=? AND m.revoked=0 AND (m.expires_at IS NULL OR m.expires_at>?) LIMIT 1").bind(discordId,new Date().toISOString()).first();
 if(existing)return reply("❌ Your Discord account already has an active Syndicate Hub key.");
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 const hex=[...bytes].map(x=>x.toString(16).padStart(2,"0").toUpperCase()).join("");
 const key="SYND-"+hex.match(/.{8}/g).join("-");
 const digest=await sha(env.KEY_PEPPER+":"+key);
 const now=new Date().toISOString();
 try {
  await env.DB.batch([
   env.DB.prepare("INSERT INTO member_keys(key_hash,key_prefix,user_id,expires_at,revoked,created_at) VALUES(?,?,?,NULL,0,?)").bind(digest,key.slice(0,13),robloxId,now),
   env.DB.prepare("INSERT INTO discord_key_issuance(discord_user_id,guild_id,roblox_user_id,key_hash,issued_at,expires_at) VALUES(?,?,?,?,?,?)").bind(discordId,GUILD_ID,robloxId,digest,now,"LIFETIME")
  ]);
 }catch(e){console.error("issue",e);return reply("❌ Could not generate a key. An active key may already exist. Try again or contact an administrator.")}
 await audit(env,"key_issued",robloxId);
 await discordLog(env,"KEY_LOG_CHANNEL_ID","🔑 Lifetime key issued • Discord <@"+discordId+"> • Roblox `"+robloxId+"` • Prefix `"+key.slice(0,13)+"`");
 return reply("🔑 **Syndicate Hub Lifetime Key**\nRoblox ID: `"+robloxId+"`"+(account.name?"\nUsername: `"+account.name+"`":"")+"\nKey: `"+key+"`\n**Keep this key private.** It remains valid until revoked.");
}
async function listKeys(env) {
 const r=await env.DB.prepare("SELECT key_prefix,user_id,created_at FROM member_keys WHERE revoked=0 AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT 15").bind(new Date().toISOString()).all();
 const rows=r.results||[];
 return reply(rows.length?"**Active Syndicate Hub keys**\n"+rows.map(x=>"• Roblox `"+x.user_id+"` • `"+x.key_prefix+"…`").join("\n"):"No active keys.");
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
function modal(){return new Response(JSON.stringify({type:9,data:{custom_id:"syndicate_key_modal",title:"Generate Syndicate Hub Key",components:[{type:1,components:[{type:4,custom_id:"roblox_id",label:"Roblox Username or User ID",style:1,min_length:1,max_length:20,required:true,placeholder:"Username (not display name) or numeric ID"}]}]}}),{headers:{"content-type":"application/json"}})}
async function postPanel(i,env){
 const channel=i.channel_id;
 if(!channel)return reply("No channel found.");
 const payload={embeds:[{title:"🔑 SYNDICATE HUB | KEY ACCESS",description:"**Unlock Your Lifetime Access**\n\nClick the button below to generate your personal Syndicate Hub key. Enter your **Roblox username** (not display name) or numeric User ID.\n\n**One active key per member and Roblox ID.** Your key will only be shown to you.",color:8073395,footer:{text:"Syndicate Hub • Private key delivery"}}],components:[{type:1,components:[{type:2,style:1,label:"Generate My Key",custom_id:"syndicate_generate_key",emoji:{name:"🔑"}}]}]};
 const r=await fetch("https://discord.com/api/v10/channels/"+channel+"/messages",{method:"POST",headers:{"Authorization":"Bot "+env.DISCORD_BOT_TOKEN,"Content-Type":"application/json"},body:JSON.stringify(payload)});
 if(!r.ok){console.error("panel",r.status,(await r.text()).slice(0,500));return reply("Could not post panel. Check bot permissions: View Channel, Send Messages, Embed Links.")}
 return reply("✅ Key-generation panel posted in this channel.");
}
export default {
 async scheduled(event,env,ctx){
  if(!env.DISCORD_BOT_TOKEN)return;
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
 async fetch(req,env) {
  const url=new URL(req.url);
  if(req.method==="GET"&&url.pathname==="/health")return new Response(JSON.stringify({ok:true,app:APPLICATION_ID}),{headers:{"content-type":"application/json"}});
  if(req.method!=="POST"||url.pathname!=="/discord/interactions")return new Response("Not found",{status:404});
  const raw=await req.text();
  if(!await validSignature(req,raw))return new Response("Invalid Discord signature",{status:401});
  let i;try{i=JSON.parse(raw)}catch{return new Response("Invalid JSON",{status:400})}
  if(i.type===1)return new Response(JSON.stringify({type:1}),{headers:{"content-type":"application/json"}});
  if(![2,3,5].includes(i.type)||i.guild_id!==GUILD_ID)return reply("This bot is only available in the Syndicate Hub server.");
  if(!env.DB||!env.KEY_PEPPER)return reply("Authentication database is not configured.");
  try {
   if(i.type===3&&i.data?.custom_id==="syndicate_generate_key")return modal();
   if(i.type===5&&i.data?.custom_id==="syndicate_key_modal"){
    const id=i.data.components?.flatMap(x=>x.components||[]).find(x=>x.custom_id==="roblox_id")?.value;
    return await getkey(i,env,id);
   }
   switch(i.data?.name){
    case "getkey":return await getkey(i,env);
    case "panel":return isAdmin(i)?await postPanel(i,env):reply("Administrator permission required.");
    case "keys":return isAdmin(i)?await listKeys(env):reply("Administrator permission required.");
    case "revoke":return isAdmin(i)?await revoke(i,env):reply("Administrator permission required.");
    default:return reply("Unknown command.");
   }
  }catch(e){console.error("interaction",e);return reply("An internal error occurred. Please try again.")}
 }
};
