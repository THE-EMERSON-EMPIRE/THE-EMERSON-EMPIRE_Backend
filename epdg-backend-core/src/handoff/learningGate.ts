import type { PoolClient } from 'pg';
import { handoffEnabled, handoffLock } from './config';

/** Taken before feature reads/writes; receiver uses the same exclusive lock. */
export async function configureHandoffTransaction(client: PoolClient): Promise<void> {
  await client.query("SELECT set_config('synthetic_handoff.enabled',$1,true)", [handoffEnabled() ? 'on' : 'off']);
  await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [handoffLock]);
}

export async function learnerOnboarding(client: PoolClient, learnerId: number, memberships: string[]) {
  const { rows: [row] } = await client.query<{program_id: string; program_title: string; decision: string; withdrawn: boolean;
    received_at: Date; effective: boolean}>(`SELECT p.id AS program_id,p.title AS program_title,
      latest.decision,latest.withdrawn,latest.received_at,synthetic_handoff.enrollment_allowed(e.id) AS effective
    FROM synthetic_handoff.mappings m JOIN synthetic_learning.enrollments e ON e.id=m.enrollment_id AND e.user_id=m.user_id
    JOIN synthetic_learning.programs p ON p.id=e.program_id JOIN portal_security.memberships membership ON membership.id=e.membership_id
    JOIN LATERAL (SELECT decision,withdrawn,received_at FROM synthetic_handoff.events event
      WHERE event.mapping_id=m.id ORDER BY decision_version DESC LIMIT 1) latest ON true
    WHERE m.user_id=$1 AND e.active AND membership.active AND membership.user_id=e.user_id
      AND membership.id=ANY($2::uuid[]) AND membership.school_id=e.school_id AND p.school_id=e.school_id`, [learnerId, memberships]);
  const onboarding = !row ? { status: 'not_received' as const, program_id: null, program_title: null, updated_at: null }
    : { status: row.decision === 'revoked' || row.withdrawn ? 'withdrawn' as const : row.effective ? 'ready' as const : 'held' as const,
      program_id: row.program_id, program_title: row.program_title, updated_at: row.received_at.toISOString() };
  return { success: true as const, environment: 'synthetic-local' as const, learner_id: learnerId,
    generated_at: new Date().toISOString(), privileged_controls_available: false as const, onboarding };
}
