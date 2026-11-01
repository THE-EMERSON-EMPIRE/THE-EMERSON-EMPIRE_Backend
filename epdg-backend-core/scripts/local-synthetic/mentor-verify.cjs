'use strict';
// Local synthetic mentor integration acceptance; normal non-human fixture logins only.
// Does not read, export, reset or mint any learner A credential or browser session.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const C = require('./common.cjs');
const base = 'http://127.0.0.1:58000';
const origin = 'http://127.0.0.1:58080';
const programB = '10000000-0000-4000-8000-000000000003';
const assignmentA = '30000000-0000-4000-8000-000000000004';
const fixtureDir = C.path.join(C.workspace, 'build-evidence', 'epdg-synthetic-2026-10-24', 'assignment-uploads', 'fixtures');
const evidenceDir = C.path.join(C.workspace, 'build-evidence', 'epdg-synthetic-2026-10-24', 'mentor-reviews');

async function verify({ restart = false } = {}) {
  const c = C.config(); await C.preflight(c);
  const checks = [];
  const sessions = [];
  let current = 'startup';
  let stopped = false;
  let operator;
  let learner;
  let mentor;
  let mentor2;
  let foreign;
  let enrollment;
  let mapping;
  let item;
  let unsubmitted;
  let submission;
  let receiptId;
  let activeFile;
  let removedFile;
  let review;
  let published;
  let mentorMembership;
  let learnerMembership;
  const text = { name: 'synthetic-career-plan.txt', type: 'text/plain', bytes: C.fs.readFileSync(C.path.join(fixtureDir, 'synthetic-career-plan.txt')) };
  const pdf = { name: 'synthetic-practice-plan.pdf', type: 'application/pdf', bytes: C.fs.readFileSync(C.path.join(fixtureDir, 'synthetic-practice-plan.pdf')) };
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
    assert.equal(result.status, 200); assert.deepEqual(result.data.user.permissions, []);
    assert.equal(result.data.user.privileged_controls_available, false);
    const cookie = result.headers.get('set-cookie'); assert.ok(cookie);
    const session = { cookie: cookie.split(';')[0], csrf: result.data.csrf_token, user: result.data.user };
    sessions.push(session); return session;
  };
  const assignment = id => '/api/learner/assignments/' + id;
  const mentorPath = (id = receiptId) => '/api/mentor/reviews/' + id;
  const queue = (session = mentor, suffix = '') => api('/api/mentor/reviews' + suffix, { session });
  const detail = (session = mentor, id = receiptId) => api(mentorPath(id), { session });
  const saveReview = (comment, expected_revision, options = {}) => api(mentorPath() + '/draft', {
    method: 'POST', session: mentor, body: { comment, expected_revision }, ...options });
  const publishReview = (expected_revision, options = {}) => api(mentorPath() + '/publish', {
    method: 'POST', session: mentor, body: { expected_revision }, ...options });
  const feedback = (id = item, session = learner) => api(assignment(id) + '/feedback', { session });
  const download = (id = activeFile?.id, session = mentor, receipt = receiptId) => api(mentorPath(receipt) + '/attachments/' + id + '/download', { session, binary: true });
  const upload = (id, file, revision) => {
    const body = new FormData(); body.append('expected_revision', String(revision)); body.append('file', new Blob([file.bytes], { type: file.type }), file.name);
    return api(assignment(id) + '/attachments', { session: learner, method: 'POST', multipart: true, body });
  };
  const newItem = async title => {
    const id = C.crypto.randomUUID(); await operator.query('BEGIN');
    try {
      await operator.query("SELECT pg_advisory_xact_lock(hashtext('synthetic-mentor-qa-fixtures'))");
      await operator.query(`INSERT INTO synthetic_learning.items(id,program_id,position,title,kind,description,content,due_at)
        SELECT $1,$2,COALESCE(max(position),0)+1,$3,'assignment','SYNTHETIC mentor-review acceptance fixture.',
          'SYNTHETIC QA PROMPT: Write an invented plan for a fictional workshop.',NULL FROM synthetic_learning.items WHERE program_id=$2`, [id, programB, title]);
      await operator.query('COMMIT'); return id;
    } catch (error) { await operator.query('ROLLBACK'); throw error; }
  };
  const control = command => {
    const result = spawnSync(process.execPath, [C.path.join(__dirname, 'manage.cjs'), command], {
      env: C.cleanEnv(), cwd: C.core, windowsHide: true, encoding: 'utf8', timeout: 40000 });
    assert.equal(result.status, 0);
  };
  try {
    await check('mentor queue detail writes downloads and learner feedback deny anonymous and bearer access', async () => {
      const id = C.crypto.randomUUID();
      for (const options of [{}, { headers: { Authorization: 'Bearer invalid-synthetic-token' } }, { headers: { Cookie: 'epdg_synthetic_session=invalid' } }]) {
        for (const route of ['/api/mentor/reviews', mentorPath(id), assignment(C.crypto.randomUUID()) + '/feedback']) assert.equal((await api(route, options)).status, 401);
        for (const action of ['draft', 'publish']) assert.equal((await api(mentorPath(id) + '/' + action, { method: 'POST', body: action === 'draft' ? { comment: 'SYNTHETIC denied', expected_revision: 0 } : { expected_revision: 0 }, ...options })).status, 401);
        assert.equal((await api(mentorPath(id) + '/attachments/' + C.crypto.randomUUID() + '/download', { binary: true, ...options })).status, 401);
      }
    });
    await check('guarded B-only fixtures create one frozen submission and one unsubmitted draft with normal mentor logins', async () => {
      learner = await login('learner-b@epdg.invalid'); mentor = await login('school-b@epdg.invalid');
      mentor2 = await login('school-b@epdg.invalid'); foreign = await login('school-a@epdg.invalid');
      operator = await C.client(c, true);
      const identity = (await operator.query(`SELECT current_database() AS db,current_user AS role,
        host(inet_server_addr()) AS host,inet_server_port() AS port,instance_id::text FROM synthetic_meta.identity`)).rows[0];
      assert.deepEqual(identity, { db: 'epdg_synthetic', role: 'epdg_synthetic_operator', host: '127.0.0.1', port: 55432, instance_id: c.instanceId });
      const rows = (await operator.query(`SELECT e.id,e.membership_id FROM synthetic_learning.enrollments e JOIN core.users u ON u.id=e.user_id
        WHERE e.program_id=$1 AND e.user_id=$2 AND e.active AND u.email='learner-b@epdg.invalid' AND u.name LIKE 'SYNTHETIC %'`, [programB, learner.user.id])).rows;
      assert.equal(rows.length, 1); enrollment = rows[0].id; learnerMembership = rows[0].membership_id;
      assert.equal(mentor.user.memberships.length, 1); mentorMembership = mentor.user.memberships[0].id;
      const mapped = (await operator.query(`SELECT id,mentor_user_id,membership_id,enrollment_id,active,mentor_label
        FROM synthetic_learning.mentor_assignments WHERE id='60000000-0000-4000-8000-000000000003'`)).rows;
      assert.equal(mapped.length, 1); mapping = mapped[0].id;
      assert.deepEqual(mapped[0], { id: mapping, mentor_user_id: mentor.user.id, membership_id: mentorMembership,
        enrollment_id: enrollment, active: true, mentor_label: 'SYNTHETIC Mentor B' });
      item = await newItem('SYNTHETIC mentor QA frozen submission'); unsubmitted = await newItem('SYNTHETIC mentor QA unsubmitted draft');
      assert.equal((await api(assignment(unsubmitted) + '/draft', { method: 'POST', session: learner, body: { answer: 'SYNTHETIC unsubmitted private learner draft.', expected_revision: 0 } })).status, 200);
      const saved = await api(assignment(item) + '/draft', { method: 'POST', session: learner, body: { answer: 'SYNTHETIC learner response: Plan an imaginary workshop with an invented team.', expected_revision: 0 } });
      assert.equal(saved.status, 200); submission = saved.data.submission;
      let result = await upload(item, text, submission.revision); assert.equal(result.status, 200); submission = result.data.submission; activeFile = submission.attachments[0];
      result = await upload(item, pdf, submission.revision); assert.equal(result.status, 200); submission = result.data.submission;
      removedFile = submission.attachments.find(file => file.filename === pdf.name); assert.ok(removedFile);
      result = await api(assignment(item) + '/attachments/' + removedFile.id + '/remove', { method: 'POST', session: learner, body: { expected_revision: submission.revision } });
      assert.equal(result.status, 200); submission = result.data.submission;
      result = await api(assignment(item) + '/submit', { method: 'POST', session: learner, body: { expected_revision: submission.revision } });
      assert.equal(result.status, 200); submission = result.data.submission; receiptId = submission.receipt.id;
    });
    await check('mentor queue contains only assigned frozen submission summaries and omits unsubmitted answers', async () => {
      const result = await queue(); assert.equal(result.status, 200); assert.equal(result.data.mentor_id, mentor.user.id);
      assert.equal(result.data.environment, 'synthetic-local'); assert.equal(result.headers.get('cache-control'), 'no-store');
      const row = result.data.reviews.find(value => value.receipt_id === receiptId); assert.ok(row);
      assert.equal(row.item_id, item); assert.equal(row.program_id, programB); assert.equal(row.learner_id, learner.user.id);
      assert.equal(row.review_state, 'not_started'); assert.equal(row.review_revision, 0); assert.match(row.learner_label, /^SYNTHETIC /);
      assert.ok(!result.data.reviews.some(value => value.item_id === unsubmitted));
      assert.ok(result.data.reviews.every(value => value.program_id === programB && !('answer' in value) && !('draft' in value) && !('attachments' in value)));
      const selected = await detail(); assert.equal(selected.status, 200); review = selected.data.review;
      assert.equal(review.answer, submission.answer); assert.equal(review.submission_revision, submission.revision);
      assert.deepEqual(review.attachments, submission.attachments); assert.equal(review.draft, null); assert.equal(review.published, null);
    });
    await check('intern role foreign-school receipt and removed-file access are denied without disclosure', async () => {
      assert.equal((await queue(learner)).status, 403); assert.equal((await detail(learner)).status, 403);
      assert.equal((await saveReview('SYNTHETIC denied', 0, { session: learner })).status, 403);
      assert.equal((await publishReview(0, { session: learner })).status, 403);
      assert.equal((await detail(foreign)).status, 404); assert.equal((await download(activeFile.id, foreign)).status, 404);
      assert.equal((await saveReview('SYNTHETIC denied', 0, { session: foreign })).status, 404);
      assert.equal((await publishReview(0, { session: foreign })).status, 404);
      assert.equal((await detail(mentor, C.crypto.randomUUID())).status, 404);
      assert.equal((await detail(mentor, unsubmitted)).status, 404);
      assert.equal((await download(removedFile.id)).status, 404);
      assert.equal((await download(C.crypto.randomUUID())).status, 404);
      assert.equal((await feedback(item, mentor)).status, 403); assert.equal((await feedback(assignmentA)).status, 404);
      const file = await download(); assert.equal(file.status, 200); assert.deepEqual(file.data, text.bytes);
      assert.equal(file.headers.get('content-type'), 'application/octet-stream'); assert.equal(file.headers.get('cache-control'), 'no-store');
      assert.equal(file.headers.get('x-content-type-options'), 'nosniff'); assert.match(file.headers.get('content-security-policy') ?? '', /sandbox/);
      assert.match(file.headers.get('content-disposition') ?? '', /^attachment;/);
    });
    await check('selectors role spoofing extra fields and CSRF origin content-type contracts reject mentor writes', async () => {
      for (const suffix of ['?user_id=1', '?learner_id=1', '?school_id=1', '?role=admin']) {
        assert.equal((await queue(mentor, suffix)).status, 400);
        assert.equal((await api(mentorPath() + suffix, { session: mentor })).status, 400);
        assert.equal((await api(assignment(item) + '/feedback' + suffix, { session: learner })).status, 400);
      }
      for (const field of ['role', 'user_id', 'learner_id', 'receipt_id', 'published_at', 'mentor_label', 'id']) {
        assert.equal((await saveReview('SYNTHETIC denied', 0, { body: { comment: 'SYNTHETIC denied', expected_revision: 0, [field]: 'forged' } })).status, 400);
        assert.equal((await publishReview(0, { body: { expected_revision: 0, [field]: 'forged' } })).status, 400);
      }
      for (const work of [options => saveReview('SYNTHETIC denied', 0, options), options => publishReview(0, options)]) {
        for (const csrf of [null, 'invalid', learner.csrf]) assert.equal((await work({ headers: { 'X-CSRF-Token': csrf } })).status, 403);
        assert.equal((await work({ headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
        assert.equal((await work({ headers: { 'X-EPDG-Request': null } })).status, 403);
        assert.equal((await work({ headers: { 'Content-Type': 'text/plain' } })).status, 415);
      }
    });
    await check('bounded well-formed review drafts require safe revisions and nonblank publication', async () => {
      assert.equal((await publishReview(0)).status, 400);
      const empty = await saveReview(' \n\t', 0); assert.equal(empty.status, 200); review = empty.data.review; assert.equal(review.draft.revision, 1);
      assert.equal((await publishReview(1)).status, 400);
      for (const revision of [-1, 0.5, '1', null, true, {}, 2147483648]) {
        assert.equal((await saveReview('SYNTHETIC rejected', revision)).status, 400); assert.equal((await publishReview(revision)).status, 400);
      }
      for (const comment of [null, 1, {}, [], 'a'.repeat(4001), '😀'.repeat(4000), 'SYNTHETIC\0invalid', '\ud800']) assert.equal((await saveReview(comment, 1)).status, 400);
      const boundary = '€'.repeat(4000); assert.equal(Buffer.byteLength(boundary), 12000);
      const saved = await saveReview(boundary, 1); assert.equal(saved.status, 200); review = saved.data.review;
      assert.equal(review.draft.revision, 2); assert.equal(review.draft.comment, boundary);
    });
    const privateComment = 'SYNTHETIC PRIVATE REVIEW DRAFT: Add a clear fictional next step. <script>inert text</script>';
    await check('saved mentor draft persists across mentor sessions and never leaks to learner feedback or dashboard', async () => {
      const saved = await saveReview(privateComment, review.draft.revision); assert.equal(saved.status, 200); review = saved.data.review;
      assert.equal(review.draft.comment, privateComment); assert.equal(review.published, null);
      assert.deepEqual((await detail(mentor2)).data.review, review);
      const own = await feedback(); assert.equal(own.status, 200); assert.deepEqual(own.data.feedback, []); assert.equal(own.data.receipt_id, receiptId);
      const unsent = await feedback(unsubmitted); assert.equal(unsent.status, 200); assert.equal(unsent.data.receipt_id, null); assert.deepEqual(unsent.data.feedback, []);
      const board = await api('/api/learner/dashboard', { session: learner }); assert.equal(board.status, 200);
      assert.ok(!JSON.stringify(board.data).includes(privateComment)); assert.ok(!JSON.stringify(own.data).includes(privateComment));
      const before = review; assert.equal((await saveReview('SYNTHETIC stale overwrite', review.draft.revision - 1)).status, 409);
      assert.deepEqual((await detail()).data.review, before);
    });
    await check('two mentor sessions saving one revision produce exactly one winner', async () => {
      const revision = review.draft.revision;
      const results = await Promise.all([saveReview('SYNTHETIC concurrent review one', revision), saveReview('SYNTHETIC concurrent review two', revision, { session: mentor2 })]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
      review = results.find(result => result.status === 200).data.review; assert.equal(review.draft.revision, revision + 1);
      assert.deepEqual((await detail()).data.review, review);
    });
    await check('mentor assignment withdrawal hides drafts and blocks a pending save after the revocation lock releases', async () => {
      const before = review; let pending;
      await operator.query('BEGIN');
      try {
        await operator.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['mentor-mapping:' + mapping]);
        pending = saveReview('SYNTHETIC must not survive mapping withdrawal', review.draft.revision);
        for (let attempt = 0; attempt < 50; attempt++) {
          const waiting = (await operator.query("SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rows[0].count;
          if (waiting > 0) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        await operator.query('UPDATE synthetic_learning.mentor_assignments SET active=false WHERE id=$1', [mapping]);
        await operator.query('COMMIT');
        assert.equal((await pending).status, 404);
        assert.ok(!(await queue()).data.reviews.some(value => value.receipt_id === receiptId));
        assert.equal((await detail()).status, 404); assert.equal((await download()).status, 404);
      } catch (error) { await operator.query('ROLLBACK'); throw error; }
      finally { await operator.query('UPDATE synthetic_learning.mentor_assignments SET active=true WHERE id=$1', [mapping]); }
      assert.deepEqual((await detail()).data.review, before);
    });
    await check('learner enrollment membership and eligibility withdrawal close mentor reads writes and frozen download', async () => {
      const before = review;
      try {
        await operator.query('UPDATE synthetic_learning.enrollments SET active=false WHERE id=$1 AND user_id=$2', [enrollment, learner.user.id]);
        assert.equal((await detail()).status, 404); assert.equal((await download()).status, 404);
        assert.equal((await saveReview('SYNTHETIC withdrawn enrollment', review.draft.revision)).status, 404);
      } finally { await operator.query('UPDATE synthetic_learning.enrollments SET active=true WHERE id=$1 AND user_id=$2', [enrollment, learner.user.id]); }
      try {
        await operator.query('UPDATE portal_security.memberships SET active=false WHERE id=$1 AND user_id=$2', [learnerMembership, learner.user.id]);
        assert.equal((await detail()).status, 404); assert.equal((await download()).status, 404);
        assert.equal((await publishReview(review.draft.revision)).status, 404);
        assert.equal((await feedback()).status, 401);
      } finally { await operator.query('UPDATE portal_security.memberships SET active=true WHERE id=$1 AND user_id=$2', [learnerMembership, learner.user.id]); }
      learner = await login('learner-b@epdg.invalid');
      try {
        await operator.query('UPDATE portal_security.account_states SET active=false WHERE user_id=$1', [learner.user.id]);
        assert.equal((await detail()).status, 404); assert.equal((await download()).status, 404);
        assert.equal((await saveReview('SYNTHETIC inactive learner', review.draft.revision)).status, 404);
      } finally { await operator.query('UPDATE portal_security.account_states SET active=true WHERE user_id=$1', [learner.user.id]); }
      learner = await login('learner-b@epdg.invalid'); assert.deepEqual((await detail()).data.review, before);
    });
    await check('mentor membership withdrawal revokes old sessions and restoration requires fresh normal login', async () => {
      const old = mentor;
      try {
        await operator.query('UPDATE portal_security.memberships SET active=false WHERE id=$1 AND user_id=$2', [mentorMembership, mentor.user.id]);
        assert.equal((await queue()).status, 401); assert.equal((await detail()).status, 401); assert.equal((await download()).status, 401);
      } finally { await operator.query('UPDATE portal_security.memberships SET active=true WHERE id=$1 AND user_id=$2', [mentorMembership, mentor.user.id]); }
      assert.equal((await detail(old)).status, 401);
      mentor = await login('school-b@epdg.invalid'); mentor2 = await login('school-b@epdg.invalid');
      assert.deepEqual((await detail()).data.review, review);
    });
    await check('publishing once creates a server-timed immutable record and concurrent retries return the same feedback', async () => {
      const finalComment = 'SYNTHETIC PUBLISHED FEEDBACK: Your invented workshop plan has a clear purpose. Add one fictional next step.';
      const saved = await saveReview(finalComment, review.draft.revision); assert.equal(saved.status, 200); review = saved.data.review;
      const started = Date.now(); const revision = review.draft.revision;
      const results = await Promise.all([publishReview(revision), publishReview(revision, { session: mentor2 })]);
      assert.deepEqual(results.map(result => result.status), [200, 200]);
      review = results[0].data.review; assert.deepEqual(results[1].data.review, review); published = review.published;
      assert.equal(published.comment, finalComment); assert.equal(published.revision, revision);
      assert.match(published.id, /^[0-9a-f-]{36}$/); assert.match(published.mentor_label, /^SYNTHETIC /);
      assert.ok(Date.parse(published.published_at) >= started - 1000 && Date.parse(published.published_at) <= Date.now() + 1000);
      assert.equal((await saveReview('SYNTHETIC forbidden published overwrite', revision)).status, 409);
      assert.equal((await publishReview(revision - 1)).status, 409);
      assert.deepEqual((await publishReview(revision)).data.review.published, published);
    });
    await check('authorized learner receives only published feedback through its own endpoint and dashboard', async () => {
      const result = await feedback(); assert.equal(result.status, 200);
      assert.equal(result.data.learner_id, learner.user.id); assert.equal(result.data.item_id, item); assert.equal(result.data.program_id, programB); assert.equal(result.data.receipt_id, receiptId);
      assert.deepEqual(result.data.feedback, [published]);
      const board = await api('/api/learner/dashboard', { session: learner }); assert.equal(board.status, 200);
      const row = board.data.feedback.find(value => value.id === published.id); assert.ok(row);
      assert.equal(row.comment, published.comment); assert.equal(row.program_id, programB); assert.equal(row.mentor_label, published.mentor_label);
      assert.equal(row.created_at, published.published_at); assert.ok(!JSON.stringify(board.data).includes(privateComment));
    });
    await check('published learner history survives mentor mapping and account withdrawal while mentor access closes', async () => {
      try {
        await operator.query('UPDATE synthetic_learning.mentor_assignments SET active=false WHERE id=$1', [mapping]);
        assert.equal((await detail()).status, 404); assert.equal((await download()).status, 404);
        assert.deepEqual((await feedback()).data.feedback, [published]);
        const board = await api('/api/learner/dashboard', { session: learner }); assert.equal(board.status, 200);
        assert.ok(board.data.feedback.some(value => value.id === published.id));
      } finally { await operator.query('UPDATE synthetic_learning.mentor_assignments SET active=true WHERE id=$1', [mapping]); }
      try {
        await operator.query('UPDATE portal_security.account_states SET active=false WHERE user_id=$1', [mentor.user.id]);
        assert.equal((await detail()).status, 401); assert.deepEqual((await feedback()).data.feedback, [published]);
      } finally { await operator.query('UPDATE portal_security.account_states SET active=true WHERE user_id=$1', [mentor.user.id]); }
      mentor = await login('school-b@epdg.invalid'); mentor2 = await login('school-b@epdg.invalid');
      assert.deepEqual((await detail()).data.review, review);
    });
    await check('own learner withdrawal hides published feedback until current scope is restored', async () => {
      try {
        await operator.query('UPDATE synthetic_learning.enrollments SET active=false WHERE id=$1 AND user_id=$2', [enrollment, learner.user.id]);
        assert.equal((await feedback()).status, 404); assert.equal((await detail()).status, 404);
        const board = await api('/api/learner/dashboard', { session: learner }); assert.equal(board.status, 200);
        assert.ok(!board.data.feedback.some(value => value.id === published.id));
      } finally { await operator.query('UPDATE synthetic_learning.enrollments SET active=true WHERE id=$1 AND user_id=$2', [enrollment, learner.user.id]); }
      try {
        await operator.query('UPDATE portal_security.memberships SET active=false WHERE id=$1 AND user_id=$2', [learnerMembership, learner.user.id]);
        assert.equal((await feedback()).status, 401); assert.equal((await detail()).status, 404);
      } finally { await operator.query('UPDATE portal_security.memberships SET active=true WHERE id=$1 AND user_id=$2', [learnerMembership, learner.user.id]); }
      learner = await login('learner-b@epdg.invalid'); assert.deepEqual((await feedback()).data.feedback, [published]);
    });
    await check('thirteen RLS tables have no browser policies grants or helper execute and runtime cannot forge reviews', async () => {
      const tables = (await operator.query(`SELECT count(*)::int AS tables,count(*) FILTER(WHERE c.relrowsecurity)::int AS rls
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='synthetic_learning' AND c.relkind='r'`)).rows[0];
      assert.deepEqual(tables, { tables: 15, rls: 15 });
      assert.equal((await operator.query("SELECT count(*)::int AS count FROM pg_policies WHERE schemaname='synthetic_learning'")).rows[0].count, 0);
      assert.equal((await operator.query("SELECT count(*)::int AS count FROM information_schema.role_table_grants WHERE table_schema='synthetic_learning' AND grantee IN ('PUBLIC','anon','authenticated')")).rows[0].count, 0);
      assert.equal((await operator.query(`SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE n.nspname='synthetic_learning' AND a.grantee=0 AND a.privilege_type='EXECUTE'`)).rows[0].count, 0);
      assert.equal((await operator.query('SELECT count(*)::int AS count FROM synthetic_learning.mentor_review_feedback WHERE assignment_id=$1 AND receipt_id=$2', [mapping, receiptId])).rows[0].count, 1);
      const app = await C.client(c);
      try {
        const grants = (await app.query(`SELECT
          has_schema_privilege(current_user,'synthetic_learning','CREATE') AS schema_create,
          has_table_privilege(current_user,'synthetic_learning.mentor_assignments','INSERT,UPDATE,DELETE,TRUNCATE') AS mapping_write,
          has_column_privilege(current_user,'synthetic_learning.mentor_review_drafts','comment','INSERT') AS draft_insert,
          has_column_privilege(current_user,'synthetic_learning.mentor_review_drafts','comment','UPDATE') AS draft_update,
          has_column_privilege(current_user,'synthetic_learning.mentor_review_drafts','saved_at','INSERT,UPDATE') AS draft_time,
          has_table_privilege(current_user,'synthetic_learning.mentor_review_drafts','DELETE,TRUNCATE') AS draft_remove,
          has_column_privilege(current_user,'synthetic_learning.mentor_review_feedback','comment','INSERT') AS feedback_insert,
          has_column_privilege(current_user,'synthetic_learning.mentor_review_feedback','id','INSERT') AS feedback_id,
          has_column_privilege(current_user,'synthetic_learning.mentor_review_feedback','published_at','INSERT') AS feedback_time,
          has_column_privilege(current_user,'synthetic_learning.mentor_review_feedback','mentor_label','INSERT') AS feedback_label,
          has_any_column_privilege(current_user,'synthetic_learning.mentor_review_feedback','UPDATE') AS feedback_update,
          has_table_privilege(current_user,'synthetic_learning.mentor_review_feedback','DELETE,TRUNCATE') AS feedback_remove,
          has_function_privilege(current_user,'synthetic_learning.mentor_scope_allowed(uuid,uuid)','EXECUTE') AS scope_execute`)).rows[0];
        assert.deepEqual(grants, { schema_create: false, mapping_write: false, draft_insert: true, draft_update: true, draft_time: false,
          draft_remove: false, feedback_insert: true, feedback_id: false, feedback_time: false, feedback_label: false,
          feedback_update: false, feedback_remove: false, scope_execute: true });
        await assert.rejects(app.query('UPDATE synthetic_learning.mentor_assignments SET active=false WHERE id=$1', [mapping]), error => error.code === '42501');
        await assert.rejects(app.query('UPDATE synthetic_learning.mentor_review_feedback SET comment=$3 WHERE assignment_id=$1 AND receipt_id=$2', [mapping, receiptId, 'SYNTHETIC forbidden']), error => error.code === '42501');
        await assert.rejects(app.query('DELETE FROM synthetic_learning.mentor_review_feedback WHERE assignment_id=$1 AND receipt_id=$2', [mapping, receiptId]), error => error.code === '42501');
        await assert.rejects(app.query('UPDATE synthetic_learning.mentor_review_drafts SET comment=$3,revision=revision+1 WHERE assignment_id=$1 AND receipt_id=$2', [mapping, receiptId, 'SYNTHETIC forbidden after publish']), error => error.code === '23514');
        await assert.rejects(app.query(`INSERT INTO synthetic_learning.mentor_review_feedback(assignment_id,receipt_id,comment,revision)
          VALUES($1,$2,$3,$4)`, [mapping, receiptId, 'SYNTHETIC forged feedback', published.revision]), error => error.code === '23514');
        await assert.rejects(app.query(`INSERT INTO synthetic_learning.mentor_review_feedback(id,assignment_id,receipt_id,comment,revision,published_at,mentor_label)
          VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6)`, [C.crypto.randomUUID(), mapping, receiptId, published.comment, published.revision, 'SYNTHETIC forged mentor']), error => error.code === '42501');
      } finally { await app.end(); }
    });
    if (restart) await check('mentor draft published history frozen download and authenticated sessions survive full local restart', async () => {
      await operator.end(); operator = undefined; control('stop'); stopped = true; control('start'); stopped = false;
      assert.deepEqual((await detail()).data.review, review); assert.deepEqual((await feedback()).data.feedback, [published]);
      assert.deepEqual((await download()).data, text.bytes);
    });
    await check('mentor logout closes review access while owner admin and membership controls remain closed', async () => {
      for (const path of ['/api/admin/stats', '/api/owner/bootstrap', '/api/invitations', '/api/memberships']) {
        assert.equal((await api(path, { session: mentor, ...(path === '/api/admin/stats' ? {} : { method: 'POST', body: {} }) })).status, 503);
      }
      assert.equal((await api('/api/auth/logout', { session: mentor, method: 'POST', body: {} })).status, 200);
      assert.equal((await queue()).status, 401); assert.equal((await detail()).status, 401); assert.equal((await download()).status, 401);
    });
    const sourceFiles = [];
    const visit = dir => { for (const child of C.fs.readdirSync(dir, { withFileTypes: true })) {
      const file = C.path.join(dir, child.name); if (child.isDirectory()) visit(file);
      else if (/\.(?:ts|cjs|json|sql)$/.test(child.name)) sourceFiles.push(file);
    } };
    for (const dir of ['src', 'learning-migrations', 'scripts/local-synthetic']) visit(C.path.join(C.core, dir));
    for (const file of ['package.json', 'package-lock.json']) sourceFiles.push(C.path.join(C.core, file));
    const hash = C.crypto.createHash('sha256');
    for (const file of sourceFiles.sort()) hash.update(C.path.relative(C.core, file).replace(/\\/g, '/')).update('\0').update(C.fs.readFileSync(file)).update('\0');
    const head = spawnSync('C:\\Program Files\\Git\\cmd\\git.exe', ['-C', C.backend, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true, env: C.cleanEnv() }); assert.equal(head.status, 0);
    const evidence = { at: new Date().toISOString(), checksPassed: checks.length, checks, fullRuntimeRestartTested: restart,
      backendBaseRevision: head.stdout.trim(), sourceFingerprint: hash.digest('hex'), sourceFingerprintFileCount: sourceFiles.length,
      sourceFingerprintScope: ['epdg-backend-core/src', 'epdg-backend-core/learning-migrations', 'epdg-backend-core/scripts/local-synthetic', 'epdg-backend-core/package.json', 'epdg-backend-core/package-lock.json'],
      learnerAPasswordOrSessionAccessed: false, credentialsPersisted: false, productionTouched: false, privilegedControlsEnabled: false,
      limitations: ['Local synthetic environment only', 'Published feedback has no grades, awards or enrollment powers', 'Browser acceptance is recorded separately'] };
    C.fs.mkdirSync(evidenceDir, { recursive: true });
    C.fs.writeFileSync(C.path.join(C.state, 'mentor-verification.receipt.json'), JSON.stringify(evidence, null, 2));
    C.fs.writeFileSync(C.path.join(evidenceDir, 'mentor-api-final.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ checksPassed: checks.length, fullRuntimeRestartTested: restart, productionTouched: false, privilegedControlsEnabled: false })); return evidence;
  } catch (error) {
    C.fs.writeFileSync(C.path.join(C.state, 'mentor-verify.failure.json'), JSON.stringify({ at: new Date().toISOString(), check: current, errorType: error.name,
      code: typeof error.code === 'string' ? error.code : undefined }, null, 2));
    console.error('Mentor verification failed at: ' + current); throw error;
  } finally {
    if (operator) await operator.end(); if (stopped) control('start');
    for (const session of sessions) try { await api('/api/auth/logout', { session, method: 'POST', body: {} }); } catch { /* Non-human fixture sessions expire normally. */ }
  }
}
module.exports = { verify };
if (require.main === module) verify({ restart: process.argv.includes('--restart') }).catch(() => { process.exitCode = 1; });
