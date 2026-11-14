'use strict';
// Explicit operator command only. Application startup never imports this file.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Client}=require('pg');
const core=path.resolve(__dirname,'../..');
const migrations=[
 ['access-migrations','security/access-schema-manifest.json','portal_access'],
 ['account-migrations','security/account-schema-manifest.json','portal_accounts'],
 ['portable-learning-migrations','learning/portable-schema-manifest.json','portal_learning']
];
function entries(){return migrations.map(([folder,manifestFile,schema])=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(core,'src',manifestFile),'utf8'));
 const sql=fs.readFileSync(path.join(core,folder,manifest.file),'utf8');
 if(crypto.createHash('sha256').update(sql).digest('hex')!==manifest.sha256)throw new Error('Migration checksum does not match reviewed manifest');
 return {schema,manifest,sql};
});}
async function applyMigrations(client,{runtimeRole,migratorRole}){
 if(!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)||!/^[a-z_][a-z0-9_]{0,62}$/.test(migratorRole)||runtimeRole===migratorRole)throw new Error('Distinct reviewed database roles required');
 const applied=[];
 await client.query('BEGIN');
 try{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('epdg-portable-release-migrations',0))");
  const {rows:[identity]}=await client.query('SELECT current_user AS role');
  if(identity.role!==migratorRole)throw new Error('Migrator identity mismatch');
  for(const file of ['schema-manifest.json','admin-schema-manifest.json']){
   const required=JSON.parse(fs.readFileSync(path.join(core,'src/security',file),'utf8'));
   const existing=(await client.query('SELECT sha256 FROM portal_security.schema_migrations WHERE version=$1',[required.version])).rows;
   if(existing.length!==1||existing[0].sha256!==required.sha256)throw new Error('Existing authentication migration is not the reviewed baseline');
  }
  await client.query("SELECT set_config('epdg.access_runtime_role',$1,true),set_config('epdg.access_migrator_role',$2,true)",[runtimeRole,migratorRole]);
  for(const entry of entries()){
   const ledger=(await client.query('SELECT to_regclass($1) IS NOT NULL AS present',[entry.schema+'.schema_migrations'])).rows[0].present;
   const recorded=ledger?(await client.query(`SELECT version,sha256 FROM ${entry.schema}.schema_migrations`)).rows:[];
   if(recorded.some(row=>row.version!==entry.manifest.version))throw new Error('Unreviewed migration version requires operator reconciliation');
   const previous=recorded.find(row=>row.version===entry.manifest.version);
   if(previous){if(previous.sha256!==entry.manifest.sha256)throw new Error('Existing migration checksum differs; operator reconciliation required');applied.push({version:entry.manifest.version,status:'verified'});continue;}
   // A namespace without this reviewed ledger is never silently taken over.
   if((await client.query('SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1) AS present',[entry.schema])).rows[0].present)throw new Error('Unrecorded portable schema requires operator reconciliation');
   await client.query(entry.sql);
   await client.query(`INSERT INTO ${entry.schema}.schema_migrations(version,sha256) VALUES($1,$2)`,[entry.manifest.version,entry.manifest.sha256]);
   applied.push({version:entry.manifest.version,status:'applied'});
  }
  await client.query('COMMIT');return applied;
 }catch(error){await client.query('ROLLBACK');throw error;}
}
async function main(){
 const [action,configuration]=process.argv.slice(2);
 if(!['--plan','--apply'].includes(action)||!configuration)throw new Error('Use --plan or --apply with a private reviewed target JSON file');
 const config=JSON.parse(fs.readFileSync(path.resolve(configuration),'utf8'));
 if(!config.target_id||!config.approval_reference||!config.host||!config.database||!config.migrator_role||!config.runtime_role)throw new Error('Reviewed target configuration is incomplete');
 const plan=entries().map(({schema,manifest})=>({schema,...manifest}));
 if(action==='--plan'){process.stdout.write(JSON.stringify({action:'plan',migrations:plan,production_changed:false},null,2)+'\n');return;}
 if(process.env.EPDG_ACCOUNT_MIGRATIONS_APPROVED!=='1'||process.env.EPDG_ACCOUNT_TARGET_ID!==config.target_id||process.env.EPDG_ACCOUNT_RELEASE_APPROVAL!==config.approval_reference)throw new Error('Explicit matching operator migration approval is required');
 const synthetic=config.synthetic_only===true;
 if(synthetic&&(config.host!=='127.0.0.1'||config.port!==55432||config.database!=='epdg_synthetic'))throw new Error('Synthetic target must be the dedicated disposable database');
 if(!synthetic&&config.ssl!==true)throw new Error('Verified TLS is required');
 const password=process.env.EPDG_MIGRATOR_PASSWORD;if(!password)throw new Error('Migrator credential must be supplied privately');
 // Poolers may require a reviewed connection username distinct from current_user.
 const client=new Client({host:config.host,port:config.port||5432,database:config.database,user:config.connection_user||config.migrator_role,password,ssl:synthetic?false:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:60000});
 await client.connect();
 try{
  const {rows:[actual]}=await client.query('SELECT current_database() AS database,current_user AS role');
  if(actual.database!==config.database||actual.role!==config.migrator_role)throw new Error('Connected database identity differs from reviewed target');
  const results=await applyMigrations(client,{runtimeRole:config.runtime_role,migratorRole:config.migrator_role});
  process.stdout.write(JSON.stringify({migrations:results,release_controls_changed:false,accounts_provisioned:0,invitations_sent:0})+'\n');
 }finally{await client.end();}
}
module.exports={applyMigrations,entries};
if(require.main===module)main().catch(error=>{process.stderr.write('Migration stopped: '+error.message+'\n');process.exitCode=1;});
