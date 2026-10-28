import type { PoolClient } from 'pg';
import { PortalService } from '../security/PortalService';
import { PortalError } from '../security/primitives';
import { assignmentAnswer, assignmentRevision, learningIdentifier, requireSyntheticLearning } from './primitives';
import { checkLearningSchema, publicAttachment, type AttachmentMetadata } from './LearningService';
import { configureHandoffTransaction } from '../handoff/learningGate';
import { checkHandoffSchema } from '../handoff/HandoffService';

type Mentor = Awaited<ReturnType<PortalService['session']>>['user'];
interface Context {
  mapping_id: string; receipt_id: string; item_id: string; program_id: string; learner_id: number; learner_label: string;
  program_title: string; assignment_title: string; answer: string; submitted_at: Date; submission_revision: number;
  attachments: AttachmentMetadata[];
  attempt_number: number;
}
interface ReviewDraft { comment: string; revision: number; saved_at: Date }
interface Published { id: string; comment: string; revision: number; published_at: Date; mentor_label: string }
const scope = `ma.mentor_user_id=$1 AND ma.membership_id=ANY($2::uuid[])
  AND synthetic_learning.mentor_scope_allowed(ma.id,r.id)`;
const source = `FROM synthetic_learning.assignment_receipts r
  JOIN synthetic_learning.enrollments e ON e.id=r.enrollment_id AND e.program_id=r.program_id
  JOIN synthetic_learning.programs p ON p.id=e.program_id
  JOIN synthetic_learning.items i ON i.id=r.item_id AND i.program_id=p.id
  JOIN core.users lu ON lu.id=e.user_id
  JOIN synthetic_learning.mentor_assignments ma ON ma.enrollment_id=e.id`;
const fields = `ma.id AS mapping_id,r.id AS receipt_id,r.item_id,r.program_id,e.user_id AS learner_id,
  lu.name AS learner_label,p.title AS program_title,i.title AS assignment_title,r.answer,r.submitted_at,
  r.revision AS submission_revision,r.attachments,r.attempt_number`;
const conflict = () => new PortalError(409, 'Review changed; reload the saved feedback before continuing');

export function mentorComment(input: unknown): string {
  try { return assignmentAnswer(input); }
  catch { throw new PortalError(400, 'Feedback comment must be plain text within 4000 characters and 12000 UTF-8 bytes'); }
}
function requireMentor(user: Mentor): void {
  if (user.legacy_role !== 'school' || !['school-a@epdg.invalid', 'school-b@epdg.invalid'].includes(user.email) ||
      !user.name.startsWith('SYNTHETIC ')) throw new PortalError(403, 'Mentor review is unavailable for this account');
}
async function context(client: PoolClient, user: Mentor, receiptId: string): Promise<Context> {
  const { rows: [row] } = await client.query<Context>(`SELECT ${fields} ${source} WHERE ${scope} AND r.id=$3`,
    [user.id, user.memberships.map(m => m.id), receiptId]);
  if (!row) throw new PortalError(404, 'Review not found');
  return row;
}
async function lockedContext(client: PoolClient, user: Mentor, receiptId: string): Promise<Context> {
  const initial = await context(client, user, receiptId);
  await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [`mentor-mapping:${initial.mapping_id}`]);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`mentor-review:${initial.mapping_id}:${receiptId}`]);
  return context(client, user, receiptId);
}
async function detail(client: PoolClient, user: Mentor, row: Context) {
  const args = [row.mapping_id, row.receipt_id];
  const { rows: [draft] } = await client.query<ReviewDraft>(`SELECT comment,revision,saved_at FROM synthetic_learning.mentor_review_drafts
    WHERE assignment_id=$1 AND receipt_id=$2`, args);
  const { rows: [published] } = await client.query<Published>(`SELECT id,comment,revision,published_at,mentor_label FROM synthetic_learning.mentor_review_feedback
    WHERE assignment_id=$1 AND receipt_id=$2`, args);
  return { success: true as const, environment: 'synthetic-local' as const, mentor_id: user.id,
    review: { receipt_id: row.receipt_id, item_id: row.item_id, program_id: row.program_id, learner_id: row.learner_id,
      learner_label: row.learner_label, program_title: row.program_title, assignment_title: row.assignment_title,
      answer: row.answer, submitted_at: row.submitted_at.toISOString(), submission_revision: row.submission_revision, attempt_number: row.attempt_number,
      attachments: row.attachments.map(publicAttachment),
      draft: draft ? { ...draft, saved_at: draft.saved_at.toISOString() } : null,
      published: published ? { ...published, published_at: published.published_at.toISOString() } : null } };
}

export class MentorReviewService {
  constructor(private readonly portal = new PortalService()) {}
  private async withMentor<T>(raw: string, work: (client: PoolClient, user: Mentor) => Promise<T>): Promise<T> {
    requireSyntheticLearning();
    return this.portal.withAuthenticatedSession(raw, async (client, user) => {
      requireMentor(user); await configureHandoffTransaction(client);
      // Bound planning of the many-join scope predicate for this transaction only.
      try {
        await client.query('SET LOCAL join_collapse_limit TO 1');
        await client.query('SET LOCAL from_collapse_limit TO 1');
      } catch { throw new PortalError(503, 'Mentor review is unavailable'); }
      await checkLearningSchema(client); await checkHandoffSchema(client); return work(client, user);
    });
  }

