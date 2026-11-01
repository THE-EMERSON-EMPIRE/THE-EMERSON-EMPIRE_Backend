'use strict';
// Explicit local integration verification. Credentials stay in memory and are never printed.
// Learner A's human-managed password and browser session are not read or changed.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const C = require('./common.cjs');
const origin = 'http://127.0.0.1:58080';
const base = 'http://127.0.0.1:58000';
const ids = {
  programA: '10000000-0000-4000-8000-000000000001',
  programA2: '10000000-0000-4000-8000-000000000002',
  programB: '10000000-0000-4000-8000-000000000003',
  lessonA: '30000000-0000-4000-8000-000000000001',
  lessonB: '30000000-0000-4000-8000-000000000008',
  assignmentB: '30000000-0000-4000-8000-000000000010',
};

async function verify({ restart = false } = {}) {
  const c = C.config();
  await C.preflight(c);
  const checks = [];
  let current = 'startup';
  let stackStopped = false;
  let operator;
  let b;
  let school;
  const check = async (name, work) => {
    current = name;
    await work();
    checks.push(name);
    console.log('PASS ' + name);
  };
  const api = async (route, { method = 'GET', body, session, headers = {} } = {}) => {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const h = {
      ...(unsafe ? { Origin: origin, 'X-EPDG-Request': 'portal', 'Content-Type': 'application/json' } : {}),
      ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
      ...headers,
    };
    for (const key of Object.keys(h)) if (h[key] === null) delete h[key];
    const response = await fetch(base + route, {
      method, headers: h,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const login = async email => {
    const result = await api('/api/auth/login', { method: 'POST', body: { email, password: c.fixturePassword } });
    assert.equal(result.status, 200, 'Existing non-A synthetic fixture signs in');
    const setCookie = result.headers.get('set-cookie');
    assert.ok(setCookie, 'Synthetic session cookie is issued');
    return { cookie: setCookie.split(';')[0], csrf: result.data.csrf_token, user: result.data.user };
  };
  const dashboard = async session => {
    const result = await api('/api/learner/dashboard', { session });
    assert.equal(result.status, 200, 'Own learner dashboard succeeds');
    return result.data;
  };
  const detail = async (session, id = ids.programB) => {
    const result = await api('/api/learner/programs/' + id, { session });
    assert.equal(result.status, 200, 'Own program succeeds');
    return result.data;
  };
  const completion = (id, options = {}) => api('/api/learner/items/' + id + '/complete', {
    method: 'POST', session: b, body: {}, ...options,
  });
  const control = command => {
    const result = spawnSync(process.execPath, [C.path.join(__dirname, 'manage.cjs'), command], {
      env: C.cleanEnv(), cwd: C.core, windowsHide: true, encoding: 'utf8', timeout: 40000,
    });
    assert.equal(result.status, 0, 'Controlled local runtime ' + command + ' succeeds');
  };
  try {
    await check('learner routes reject anonymous, unknown-cookie and bearer requests', async () => {
      for (const route of ['/api/learner/dashboard', '/api/learner/programs/' + ids.programB]) {
        assert.equal((await api(route)).status, 401);
        assert.equal((await api(route, { headers: { Authorization: 'Bearer invalid-synthetic-token' } })).status, 401);
        assert.equal((await api(route, { headers: { Cookie: 'epdg_synthetic_session=invalid' } })).status, 401);
      }
      assert.equal((await completion(ids.lessonB, { session: undefined })).status, 401);
    });
    await check('only the existing learner B fixture receives its own program data', async () => {
      b = await login('learner-b@epdg.invalid');
      school = await login('school-b@epdg.invalid');
      const value = await dashboard(b);
      assert.equal(value.success, true);
      assert.equal(value.environment, 'synthetic-local');
      assert.equal(value.learner_id, b.user.id);
      assert.equal(value.programs.length, 1);
      assert.equal(value.programs[0].id, ids.programB);
      assert.ok(!JSON.stringify(value).includes(ids.programA));
      assert.ok(!JSON.stringify(value).includes(ids.programA2));
      assert.ok(value.upcoming.every(item => item.program_id === ids.programB));
      assert.ok(value.feedback.every(item => item.program_id === ids.programB));
      assert.ok(value.resources.every(item => item.program_id === ids.programB));
      assert.equal(value.summary.active_programs, 1);
      assert.equal(value.summary.total_items, 2);
      assert.equal(value.summary.progress_percent, Math.round(value.summary.completed_items / value.summary.total_items * 100));
      const result = await api('/api/learner/dashboard', { session: b });
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
      assert.deepEqual(b.user.permissions, []);
      assert.equal(b.user.privileged_controls_available, false);
    });
    await check('school users cannot read or mutate the learner feature', async () => {
      for (const route of ['/api/learner/dashboard', '/api/learner/programs/' + ids.programB]) {
        assert.equal((await api(route, { session: school })).status, 403);
      }
      assert.equal((await completion(ids.lessonB, { session: school })).status, 403);
    });
    await check('client scope overrides and foreign program or item identifiers are rejected', async () => {
      for (const suffix of ['?user_id=1', '?school_id=1', '?role=admin', '?limit=1000']) {
        assert.equal((await api('/api/learner/dashboard' + suffix, { session: b })).status, 400);
        assert.equal((await api('/api/learner/programs/' + ids.programB + suffix, { session: b })).status, 400);
      }
      for (const id of [ids.programA, ids.programA2, 'ffffffff-ffff-4fff-8fff-ffffffffffff']) {
        assert.equal((await api('/api/learner/programs/' + id, { session: b })).status, 404);
      }
      assert.equal((await completion(ids.lessonA)).status, 404);
      assert.equal((await completion('ffffffff-ffff-4fff-8fff-ffffffffffff')).status, 404);
      assert.equal((await completion(ids.lessonB, { body: { user_id: b.user.id } })).status, 400);
      assert.equal((await api('/api/learner/items/' + ids.lessonB + '/complete?role=admin', { method: 'POST', body: {}, session: b })).status, 400);
    });
    await check('lesson completion requires the current session CSRF and exact origin contract', async () => {
      for (const token of [null, 'invalid', school.csrf]) {
        assert.equal((await completion(ids.lessonB, { headers: { 'X-CSRF-Token': token } })).status, 403);
      }
      assert.equal((await completion(ids.lessonB, { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
      assert.equal((await completion(ids.lessonB, { headers: { 'X-EPDG-Request': null } })).status, 403);
      assert.equal((await completion(ids.lessonB, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    });
    await check('program detail is limited to its own items and assignment completion stays closed', async () => {
      const value = await detail(b);
      assert.equal(value.program.id, ids.programB);
      // Dedicated assignment acceptance adds append-only B-only QA fixtures.
      // Preserve checks for the three original teaching items without requiring
      // the entire local fixture collection to remain fixed in size.
      for (const id of [ids.lessonB, '30000000-0000-4000-8000-000000000009', ids.assignmentB]) {
        assert.ok(value.program.items.some(item => item.id === id));
      }
      assert.equal(value.program.items.find(item => item.id === ids.lessonB).kind, 'lesson');
      assert.equal(value.program.items.find(item => item.id === ids.assignmentB).kind, 'assignment');
      assert.equal((await completion(ids.assignmentB)).status, 403);
    });
    await check('removing the B enrollment hides its records and yields a true empty dashboard', async () => {
      const db = await C.client(c, true);
      let original;
      try {
        const result = await db.query('SELECT id,active FROM synthetic_learning.enrollments WHERE program_id=$1 AND user_id=$2', [ids.programB, b.user.id]);
        assert.equal(result.rows.length, 1);
        original = result.rows[0];
        assert.equal(original.active, true);
        await db.query('UPDATE synthetic_learning.enrollments SET active=false WHERE id=$1 AND user_id=$2', [original.id, b.user.id]);
        const value = await dashboard(b);
        assert.equal(value.programs.length, 0);
        assert.equal(value.upcoming.length, 0);
        assert.equal(value.feedback.length, 0);
        assert.equal(value.resources.length, 0);
        assert.deepEqual(value.summary, { active_programs: 0, completed_items: 0, total_items: 0, progress_percent: 0 });
        assert.equal((await api('/api/learner/programs/' + ids.programB, { session: b })).status, 404);
        assert.equal((await completion(ids.lessonB)).status, 404);
      } finally {
        if (original) await db.query('UPDATE synthetic_learning.enrollments SET active=$2 WHERE id=$1 AND user_id=$3', [original.id, original.active, b.user.id]);
        await db.end();
      }
      assert.equal((await dashboard(b)).programs.length, 1);
    });
    await check('own lesson completion is idempotent and server progress reflects stored completion', async () => {
      const before = await detail(b);
      const previous = before.program.items.find(item => item.id === ids.lessonB);
      const first = await completion(ids.lessonB);
      const second = await completion(ids.lessonB);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(first.data.item_id, ids.lessonB);
      assert.equal(first.data.already_completed, previous.completed_at !== null);
      assert.equal(second.data.already_completed, true);
      assert.equal(first.data.completed_at, second.data.completed_at);
      assert.ok(Number.isFinite(Date.parse(first.data.completed_at)));
      const after = await detail(b);
      assert.equal(after.program.items.find(item => item.id === ids.lessonB).status, 'completed');
      assert.equal(after.program.completed_items, before.program.completed_items + (previous.completed_at === null ? 1 : 0));
      assert.equal(after.program.progress_percent, Math.round(after.program.completed_items / after.program.total_items * 100));
      const value = await dashboard(b);
      assert.equal(value.summary.completed_items, after.program.completed_items);
      assert.equal(value.summary.progress_percent, after.program.progress_percent);
    });
    if (restart) await check('completion and the authenticated learner session survive a full local backend/database restart', async () => {
      const before = await detail(b);
      control('stop'); stackStopped = true;
      control('start'); stackStopped = false;
      const after = await detail(b);
      assert.equal(after.program.items.find(item => item.id === ids.lessonB).completed_at, before.program.items.find(item => item.id === ids.lessonB).completed_at);
      assert.equal(after.program.completed_items, before.program.completed_items);
    });
    await check('original content stays read-only while bounded lesson-completion privileges remain unchanged', async () => {
      operator = await C.client(c, true);
      const result = await operator.query(`SELECT count(*)::int AS tables,
        count(*) FILTER(WHERE c.relrowsecurity)::int AS rls FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='synthetic_learning' AND c.relkind='r'`);
      assert.deepEqual(result.rows[0], { tables: 15, rls: 15 });
      const policies = await operator.query("SELECT count(*)::int AS count FROM pg_policies WHERE schemaname='synthetic_learning'");
      assert.equal(policies.rows[0].count, 0);
      const browser = await operator.query("SELECT count(*)::int AS count FROM information_schema.role_table_grants WHERE table_schema='synthetic_learning' AND grantee IN ('PUBLIC','anon','authenticated')");
      assert.equal(browser.rows[0].count, 0);
      const app = await C.client(c);
      try {
        for (const table of ['schema_migrations', 'programs', 'enrollments', 'items', 'completions', 'feedback', 'resources', 'assignment_drafts', 'assignment_receipts', 'assignment_attachments', 'mentor_assignments', 'mentor_review_drafts', 'mentor_review_feedback']) {
          const read = await app.query('SELECT count(*)::int AS count FROM synthetic_learning.' + table);
          assert.ok(Number.isInteger(read.rows[0].count));
          await assert.rejects(app.query('DELETE FROM synthetic_learning.' + table), error => error.code === '42501');
        }
        const privileges = await app.query(`SELECT
          has_schema_privilege(current_user,'synthetic_learning','CREATE') AS schema_create,
          has_table_privilege(current_user,'synthetic_learning.programs','INSERT,UPDATE,DELETE') AS content_write,
          has_table_privilege(current_user,'synthetic_learning.enrollments','INSERT,UPDATE,DELETE') AS enrollment_write,
          has_table_privilege(current_user,'synthetic_learning.completions','UPDATE,DELETE') AS completion_admin,
          has_column_privilege(current_user,'synthetic_learning.completions','enrollment_id','INSERT') AS own_insert,
          has_column_privilege(current_user,'synthetic_learning.completions','completed_at','INSERT') AS time_insert`);
        assert.deepEqual(privileges.rows[0], { schema_create: false, content_write: false, enrollment_write: false,
          completion_admin: false, own_insert: true, time_insert: false });
      } finally { await app.end(); }
      const bad = await operator.query("SELECT count(*)::int AS count FROM core.users WHERE email NOT LIKE '%@epdg.invalid' OR name NOT LIKE 'SYNTHETIC %'");
      assert.equal(bad.rows[0].count, 0);
      await operator.end(); operator = undefined;
    });
    await check('logout revokes learner data access while all privileged controls remain closed', async () => {
      assert.equal((await api('/api/admin/stats', { session: b })).status, 503);
      assert.equal((await api('/api/invitations', { method: 'POST', body: {}, session: b })).status, 503);
      assert.equal((await api('/api/owner/bootstrap', { method: 'POST', body: {}, session: b })).status, 503);
      assert.equal((await api('/api/auth/logout', { method: 'POST', body: {}, session: b })).status, 200);
      assert.equal((await api('/api/learner/dashboard', { session: b })).status, 401);
      assert.equal((await api('/api/learner/programs/' + ids.programB, { session: b })).status, 401);
      assert.equal((await completion(ids.lessonB)).status, 401);
      b = undefined;
    });
    const receipt = { at: new Date().toISOString(), instanceId: c.instanceId,
      checksPassed: checks.length, checks, fullRuntimeRestartTested: restart,
      learnerAPasswordOrSessionAccessed: false, credentialsPersisted: false,
      productionTouched: false, privilegedControlsEnabled: false,
      limitations: ['Local synthetic environment only', 'Self-marked lesson completion does not submit or grade assignments',
        'Browser acceptance is recorded separately by the parent task'] };
    C.fs.writeFileSync(C.path.join(C.state, 'learner-verification.receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ checksPassed: checks.length, fullRuntimeRestartTested: restart,
      productionTouched: false, privilegedControlsEnabled: false }));
    return receipt;
  } catch (error) {
    C.fs.writeFileSync(C.path.join(C.state, 'learner-verify.failure.json'), JSON.stringify({
      at: new Date().toISOString(), check: current, errorType: error.name,
      code: typeof error.code === 'string' ? error.code : undefined,
    }, null, 2));
    console.error('Learner verification failed at: ' + current);
    throw error;
  } finally {
    if (operator) await operator.end();
    if (stackStopped) control('start');
    for (const session of [b, school]) if (session) {
      try { await api('/api/auth/logout', { method: 'POST', body: {}, session }); } catch { /* Private short-lived fixture sessions expire normally. */ }
    }
  }
}
module.exports = { verify };
if (require.main === module) verify({ restart: process.argv.includes('--restart') }).catch(() => { process.exitCode = 1; });
