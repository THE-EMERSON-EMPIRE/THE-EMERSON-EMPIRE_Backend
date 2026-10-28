'use strict';
// Opt-in private operator HTTP acceptance. Never imported by API or bootstrap startup.
const https=require('node:https'),crypto=require('node:crypto');
const {Client}=require('pg');
const profile=require('../../src/hosted-practice/supabase-profile.json');
const {environment}=require('./bootstrap-supabase.cjs');
const {supabaseDatabaseConnection}=require('../../dist/hosted-practice/profile.js');
const {initializeSupabaseSession}=require('../../dist/db/supabase-session.js');
const email='learner-a@epdg.invalid',cookieName='__Host-epdg_session';
const paths=new Set(['/api/auth/login','/api/auth/session','/api/auth/logout','/api/auth/forgot-password','/api/auth/reset-password','/api/auth/change-password']);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const validToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const need=condition=>{if(!condition)throw new Error('Private recovery acceptance check failed');};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function requestJson({origin,path,method='GET',body,session,portalOrigin}){
 need(origin===profile.backendOrigin&&portalOrigin===profile.frontendOrigin&&paths.has(path));
 const url=new URL(origin+path);need(url.protocol==='https:'&&!url.username&&!url.password&&!url.port);
 const payload=body===undefined?null:Buffer.from(JSON.stringify(body));need(!payload||payload.length<=16384);
 return new Promise((resolve,reject)=>{
  const headers={Origin:portalOrigin,'X-EPDG-Request':'portal','X-Forwarded-Proto':'https'};
  if(payload)Object.assign(headers,{'Content-Type':'application/json','Content-Length':payload.length});
  if(session)Object.assign(headers,{Cookie:session.cookie,'X-CSRF-Token':session.csrf});
  const req=https.request(url,{method,headers,agent:false,rejectUnauthorized:true,servername:url.hostname},res=>{
   const chunks=[];let size=0;
   res.on('data',chunk=>{size+=chunk.length;if(size>65536){req.destroy(new Error('Private recovery response is unavailable'));return;}chunks.push(chunk);});
   res.on('error',()=>reject(new Error('Private recovery response is unavailable')));
   res.on('end',()=>{try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}
    catch{reject(new Error('Private recovery response is unavailable'));}});
  });
  req.setTimeout(10000,()=>req.destroy(new Error('Private recovery request timed out')));
  req.on('error',()=>reject(new Error('Private recovery request is unavailable')));req.end(payload);
 });
}
function envelope(response,status){
 need(response.status===status&&response.body&&response.body.environment==='synthetic-hosted'&&response.body.privileged_controls_available===false);
 return response.body;
}
function loginSession(response){
 const body=envelope(response,200);
 need(body.success===true&&body.user?.email===email&&body.user?.legacy_role==='intern'&&body.user?.privileged_controls_available===false&&
  Array.isArray(body.user?.permissions)&&body.user.permissions.length===0&&validToken(body.csrf_token));
 const cookies=response.headers?.['set-cookie'];need(Array.isArray(cookies));
 const matches=cookies.filter(value=>typeof value==='string'&&value.startsWith(cookieName+'='));need(matches.length===1);
 const parts=matches[0].split(';').map(v=>v.trim()),raw=parts[0].slice(cookieName.length+1);
 need(validToken(raw)&&parts.some(v=>/^Secure$/i.test(v))&&parts.some(v=>/^HttpOnly$/i.test(v))&&
  parts.some(v=>/^SameSite=Strict$/i.test(v))&&parts.some(v=>/^Path=\/$/i.test(v))&&!parts.some(v=>/^Domain=/i.test(v)));
 return {cookie:parts[0],csrf:body.csrf_token,raw};
}
function captureToken(row){
 need(row?.recipient===email&&row.from_address==='EPDG Synthetic <no-reply@epdg.invalid>'&&row.subject==='EPDG portal password recovery'&&
  typeof row.html==='string'&&Buffer.byteLength(row.html)<=16384&&row.html.includes('This link expires in 20 minutes.'));
 const links=[...row.html.matchAll(/href="([^"]+)"/g)];need(links.length===1);
 const link=new URL(links[0][1]);need(link.origin===profile.frontendOrigin&&link.pathname==='/reset-password'&&!link.search&&!link.username&&!link.password);
 const token=link.hash.slice('#token='.length);need(link.hash==='#token='+token&&validToken(token)&&
  links[0][1]===profile.frontendOrigin+'/reset-password#token='+token);return token;
}

