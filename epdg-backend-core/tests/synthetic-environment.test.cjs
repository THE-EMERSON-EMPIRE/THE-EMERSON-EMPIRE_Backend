'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateEnvironment}=require('../dist/config/env.js');
const {validateSyntheticEnvironment}=require('../dist/config/synthetic.js');
const {runtimeEnv}=require('../scripts/local-synthetic/common.cjs');
const {assertLocal}=require('../scripts/local-synthetic/network-guard.cjs');
const {getAllowedOrigins}=require('../dist/utils/corsconfig.js');
const fixture=()=>runtimeEnv({instanceId:'00000000-0000-0000-0000-000000000000',appPassword:'synthetic-only',jwtSecret:'x'.repeat(40),certificateSecret:'y'.repeat(40)});
test('synthetic mode needs no production mail key and rejects nonlocal targets or credentials',()=>{
  assert.doesNotThrow(()=>validateEnvironment(fixture()));
  assert.deepEqual(getAllowedOrigins(fixture()),['http://127.0.0.1:58080']);
  assert.deepEqual(getAllowedOrigins({...fixture(),CORS_ORIGINS:'https://unrelated.invalid'}),['http://127.0.0.1:58080']);
  for(const [key,value] of Object.entries({NODE_ENV:'production',DB_HOST:'db.example.com',DB_NAME:'production',DB_USER:'postgres',SMTP_HOST:'smtp.example.com',SMTP_PORT:'587',FRONTEND_URL:'https://example.com',SUPABASE_URL:'https://example.supabase.co',RESEND_API_KEY:'forbidden',SUPABASE_SERVICE_ROLE_KEY:'forbidden',DATABASE_URL:'forbidden'})){
    assert.throws(()=>validateSyntheticEnvironment({...fixture(),[key]:value}),/Unsafe|Forbidden/);
  }
  assert.throws(()=>validateEnvironment({...fixture(),EPDG_SYNTHETIC_MODE:undefined}),/isolated local test runner/);
});
test('network allowlist permits only the exact local database and sink SMTP endpoints',()=>{
  assert.doesNotThrow(()=>assertLocal('127.0.0.1',55432));assert.doesNotThrow(()=>assertLocal('127.0.0.1',51025));
  for(const [host,port] of [['api.resend.com',443],['127.0.0.1',465],['localhost',55432],['192.168.1.1',55432]])assert.throws(()=>assertLocal(host,port),/blocked/);
});
test('Mailpit transport rejects real-domain recipients before making a connection',async()=>{
  const saved={...process.env};
  try{
    for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,fixture());
    const {deliverEmail}=require('../dist/utils/mailDelivery.js');
    await assert.rejects(deliverEmail({from:process.env.SMTP_FROM,to:'blocked@example.com',subject:'SYNTHETIC',html:'Test'}),/reserved .invalid/);
  }finally{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,saved);}
});
