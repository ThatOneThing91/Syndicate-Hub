const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const hash=async(v)=>{const bytes=new TextEncoder().encode(v);const digest=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("")};
const auth=(req,env)=>env.ADMIN_TOKEN&&req.headers.get("authorization")==="Bearer "+env.ADMIN_TOKEN;
const parse=async req=>{try{return await req.json()}catch{return null}};
const userId=v=>typeof v==="string"&&/^[1-9][0-9]{0,19}$/.test(v);
const keyFormat=v=>typeof v==="string"&&/^SYND-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$/.test(v);
const digestKey=(key,env)=>hash(env.KEY_PEPPER+":"+key);
export default {
 async fetch(req,env){
  if(!env.DB||!env.KEY_PEPPER||!env.ADMIN_TOKEN)return json({error:"Server not configured"},503);
  const url=new URL(req.url);
  if(req.method==="GET"&&url.pathname==="/health")return json({ok:true});
  if(req.method==="POST"&&url.pathname==="/verify"){
   const b=await parse(req);
   if(!b||!userId(b.userId)||!keyFormat(b.key))return json({valid:false},400);
   const digest=await digestKey(b.key,env);
   const record=await env.DB.prepare("SELECT user_id,expires_at,revoked FROM member_keys WHERE key_hash=?").bind(digest).first();
   const valid=!!record&&record.user_id===b.userId&&!record.revoked&&(!record.expires_at||Date.parse(record.expires_at)>Date.now());
   return json({valid,expiresAt:valid?record.expires_at:null});
  }
  if(!url.pathname.startsWith("/admin/"))return json({error:"Not found"},404);
  if(!auth(req,env))return json({error:"Unauthorized"},401);
  if(req.method==="POST"&&url.pathname==="/admin/issue"){
   const b=await parse(req);
   if(!b||!userId(b.userId)||!(b.expiresAt===null||b.expiresAt===undefined||(typeof b.expiresAt==="string"&&Number.isFinite(Date.parse(b.expiresAt))&&Date.parse(b.expiresAt)>Date.now())))return json({error:"Invalid userId or expiresAt"},400);
   const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
   const hex=[...bytes].map(x=>x.toString(16).padStart(2,"0").toUpperCase()).join("");
   const key="SYND-"+hex.match(/.{8}/g).join("-");
   await env.DB.prepare("INSERT INTO member_keys(key_hash,key_prefix,user_id,expires_at,revoked,created_at) VALUES(?,?,?,?,0,?)")
    .bind(await digestKey(key,env),key.slice(0,13),b.userId,b.expiresAt||null,new Date().toISOString()).run();
   return json({key,userId:b.userId,expiresAt:b.expiresAt||null},201);
  }
  if(req.method==="POST"&&url.pathname==="/admin/revoke"){
   const b=await parse(req);
   if(!b||!keyFormat(b.key))return json({error:"Invalid key"},400);
   const r=await env.DB.prepare("UPDATE member_keys SET revoked=1 WHERE key_hash=?").bind(await digestKey(b.key,env)).run();
   return json({revoked:(r.meta?.changes||0)>0});
  }
  if(req.method==="GET"&&url.pathname==="/admin/keys"){
   const r=await env.DB.prepare("SELECT key_prefix,user_id,expires_at,revoked,created_at FROM member_keys ORDER BY created_at DESC LIMIT 500").all();
   return json({keys:r.results});
  }
  return json({error:"Not found"},404);
 }
};