async function acceptRecovery({env=process.env,ClientCtor=Client,requestJson:request=requestJson,sleep=delay}={}){
 const result={success:false,environment:'synthetic-hosted',fixtureRestored:false,passwordResetAttempted:false,sessionBindingVerified:false};
 let stage='configuration',db,secrets,tempPassword,oldSession,tempSession,since,databaseFailed=false;
 const sessions=[];
 const read=async(sql,values=[])=>{need(!databaseFailed&&/^SELECT\b/.test(sql)&&!sql.includes(';'));return (await db.query(sql,values)).rows;};
 const call=(path,method='GET',body,session)=>{need(!databaseFailed||method==='GET'||path==='/api/auth/logout');
  return request({origin:profile.backendOrigin,path,method,body,session,portalOrigin:profile.frontendOrigin});};
 const active=async(session,expected=1)=>{
  const rows=await read(`SELECT /* recovery-acceptance:session */ count(*)::int AS n
   FROM portal_security.sessions s JOIN core.users u ON u.id=s.user_id
   WHERE u.email=$1 AND s.token_hash=$2 AND s.created_at>=$3 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`,[email,hash(session.raw),since]);
  need(rows.length===1&&rows[0].n===expected);
 };
 const login=async(password,optional=false)=>{
  const response=await call('/api/auth/login','POST',{email,password});
  if(optional&&response.status===401){envelope(response,401);return null;}
  const session=loginSession(response);sessions.push(session);await active(session);return session;
 };
 const sessionStatus=async(session,status)=>{envelope(await call('/api/auth/session','GET',undefined,session),status);};
 const logout=async(session)=>{envelope(await call('/api/auth/logout','POST',{},session),200);await sessionStatus(session,401);await active(session,0);};
 const restore=async(known)=>{
  try{
   const current=known??await login(tempPassword,true);
   if(current){await active(current);envelope(await call('/api/auth/change-password','POST',
     {current_password:tempPassword,new_password:secrets.fixturePassword},current),200);
    await sessionStatus(current,401);await active(current,0);}
   const restored=await login(secrets.fixturePassword);await sessionStatus(restored,200);await logout(restored);
   result.fixtureRestored=true;return true;
  }catch{return false;}
 };
 try{
  need(env.EPDG_HOSTED_PRACTICE_RECOVERY_ACCEPTANCE==='1'&&env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!env.NODE_DEBUG&&!env.NODE_DEBUG_NATIVE);
  secrets=environment(env);const endpoint=supabaseDatabaseConnection(profile);
  tempPassword=crypto.randomBytes(32).toString('base64url');need(![secrets.fixturePassword,secrets.appPassword,secrets.adminPassword].includes(tempPassword));
  db=new ClientCtor({host:endpoint.host,port:5432,database:'postgres',user:endpoint.operatorUser,password:secrets.adminPassword,
   ssl:{ca:secrets.ca,rejectUnauthorized:true,servername:endpoint.host},
   options:'-c search_path=pg_catalog,epdg,pg_temp -c default_transaction_read_only=on',connectionTimeoutMillis:10000,statement_timeout:10000});
  db.on?.('error',()=>{databaseFailed=true;});
  await db.connect();stage='database_session';need(!databaseFailed);
  await initializeSupabaseSession(db,{readOnly:true,statementTimeoutMs:10000});need(!databaseFailed);stage='database_identity';
  const rows=await read(`SELECT /* recovery-acceptance:identity */ current_database() AS db,current_user AS role,inet_server_port() AS port,
   (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,current_setting('default_transaction_read_only') AS read_only,
   h.instance_id::text,h.project_id::text,h.environment_id::text,h.service_id::text,h.supabase_project_ref,h.supabase_organization_id,
   h.database_host,h.baseline_sha256,h.isolation_sha256,h.schema_sha256,
   m.instance_id::text AS source_instance,m.provider AS source_provider,m.supabase_project_ref AS source_project_ref,
   m.baseline_sha256 AS source_baseline,m.isolation_sha256 AS source_isolation FROM hosted_practice.identity h CROSS JOIN synthetic_meta.identity m`);
  need(rows.length===1);const identity=rows[0];
  const expected={db:'postgres',role:'postgres',port:5432,tls:true,read_only:'on',instance_id:profile.instanceId,project_id:profile.projectId,
   environment_id:profile.environmentId,service_id:profile.serviceId,supabase_project_ref:profile.supabaseProjectRef,
   supabase_organization_id:profile.supabaseOrganizationId,database_host:profile.databaseHost,baseline_sha256:profile.baselineSha256,
   isolation_sha256:profile.isolationSha256,schema_sha256:profile.isolationSha256,source_instance:profile.instanceId,
   source_provider:'supabase',source_project_ref:profile.supabaseProjectRef,source_baseline:profile.baselineSha256,source_isolation:profile.isolationSha256};
  need(Object.entries(expected).every(([key,value])=>identity[key]===value));
  stage='capture_marker';const marker=await read('SELECT /* recovery-acceptance:capture-marker */ clock_timestamp() AS since,count(*)::int AS n FROM hosted_practice.mail_capture WHERE recipient=$1',[email]);
  need(marker.length===1&&Number.isInteger(marker[0].n)&&marker[0].n>=0&&Number.isFinite(new Date(marker[0].since).getTime()));since=marker[0].since;
  stage='initial_login';oldSession=await login(secrets.fixturePassword);result.sessionBindingVerified=true;
  stage='recovery_request';const generic=envelope(await call('/api/auth/forgot-password','POST',{email}),200);
  need(generic.success===true&&generic.message==='If the account is eligible, recovery instructions will be sent'&&
   Object.keys(generic).sort().join(',')==='environment,message,privileged_controls_available,success');
  stage='capture';let capture;const deadline=Date.now()+10000;
  for(let attempt=0;attempt<20&&Date.now()<deadline;attempt++){
   const captured=await read(`SELECT /* recovery-acceptance:capture */ id::text,from_address,recipient,subject,html,captured_at,
    (SELECT count(*)::int FROM hosted_practice.mail_capture WHERE recipient=$1) AS total
    FROM hosted_practice.mail_capture WHERE recipient=$1 AND captured_at>=$2 ORDER BY captured_at,id LIMIT 2`,[email,since]);
   need(captured.length<=1);if(captured.length===1){need(captured[0].total===marker[0].n+1);capture=captured[0];break;}await sleep(250);
  }
  need(capture);const token=captureToken(capture);stage='token_metadata';
  const tokens=await read(`SELECT /* recovery-acceptance:token */ EXTRACT(EPOCH FROM(t.expires_at-t.created_at))::float8 AS lifetime_seconds,
   (t.consumed_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>clock_timestamp()) AS active
   FROM portal_security.recovery_tokens t JOIN core.users u ON u.id=t.user_id WHERE u.email=$1 AND t.token_hash=$2`,[email,hash(token)]);
  need(tokens.length===1&&tokens[0].active===true&&tokens[0].lifetime_seconds>=1195&&tokens[0].lifetime_seconds<=1205);
  stage='reset';result.passwordResetAttempted=true;
  envelope(await call('/api/auth/reset-password','POST',{token,password:tempPassword}),200);
  stage='old_session_revocation';await sessionStatus(oldSession,401);await active(oldSession,0);
  stage='token_reuse';envelope(await call('/api/auth/reset-password','POST',{token,password:tempPassword}),400);
  stage='temporary_login';tempSession=await login(tempPassword);await sessionStatus(tempSession,200);
  stage='restoration';need(await restore(tempSession));await sessionStatus(oldSession,401);await sessionStatus(tempSession,401);
  result.success=true;
 }catch{result.failure_stage=stage;}
 finally{
  if(result.passwordResetAttempted&&!result.fixtureRestored){if(!await restore())result.restoration_required=true;}
  for(const session of sessions){try{const response=await call('/api/auth/session','GET',undefined,session);if(response.status===200)await logout(session);else envelope(response,401);}catch{result.success=false;result.failure_stage??='session_cleanup';}}
  try{await db?.end();}catch{result.success=false;result.failure_stage??='database_cleanup';}
  if(databaseFailed){result.success=false;result.failure_stage??='database_connection';}
 }
 return result;
}
module.exports={acceptRecovery,requestJson,captureToken};
if(require.main===module)acceptRecovery().then(result=>{console.log(JSON.stringify(result));if(!result.success)process.exitCode=1;})
 .catch(()=>{console.error('Private recovery acceptance is unavailable; no sensitive values logged.');process.exitCode=1;});
