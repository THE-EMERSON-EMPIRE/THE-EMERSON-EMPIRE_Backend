'use strict';
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {test}=require('node:test');
const {attachmentName,attachmentMediaType,multipartRevision,validateAttachment,attachmentLimit}=require('../dist/learning/attachments.js');
const {LearningService}=require('../dist/learning/LearningService.js');
const {PortalError}=require('../dist/security/primitives.js');
const manifest=require('../src/learning/schema-manifest.json');
const txt=Buffer.from('SYNTHETIC fictional project notes\nOne clear next step.\n');
const pdf=Buffer.from('%PDF-1.7\nSYNTHETIC signature test\n%%EOF\n');
const png=Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex');
const jpeg=Buffer.from('ffd8ffe00010ffd9','hex');
const bad=work=>assert.throws(work,error=>error instanceof PortalError&&error.statusCode===400);

test('multipart parser uses the pinned reviewed Multer security release',()=>{
  const installed=require('../node_modules/multer/package.json');
  const declared=require('../package.json');const lock=require('../package-lock.json');
  assert.equal(installed.version,'2.5.0');assert.equal(declared.dependencies.multer,'2.5.0');
  assert.equal(lock.packages['node_modules/multer'].version,'2.5.0');
});

test('only supported safe ASCII filenames are accepted without rewriting paths',()=>{
  for(const value of ['SYNTHETIC plan.txt','Sample_1-2.PDF','a.png','a.jpg','a.jpeg'])assert.equal(attachmentName(value),value);
  for(const value of ['../escape.txt','folder/file.txt','folder\\file.txt','bad..txt','.hidden.txt','a.txt ','a.txt.',
    'a.html','a.svg','a.zip','a.docx','a.txt\r\nheader','é.txt','a\0.txt','a".txt','a'.repeat(97)+'.txt'])bad(()=>attachmentName(value));
});
test('canonical metadata MIME derives from extension and incoming MIME is checked as a separate hint',()=>{
  for(const supplied of ['','application/octet-stream','text/plain'])assert.equal(attachmentMediaType('A.TXT',supplied),'text/plain');
  assert.equal(attachmentMediaType('a.JPEG','image/jpeg'),'image/jpeg');
  for(const supplied of ['text/html','image/png','text/plain; charset=utf-8'])bad(()=>attachmentMediaType('a.txt',supplied));
});
test('text files accept valid UTF-8 and permitted line whitespace but reject binary/control/markup formats',()=>{
  assert.equal(validateAttachment('a.txt','text/plain',Buffer.from('SYNTHETIC café\tfictional\r\n')).mediaType,'text/plain');
  for(const bytes of [Buffer.from([0xff]),Buffer.from('SYNTHETIC\0'),Buffer.from('SYNTHETIC\x01'),Buffer.from('SYNTHETIC\x7f'),
    Buffer.from('SYNTHETIC\u0085'),Buffer.from('<!doctype html><html>fictional</html>'),Buffer.from('<svg>'),pdf,png,jpeg]) {
    bad(()=>validateAttachment('a.txt','text/plain',bytes));
  }
});
test('binary formats require matching extension, canonical MIME hint and bounded file signatures',()=>{
  for(const [name,mime,bytes] of [['a.pdf','application/pdf',pdf],['a.png','image/png',png],['a.jpg','image/jpeg',jpeg],['a.jpeg','image/jpeg',jpeg]]) {
    assert.equal(validateAttachment(name,mime,bytes).mediaType,mime);
    bad(()=>validateAttachment(name,mime,txt));
    bad(()=>validateAttachment(name,mime,bytes.subarray(0,bytes.length-3)));
  }
  bad(()=>validateAttachment('a.png','application/pdf',png));
});
test('zero bytes and oversize files are rejected, exact 1 MiB text is accepted',()=>{
  bad(()=>validateAttachment('a.txt','text/plain',Buffer.alloc(0)));
  assert.equal(validateAttachment('a.txt','text/plain',Buffer.alloc(attachmentLimit,0x53)).bytes.length,1048576);
  assert.throws(()=>validateAttachment('a.txt','text/plain',Buffer.alloc(attachmentLimit+1,0x53)),error=>error instanceof PortalError&&error.statusCode===413);
});
test('multipart revisions require canonical decimal text without coercion or duplicate values',()=>{
  for(const [value,expected]of [['0',0],['1',1],['2147483647',2147483647]])assert.equal(multipartRevision(value),expected);
  for(const value of [0,undefined,null,[],['1','2'],'01','+1','1.0','1e1',' 1','1\n','-1','2147483648'])bad(()=>multipartRevision(value));
});
test('attachment methods fail closed outside the exact synthetic contract before touching a session or DB',async()=>{
  const previous=process.env.EPDG_SYNTHETIC_MODE;delete process.env.EPDG_SYNTHETIC_MODE;let called=false;
  try{
    const service=new LearningService({withAuthenticatedSession:async()=>{called=true;throw new Error('Forbidden');}});
    const id='30000000-0000-4000-8000-000000000004';
    for(const invoke of [()=>service.attachmentUploadPreflight('opaque',id),()=>service.uploadAttachment('opaque',id,1,'a.txt','text/plain',txt),
      ()=>service.setAttachmentRemoved('opaque',id,id,1,true),()=>service.downloadAttachment('opaque',id,id)]) {
      await assert.rejects(invoke(),error=>error instanceof PortalError&&error.statusCode===503);
    }
    assert.equal(called,false);
  }finally{if(previous===undefined)delete process.env.EPDG_SYNTHETIC_MODE;else process.env.EPDG_SYNTHETIC_MODE=previous;}
});
test('reviewed attachment migration keeps historical hashes and adds no cloud/public grant or definer function',()=>{
  const migration=manifest.extensions[2];const sql=readFileSync(join(__dirname,'..','learning-migrations',migration.file),'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'),migration.sha256);
  require('../dist/db/migrationSafety.js').validateNonDestructiveMigrationSql(migration.file,sql);
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,1);
  assert.doesNotMatch(sql,/SECURITY DEFINER|CREATE POLICY|GRANT|ALTER TABLE (?:core|epdg|portal_security)\./i);
  assert.match(sql,/GENERATED ALWAYS AS \(encode\(sha256\(bytes\),'hex'\)\)/);
  assert.match(sql,/active_count>=3/);assert.match(sql,/lifetime_count>=6/);
  assert.match(sql,/INTO NEW.attachments/);
});
