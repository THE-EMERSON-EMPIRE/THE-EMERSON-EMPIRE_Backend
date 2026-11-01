'use strict';
const assert=require('node:assert/strict');
const C=require('./common.cjs');
const manifest=require('../../src/security/schema-manifest.json');
async function migrate(){
  const c=C.config();await C.preflight(c);
  const sql=C.fs.readFileSync(C.path.join(C.core,'security-migrations',manifest.file),'utf8');
  assert.equal(C.crypto.createHash('sha256').update(sql).digest('hex'),manifest.sha256,'Reviewed migration checksum');
  require('../../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(manifest.file,sql);
  const db=await C.client(c,true);let applied=false;
  try{
    await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('epdg-local-security-migration-v1'))");
    const {rows:[identity]}=await db.query("SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS directory,instance_id::text FROM synthetic_meta.identity");
    assert.equal(identity.db,'epdg_synthetic');assert.equal(identity.host,'127.0.0.1');assert.equal(identity.port,55432);assert.equal(identity.instance_id,c.instanceId);
    assert.equal(C.path.resolve(identity.directory).toLowerCase(),C.path.join(C.state,'postgres').toLowerCase());
    const {rows:[existing]}=await db.query("SELECT to_regclass('portal_security.schema_migrations') IS NOT NULL AS present");
    if(existing.present){const {rows}=await db.query('SELECT sha256 FROM portal_security.schema_migrations WHERE version=$1',[manifest.version]);assert.equal(rows.length,1,'Unrecognized security schema requires review');assert.equal(rows[0].sha256,manifest.sha256);}
    else{
      const {rows:[unexpected]}=await db.query("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='portal_security') AS present");
      assert.equal(unexpected.present,false,'Never overwrite an unknown security schema');
      await db.query(sql);
      await db.query('INSERT INTO portal_security.schema_migrations(version,sha256) VALUES($1,$2)',[manifest.version,manifest.sha256]);applied=true;
    }
    await db.query(`GRANT USAGE ON SCHEMA portal_security TO epdg_synthetic_app;
      GRANT SELECT ON portal_security.schema_migrations,portal_security.account_states,portal_security.memberships TO epdg_synthetic_app;
      GRANT UPDATE(revision) ON portal_security.account_states TO epdg_synthetic_app;
      GRANT SELECT,INSERT,UPDATE ON portal_security.sessions,portal_security.recovery_tokens TO epdg_synthetic_app;
      GRANT INSERT ON portal_security.audit_events TO epdg_synthetic_app;`);
    await db.query('COMMIT');
    const receipt={at:new Date().toISOString(),instanceId:c.instanceId,version:manifest.version,sha256:manifest.sha256,applied,historyReplayed:false,productionTouched:false,backfillRows:0};
    C.fs.writeFileSync(C.path.join(C.state,'security-migration.receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
}
module.exports={migrate};
