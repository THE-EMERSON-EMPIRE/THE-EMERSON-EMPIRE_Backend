'use strict';
const {spawn,spawnSync} = require('node:child_process');
const net = require('node:net');
const C = require('./common.cjs');
const {fs,path,crypto,state,workspace,core,configFile,baselineFile,checksum,config,cleanEnv,client,preflight,mailHeaders,runtimeEnv} = C;
const pgBin = path.join(workspace, '.tools/postgresql-17.11/pgsql/bin');
const mailpit = path.join(workspace, '.tools/mailpit-v1.31.6/mailpit.exe');
const node = path.join(workspace, '.tools/node-v22.23.1-win-x64/node.exe');
const data = path.join(state, 'postgres');
function run(exe, args, env = cleanEnv()) {
  // Windows postgres inherits pg_ctl handles. Never give that daemon a captured pipe.
  const daemonControl=path.basename(exe).toLowerCase()==='pg_ctl.exe';
  const r = spawnSync(exe, args, {env,cwd:core,windowsHide:true,encoding:'utf8',...(daemonControl?{stdio:'ignore'}:{})});
  if (r.error || r.status !== 0) throw new Error(`${path.basename(exe)} failed; inspect local logs`);
  return r.stdout || '';
}
function restrictDirectory() {
  const sid = run('powershell.exe', ['-NoProfile','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value']).trim();
  run('icacls.exe', [state,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F']);
}
const pgRunning = () => spawnSync(path.join(pgBin,'pg_ctl.exe'),['-D',data,'status'],{env:cleanEnv(),windowsHide:true,stdio:'ignore'}).status === 0;
function startPg() {
  if (!pgRunning()) run(path.join(pgBin,'pg_ctl.exe'),['-D',data,'-l',path.join(state,'postgres.log'),'-w','start']);
}
async function portFree(port) {
  await new Promise((resolve,reject) => {const server=net.createServer(); server.once('error',()=>reject(new Error(`Local port ${port} is occupied`))); server.listen(port,'127.0.0.1',()=>server.close(resolve));});
}
async function setup() {
  if (fs.existsSync(configFile)) {
    const c=config();
    if(!c.csrfSecret){c.csrfSecret=crypto.randomBytes(36).toString('base64url');fs.writeFileSync(configFile,JSON.stringify(c,null,2));}
    startPg();
    const catalog=await client(c,true,'postgres'); let exists;
    try {
      const {rows:[r]}=await catalog.query("SELECT current_setting('data_directory') AS directory, EXISTS(SELECT 1 FROM pg_database WHERE datname='epdg_synthetic') AS present");
      if(path.resolve(r.directory).toLowerCase()!==path.resolve(data).toLowerCase())throw new Error('Unexpected local cluster directory');
      exists=r.present;
    }finally{await catalog.end();}
    if(!exists)await initializeDatabase(c);
    else {
      const db=await client(c,true);let empty;
      try {const {rows:[r]}=await db.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");empty=r.count===0;}finally{await db.end();}
      if(empty)await initializeSchema(c);
    }
    await applyIsolation(c); await preflight(c); console.log('Existing synthetic instance verified; baseline and fixtures preserved.'); return;
  }
  await portFree(55432);
  fs.mkdirSync(state,{recursive:true}); restrictDirectory();
  const secret=()=>crypto.randomBytes(36).toString('base64url');
  const c={instanceId:crypto.randomUUID(),adminPassword:secret(),appPassword:secret(),jwtSecret:secret(),certificateSecret:secret(),mailPassword:secret(),fixturePassword:secret(),csrfSecret:secret()};
  // No environment imported from production; local state is excluded from Git and ACL restricted.
  fs.writeFileSync(configFile,JSON.stringify(c,null,2));
  const pwFile=path.join(state,'init-password.txt'); fs.writeFileSync(pwFile,c.adminPassword);
  try {run(path.join(pgBin,'initdb.exe'),['-D',data,'-U','epdg_synthetic_operator','--encoding=UTF8','--locale=C','--auth=scram-sha-256',`--pwfile=${pwFile}`]);}
  finally {fs.unlinkSync(pwFile);}
  fs.appendFileSync(path.join(data,'postgresql.conf'),"\nlisten_addresses = '127.0.0.1'\nport = 55432\npassword_encryption = 'scram-sha-256'\n");
  fs.writeFileSync(path.join(data,'pg_hba.conf'),'host epdg_synthetic epdg_synthetic_app 127.0.0.1/32 scram-sha-256\nhost all epdg_synthetic_operator 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n');
  startPg();
  await initializeDatabase(c);
  await applyIsolation(c); await preflight(c);
}
async function initializeDatabase(c) {
  const admin = await client(c,true,'postgres');
  try {
    await admin.query(`CREATE ROLE epdg_synthetic_app LOGIN PASSWORD '${c.appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS`);
    await admin.query('CREATE DATABASE epdg_synthetic');
    await admin.query('REVOKE ALL ON DATABASE epdg_synthetic FROM PUBLIC');
    await admin.query('GRANT CONNECT ON DATABASE epdg_synthetic TO epdg_synthetic_app');
  } finally {await admin.end();}
  await initializeSchema(c);
}
async function initializeSchema(c) {
  const db=await client(c,true);
  try {
    await db.query('BEGIN');
    const {rows:[{count}]}=await db.query("SELECT count(*)::int FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");
    if(count!==0)throw new Error('Baseline requires a brand-new empty database');
    await db.query(fs.readFileSync(baselineFile,'utf8'));
    await db.query('CREATE SCHEMA synthetic_meta; REVOKE ALL ON SCHEMA synthetic_meta FROM PUBLIC; CREATE TABLE synthetic_meta.identity(instance_id uuid PRIMARY KEY,baseline_sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()); GRANT USAGE ON SCHEMA synthetic_meta TO epdg_synthetic_app; GRANT SELECT ON synthetic_meta.identity TO epdg_synthetic_app;');
    await db.query('INSERT INTO synthetic_meta.identity(instance_id,baseline_sha256) VALUES($1,$2)',[c.instanceId,checksum()]);
    const {rows:tables}=await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('core','epdg','public','private') ORDER BY 1,2");
    let total=0;
    for(const t of tables){const r=await db.query(`SELECT count(*)::int AS count FROM "${t.schemaname}"."${t.tablename}"`);total+=r.rows[0].count;}
    if(tables.length!==50 || total!==0)throw new Error('Schema-only zero-row assertion failed');
    await db.query('COMMIT');
    fs.writeFileSync(path.join(state,'empty-baseline.receipt.json'),JSON.stringify({verifiedAt:new Date().toISOString(),instanceId:c.instanceId,baselineSha256:checksum(),applicationTables:50,applicationRowsBeforeSeed:0,productionDataCopied:false,storageProvisioned:false},null,2));
    console.log('Schema-only baseline created: 50 empty application tables; zero rows.');
  } catch(e){await db.query('ROLLBACK'); throw e;} finally {await db.end();}
}
async function applyIsolation(c) {
  const db=await client(c,true);
  try {
    await db.query('BEGIN');
    const {rows:[m]}=await db.query('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port, instance_id::text, baseline_sha256 FROM synthetic_meta.identity');
    if(m.db!=='epdg_synthetic'||m.host!=='127.0.0.1'||m.port!==55432||m.instance_id!==c.instanceId||m.baseline_sha256!==checksum())throw new Error('Local DDL identity gate failed');
    await db.query(fs.readFileSync(path.join(__dirname,'isolation.sql'),'utf8'));
    await db.query('ALTER TABLE synthetic_meta.identity ADD COLUMN IF NOT EXISTS isolation_sha256 text');
    await db.query('UPDATE synthetic_meta.identity SET isolation_sha256=$1 WHERE instance_id=$2',[C.isolationChecksum(),c.instanceId]);
    await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
}
async function isReady(url, headers) {
  try {return (await fetch(url,{headers,signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}
}
async function waitReady(url,headers) {
  for(let i=0;i<40;i++){if(await isReady(url,headers))return; await new Promise(r=>setTimeout(r,250));}
  throw new Error('Local service readiness timed out');
}
function background(exe,args,env,logName){
  const log=fs.openSync(path.join(state,logName),'a');
  const child=spawn(exe,args,{env,cwd:core,detached:true,windowsHide:true,stdio:['ignore',log,log]});
  child.unref(); fs.closeSync(log); return child.pid;
}
async function start() {
  const c=config(); startPg(); await preflight(c);
  const pids={};
  if(!await isReady('http://127.0.0.1:58025/api/v1/messages',mailHeaders(c))){
    await portFree(58025); await portFree(51025);
    const bcrypt=require('bcrypt'); const auth=path.join(state,'mailpit-auth.txt');
    fs.writeFileSync(auth,'synthetic-reviewer:'+await bcrypt.hash(c.mailPassword,12)+'\n');
    pids.mailpit=background(mailpit,['--listen','127.0.0.1:58025','--smtp','127.0.0.1:51025',
      '--allowed-hosts','127.0.0.1,127.0.0.1:58025','--ui-auth-file',auth,
      '--database',path.join(state,'mailpit.db'),'--max','50','--max-age','24h',
      '--smtp-allowed-recipients','(?i)^[a-z0-9._+-]+@[a-z0-9.-]+\\.invalid$',
      '--smtp-disable-rdns','--disable-version-check','--block-remote-css-and-fonts','--quiet'],
      {...cleanEnv(),HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1'},'mailpit.log');
    await waitReady('http://127.0.0.1:58025/api/v1/messages',mailHeaders(c));
  }
  if(!await isReady('http://127.0.0.1:58000/health')){
    await portFree(58000);
    pids.backend=background(node,[path.join(__dirname,'serve.cjs')],runtimeEnv(c),'backend.log');
    await waitReady('http://127.0.0.1:58000/health');
  }
  const oldFile=path.join(state,'pids.json');const old=fs.existsSync(oldFile)?JSON.parse(fs.readFileSync(oldFile)):{};
  fs.writeFileSync(oldFile,JSON.stringify({...old,...pids}));
  console.log('Local backend and authenticated Mailpit are ready; all listeners use 127.0.0.1.');
}
async function stop(){
  const pidFile=path.join(state,'pids.json');
  if(fs.existsSync(pidFile)){
    // Validate each PID executable before stopping it; never kill unrelated listeners.
    for(const [kind,pid] of Object.entries(JSON.parse(fs.readFileSync(pidFile)))){
      if(!Number.isInteger(pid))throw new Error('Invalid recorded PID');
      const expected=kind==='mailpit'?mailpit:node;
      const raw=run('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress`]).trim();
      if(!raw)continue;
      const actual=JSON.parse(raw);
      const marker=kind==='mailpit'?path.join(state,'mailpit.db'):path.join(__dirname,'serve.cjs');
      const normalized=s=>s.replaceAll('\\','/').toLowerCase();
      if(actual.ExecutablePath.toLowerCase()!==expected.toLowerCase() || !normalized(actual.CommandLine).includes(normalized(marker)))throw new Error('PID executable or command changed; stop refused');
      process.kill(pid);
    }
    fs.unlinkSync(pidFile);
  }
  if(pgRunning())run(path.join(pgBin,'pg_ctl.exe'),['-D',data,'-m','fast','-w','stop']);
  console.log('Only this local synthetic stack stopped; data retained.');
}
async function main(){
  if(process.platform!=='win32')throw new Error('This launcher is configured for the inspected Windows workspace');
  const command=process.argv[2];
  if(command==='setup')return setup();
  if(command==='start')return start();
  if(command==='security-migrate'){startPg();return require('./security-migrate.cjs').migrate();}
  if(command==='security-seed')return require('./security-seed.cjs').seed();
  if(command==='learning-migrate'){startPg();return require('./learning-migrate.cjs').migrate();}
  if(command==='learning-seed')return require('./learning-seed.cjs').seed();
  if(command==='mentor-seed')return require('./mentor-seed.cjs').seed();
  if(command==='stop')return stop();
  if(command==='verify')return require('./security-verify.cjs').verify();
  if(command==='status'){await preflight(config());console.log(JSON.stringify({database:'verified',backend:await isReady('http://127.0.0.1:58000/health'),mailpit:await isReady('http://127.0.0.1:58025/api/v1/messages',mailHeaders(config()))}));return;}
  throw new Error('Use setup, start, verify, status, or stop');
}
main().catch(e=>{console.error('Synthetic stack command failed:',e.message.replace(/password[^ ]*/gi,'[redacted]'));process.exit(1);});