  async queue(raw: string) {
    return this.withMentor(raw, async (client, user) => {
      const args = [user.id, user.memberships.map(m => m.id)];
      const { rows: mappings } = await client.query<{id: string}>(`SELECT id FROM synthetic_learning.mentor_assignments
        WHERE mentor_user_id=$1 AND membership_id=ANY($2::uuid[]) ORDER BY id LIMIT 101`, args);
      if (mappings.length > 100) throw new PortalError(503, 'Mentor review is unavailable');
      for (const mapping of mappings) await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [`mentor-mapping:${mapping.id}`]);
      const { rows } = await client.query<Omit<Context, 'mapping_id' | 'answer' | 'attachments'> & { review_state: 'not_started' | 'draft' | 'published'; review_revision: number }>(`SELECT
        r.id AS receipt_id,r.item_id,r.program_id,e.user_id AS learner_id,lu.name AS learner_label,p.title AS program_title,
        i.title AS assignment_title,r.submitted_at,r.revision AS submission_revision,r.attempt_number,
        CASE WHEN f.id IS NOT NULL THEN 'published' WHEN d.revision IS NOT NULL THEN 'draft' ELSE 'not_started' END AS review_state,
        coalesce(f.revision,d.revision,0) AS review_revision ${source}
        LEFT JOIN synthetic_learning.mentor_review_drafts d ON d.assignment_id=ma.id AND d.receipt_id=r.id
        LEFT JOIN synthetic_learning.mentor_review_feedback f ON f.assignment_id=ma.id AND f.receipt_id=r.id
        WHERE ${scope} AND ma.id=ANY($3::uuid[]) ORDER BY r.submitted_at DESC,r.id LIMIT 100`, [...args, mappings.map(m => m.id)]);
      return { success: true as const, environment: 'synthetic-local' as const, mentor_id: user.id,
        reviews: rows.map(row => ({ ...row, submitted_at: row.submitted_at.toISOString() })) };
    });
  }
  async review(raw: string, inputReceipt: unknown) {
    const id = learningIdentifier(inputReceipt);
    return this.withMentor(raw, async (client, user) => detail(client, user, await lockedContext(client, user, id)));
  }
  async saveDraft(raw: string, inputReceipt: unknown, inputComment: unknown, inputRevision: unknown) {
    const id = learningIdentifier(inputReceipt); const comment = mentorComment(inputComment); const expected = assignmentRevision(inputRevision);
    return this.withMentor(raw, async (client, user) => {
      const row = await lockedContext(client, user, id); const current = (await detail(client, user, row)).review;
      if (current.published || (current.draft?.revision ?? 0) !== expected || expected === 2147483647) throw conflict();
      const args = [user.id, user.memberships.map(m => m.id), id, comment, expected + 1];
      const result = expected === 0
        ? await client.query(`INSERT INTO synthetic_learning.mentor_review_drafts(assignment_id,receipt_id,comment,revision)
          SELECT ma.id,r.id,$4,$5 ${source} WHERE ${scope} AND r.id=$3`, args)
        : await client.query(`UPDATE synthetic_learning.mentor_review_drafts d SET comment=$4,revision=$5
          WHERE d.receipt_id=$3 AND d.revision=$6 AND d.assignment_id IN (SELECT ma.id ${source} WHERE ${scope} AND r.id=$3)`, [...args, expected]);
      if (result.rowCount !== 1) throw new PortalError(404, 'Review not found');
      return detail(client, user, row);
    });
  }
  async publish(raw: string, inputReceipt: unknown, inputRevision: unknown) {
    const id = learningIdentifier(inputReceipt); const expected = assignmentRevision(inputRevision);
    return this.withMentor(raw, async (client, user) => {
      const row = await lockedContext(client, user, id); const current = await detail(client, user, row);
      const revision = current.review.published?.revision ?? current.review.draft?.revision ?? 0;
      if (revision !== expected) throw conflict();
      if (current.review.published) return current;
      if (!current.review.draft?.comment.trim()) throw new PortalError(400, 'Save a nonblank feedback draft before publishing');
      const result = await client.query(`INSERT INTO synthetic_learning.mentor_review_feedback(assignment_id,receipt_id,comment,revision)
        SELECT ma.id,r.id,d.comment,d.revision ${source}
        JOIN synthetic_learning.mentor_review_drafts d ON d.assignment_id=ma.id AND d.receipt_id=r.id
        WHERE ${scope} AND r.id=$3 AND d.revision=$4`, [user.id, user.memberships.map(m => m.id), id, expected]);
      if (result.rowCount !== 1) throw new PortalError(404, 'Review not found');
      return detail(client, user, row);
    });
  }
  async download(raw: string, inputReceipt: unknown, inputAttachment: unknown) {
    const id = learningIdentifier(inputReceipt); const attachmentId = learningIdentifier(inputAttachment);
    return this.withMentor(raw, async (client, user) => {
      const row = await lockedContext(client, user, id); const file = row.attachments.find(a => a.id === attachmentId);
      if (!file) throw new PortalError(404, 'Attachment not found');
      const { rows: [result] } = await client.query<{filename: string; bytes: Buffer}>(`SELECT a.filename,a.bytes ${source}
        JOIN synthetic_learning.assignment_attachments a ON a.enrollment_id=r.enrollment_id AND a.item_id=r.item_id AND a.attempt_number=r.attempt_number
        WHERE ${scope} AND r.id=$3 AND a.id=$4 AND NOT a.removed AND a.sha256=$5 AND a.size_bytes=$6`,
      [user.id, user.memberships.map(m => m.id), id, attachmentId, file.sha256, file.size_bytes]);
      if (!result) throw new PortalError(404, 'Attachment not found');
      return result;
    });
  }
}
