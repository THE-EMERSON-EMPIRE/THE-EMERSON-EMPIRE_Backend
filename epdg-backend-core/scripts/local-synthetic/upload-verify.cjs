'use strict';
// Local synthetic integration verification only. Login secrets and B cookies stay in memory.
// Appends B-only QA assignment records; never deletes final receipts or touches learner A.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const C = require('./common.cjs');
const origin = 'http://127.0.0.1:58080';
const base = 'http://127.0.0.1:58000';
const programB = '10000000-0000-4000-8000-000000000003';
const assignmentA = '30000000-0000-4000-8000-000000000004';
const fixtureDir = C.path.join(C.workspace, 'build-evidence', 'epdg-synthetic-2026-10-24', 'assignment-uploads', 'fixtures');
const evidenceDir = C.path.dirname(fixtureDir);
const fixture = (name, type) => ({ name, type, bytes: C.fs.readFileSync(C.path.join(fixtureDir, name)) });
const fixtures = () => ({
  text: fixture('synthetic-career-plan.txt', 'text/plain'),
  pdf: fixture('synthetic-practice-plan.pdf', 'application/pdf'),
  png: fixture('synthetic-color-grid.png', 'image/png'),
  jpeg: fixture('synthetic-color-grid.jpg', 'image/jpeg'),
  oversized: fixture('synthetic-oversized.txt', 'text/plain'),
  badPdf: fixture('synthetic-invalid-signature.pdf', 'application/pdf'),
  badUtf8: fixture('synthetic-invalid-utf8.txt', 'text/plain'),
  empty: fixture('synthetic-empty.txt', 'text/plain'),
});

