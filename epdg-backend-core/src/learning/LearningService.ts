import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { PortalService } from '../security/PortalService';
import { PortalError } from '../security/primitives';
import { assignmentAnswer, assignmentRevision, learningIdentifier, lessonProgress, requireSyntheticLearning } from './primitives';
import manifest from './schema-manifest.json';
import { validateAttachment } from './attachments';
import { configureHandoffTransaction, learnerOnboarding } from '../handoff/learningGate';
import { handoffConfig, handoffEnabled } from '../handoff/config';
import { checkHandoffSchema } from '../handoff/HandoffService';
import { isHostedPractice } from '../hosted-practice/profile';
import { checkHostedDatabase } from '../hosted-practice/readiness';

type Learner = Awaited<ReturnType<PortalService['session']>>['user'];
interface ProgramRow {
  id: string; enrollment_id: string; title: string; summary: string;
  starts_at: Date; ends_at: Date;
}
interface ItemRow {
  id: string; program_id: string; title: string; kind: 'lesson' | 'assignment';
  description: string; content: string; due_at: Date | null; completed_at: Date | null;
  draft_revision: number | null; submitted_revision: number | null;
}
const unavailable = () => new PortalError(503, 'Synthetic learner programs are unavailable');
const iso = (value: Date | null) => value ? value.toISOString() : null;

