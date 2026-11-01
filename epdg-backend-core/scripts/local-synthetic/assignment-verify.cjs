'use strict';
// Real HTTP/SQL verification against the guarded, local synthetic instance.
// A fresh B-only QA assignment is appended per run; submitted receipts are never deleted.
// Learner A's human-managed password and browser sessions are never read or changed.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const C = require('./common.cjs');
const base = 'http://127.0.0.1:58000';
const origin = 'http://127.0.0.1:58080';
const programB = '10000000-0000-4000-8000-000000000003';
const assignmentA = '30000000-0000-4000-8000-000000000004';
const lessonB = '30000000-0000-4000-8000-000000000008';

async function verify({ restart = false } = {}) {
  const c = C.config();
  await C.preflight(c);
  const checks = [];
  const sessions = [];
  const assignment = C.crypto.randomUUID();
  let current = 'startup';
  let stopped = false;
  let operator;
  let b;
  let second;
  let school;
  let enrollment;
  let revision = 0;
  let final;
  let lessonSummary;
  const check = async (name, work) => {
    current = name; await work(); checks.push(name); console.log('PASS ' + name);
  };
  const api = async (route, { method = 'GET', body, session, headers = {} } = {}) => {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const h = { ...(unsafe ? { Origin: origin, 'X-EPDG-Request': 'portal', 'Content-Type': 'application/json' } : {}),
      ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...headers };
    for (const key of Object.keys(h)) if (h[key] === null) delete h[key];
    const response = await fetch(base + route, { method, headers: h,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(10000) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const route = (id = assignment) => '/api/learner/assignments/' + id;
  const read = (session = b, id = assignment) => api(route(id) + '/submission', { session });
  const draft = (answer, expected_revision = revision, options = {}) => api(route() + '/draft', {
    method: 'POST', session: b, body: { answer, expected_revision }, ...options });
  const submit = (expected_revision = revision, options = {}) => api(route() + '/submit', {
    method: 'POST', session: b, body: { expected_revision }, ...options });
  const login = async email => {
    const result = await api('/api/auth/login', { method: 'POST', body: { email, password: c.fixturePassword } });
    assert.equal(result.status, 200, 'Existing non-A synthetic fixture signs in');
    assert.equal(result.data.user.privileged_controls_available, false);
    assert.deepEqual(result.data.user.permissions, []);
    const cookie = result.headers.get('set-cookie'); assert.ok(cookie);
    const session = { cookie: cookie.split(';')[0], csrf: result.data.csrf_token, user: result.data.user };
    sessions.push(session); return session;
  };
  const dashboard = async () => {
    const result = await api('/api/learner/dashboard', { session: b });
    assert.equal(result.status, 200); return result.data;
  };
  const sameLessons = summary => {
    for (const key of ['completed_items', 'total_items', 'progress_percent']) assert.equal(summary[key], lessonSummary[key]);
  };
  const control = command => {
    const result = spawnSync(process.execPath, [C.path.join(__dirname, 'manage.cjs'), command], {
      env: C.cleanEnv(), cwd: C.core, windowsHide: true, encoding: 'utf8', timeout: 40000 });
    assert.equal(result.status, 0, 'Controlled local runtime ' + command + ' succeeds');
  };
  try {
    await check('submission routes reject anonymous, bearer and unknown-cookie requests', async () => {
      for (const options of [{}, { headers: { Authorization: 'Bearer invalid-synthetic-token' } },
        { headers: { Cookie: 'epdg_synthetic_session=invalid' } }]) {
        assert.equal((await api(route() + '/submission', options)).status, 401);
        assert.equal((await draft('SYNTHETIC denied', 0, { session: undefined, ...options })).status, 401);
        assert.equal((await submit(0, { session: undefined, ...options })).status, 401);
      }
    });
    await check('guarded operator appends one fresh synthetic QA assignment only to learner B', async () => {
      b = await login('learner-b@epdg.invalid');
      second = await login('learner-b@epdg.invalid');
      school = await login('school-b@epdg.invalid');
      operator = await C.client(c, true);
      const identity = (await operator.query(`SELECT current_database() AS db,current_user AS role,
        host(inet_server_addr()) AS host,inet_server_port() AS port,instance_id::text FROM synthetic_meta.identity`)).rows[0];
      assert.deepEqual(identity, { db: 'epdg_synthetic', role: 'epdg_synthetic_operator', host: '127.0.0.1', port: 55432, instance_id: c.instanceId });
      const rows = (await operator.query(`SELECT e.id,e.active FROM synthetic_learning.enrollments e
        JOIN core.users u ON u.id=e.user_id WHERE e.program_id=$1 AND e.user_id=$2
        AND u.email='learner-b@epdg.invalid' AND u.name LIKE 'SYNTHETIC %'`, [programB, b.user.id])).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].active, true); enrollment = rows[0].id;
      await operator.query('BEGIN');
      try {
        await operator.query("SELECT pg_advisory_xact_lock(hashtext('synthetic-assignment-qa-fixtures'))");
        await operator.query(`INSERT INTO synthetic_learning.items(id,program_id,position,title,kind,description,content,due_at)
          SELECT $1,$2,COALESCE(max(position),0)+1,'SYNTHETIC QA assignment','assignment',
          'SYNTHETIC automated assignment acceptance fixture. Invented information only.',
          'SYNTHETIC QA PROMPT: Describe an imaginary project plan. Do not enter real personal information.',
          clock_timestamp()-interval '1 minute' FROM synthetic_learning.items WHERE program_id=$2`, [assignment, programB]);
        await operator.query('COMMIT');
      } catch (error) { await operator.query('ROLLBACK'); throw error; }
      lessonSummary = (await dashboard()).summary;
    });
    await check('school, foreign learner and lesson identifiers cannot access assignment answers', async () => {
      assert.equal((await read(school)).status, 403);
      assert.equal((await draft('SYNTHETIC denied', 0, { session: school })).status, 403);
      assert.equal((await submit(0, { session: school })).status, 403);
      for (const id of [assignmentA, lessonB, 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'invalid']) {
        for (const suffix of ['/submission', '/draft', '/submit']) {
          const mutation = suffix !== '/submission';
          const result = await api(route(id) + suffix, { session: b,
            ...(mutation ? { method: 'POST', body: suffix === '/draft' ? { answer: 'SYNTHETIC foreign', expected_revision: 0 } : { expected_revision: 0 } } : {}) });
          assert.equal(result.status, 404);
          assert.ok(!JSON.stringify(result.data).includes('Communication practice reflection'));
        }
      }
    });
    await check('query selectors and extra body fields cannot forge identity, role, timestamps or receipts', async () => {
      for (const suffix of ['?user_id=1', '?school_id=1', '?role=admin']) {
        assert.equal((await api(route() + '/submission' + suffix, { session: b })).status, 400);
        assert.equal((await api(route() + '/draft' + suffix, { session: b, method: 'POST', body: { answer: 'SYNTHETIC rejected', expected_revision: 0 } })).status, 400);
        assert.equal((await api(route() + '/submit' + suffix, { session: b, method: 'POST', body: { expected_revision: 0 } })).status, 400);
      }
      for (const field of ['user_id', 'role', 'enrollment_id', 'program_id', 'saved_at', 'submitted_at', 'receipt', 'id']) {
        assert.equal((await draft('SYNTHETIC rejected', 0, { body: { answer: 'SYNTHETIC rejected', expected_revision: 0, [field]: 'forged' } })).status, 400);
        assert.equal((await submit(0, { body: { expected_revision: 0, [field]: 'forged' } })).status, 400);
      }
    });
    await check('draft and submit require the bound CSRF token, exact origin and JSON request contract', async () => {
      for (const work of [options => draft('SYNTHETIC denied', 0, options), options => submit(0, options)]) {
        for (const token of [null, 'invalid', school.csrf]) assert.equal((await work({ headers: { 'X-CSRF-Token': token } })).status, 403);
        assert.equal((await work({ headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
        assert.equal((await work({ headers: { 'X-EPDG-Request': null } })).status, 403);
        assert.equal((await work({ headers: { 'Content-Type': 'text/plain' } })).status, 415);
      }
    });
    await check('new assignment state is empty and blank final submission creates no receipt', async () => {
      const result = await read(); assert.equal(result.status, 200);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(result.data.environment, 'synthetic-local'); assert.equal(result.data.learner_id, b.user.id);
      assert.deepEqual(result.data.submission, { item_id: assignment, program_id: programB, state: 'not_started', answer: '', revision: 0, saved_at: null, receipt: null, attachments: [], removed_attachments: [], attempt_number: 1, previous_receipt_id: null, can_start_revision: false });
      assert.equal((await submit(0)).status, 400);
      const emptyDraft = await draft(' \n\t', 0); assert.equal(emptyDraft.status, 200);
      revision = emptyDraft.data.submission.revision; assert.equal(revision, 1);
      assert.equal((await submit()).status, 400);
      assert.equal((await read()).data.submission.receipt, null);
    });
    await check('bounded UTF-8 answers and safe integer revisions reject malformed requests without writes', async () => {
      for (const value of [-1, 0.5, '1', null, true, {}, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal((await draft('SYNTHETIC rejected', value)).status, 400);
        assert.equal((await submit(value)).status, 400);
      }
      for (const answer of [null, 1, {}, [], 'a'.repeat(4001), '😀'.repeat(4000), 'SYNTHETIC\0invalid', '\ud800']) assert.equal((await draft(answer)).status, 400);
      assert.equal((await draft('', revision, { body: { expected_revision: revision } })).status, 400);
      assert.equal((await draft('', revision, { body: { answer: 'SYNTHETIC missing revision' } })).status, 400);
      assert.equal((await submit(revision, { body: {} })).status, 400);
      assert.equal((await read()).data.submission.revision, revision);
      const boundary = '€'.repeat(4000);
      assert.equal(Buffer.byteLength(boundary), 12000);
      const accepted = await draft(boundary); assert.equal(accepted.status, 200);
      revision += 1; assert.equal(accepted.data.submission.revision, revision);
      assert.equal((await read()).data.submission.answer, boundary);
    });
    await check('saved plain-text draft survives a second authenticated session without changing lesson progress', async () => {
      const answer = 'SYNTHETIC fictional plan.\nStep 1: Ask an imaginary team to review.\n<script>inert text</script> & “quoted”';
      const started = Date.now(); const result = await draft(answer); assert.equal(result.status, 200);
      const value = result.data.submission; revision += 1;
      assert.equal(value.revision, revision); assert.equal(value.state, 'draft'); assert.equal(value.answer, answer); assert.equal(value.receipt, null);
      assert.ok(Date.parse(value.saved_at) >= started - 1000 && Date.parse(value.saved_at) <= Date.now() + 1000);
      assert.deepEqual((await read(second)).data.submission, value);
      const fresh = await login('learner-b@epdg.invalid');
      assert.deepEqual((await read(fresh)).data.submission, value);
      const board = await dashboard(); sameLessons(board.summary);
      assert.equal(board.upcoming.find(item => item.id === assignment).status, 'draft');
    });
    await check('stale draft writes return conflict and preserve the latest answer', async () => {
      const before = (await read()).data.submission;
      assert.equal((await draft('SYNTHETIC stale overwrite', revision - 1)).status, 409);
      assert.deepEqual((await read()).data.submission, before);
    });
    await check('two sessions saving one revision yield exactly one winner and preserve its answer', async () => {
      const outcomes = await Promise.all([
        draft('SYNTHETIC concurrent answer one', revision, { session: b }),
        draft('SYNTHETIC concurrent answer two', revision, { session: second }),
      ]);
      assert.deepEqual(outcomes.map(item => item.status).sort(), [200, 409]);
      const winner = outcomes.find(item => item.status === 200).data.submission;
      revision += 1; assert.equal(winner.revision, revision);
      assert.deepEqual((await read()).data.submission, winner);
    });
    await check('withdrawn enrollment hides drafts and blocks writes until its original active state is restored', async () => {
      const before = (await read()).data.submission;
      try {
        await operator.query('UPDATE synthetic_learning.enrollments SET active=false WHERE id=$1 AND user_id=$2', [enrollment, b.user.id]);
        assert.equal((await read()).status, 404);
        assert.equal((await draft('SYNTHETIC withdrawn')).status, 404);
        assert.equal((await submit()).status, 404);
      } finally { await operator.query('UPDATE synthetic_learning.enrollments SET active=true WHERE id=$1 AND user_id=$2', [enrollment, b.user.id]); }
      assert.deepEqual((await read()).data.submission, before);
    });
    await check('concurrent final submits return the same server receipt exactly once and remove upcoming work', async () => {
      const before = (await read()).data.submission; const started = Date.now();
      const outcomes = await Promise.all([submit(revision, { session: b }), submit(revision, { session: second })]);
      assert.deepEqual(outcomes.map(item => item.status), [200, 200]);
      final = outcomes[0].data.submission; assert.deepEqual(outcomes[1].data.submission, final);
      assert.equal(final.state, 'submitted'); assert.equal(final.answer, before.answer);
      assert.equal(final.revision, revision); assert.equal(final.receipt.revision, revision);
      assert.match(final.receipt.id, /^[0-9a-f-]{36}$/);
      assert.ok(Date.parse(final.receipt.submitted_at) >= started - 1000 && Date.parse(final.receipt.submitted_at) <= Date.now() + 1000);
      assert.deepEqual((await read()).data.submission, final);
      const board = await dashboard(); sameLessons(board.summary);
      assert.ok(!board.upcoming.some(item => item.id === assignment));
      const detail = await api('/api/learner/programs/' + programB, { session: b });
      assert.equal(detail.status, 200); assert.equal(detail.data.program.items.find(item => item.id === assignment).status, 'submitted');
    });
    await check('submitted answers are immutable and repeated submits return the original receipt', async () => {
      assert.equal((await draft('SYNTHETIC forbidden final overwrite')).status, 409);
      assert.equal((await submit(revision - 1)).status, 409);
      assert.deepEqual((await submit()).data.submission, final);
      assert.deepEqual((await read(second)).data.submission, final);
    });
    await check('thirteen RLS tables have no browser grants and final answers have append-only runtime privileges', async () => {
      const rows = (await operator.query(`SELECT count(*)::int AS tables,count(*) FILTER(WHERE c.relrowsecurity)::int AS rls
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='synthetic_learning' AND c.relkind='r'`)).rows;
      assert.deepEqual(rows[0], { tables: 15, rls: 15 });
      assert.equal((await operator.query("SELECT count(*)::int AS count FROM pg_policies WHERE schemaname='synthetic_learning'")).rows[0].count, 0);
      assert.equal((await operator.query("SELECT count(*)::int AS count FROM information_schema.role_table_grants WHERE table_schema='synthetic_learning' AND grantee IN ('PUBLIC','anon','authenticated')")).rows[0].count, 0);
      const bad = await operator.query("SELECT count(*)::int AS count FROM core.users WHERE email NOT LIKE '%@epdg.invalid' OR name NOT LIKE 'SYNTHETIC %'");
      assert.equal(bad.rows[0].count, 0);
      const stored = (await operator.query(`SELECT count(*)::int AS count FROM synthetic_learning.assignment_receipts
        WHERE enrollment_id=$1 AND item_id=$2`, [enrollment, assignment])).rows[0];
      assert.equal(stored.count, 1);
      const app = await C.client(c);
      try {
        const privileges = (await app.query(`SELECT
          has_schema_privilege(current_user,'synthetic_learning','CREATE') AS schema_create,
          has_table_privilege(current_user,'synthetic_learning.assignment_drafts','SELECT') AS draft_read,
          has_column_privilege(current_user,'synthetic_learning.assignment_drafts','answer','INSERT') AS draft_insert,
          has_column_privilege(current_user,'synthetic_learning.assignment_drafts','answer','UPDATE') AS draft_update,
          has_table_privilege(current_user,'synthetic_learning.assignment_drafts','DELETE,TRUNCATE') AS draft_remove,
          has_table_privilege(current_user,'synthetic_learning.assignment_receipts','SELECT') AS receipt_read,
          has_column_privilege(current_user,'synthetic_learning.assignment_receipts','answer','INSERT') AS receipt_insert,
          has_column_privilege(current_user,'synthetic_learning.assignment_receipts','id','INSERT') AS receipt_id_write,
          has_column_privilege(current_user,'synthetic_learning.assignment_receipts','submitted_at','INSERT') AS receipt_time_write,
          has_any_column_privilege(current_user,'synthetic_learning.assignment_receipts','UPDATE') AS receipt_update,
          has_table_privilege(current_user,'synthetic_learning.assignment_receipts','DELETE,TRUNCATE') AS receipt_remove`)).rows[0];
        assert.deepEqual(privileges, { schema_create: false, draft_read: true, draft_insert: true, draft_update: true,
          draft_remove: false, receipt_read: true, receipt_insert: true, receipt_id_write: false,
          receipt_time_write: false, receipt_update: false, receipt_remove: false });
        await assert.rejects(app.query('DELETE FROM synthetic_learning.assignment_receipts WHERE enrollment_id=$1 AND item_id=$2', [enrollment, assignment]), error => error.code === '42501');
        await assert.rejects(app.query('UPDATE synthetic_learning.assignment_receipts SET answer=$3 WHERE enrollment_id=$1 AND item_id=$2', [enrollment, assignment, 'SYNTHETIC forbidden']), error => error.code === '42501');
        await assert.rejects(app.query('TRUNCATE synthetic_learning.assignment_receipts'), error => error.code === '42501');
        await assert.rejects(app.query(`UPDATE synthetic_learning.assignment_drafts SET answer=$3,revision=revision+1
          WHERE enrollment_id=$1 AND item_id=$2`, [enrollment, assignment, 'SYNTHETIC forbidden after final']), error => error.code === '23514');
        await assert.rejects(app.query(`INSERT INTO synthetic_learning.assignment_receipts(enrollment_id,program_id,item_id,answer,revision)
          VALUES($1,$2,$3,$4,$5)`, [enrollment, programB, assignment, 'SYNTHETIC forged final answer', revision]), error => error.code === '23514');
        await assert.rejects(app.query(`INSERT INTO synthetic_learning.assignment_receipts(id,enrollment_id,program_id,item_id,answer,revision,submitted_at)
          VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())`, [C.crypto.randomUUID(), enrollment, programB, assignment, final.answer, revision]), error => error.code === '42501');
      } finally { await app.end(); }
    });
    if (restart) await check('submitted receipt, answer and authenticated session survive full backend and database restart', async () => {
      await operator.end(); operator = undefined;
      control('stop'); stopped = true; control('start'); stopped = false;
      assert.deepEqual((await read()).data.submission, final); sameLessons((await dashboard()).summary);
    });
    await check('logout revokes assignment access while owner, invitation and admin controls remain closed', async () => {
      assert.equal((await api('/api/admin/stats', { session: b })).status, 503);
      assert.equal((await api('/api/invitations', { session: b, method: 'POST', body: {} })).status, 503);
      assert.equal((await api('/api/owner/bootstrap', { session: b, method: 'POST', body: {} })).status, 503);
      assert.equal((await api('/api/auth/logout', { method: 'POST', body: {}, session: b })).status, 200);
      assert.equal((await read()).status, 401); assert.equal((await draft('SYNTHETIC denied')).status, 401); assert.equal((await submit()).status, 401);
    });
    const receipt = { at: new Date().toISOString(), instanceId: c.instanceId, checksPassed: checks.length, checks,
      qaAssignmentId: assignment, qaEnrollmentId: enrollment, appendOnlyReceiptRetained: true, fullRuntimeRestartTested: restart,
      learnerAPasswordOrSessionAccessed: false, credentialsPersisted: false, productionTouched: false,
      privilegedControlsEnabled: false, limitations: ['Local synthetic environment only', 'Text-only submission; no uploads, grading or credit awards',
        'Browser acceptance is recorded separately by the parent task'] };
    C.fs.writeFileSync(C.path.join(C.state, 'assignment-verification.receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ checksPassed: checks.length, fullRuntimeRestartTested: restart, productionTouched: false, privilegedControlsEnabled: false }));
    return receipt;
  } catch (error) {
    C.fs.writeFileSync(C.path.join(C.state, 'assignment-verify.failure.json'), JSON.stringify({ at: new Date().toISOString(), check: current,
      errorType: error.name, code: typeof error.code === 'string' ? error.code : undefined }, null, 2));
    console.error('Assignment verification failed at: ' + current);
    throw error;
  } finally {
    if (operator) await operator.end();
    if (stopped) control('start');
    for (const session of sessions) {
      try { await api('/api/auth/logout', { method: 'POST', body: {}, session }); } catch { /* Private fixture sessions expire normally. */ }
    }
  }
}
module.exports = { verify };
if (require.main === module) verify({ restart: process.argv.includes('--restart') }).catch(() => { process.exitCode = 1; });
