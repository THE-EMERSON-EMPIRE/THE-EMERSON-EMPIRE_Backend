'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const core = path.resolve(__dirname, '../..');
const backend = path.dirname(core);
const workspace = path.resolve(backend, '../..');
const state = path.join(backend, '.local-synthetic');
const configFile = path.join(state, 'runtime.json');
const baselineFile = path.join(__dirname, 'baseline.sql');
const checksum = () => crypto.createHash('sha256').update(fs.readFileSync(baselineFile)).digest('hex');
const isolationChecksum = () => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'isolation.sql'))).digest('hex');
const config = () => JSON.parse(fs.readFileSync(configFile, 'utf8'));
function cleanEnv() {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'USERNAME', 'USERDOMAIN', 'APPDATA', 'LOCALAPPDATA']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}
function runtimeEnv(c) {
  return { ...cleanEnv(), EPDG_SYNTHETIC_MODE: '1', NODE_ENV: 'test',
    DB_HOST: '127.0.0.1', DB_PORT: '55432', DB_NAME: 'epdg_synthetic',
    DB_USER: 'epdg_synthetic_app', DB_PASSWORD: c.appPassword, DB_SSL: 'false',
    JWT_SECRET: c.jwtSecret, CERT_SIGNING_SECRET: c.certificateSecret,
    FRONTEND_URL: 'http://127.0.0.1:58080', CORS_ORIGINS: 'http://127.0.0.1:58080',
    SUPABASE_URL: 'http://127.0.0.1:55439', SMTP_FROM: 'EPDG Synthetic <no-reply@epdg.invalid>',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '51025', MAIL_DELIVERY_MODE: 'mailpit',
    SYNTHETIC_INSTANCE_ID: c.instanceId, PORT: '58000',
    PORTAL_ORIGIN:'http://127.0.0.1:58080',SESSION_CSRF_SECRET:c.csrfSecret,
    ...(c.crmHandoffEnabled === true ? { EPDG_SYNTHETIC_CRM_HANDOFF_ENABLED:'1', EPDG_SYNTHETIC_CRM_HANDOFF_KEY:c.crmHandoffKey } : {}) };
}
async function client(c, admin = false, database = 'epdg_synthetic') {
  const connection = new Client({host: '127.0.0.1', port: 55432, database,
    user: admin ? 'epdg_synthetic_operator' : 'epdg_synthetic_app',
    password: admin ? c.adminPassword : c.appPassword, ssl: false,
    connectionTimeoutMillis: 3000, statement_timeout: 15000});
  await connection.connect();
  return connection;
}
async function preflight(c) {
  const db = await client(c);
  try {
    const { rows: [identity] } = await db.query(`SELECT current_database() AS db, current_user AS role,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolbypassrls,
      has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
      has_schema_privilege(current_user, 'private', 'USAGE') AS private_usage,
      has_database_privilege(current_user, current_database(), 'CREATE') AS db_create,
      m.instance_id::text, m.baseline_sha256, m.isolation_sha256 FROM pg_roles r CROSS JOIN synthetic_meta.identity m
      WHERE r.rolname = current_user`);
    if (!identity || identity.db !== 'epdg_synthetic' || identity.role !== 'epdg_synthetic_app' ||
        identity.host !== '127.0.0.1' || identity.port !== 55432 || identity.rolsuper ||
        identity.rolcreatedb || identity.rolcreaterole || !identity.rolbypassrls ||
        identity.public_usage || identity.private_usage || identity.db_create ||
        identity.instance_id !== c.instanceId || identity.baseline_sha256 !== checksum() ||
        identity.isolation_sha256 !== isolationChecksum()) {
      throw new Error('Synthetic database identity or privilege gate failed');
    }
    return identity;
  } finally { await db.end(); }
}
function mailHeaders(c) {
  return { Authorization: 'Basic ' + Buffer.from('synthetic-reviewer:' + c.mailPassword).toString('base64') };
}
module.exports = {fs,path,crypto,core,backend,workspace,state,configFile,baselineFile,checksum,isolationChecksum,config,cleanEnv,runtimeEnv,client,preflight,mailHeaders};