export async function checkLearningSchema(client: PoolClient): Promise<void> {
  if (isHostedPractice()) { await checkHostedDatabase(client); return; }
  const { rows: [identity] } = await client.query(`SELECT current_database() AS db,current_user AS role,
    host(inet_server_addr()) AS host,inet_server_port() AS port,instance_id::text,
    to_regclass('synthetic_learning.schema_migrations') IS NOT NULL AS present
    FROM synthetic_meta.identity`);
  if (!identity || identity.db !== 'epdg_synthetic' || identity.role !== 'epdg_synthetic_app' ||
      identity.host !== '127.0.0.1' || identity.port !== 55432 ||
      identity.instance_id !== process.env.SYNTHETIC_INSTANCE_ID || !identity.present) throw unavailable();
  const { rows: ledger } = await client.query<{version: string; sha256: string}>('SELECT version,sha256 FROM synthetic_learning.schema_migrations');
  const reviewed = [manifest, ...manifest.extensions];
  if (ledger.length !== reviewed.length || reviewed.some(m => !ledger.some(row => row.version === m.version && row.sha256 === m.sha256))) throw unavailable();
  const { rows: [schema] } = await client.query(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='synthetic_learning' AND c.relkind='r' AND c.relrowsecurity) AS secured_tables,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='synthetic_learning') AS policies,
    has_schema_privilege(current_user,'synthetic_learning','CREATE') AS schema_create,
    has_column_privilege(current_user,'synthetic_learning.completions','completed_at','INSERT') AS timestamp_write,
    has_table_privilege(current_user,'synthetic_learning.completions','UPDATE,DELETE,TRUNCATE') AS completion_admin,
    has_column_privilege(current_user,'synthetic_learning.assignment_drafts','saved_at','INSERT,UPDATE') AS draft_timestamp_write,
    has_any_column_privilege(current_user,'synthetic_learning.assignment_receipts','UPDATE') AS receipt_update,
    has_column_privilege(current_user,'synthetic_learning.assignment_receipts','id','INSERT') AS receipt_id_write,
    has_column_privilege(current_user,'synthetic_learning.assignment_receipts','submitted_at','INSERT') AS receipt_timestamp_write,
    has_column_privilege(current_user,'synthetic_learning.assignment_receipts','attachments','INSERT') AS receipt_manifest_write,
    (has_column_privilege(current_user,'synthetic_learning.assignment_receipts','attempt_number','INSERT,UPDATE') OR
      has_column_privilege(current_user,'synthetic_learning.assignment_receipts','previous_receipt_id','INSERT,UPDATE') OR
      has_column_privilege(current_user,'synthetic_learning.assignment_drafts','attempt_number','INSERT') OR
      has_column_privilege(current_user,'synthetic_learning.assignment_drafts','previous_receipt_id','INSERT')) AS attempt_forgery,
    has_table_privilege(current_user,'synthetic_learning.assignment_attachments','DELETE,TRUNCATE') AS attachment_admin,
    (has_any_column_privilege(current_user,'synthetic_learning.mentor_assignments','INSERT,UPDATE') OR
      has_table_privilege(current_user,'synthetic_learning.mentor_assignments','DELETE,TRUNCATE')) AS mentor_mapping_admin,
    (has_column_privilege(current_user,'synthetic_learning.mentor_review_drafts','saved_at','INSERT,UPDATE') OR
      has_table_privilege(current_user,'synthetic_learning.mentor_review_drafts','DELETE,TRUNCATE')) AS mentor_draft_admin,
    EXISTS(SELECT 1 FROM information_schema.column_privileges WHERE grantee=current_user AND table_schema='synthetic_learning'
      AND table_name='mentor_review_drafts' AND privilege_type='UPDATE' AND column_name NOT IN ('comment','revision')) AS mentor_draft_identifier_write,
    (has_any_column_privilege(current_user,'synthetic_learning.mentor_review_feedback','UPDATE') OR
      has_table_privilege(current_user,'synthetic_learning.mentor_review_feedback','DELETE,TRUNCATE') OR
      has_column_privilege(current_user,'synthetic_learning.mentor_review_feedback','id','INSERT') OR
      has_column_privilege(current_user,'synthetic_learning.mentor_review_feedback','published_at','INSERT') OR
      has_column_privilege(current_user,'synthetic_learning.mentor_review_feedback','mentor_label','INSERT')) AS mentor_feedback_admin,
    NOT has_function_privilege(current_user,'synthetic_learning.mentor_scope_allowed(uuid,uuid)','EXECUTE') AS mentor_scope_missing,
    (NOT has_table_privilege(current_user,'synthetic_learning.assignment_attachments','SELECT') OR
      NOT has_column_privilege(current_user,'synthetic_learning.assignment_attachments','bytes','INSERT') OR
      NOT has_column_privilege(current_user,'synthetic_learning.assignment_attachments','removed','UPDATE')) AS attachment_runtime_missing,
    EXISTS(SELECT 1 FROM information_schema.column_privileges WHERE grantee=current_user AND table_schema='synthetic_learning'
      AND table_name='assignment_attachments' AND ((privilege_type='UPDATE' AND column_name<>'removed') OR
      (privilege_type='INSERT' AND column_name NOT IN ('enrollment_id','program_id','item_id','filename','media_type','bytes')))) AS attachment_metadata_write,
    has_table_privilege(current_user,'synthetic_learning.assignment_drafts','DELETE,TRUNCATE') AS draft_admin,
    has_table_privilege(current_user,'synthetic_learning.assignment_receipts','DELETE,TRUNCATE') AS receipt_admin,
    (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='synthetic_learning' AND NOT t.tgisinternal AND t.tgenabled='O'
      AND t.tgname IN ('assignment_draft_guard','assignment_receipt_guard','assignment_attachment_guard','assignment_attachment_revision',
        'mentor_mapping_guard','mentor_review_draft_guard','mentor_review_feedback_guard')) AS assignment_guards,
    EXISTS(SELECT 1 FROM information_schema.column_privileges WHERE grantee=current_user AND table_schema='synthetic_learning'
      AND table_name='assignment_drafts' AND privilege_type='UPDATE' AND column_name NOT IN ('answer','revision','attempt_number','previous_receipt_id')) AS draft_identifier_write,
    EXISTS(SELECT 1 FROM pg_tables t WHERE t.schemaname='synthetic_learning' AND t.tablename NOT IN
      ('completions','assignment_drafts','assignment_receipts','assignment_attachments','mentor_review_drafts','mentor_review_feedback')
      AND (has_any_column_privilege(current_user,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),'INSERT,UPDATE')
        OR has_table_privilege(current_user,quote_ident(t.schemaname)||'.'||quote_ident(t.tablename),'DELETE,TRUNCATE'))) AS content_admin
    `);
  if (!schema || schema.secured_tables !== manifest.secured_tables || schema.policies !== 0 ||
      schema.schema_create || schema.timestamp_write || schema.completion_admin || schema.content_admin ||
      schema.draft_timestamp_write || schema.receipt_update || schema.receipt_id_write || schema.receipt_timestamp_write ||
      schema.draft_admin || schema.receipt_admin || schema.draft_identifier_write || schema.assignment_guards !== 7 ||
      schema.receipt_manifest_write || schema.attempt_forgery || schema.attachment_admin || schema.attachment_metadata_write || schema.attachment_runtime_missing ||
      schema.mentor_mapping_admin || schema.mentor_draft_admin || schema.mentor_draft_identifier_write || schema.mentor_feedback_admin || schema.mentor_scope_missing) throw unavailable();
}

export async function checkLearningReadiness(): Promise<void> {
  requireSyntheticLearning();
  handoffEnabled();
  const client = await getPool().connect();
  try { await checkLearningSchema(client); await checkHandoffSchema(client); } finally { client.release(); }
}

function requireLearner(user: Learner): void {
  if (user.legacy_role !== 'intern' || !['learner-a@epdg.invalid', 'learner-b@epdg.invalid'].includes(user.email) ||
      !user.name.startsWith('SYNTHETIC ')) throw new PortalError(403, 'Learner programs are unavailable for this account');
}

// Every query is bounded to the validated session's individual enrollment AND
// its current institution membership. A role name alone never grants access.
const enrollmentScope = `e.user_id=$1 AND e.active AND m.user_id=e.user_id AND m.active
  AND m.id=ANY($2::uuid[]) AND m.school_id=e.school_id AND p.school_id=e.school_id
  AND synthetic_handoff.enrollment_allowed(e.id)`;

interface Assignment { item_id: string; program_id: string; enrollment_id: string }
interface Draft { answer: string; revision: number; saved_at: Date; attempt_number: number; previous_receipt_id: string | null }
export interface AttachmentMetadata { id: string; filename: string; media_type: string; size_bytes: number; sha256: string; uploaded_at: Date | string }
interface AttachmentRow extends AttachmentMetadata { removed: boolean }
interface Receipt { id: string; answer: string; revision: number; submitted_at: Date; attachments: AttachmentMetadata[]; attempt_number: number; previous_receipt_id: string | null }
export const publicAttachment = (row: AttachmentMetadata) => ({ id: row.id, filename: row.filename, media_type: row.media_type,
  size_bytes: row.size_bytes, sha256: row.sha256, uploaded_at: new Date(row.uploaded_at).toISOString() });
async function scopedAssignment(client: PoolClient, user: Learner, id: string): Promise<Assignment> {
  const { rows: [item] } = await client.query<Assignment>(`SELECT i.id AS item_id,i.program_id,e.id AS enrollment_id
    FROM synthetic_learning.items i JOIN synthetic_learning.programs p ON p.id=i.program_id
    JOIN synthetic_learning.enrollments e ON e.program_id=p.id
    JOIN portal_security.memberships m ON m.id=e.membership_id
    WHERE ${enrollmentScope} AND i.id=$3 AND i.kind='assignment'`, [user.id, user.memberships.map(m => m.id), id]);
  if (!item) throw new PortalError(404, 'Assignment not found');
  return item;
}
async function assignmentState(client: PoolClient, item: Assignment, user: Learner) {
  const args = [item.enrollment_id, item.item_id];
  const { rows: [draft] } = await client.query<Draft>(`SELECT answer,revision,saved_at,attempt_number,previous_receipt_id FROM synthetic_learning.assignment_drafts
    WHERE enrollment_id=$1 AND item_id=$2`, args);
  const attempt = draft?.attempt_number ?? 1;
  const { rows: [receipt] } = await client.query<Receipt>(`SELECT id,answer,revision,submitted_at,attachments,attempt_number,previous_receipt_id FROM synthetic_learning.assignment_receipts
    WHERE enrollment_id=$1 AND item_id=$2 AND attempt_number=$3`, [...args, attempt]);
  const { rows: attachments } = await client.query<AttachmentRow>(`SELECT id,filename,media_type,size_bytes,sha256,uploaded_at,removed
    FROM synthetic_learning.assignment_attachments WHERE enrollment_id=$1 AND item_id=$2 AND attempt_number=$3 ORDER BY uploaded_at,id`, [...args, attempt]);
  const published = receipt ? (await client.query<{present: boolean}>('SELECT EXISTS(SELECT 1 FROM synthetic_learning.mentor_review_feedback WHERE receipt_id=$1) AS present', [receipt.id])).rows[0].present : false;
  return { success: true as const, environment: 'synthetic-local' as const, learner_id: user.id,
    submission: { item_id: item.item_id, program_id: item.program_id,
      state: receipt ? 'submitted' as const : draft ? 'draft' as const : 'not_started' as const,
      answer: receipt?.answer ?? draft?.answer ?? '', revision: receipt?.revision ?? draft?.revision ?? 0,
      saved_at: draft ? draft.saved_at.toISOString() : null,
      attempt_number: attempt, previous_receipt_id: draft?.previous_receipt_id ?? null,
      can_start_revision: Boolean(receipt && published && attempt < 5 && receipt.revision < 2147483647),
      attachments: (receipt ? receipt.attachments : attachments.filter(a => !a.removed)).map(publicAttachment),
      removed_attachments: receipt ? [] : attachments.filter(a => a.removed).map(publicAttachment),
      receipt: receipt ? { id: receipt.id, submitted_at: receipt.submitted_at.toISOString(), revision: receipt.revision } : null } };
}
async function lockAssignment(client: PoolClient, user: Learner, id: string): Promise<Assignment> {
  const item = await scopedAssignment(client, user, id);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${item.enrollment_id}:${item.item_id}`]);
  // Recheck the institution and enrollment after waiting for another write.
  return scopedAssignment(client, user, id);
}
const revisionConflict = () => new PortalError(409, 'Assignment changed; reload the saved response before continuing');