async function verify({ restart = false } = {}) {
  const c = C.config(); await C.preflight(c);
  const multerVersion = JSON.parse(C.fs.readFileSync(C.path.join(C.core, 'node_modules', 'multer', 'package.json'), 'utf8')).version;
  assert.equal(multerVersion, '2.5.0', 'Reviewed multipart security version is installed');
  const f = fixtures();
  const sessions = [];
  const checks = [];
  const qaItems = [];
  let current = 'startup';
  let stopped = false;
  let operator;
  let b;
  let b2;
  let school;
  let enrollment;
  let main;
  let race;
  let state;
  let raceState;
  let retainedDownload;
  const check = async (name, work) => { current = name; await work(); checks.push(name); console.log('PASS ' + name); };
  const api = async (route, { method = 'GET', body, session, headers = {}, multipart = false, binary = false } = {}) => {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const h = { ...(unsafe ? { Origin: origin, 'X-EPDG-Request': 'portal', ...(multipart ? {} : { 'Content-Type': 'application/json' }) } : {}),
      ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...headers };
    for (const key of Object.keys(h)) if (h[key] === null) delete h[key];
    const response = await fetch(base + route, { method, headers: h, cache: 'no-store', redirect: 'error',
      ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    return { status: response.status, data: binary ? Buffer.from(await response.arrayBuffer()) : await response.json(), headers: response.headers };
  };
  const login = async email => {
    const result = await api('/api/auth/login', { method: 'POST', body: { email, password: c.fixturePassword } });
    assert.equal(result.status, 200); assert.equal(result.data.user.privileged_controls_available, false);
    const cookie = result.headers.get('set-cookie'); assert.ok(cookie);
    const session = { cookie: cookie.split(';')[0], csrf: result.data.csrf_token, user: result.data.user };
    sessions.push(session); return session;
  };
  const assignment = item => '/api/learner/assignments/' + item;
  const read = (item, session = b) => api(assignment(item) + '/submission', { session });
  const save = (item, answer, expected_revision, session = b) => api(assignment(item) + '/draft', {
    method: 'POST', body: { answer, expected_revision }, session });
  const submit = (item, expected_revision, session = b) => api(assignment(item) + '/submit', {
    method: 'POST', body: { expected_revision }, session });
  const form = (file, revision, { fields = [], files = [], fileField = 'file', omitFile = false } = {}) => {
    const value = new FormData();
    if (revision !== undefined) value.append('expected_revision', String(revision));
    for (const [key, field] of fields) value.append(key, String(field));
    if (!omitFile) value.append(fileField, new Blob([file.bytes], { type: file.type }), file.name);
    for (const extra of files) value.append(fileField, new Blob([extra.bytes], { type: extra.type }), extra.name);
    return value;
  };
  const upload = (item, file, revision, options = {}) => {
    const { formOptions, ...requestOptions } = options;
    return api(assignment(item) + '/attachments', { method: 'POST', session: b, multipart: true,
      body: form(file, revision, formOptions), ...requestOptions });
  };
  const change = (item, id, action, revision, options = {}) => api(assignment(item) + '/attachments/' + id + '/' + action, {
    method: 'POST', session: b, body: { expected_revision: revision }, ...options });
  const download = (item, id, options = {}) => api(assignment(item) + '/attachments/' + id + '/download', {
    session: b, binary: true, ...options });
  const accept = result => { assert.equal(result.status, 200); state = result.data.submission; return state; };
  const uploadMain = async file => {
    const previous = state.revision; const count = state.attachments.length;
    accept(await upload(main, file, previous)); assert.equal(state.revision, previous + 1);
    assert.equal(state.attachments.length, count + 1);
    const metadata = state.attachments.find(item => item.filename === file.name && item.sha256 === C.crypto.createHash('sha256').update(file.bytes).digest('hex'));
    assert.ok(metadata); return metadata;
  };
  const changeMain = async (id, action) => {
    const previous = state.revision; accept(await change(main, id, action, previous));
    assert.equal(state.revision, previous + 1); return state;
  };
  const sameMain = async before => assert.deepEqual((await read(main)).data.submission, before);
  const rejected = result => assert.ok([400, 409, 413, 415, 422].includes(result.status), 'Invalid request must fail with a controlled client error');
  const assertDownload = async (item, metadata, file) => {
    const result = await download(item, metadata.id); assert.equal(result.status, 200);
    assert.deepEqual(result.data, file.bytes);
    assert.equal(result.headers.get('content-type'), 'application/octet-stream');
    assert.match(result.headers.get('content-disposition') ?? '', /^attachment;/);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    assert.match(result.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.equal(metadata.filename, file.name); assert.equal(metadata.media_type, file.type);
    assert.equal(metadata.size_bytes, file.bytes.length);
    assert.equal(metadata.sha256, C.crypto.createHash('sha256').update(file.bytes).digest('hex'));
    assert.match(metadata.id, /^[0-9a-f-]{36}$/); assert.ok(Number.isFinite(Date.parse(metadata.uploaded_at)));
    assert.deepEqual(Object.keys(metadata).sort(), ['filename', 'id', 'media_type', 'sha256', 'size_bytes', 'uploaded_at']);
  };
  const newItem = async label => {
    const id = C.crypto.randomUUID();
    await operator.query('BEGIN');
    try {
      await operator.query("SELECT pg_advisory_xact_lock(hashtext('synthetic-upload-qa-fixtures'))");
      await operator.query(`INSERT INTO synthetic_learning.items(id,program_id,position,title,kind,description,content,due_at)
        SELECT $1,$2,COALESCE(max(position),0)+1,$3,'assignment',
          'SYNTHETIC upload acceptance fixture. Fictional files only.',
          'SYNTHETIC QA PROMPT: Attach invented practice information only.',clock_timestamp()-interval '1 minute'
        FROM synthetic_learning.items WHERE program_id=$2`, [id, programB, 'SYNTHETIC upload QA ' + label]);
      await operator.query('COMMIT'); qaItems.push(id); return id;
    } catch (error) { await operator.query('ROLLBACK'); throw error; }
  };
  const control = command => {
    const result = spawnSync(process.execPath, [C.path.join(__dirname, 'manage.cjs'), command], {
      env: C.cleanEnv(), cwd: C.core, windowsHide: true, encoding: 'utf8', timeout: 40000 });
    assert.equal(result.status, 0, 'Controlled local runtime ' + command + ' succeeds');
  };
  try {
    await check('anonymous and bearer upload requests fail before multipart parsing', async () => {
      const id = C.crypto.randomUUID();
      for (const options of [{ session: undefined }, { session: undefined, headers: { Authorization: 'Bearer invalid-synthetic-token' } },
        { session: undefined, headers: { Cookie: 'epdg_synthetic_session=invalid' } }]) {
        assert.equal((await upload(id, f.oversized, 1, options)).status, 401);
        assert.equal((await download(id, C.crypto.randomUUID(), options)).status, 401);
        assert.equal((await change(id, C.crypto.randomUUID(), 'remove', 1, options)).status, 401);
      }
    });
    await check('guarded operator appends fresh B-only QA assignments and normal non-A sessions', async () => {
      b = await login('learner-b@epdg.invalid'); b2 = await login('learner-b@epdg.invalid'); school = await login('school-b@epdg.invalid');
      operator = await C.client(c, true);
      const identity = (await operator.query(`SELECT current_database() AS db,current_user AS role,
        host(inet_server_addr()) AS host,inet_server_port() AS port,instance_id::text FROM synthetic_meta.identity`)).rows[0];
      assert.deepEqual(identity, { db: 'epdg_synthetic', role: 'epdg_synthetic_operator', host: '127.0.0.1', port: 55432, instance_id: c.instanceId });
      const row = (await operator.query(`SELECT e.id FROM synthetic_learning.enrollments e JOIN core.users u ON u.id=e.user_id
        WHERE e.program_id=$1 AND e.user_id=$2 AND e.active AND u.email='learner-b@epdg.invalid' AND u.name LIKE 'SYNTHETIC %'`, [programB, b.user.id])).rows;
      assert.equal(row.length, 1); enrollment = row[0].id;
      main = await newItem('bounds and final manifest'); race = await newItem('concurrent upload and submit');
      assert.equal((await read(main)).status, 200);
      const raceDraft = await save(race, 'SYNTHETIC concurrent file practice response.', 0);
      assert.equal(raceDraft.status, 200); raceState = raceDraft.data.submission;
    });
    await check('school and foreign scope are denied before oversized multipart parsing', async () => {
      assert.equal((await upload(main, f.oversized, 1, { session: school })).status, 403);
      assert.equal((await upload(assignmentA, f.oversized, 1)).status, 404);
      assert.equal((await upload('30000000-0000-4000-8000-000000000008', f.oversized, 1)).status, 404);
    });
    await check('uploads require an existing saved draft and current session CSRF origin contract', async () => {
      rejected(await upload(main, f.text, 0));
      accept(await save(main, 'SYNTHETIC fictional career plan for upload acceptance.', 0));
      assert.equal(state.revision, 1); assert.deepEqual(state.attachments, []); assert.deepEqual(state.removed_attachments, []);
      for (const token of [null, 'invalid', school.csrf]) assert.equal((await upload(main, f.text, 1, { headers: { 'X-CSRF-Token': token } })).status, 403);
      assert.equal((await upload(main, f.text, 1, { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
      assert.equal((await upload(main, f.text, 1, { headers: { 'X-EPDG-Request': null } })).status, 403);
      const before = state;
      rejected(await api(assignment(main) + '/attachments', { method: 'POST', session: b, body: { expected_revision: 1, file: 'forged' } }));
      await sameMain(before);
    });
    await check('multipart selectors duplicate fields extra files and malformed revisions roll back without orphan blobs', async () => {
      const before = state;
      for (const name of ['user_id', 'role', 'program_id', 'enrollment_id', 'id', 'sha256', 'uploaded_at']) {
        rejected(await upload(main, f.text, state.revision, { formOptions: { fields: [[name, 'forged']] } }));
      }
      rejected(await upload(main, f.text, state.revision, { formOptions: { fields: [['expected_revision', state.revision]] } }));
      rejected(await upload(main, f.text, state.revision, { formOptions: { files: [f.pdf] } }));
      rejected(await upload(main, f.text, state.revision, { formOptions: { fileField: 'other_file' } }));
      rejected(await upload(main, f.text, state.revision, { formOptions: { omitFile: true } }));
      for (const name of ['expected_revision[0]', 'expected_revision[]', 'expected_revision[x][y]', '__proto__[qa_upload]', 'constructor[prototype][qa]']) {
        rejected(await upload(main, f.text, undefined, { formOptions: { fields: [[name, '1']] } }));
      }
      for (const type of ['multipart/form-data', 'multipart/form-data; boundary=synthetic-mismatched-boundary']) {
        rejected(await upload(main, f.text, state.revision, { headers: { 'Content-Type': type } }));
      }
      for (const revision of [undefined, '01', '1.0', '-1', '0', ' 1', '1 ', '1e0', '2147483648']) rejected(await upload(main, f.text, revision));
      const queryForm = form(f.text, state.revision);
      rejected(await api(assignment(main) + '/attachments?user_id=1', { method: 'POST', session: b, multipart: true, body: queryForm }));
      await sameMain(before);
      assert.equal((await operator.query('SELECT count(*)::int AS count FROM synthetic_learning.assignment_attachments WHERE enrollment_id=$1 AND item_id=$2', [enrollment, main])).rows[0].count, 0);
      const health = await api('/health'); assert.equal(health.status, 200);
      assert.deepEqual(health.data, { success: true, service: 'epdg-backend-core', status: 'ok' });
    });
    await check('empty oversized unsafe filename MIME signature and UTF-8 files are rejected without changes', async () => {
      const before = state;
      for (const file of [f.empty, f.oversized, f.badPdf, f.badUtf8,
        { ...f.text, bytes: Buffer.from('SYNTHETIC\0invalid') }, { ...f.text, bytes: Buffer.from([0x53, 0xc2, 0x85]) },
        { ...f.png, bytes: Buffer.from('SYNTHETIC invalid PNG') }, { ...f.jpeg, bytes: Buffer.from('SYNTHETIC invalid JPEG') },
        { ...f.text, name: 'synthetic-script.exe' }, { ...f.text, type: 'application/javascript' },
        { ...f.png, name: 'synthetic-wrong.pdf', type: 'application/pdf' }]) rejected(await upload(main, file, state.revision));
      for (const name of ['../escape.txt', 'folder\\escape.txt', '.hidden.txt', 'bad..name.txt', 'bad.txt.', 'bad.txt ', 'a'.repeat(101) + '.txt', 'bad\nname.txt', 'bad"name.txt']) {
        rejected(await upload(main, { ...f.text, name }, state.revision));
      }
      await sameMain(before);
      assert.equal((await operator.query('SELECT count(*)::int AS count FROM synthetic_learning.assignment_attachments WHERE enrollment_id=$1 AND item_id=$2', [enrollment, main])).rows[0].count, 0);
      assert.equal((await api('/health')).status, 200);
    });
    let text;
    let pdf;
    let png;
    let jpeg;
    await check('one-byte text and a 100-character case-insensitive safe filename meet exact lower and name bounds', async () => {
      const item = await newItem('minimum file and maximum filename');
      assert.equal((await save(item, 'SYNTHETIC minimum-file practice response.', 0)).status, 200);
      const file = { name: 'S' + 'a'.repeat(95) + '.TXT', type: 'text/plain', bytes: Buffer.from('A') };
      assert.equal(file.name.length, 100); assert.equal(file.bytes.length, 1);
      const uploaded = await upload(item, file, 1); assert.equal(uploaded.status, 200);
      assert.equal(uploaded.data.submission.revision, 2); assert.equal(uploaded.data.submission.attachments.length, 1);
      await assertDownload(item, uploaded.data.submission.attachments[0], file);
      const done = await submit(item, 2); assert.equal(done.status, 200); assert.equal(done.data.submission.state, 'submitted');
    });
    await check('TXT PDF and PNG uploads persist metadata hashes bytes and private safe download headers', async () => {
      text = await uploadMain(f.text); await assertDownload(main, text, f.text);
      pdf = await uploadMain(f.pdf); await assertDownload(main, pdf, f.pdf);
      png = await uploadMain({ ...f.png, type: '' }); await assertDownload(main, png, f.png);
      assert.equal(state.attachments.length, 3); assert.deepEqual((await read(main, b2)).data.submission, state);
      assert.ok(!JSON.stringify(state).includes('http://')); assert.ok(!JSON.stringify(state).includes('storage_path'));
      const before = state; rejected(await upload(main, f.jpeg, state.revision)); await sameMain(before);
    });
    await check('attachment IDs remain bound to current learner assignment and institution', async () => {
      assert.equal((await download(main, text.id, { session: school })).status, 403);
      assert.equal((await download(assignmentA, text.id)).status, 404);
      assert.equal((await download(race, text.id)).status, 404);
      for (const action of ['remove', 'restore']) assert.equal((await change(race, text.id, action, 1)).status, 404);
      assert.equal((await download(main, C.crypto.randomUUID())).status, 404);
      assert.equal((await api(assignment(main) + '/attachments/' + text.id + '/download?user_id=1', { session: b, binary: true })).status, 400);
      const before = state;
      for (const action of ['remove', 'restore']) {
        assert.equal((await change(main, text.id, action, state.revision, { headers: { 'X-CSRF-Token': null } })).status, 403);
        rejected(await change(main, text.id, action, state.revision, { body: { expected_revision: state.revision, user_id: b.user.id } }));
      }
      await sameMain(before);
    });
    await check('soft removal hides download while reversible restore enforces three active attachments', async () => {
      await changeMain(text.id, 'remove');
      assert.ok(state.removed_attachments.some(item => item.id === text.id));
      assert.equal((await download(main, text.id)).status, 404);
      jpeg = await uploadMain({ ...f.jpeg, type: 'application/octet-stream' }); await assertDownload(main, jpeg, f.jpeg);
      const before = state; rejected(await change(main, text.id, 'restore', state.revision)); await sameMain(before);
      await changeMain(jpeg.id, 'remove'); await changeMain(text.id, 'restore');
      await assertDownload(main, text, f.text);
      const stale = state.revision - 1; assert.equal((await change(main, text.id, 'remove', stale)).status, 409);
    });
    await check('six lifetime records cap survives removal and failed uploads leave no extra rows', async () => {
      await changeMain(png.id, 'remove');
      const boundaryFile = { name: 'synthetic-maximum-size.txt', type: 'text/plain', bytes: Buffer.alloc(1048576, 0x41) };
      const fifth = await uploadMain(boundaryFile); await assertDownload(main, fifth, boundaryFile); await changeMain(fifth.id, 'remove');
      const sixth = await uploadMain({ ...f.jpeg, name: 'synthetic-grid-sixth.jpg' }); await changeMain(sixth.id, 'remove');
      const before = state; rejected(await upload(main, { ...f.text, name: 'synthetic-seventh.txt' }, state.revision)); await sameMain(before);
      const count = (await operator.query('SELECT count(*)::int AS count FROM synthetic_learning.assignment_attachments WHERE enrollment_id=$1 AND item_id=$2', [enrollment, main])).rows[0].count;
      assert.equal(count, 6);
      assert.equal(state.attachments.length, 2); assert.equal(state.removed_attachments.length, 4);
    });
    await check('enrollment withdrawal denies private downloads and file mutations without losing data', async () => {
      const before = state;
      try {
        await operator.query('UPDATE synthetic_learning.enrollments SET active=false WHERE id=$1 AND user_id=$2', [enrollment, b.user.id]);
        assert.equal((await download(main, text.id)).status, 404);
        assert.equal((await upload(main, f.oversized, state.revision)).status, 404);
        assert.equal((await change(main, text.id, 'remove', state.revision)).status, 404);
      } finally { await operator.query('UPDATE synthetic_learning.enrollments SET active=true WHERE id=$1 AND user_id=$2', [enrollment, b.user.id]); }
      await sameMain(before);
    });
    await check('concurrent uploads of one revision have exactly one winner and no orphan attachment', async () => {
      assert.equal((await read(race)).data.submission.revision, 1);
      const outcomes = await Promise.all([upload(race, f.text, 1, { session: b }), upload(race, f.png, 1, { session: b2 })]);
      assert.deepEqual(outcomes.map(result => result.status).sort(), [200, 409]);
      raceState = (await read(race)).data.submission; assert.equal(raceState.revision, 2); assert.equal(raceState.attachments.length, 1);
      assert.equal((await operator.query('SELECT count(*)::int AS count FROM synthetic_learning.assignment_attachments WHERE enrollment_id=$1 AND item_id=$2', [enrollment, race])).rows[0].count, 1);
    });
    await check('simultaneous submit and upload yield one coherent final or draft revision', async () => {
      const outcomes = await Promise.all([submit(race, raceState.revision, b), upload(race, f.pdf, raceState.revision, { session: b2 })]);
      assert.deepEqual(outcomes.map(result => result.status).sort(), [200, 409]);
      raceState = (await read(race)).data.submission;
      if (raceState.state === 'draft') {
        assert.equal(raceState.revision, 3); assert.equal(raceState.attachments.length, 2);
        const done = await submit(race, raceState.revision); assert.equal(done.status, 200); raceState = done.data.submission;
      } else { assert.equal(raceState.revision, 2); assert.equal(raceState.attachments.length, 1); }
      assert.equal(raceState.state, 'submitted');
      assert.deepEqual(raceState.removed_attachments, []);
    });
    await check('final receipt freezes active metadata and bytes and closes removal restore and upload', async () => {
      const before = state; accept(await submit(main, state.revision));
      assert.equal(state.state, 'submitted'); assert.equal(state.revision, before.revision);
      assert.deepEqual(state.attachments, before.attachments); assert.deepEqual(state.removed_attachments, []);
      assert.deepEqual((await submit(main, state.revision, b2)).data.submission, state);
      assert.equal((await upload(main, f.text, state.revision)).status, 409);
      for (const action of ['remove', 'restore']) assert.equal((await change(main, text.id, action, state.revision)).status, 409);
      for (const metadata of before.removed_attachments) assert.equal((await download(main, metadata.id)).status, 404);
      await assertDownload(main, text, f.text); await assertDownload(main, pdf, f.pdf);
      retainedDownload = { metadata: text, file: f.text };
      await sameMain(state);
    });
    await check('thirteen RLS tables have no browser grants and runtime cannot forge attachment identity time or final bytes', async () => {
      const metadata = (await operator.query(`SELECT count(*)::int AS tables,count(*) FILTER(WHERE c.relrowsecurity)::int AS rls
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='synthetic_learning' AND c.relkind='r'`)).rows[0];
      assert.deepEqual(metadata, { tables: 15, rls: 15 });
      assert.equal((await operator.query("SELECT count(*)::int AS count FROM pg_policies WHERE schemaname='synthetic_learning'")).rows[0].count, 0);
      assert.equal((await operator.query("SELECT count(*)::int AS count FROM information_schema.role_table_grants WHERE table_schema='synthetic_learning' AND grantee IN ('PUBLIC','anon','authenticated')")).rows[0].count, 0);
      const app = await C.client(c);
      try {
        const privileges = (await app.query(`SELECT
          has_schema_privilege(current_user,'synthetic_learning','CREATE') AS schema_create,
          has_table_privilege(current_user,'synthetic_learning.assignment_attachments','SELECT') AS read,
          has_column_privilege(current_user,'synthetic_learning.assignment_attachments','bytes','INSERT') AS byte_insert,
          has_column_privilege(current_user,'synthetic_learning.assignment_attachments','removed','UPDATE') AS flag_update,
          has_column_privilege(current_user,'synthetic_learning.assignment_attachments','id','INSERT') AS id_insert,
          has_column_privilege(current_user,'synthetic_learning.assignment_attachments','uploaded_at','INSERT') AS time_insert,
          has_column_privilege(current_user,'synthetic_learning.assignment_attachments','sha256','INSERT') AS hash_insert,
          has_column_privilege(current_user,'synthetic_learning.assignment_attachments','size_bytes','INSERT') AS size_insert,
          has_column_privilege(current_user,'synthetic_learning.assignment_attachments','bytes','UPDATE') AS byte_update,
          has_column_privilege(current_user,'synthetic_learning.assignment_attachments','filename','UPDATE') AS filename_update,
          has_table_privilege(current_user,'synthetic_learning.assignment_attachments','DELETE,TRUNCATE') AS remove,
          has_column_privilege(current_user,'synthetic_learning.assignment_receipts','attachments','INSERT,UPDATE') AS manifest_write`)).rows[0];
        assert.deepEqual(privileges, { schema_create: false, read: true, byte_insert: true, flag_update: true,
          id_insert: false, time_insert: false, hash_insert: false, size_insert: false, byte_update: false,
          filename_update: false, remove: false, manifest_write: false });
        await assert.rejects(app.query('UPDATE synthetic_learning.assignment_attachments SET removed=true WHERE id=$1', [text.id]), error => error.code === '23514');
        await assert.rejects(app.query('UPDATE synthetic_learning.assignment_attachments SET bytes=$2 WHERE id=$1', [text.id, f.pdf.bytes]), error => error.code === '42501');
        await assert.rejects(app.query('DELETE FROM synthetic_learning.assignment_attachments WHERE id=$1', [text.id]), error => error.code === '42501');
        await assert.rejects(app.query('TRUNCATE synthetic_learning.assignment_attachments'), error => error.code === '42501');
        await assert.rejects(app.query(`INSERT INTO synthetic_learning.assignment_attachments(enrollment_id,program_id,item_id,filename,media_type,bytes)
          VALUES($1,$2,$3,$4,$5,$6)`, [enrollment, programB, main, f.text.name, f.text.type, f.text.bytes]), error => error.code === '23514');
        await assert.rejects(app.query(`INSERT INTO synthetic_learning.assignment_attachments(id,enrollment_id,program_id,item_id,filename,media_type,bytes,uploaded_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`, [C.crypto.randomUUID(), enrollment, programB, main, f.text.name, f.text.type, f.text.bytes]), error => error.code === '42501');
      } finally { await app.end(); }
      await sameMain(state);
    });
    if (restart) await check('frozen upload metadata bytes receipt and session survive full local runtime restart', async () => {
      await operator.end(); operator = undefined; control('stop'); stopped = true; control('start'); stopped = false;
      await sameMain(state); await assertDownload(main, retainedDownload.metadata, retainedDownload.file);
      assert.deepEqual((await read(race)).data.submission, raceState);
    });
    await check('logout closes private download while admin owner and invitations remain unavailable', async () => {
      for (const path of ['/api/admin/stats', '/api/owner/bootstrap', '/api/invitations']) {
        const result = await api(path, { session: b, ...(path === '/api/admin/stats' ? {} : { method: 'POST', body: {} }) });
        assert.equal(result.status, 503);
      }
      assert.equal((await api('/api/auth/logout', { session: b, method: 'POST', body: {} })).status, 200);
      assert.equal((await download(main, text.id)).status, 401);
    });
    const sourceFiles = [];
    const visit = dir => { for (const item of C.fs.readdirSync(dir, { withFileTypes: true })) {
      const file = C.path.join(dir, item.name); if (item.isDirectory()) visit(file);
      else if (/\.(?:ts|cjs|json|sql)$/.test(item.name)) sourceFiles.push(file);
    } };
    for (const dir of ['src', 'learning-migrations', 'scripts/local-synthetic']) visit(C.path.join(C.core, dir));
    for (const file of ['package.json', 'package-lock.json']) sourceFiles.push(C.path.join(C.core, file));
    const sourceHash = C.crypto.createHash('sha256');
    for (const file of sourceFiles.sort()) sourceHash.update(C.path.relative(C.core, file).replace(/\\/g, '/')).update('\0').update(C.fs.readFileSync(file)).update('\0');
    const head = spawnSync('C:\\Program Files\\Git\\cmd\\git.exe', ['-C', C.backend, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true, env: C.cleanEnv() });
    assert.equal(head.status, 0);
    const receipt = { at: new Date().toISOString(), checksPassed: checks.length, checks,
      backendBaseRevision: head.stdout.trim(), sourceFingerprint: sourceHash.digest('hex'), sourceFingerprintFileCount: sourceFiles.length,
      sourceFingerprintScope: ['epdg-backend-core/src', 'epdg-backend-core/learning-migrations', 'epdg-backend-core/scripts/local-synthetic', 'epdg-backend-core/package.json', 'epdg-backend-core/package-lock.json'],
      multerVersion,
      fullRuntimeRestartTested: restart, qaAssignmentsRetained: qaItems.length,
      learnerAPasswordOrSessionAccessed: false, credentialsPersisted: false, productionTouched: false,
      privilegedControlsEnabled: false, malwareScannerAvailable: false,
      limitations: ['Local synthetic environment only', 'No malware scanner or malware-free claim', 'No public URLs or inline previews'] };
    C.fs.mkdirSync(evidenceDir, { recursive: true });
    C.fs.writeFileSync(C.path.join(C.state, 'upload-verification.receipt.json'), JSON.stringify(receipt, null, 2));
    C.fs.writeFileSync(C.path.join(evidenceDir, 'upload-api-final.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ checksPassed: checks.length, fullRuntimeRestartTested: restart, productionTouched: false, privilegedControlsEnabled: false }));
    return receipt;
  } catch (error) {
    C.fs.writeFileSync(C.path.join(C.state, 'upload-verify.failure.json'), JSON.stringify({ at: new Date().toISOString(), check: current,
      errorType: error.name, code: typeof error.code === 'string' ? error.code : undefined }, null, 2));
    console.error('Upload verification failed at: ' + current); throw error;
  } finally {
    if (operator) await operator.end(); if (stopped) control('start');
    for (const session of sessions) try { await api('/api/auth/logout', { method: 'POST', body: {}, session }); } catch { /* Private fixture sessions expire normally. */ }
  }
}
module.exports = { verify };
if (require.main === module) verify({ restart: process.argv.includes('--restart') }).catch(() => { process.exitCode = 1; });
