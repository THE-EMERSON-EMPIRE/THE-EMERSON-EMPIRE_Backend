import { requirePracticeEnvironment } from '../hosted-practice/environment';
import { PortalError } from '../security/primitives';

export function requireSyntheticLearning(env: NodeJS.ProcessEnv = process.env): void {
  try { requirePracticeEnvironment(env); }
  catch { throw new PortalError(503, 'Learner programs are available only in the isolated synthetic environment'); }
}

export function learningIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new PortalError(404, 'Program or lesson not found');
  }
  return value.toLowerCase();
}

export function lessonProgress(items: ReadonlyArray<{ kind: 'lesson' | 'assignment'; completed_at: string | null }>) {
  const lessons = items.filter(item => item.kind === 'lesson');
  const completed = lessons.filter(item => item.completed_at !== null).length;
  return { completed_items: completed, total_items: lessons.length,
    progress_percent: lessons.length ? Math.round(completed * 100 / lessons.length) : 0 };
}

export function assignmentRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647) {
    throw new PortalError(400, 'A nonnegative integer revision is required');
  }
  return value;
}

export function assignmentAnswer(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4000 || Buffer.byteLength(value, 'utf8') > 12000 ||
      value.includes('\0') || Buffer.from(value, 'utf8').toString('utf8') !== value) {
    throw new PortalError(400, 'Answer must be plain text within 4000 characters and 12000 UTF-8 bytes');
  }
  return value;
}