async function loadPrograms(client: PoolClient, user: Learner) {
  const memberships = user.memberships.map(m => m.id);
  const { rows: programs } = await client.query<ProgramRow>(`SELECT p.id,e.id AS enrollment_id,p.title,p.summary,p.starts_at,p.ends_at
    FROM synthetic_learning.enrollments e
    JOIN synthetic_learning.programs p ON p.id=e.program_id
    JOIN portal_security.memberships m ON m.id=e.membership_id
    WHERE ${enrollmentScope} ORDER BY p.starts_at,p.title,p.id`, [user.id, memberships]);
  const { rows: items } = await client.query<ItemRow>(`SELECT i.id,i.program_id,i.title,i.kind,i.description,i.content,i.due_at,c.completed_at,
    d.revision AS draft_revision,r.revision AS submitted_revision
    FROM synthetic_learning.enrollments e
    JOIN synthetic_learning.programs p ON p.id=e.program_id
    JOIN portal_security.memberships m ON m.id=e.membership_id
    JOIN synthetic_learning.items i ON i.program_id=p.id
    LEFT JOIN synthetic_learning.completions c ON c.enrollment_id=e.id AND c.item_id=i.id AND c.program_id=p.id
    LEFT JOIN synthetic_learning.assignment_drafts d ON d.enrollment_id=e.id AND d.item_id=i.id AND d.program_id=p.id
    LEFT JOIN synthetic_learning.assignment_receipts r ON r.enrollment_id=e.id AND r.item_id=i.id AND r.program_id=p.id AND r.attempt_number=coalesce(d.attempt_number,1)
    WHERE ${enrollmentScope} ORDER BY p.id,i.position,i.id`, [user.id, memberships]);
  const mapped = programs.map(program => {
    const content = items.filter(item => item.program_id === program.id).map(item => ({
      id: item.id, title: item.title, kind: item.kind, description: item.description, content: item.content,
      due_at: iso(item.due_at), status: item.kind === 'assignment'
        ? item.submitted_revision ? 'submitted' as const : item.draft_revision ? 'draft' as const : 'not_started' as const
        : item.completed_at ? 'completed' as const : 'not_started' as const,
      completed_at: item.kind === 'lesson' ? iso(item.completed_at) : null,
    }));
    const progress = lessonProgress(content);
    return { id: program.id, enrollment_id: program.enrollment_id, title: program.title, summary: program.summary,
      status: progress.total_items > 0 && progress.completed_items === progress.total_items ? 'completed' as const : 'active' as const,
      starts_at: program.starts_at.toISOString(), ends_at: program.ends_at.toISOString(), ...progress,
      next_item_id: content.find(item => item.kind === 'lesson' && item.status !== 'completed')?.id ?? null, items: content };
  });
  return { programs: mapped, memberships };
}

export class LearningService {
  constructor(private readonly portal = new PortalService()) {}

  private async withLearner<T>(raw: string, work: (client: PoolClient, user: Learner) => Promise<T>): Promise<T> {
    requireSyntheticLearning();
    return this.portal.withAuthenticatedSession(raw, async (client, user) => {
      requireLearner(user); await configureHandoffTransaction(client);
      await checkLearningSchema(client); await checkHandoffSchema(client); return work(client, user);
    });
  }

  async onboarding(raw: string) {
    const config = handoffConfig(); config.key.fill(0);
    return this.withLearner(raw, (client, user) => learnerOnboarding(client, user.id, user.memberships.map(m => m.id)));
  }

  async dashboard(raw: string) {
    return this.withLearner(raw, async (client, user) => {
      const { programs, memberships } = await loadPrograms(client, user);
      const { rows: feedback } = await client.query<{ id: string; program_id: string; program_title: string; title: string;
        comment: string; created_at: Date; mentor_label: string }>(`SELECT f.id,p.id AS program_id,p.title AS program_title,
        f.title,f.comment,f.created_at,f.mentor_label FROM synthetic_learning.feedback f
        JOIN synthetic_learning.enrollments e ON e.id=f.enrollment_id
        JOIN synthetic_learning.programs p ON p.id=e.program_id
        JOIN portal_security.memberships m ON m.id=e.membership_id
        WHERE ${enrollmentScope} ORDER BY f.created_at DESC,f.id LIMIT 20`, [user.id, memberships]);
      // Published feedback is historical to the learner's own receipt. Later
      // mentor revocation removes future mentor access, not published history.
      const { rows: publishedFeedback } = await client.query<typeof feedback[number]>(`SELECT f.id,p.id AS program_id,p.title AS program_title,
        'Assignment feedback: '||i.title AS title,f.comment,f.published_at AS created_at,f.mentor_label
        FROM synthetic_learning.mentor_review_feedback f JOIN synthetic_learning.assignment_receipts r ON r.id=f.receipt_id
        JOIN synthetic_learning.enrollments e ON e.id=r.enrollment_id AND e.program_id=r.program_id
        JOIN synthetic_learning.programs p ON p.id=e.program_id JOIN portal_security.memberships m ON m.id=e.membership_id
        JOIN synthetic_learning.items i ON i.id=r.item_id AND i.program_id=p.id
        WHERE ${enrollmentScope} ORDER BY f.published_at DESC,f.id LIMIT 20`, [user.id, memberships]);
      const { rows: resources } = await client.query<{ id: string; program_id: string; title: string; description: string; body: string }>(`SELECT r.id,r.program_id,r.title,r.description,r.body
        FROM synthetic_learning.resources r JOIN synthetic_learning.programs p ON p.id=r.program_id
        JOIN synthetic_learning.enrollments e ON e.program_id=p.id
        JOIN portal_security.memberships m ON m.id=e.membership_id
        WHERE ${enrollmentScope} ORDER BY p.title,r.title,r.id LIMIT 30`, [user.id, memberships]);
      const completed = programs.reduce((sum, p) => sum + p.completed_items, 0);
      const total = programs.reduce((sum, p) => sum + p.total_items, 0);
      const upcoming = programs.flatMap(program => program.items.filter(item => item.status !== 'completed' && item.status !== 'submitted').map(item => ({
        id: item.id, program_id: program.id, program_title: program.title, title: item.title,
        kind: item.kind, due_at: item.due_at, status: item.status,
      }))).sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999') || a.id.localeCompare(b.id)).slice(0, 12);
      return { success: true as const, environment: 'synthetic-local' as const, learner_id: user.id, generated_at: new Date().toISOString(),
        summary: { active_programs: programs.filter(p => p.status === 'active').length, completed_items: completed,
          total_items: total, progress_percent: total ? Math.round(completed * 100 / total) : 0 },
        programs: programs.map(({ items: _items, ...program }) => program), upcoming,
        feedback: [...feedback, ...publishedFeedback].sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || a.id.localeCompare(b.id))
          .slice(0, 20).map(row => ({ ...row, created_at: row.created_at.toISOString() })), resources };
    });
  }

  async program(raw: string, identifier: unknown) {
    const id = learningIdentifier(identifier);
    return this.withLearner(raw, async (client, user) => {
      const { programs } = await loadPrograms(client, user);
      const program = programs.find(p => p.id === id);
      if (!program) throw new PortalError(404, 'Program or lesson not found');
      return { success: true as const, environment: 'synthetic-local' as const, learner_id: user.id, program };
    });
  }

  async submission(raw: string, identifier: unknown) {
    const id = learningIdentifier(identifier);
    return this.withLearner(raw, async (client, user) => assignmentState(client, await lockAssignment(client, user, id), user));
  }

  async assignmentFeedback(raw: string, identifier: unknown) {
    const id = learningIdentifier(identifier);
    return this.withLearner(raw, async (client, user) => {
      const item = await lockAssignment(client, user, id);
      const args = [user.id, user.memberships.map(m => m.id), item.item_id];
      const { rows: [receipt] } = await client.query<{id: string}>(`SELECT r.id FROM synthetic_learning.assignment_receipts r
        JOIN synthetic_learning.assignment_drafts d ON d.enrollment_id=r.enrollment_id AND d.item_id=r.item_id AND d.attempt_number=r.attempt_number
        JOIN synthetic_learning.enrollments e ON e.id=r.enrollment_id AND e.program_id=r.program_id
        JOIN synthetic_learning.programs p ON p.id=e.program_id JOIN portal_security.memberships m ON m.id=e.membership_id
        WHERE ${enrollmentScope} AND r.item_id=$3`, args);
      const { rows: feedback } = await client.query<{id: string; comment: string; revision: number; published_at: Date; mentor_label: string}>(`SELECT f.id,f.comment,f.revision,f.published_at,f.mentor_label
        FROM synthetic_learning.mentor_review_feedback f JOIN synthetic_learning.assignment_receipts r ON r.id=f.receipt_id
        JOIN synthetic_learning.assignment_drafts d ON d.enrollment_id=r.enrollment_id AND d.item_id=r.item_id AND d.attempt_number=r.attempt_number
        JOIN synthetic_learning.enrollments e ON e.id=r.enrollment_id AND e.program_id=r.program_id
        JOIN synthetic_learning.programs p ON p.id=e.program_id JOIN portal_security.memberships m ON m.id=e.membership_id
        WHERE ${enrollmentScope} AND r.item_id=$3 ORDER BY f.published_at,f.id`, args);
      return { success: true as const, environment: 'synthetic-local' as const, learner_id: user.id,
        item_id: item.item_id, program_id: item.program_id, receipt_id: receipt?.id ?? null,
        feedback: feedback.map(f => ({ ...f, published_at: f.published_at.toISOString() })) };
    });
  }

  async startRevision(raw: string, identifier: unknown, inputReceipt: unknown, inputRevision: unknown) {
    const id = learningIdentifier(identifier); const expected = assignmentRevision(inputRevision);
    let receiptId: string;
    try { receiptId = learningIdentifier(inputReceipt); } catch { throw new PortalError(400, 'A valid latest receipt is required'); }
    return this.withLearner(raw, async (client, user) => {
      const item = await lockAssignment(client, user, id); const current = await assignmentState(client, item, user);
      if (current.submission.state === 'draft' && current.submission.previous_receipt_id === receiptId && current.submission.revision === expected + 1) {
        const prior = (await client.query<{revision: number}>('SELECT revision FROM synthetic_learning.assignment_receipts WHERE id=$1 AND enrollment_id=$2 AND item_id=$3',
          [receiptId, item.enrollment_id, item.item_id])).rows[0];
        if (prior?.revision === expected) return current;
      }
      if (current.submission.receipt?.id !== receiptId || current.submission.revision !== expected || !current.submission.can_start_revision) {
        throw new PortalError(409, 'A new revision requires published feedback on the latest submission and an available attempt');
      }
      const result = await client.query(`UPDATE synthetic_learning.assignment_drafts d SET attempt_number=attempt_number+1,
        previous_receipt_id=$4,revision=revision+1 WHERE d.item_id=$3 AND d.revision=$5 AND d.enrollment_id IN (
          SELECT e.id FROM synthetic_learning.enrollments e JOIN synthetic_learning.programs p ON p.id=e.program_id
          JOIN portal_security.memberships m ON m.id=e.membership_id WHERE ${enrollmentScope})
        AND EXISTS(SELECT 1 FROM synthetic_learning.assignment_receipts r WHERE r.id=$4 AND r.enrollment_id=d.enrollment_id
          AND r.item_id=d.item_id AND r.attempt_number=d.attempt_number
          AND EXISTS(SELECT 1 FROM synthetic_learning.mentor_review_feedback f WHERE f.receipt_id=r.id))`,
      [user.id, user.memberships.map(m => m.id), item.item_id, receiptId, expected]);
      if (result.rowCount !== 1) throw new PortalError(404, 'Assignment not found');
      return assignmentState(client, item, user);
    });
  }

  async attempts(raw: string, identifier: unknown) {
    const id = learningIdentifier(identifier);
    return this.withLearner(raw, async (client, user) => {
      const item = await lockAssignment(client, user, id);
      const { rows } = await client.query<Receipt>(`SELECT r.id,r.answer,r.revision,r.submitted_at,r.attachments,r.attempt_number,r.previous_receipt_id
        FROM synthetic_learning.assignment_receipts r JOIN synthetic_learning.enrollments e ON e.id=r.enrollment_id AND e.program_id=r.program_id
        JOIN synthetic_learning.programs p ON p.id=e.program_id JOIN portal_security.memberships m ON m.id=e.membership_id
        WHERE ${enrollmentScope} AND r.item_id=$3 ORDER BY r.attempt_number LIMIT 5`, [user.id, user.memberships.map(m => m.id), item.item_id]);
      const { rows: feedback } = await client.query<{receipt_id: string; id: string; comment: string; revision: number; published_at: Date; mentor_label: string}>(`SELECT receipt_id,id,comment,revision,published_at,mentor_label
        FROM synthetic_learning.mentor_review_feedback WHERE receipt_id=ANY($1::uuid[]) ORDER BY published_at,id`, [rows.map(r => r.id)]);
      return { success: true as const, environment: 'synthetic-local' as const, learner_id: user.id, item_id: item.item_id, program_id: item.program_id,
        attempts: rows.map(r => ({ receipt_id: r.id, attempt_number: r.attempt_number, answer: r.answer,
          attachments: r.attachments.map(publicAttachment), submitted_at: r.submitted_at.toISOString(), submission_revision: r.revision,
          published_feedback: feedback.filter(f => f.receipt_id === r.id).map(({ receipt_id: _receiptId, ...f }) => ({ ...f, published_at: f.published_at.toISOString() })) })) };
    });
  }

  async downloadAttemptAttachment(raw: string, identifier: unknown, inputReceipt: unknown, inputAttachment: unknown) {
    const id = learningIdentifier(identifier); const receiptId = learningIdentifier(inputReceipt); const attachmentId = learningIdentifier(inputAttachment);
    return this.withLearner(raw, async (client, user) => {
      const item = await lockAssignment(client, user, id);
      const { rows: [receipt] } = await client.query<Receipt>(`SELECT r.id,r.attempt_number,r.attachments FROM synthetic_learning.assignment_receipts r
        JOIN synthetic_learning.enrollments e ON e.id=r.enrollment_id AND e.program_id=r.program_id
        JOIN synthetic_learning.programs p ON p.id=e.program_id JOIN portal_security.memberships m ON m.id=e.membership_id
        WHERE ${enrollmentScope} AND r.item_id=$3 AND r.id=$4`, [user.id, user.memberships.map(m => m.id), item.item_id, receiptId]);
      const metadata = receipt?.attachments.find(a => a.id === attachmentId);
      if (!receipt || !metadata) throw new PortalError(404, 'Attachment not found');
      const { rows: [file] } = await client.query<{filename: string; bytes: Buffer}>(`SELECT a.filename,a.bytes FROM synthetic_learning.assignment_attachments a
        JOIN synthetic_learning.enrollments e ON e.id=a.enrollment_id JOIN synthetic_learning.programs p ON p.id=e.program_id
        JOIN portal_security.memberships m ON m.id=e.membership_id WHERE ${enrollmentScope} AND a.item_id=$3 AND a.id=$4
        AND a.attempt_number=$5 AND NOT a.removed AND a.sha256=$6 AND a.size_bytes=$7`,
      [user.id, user.memberships.map(m => m.id), item.item_id, attachmentId, receipt.attempt_number, metadata.sha256, metadata.size_bytes]);
      if (!file) throw new PortalError(404, 'Attachment not found'); return file;
    });
  }

  async attachmentUploadPreflight(raw: string, identifier: unknown): Promise<void> {
    const id = learningIdentifier(identifier);
    await this.withLearner(raw, async (client, user) => {
      const item = await lockAssignment(client, user, id); const current = (await assignmentState(client, item, user)).submission;
      if (current.state !== 'draft' || current.revision === 2147483647) throw new PortalError(409, 'Save a writable draft before attaching files');
      if (current.attachments.length >= 3 || current.attachments.length + current.removed_attachments.length >= 6) {
        throw new PortalError(409, 'Assignment attachment limit reached');
      }
    });
  }

  private async withEditableAttachment(raw: string, identifier: unknown, inputRevision: unknown,
    work: (client: PoolClient, item: Assignment, user: Learner) => Promise<void>) {
    const id = learningIdentifier(identifier); const expected = assignmentRevision(inputRevision);
    return this.withLearner(raw, async (client, user) => {
      const item = await lockAssignment(client, user, id); const current = (await assignmentState(client, item, user)).submission;
      if (current.state !== 'draft' || current.revision !== expected || expected === 2147483647) throw revisionConflict();
      try { await work(client, item, user); }
      catch (error) {
        if (['23514', '23505'].includes((error as {code?: string}).code ?? '')) throw new PortalError(409, 'Attachment state changed or its limit was reached; reload before continuing');
        throw error;
      }
      return assignmentState(client, item, user);
    });
  }

  async uploadAttachment(raw: string, identifier: unknown, inputRevision: unknown, filename: string, mediaType: string, bytes: Buffer) {
    const upload = validateAttachment(filename, mediaType, bytes);
    return this.withEditableAttachment(raw, identifier, inputRevision, async (client, item, user) => {
      const result = await client.query(`INSERT INTO synthetic_learning.assignment_attachments(enrollment_id,program_id,item_id,filename,media_type,bytes)
        SELECT e.id,p.id,i.id,$4,$5,$6 FROM synthetic_learning.enrollments e
        JOIN synthetic_learning.programs p ON p.id=e.program_id JOIN portal_security.memberships m ON m.id=e.membership_id
        JOIN synthetic_learning.items i ON i.program_id=p.id WHERE ${enrollmentScope} AND i.id=$3 AND i.kind='assignment'`,
      [user.id, user.memberships.map(m => m.id), item.item_id, upload.filename, upload.mediaType, upload.bytes]);
      if (result.rowCount !== 1) throw new PortalError(404, 'Assignment not found');
    });
  }

  async setAttachmentRemoved(raw: string, identifier: unknown, attachmentIdentifier: unknown, inputRevision: unknown, removed: boolean) {
    const attachmentId = learningIdentifier(attachmentIdentifier);
    return this.withEditableAttachment(raw, identifier, inputRevision, async (client, item, user) => {
      const result = await client.query(`UPDATE synthetic_learning.assignment_attachments a SET removed=$4
        WHERE a.id=$5 AND a.item_id=$3 AND a.removed<>$4 AND a.attempt_number=(SELECT attempt_number FROM synthetic_learning.assignment_drafts d WHERE d.enrollment_id=a.enrollment_id AND d.item_id=a.item_id) AND a.enrollment_id IN (
          SELECT e.id FROM synthetic_learning.enrollments e JOIN synthetic_learning.programs p ON p.id=e.program_id
          JOIN portal_security.memberships m ON m.id=e.membership_id WHERE ${enrollmentScope})`,
      [user.id, user.memberships.map(m => m.id), item.item_id, removed, attachmentId]);
      if (result.rowCount !== 1) throw new PortalError(404, 'Active attachment not found');
    });
  }

  async downloadAttachment(raw: string, identifier: unknown, attachmentIdentifier: unknown) {
    const id = learningIdentifier(identifier); const attachmentId = learningIdentifier(attachmentIdentifier);
    return this.withLearner(raw, async (client, user) => {
      const item = await lockAssignment(client, user, id); const current = (await assignmentState(client, item, user)).submission;
      const metadata = current.attachments.find(a => a.id === attachmentId);
      if (!metadata) throw new PortalError(404, 'Attachment not found');
      const { rows: [file] } = await client.query<{filename: string; bytes: Buffer}>(`SELECT a.filename,a.bytes FROM synthetic_learning.assignment_attachments a
        JOIN synthetic_learning.enrollments e ON e.id=a.enrollment_id JOIN synthetic_learning.programs p ON p.id=e.program_id
        JOIN portal_security.memberships m ON m.id=e.membership_id
        WHERE ${enrollmentScope} AND a.item_id=$3 AND a.id=$4 AND NOT a.removed AND a.sha256=$5 AND a.size_bytes=$6 AND a.attempt_number=$7`,
      [user.id, user.memberships.map(m => m.id), item.item_id, attachmentId, metadata.sha256, metadata.size_bytes, current.attempt_number]);
      if (!file) throw new PortalError(404, 'Attachment not found');
      return file;
    });
  }

  async saveDraft(raw: string, identifier: unknown, inputAnswer: unknown, inputRevision: unknown) {
    const id = learningIdentifier(identifier); const answer = assignmentAnswer(inputAnswer); const expected = assignmentRevision(inputRevision);
    return this.withLearner(raw, async (client, user) => {
      const item = await lockAssignment(client, user, id);
      const current = await assignmentState(client, item, user);
      if (current.submission.state === 'submitted' || current.submission.revision !== expected || expected === 2147483647) throw revisionConflict();
      const args = [user.id, user.memberships.map(m => m.id), id, answer, expected + 1];
      const scope = `SELECT e.id FROM synthetic_learning.enrollments e JOIN synthetic_learning.programs p ON p.id=e.program_id
        JOIN portal_security.memberships m ON m.id=e.membership_id JOIN synthetic_learning.items i ON i.program_id=p.id
        WHERE ${enrollmentScope} AND i.id=$3 AND i.kind='assignment'`;
      const result = expected === 0
        ? await client.query(`INSERT INTO synthetic_learning.assignment_drafts(enrollment_id,program_id,item_id,answer,revision)
          SELECT e.id,p.id,i.id,$4,$5 FROM synthetic_learning.enrollments e
          JOIN synthetic_learning.programs p ON p.id=e.program_id JOIN portal_security.memberships m ON m.id=e.membership_id
          JOIN synthetic_learning.items i ON i.program_id=p.id WHERE ${enrollmentScope} AND i.id=$3 AND i.kind='assignment'`, args)
        : await client.query(`UPDATE synthetic_learning.assignment_drafts SET answer=$4,revision=$5
          WHERE enrollment_id IN (${scope}) AND item_id=$3 AND revision=$6`, [...args, expected]);
      if (result.rowCount !== 1) throw new PortalError(404, 'Assignment not found');
      return assignmentState(client, item, user);
    });
  }

  async submitAssignment(raw: string, identifier: unknown, inputRevision: unknown) {
    const id = learningIdentifier(identifier); const expected = assignmentRevision(inputRevision);
    return this.withLearner(raw, async (client, user) => {
      const item = await lockAssignment(client, user, id);
      const current = await assignmentState(client, item, user);
      if (current.submission.revision !== expected) throw revisionConflict();
      if (current.submission.state === 'submitted') return current;
      if (current.submission.state !== 'draft' || !current.submission.answer.trim()) throw new PortalError(400, 'Save a nonblank draft before submitting');
      const result = await client.query(`INSERT INTO synthetic_learning.assignment_receipts(enrollment_id,program_id,item_id,answer,revision)
        SELECT e.id,p.id,i.id,d.answer,d.revision FROM synthetic_learning.enrollments e
        JOIN synthetic_learning.programs p ON p.id=e.program_id JOIN portal_security.memberships m ON m.id=e.membership_id
        JOIN synthetic_learning.items i ON i.program_id=p.id
        JOIN synthetic_learning.assignment_drafts d ON d.enrollment_id=e.id AND d.item_id=i.id AND d.program_id=p.id
        WHERE ${enrollmentScope} AND i.id=$3 AND i.kind='assignment' AND d.revision=$4`,
      [user.id, user.memberships.map(m => m.id), id, expected]);
      if (result.rowCount !== 1) throw new PortalError(404, 'Assignment not found');
      return assignmentState(client, item, user);
    });
  }

  async complete(raw: string, identifier: unknown) {
    const id = learningIdentifier(identifier);
    return this.withLearner(raw, async (client, user) => {
      const { rows: [item] } = await client.query<{ id: string; kind: string; program_id: string; enrollment_id: string }>(`SELECT i.id,i.kind,i.program_id,e.id AS enrollment_id
        FROM synthetic_learning.items i JOIN synthetic_learning.programs p ON p.id=i.program_id
        JOIN synthetic_learning.enrollments e ON e.program_id=p.id
        JOIN portal_security.memberships m ON m.id=e.membership_id
        WHERE ${enrollmentScope} AND i.id=$3`, [user.id, user.memberships.map(m => m.id), id]);
      if (!item) throw new PortalError(404, 'Program or lesson not found');
      if (item.kind !== 'lesson') throw new PortalError(403, 'Assignments use the separate submission flow');
      // Recheck current enrollment/membership in the write statement as well as
      // the earlier lesson lookup. An operator's concurrent deactivation must
      // never turn a stale lookup into a new completion.
      const parameters = [user.id, user.memberships.map(m => m.id), item.id];
      const { rows: inserted } = await client.query<{completed_at: Date}>(`INSERT INTO synthetic_learning.completions(enrollment_id,program_id,item_id)
        SELECT e.id,p.id,i.id FROM synthetic_learning.items i
        JOIN synthetic_learning.programs p ON p.id=i.program_id
        JOIN synthetic_learning.enrollments e ON e.program_id=p.id
        JOIN portal_security.memberships m ON m.id=e.membership_id
        WHERE ${enrollmentScope} AND i.id=$3 AND i.kind='lesson'
        ON CONFLICT(enrollment_id,item_id) DO NOTHING RETURNING completed_at`, parameters);
      const completed = inserted[0] ?? (await client.query<{completed_at: Date}>(`SELECT c.completed_at
        FROM synthetic_learning.completions c JOIN synthetic_learning.items i ON i.id=c.item_id AND i.program_id=c.program_id
        JOIN synthetic_learning.programs p ON p.id=i.program_id
        JOIN synthetic_learning.enrollments e ON e.id=c.enrollment_id AND e.program_id=p.id
        JOIN portal_security.memberships m ON m.id=e.membership_id
        WHERE ${enrollmentScope} AND i.id=$3 AND i.kind='lesson'`, parameters)).rows[0];
      if (!completed) throw new PortalError(404, 'Program or lesson not found');
      return { success: true as const, item_id: item.id, completed_at: completed.completed_at.toISOString(), already_completed: inserted.length === 0 };
    });
  }
}
