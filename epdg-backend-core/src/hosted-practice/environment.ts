import { validateSyntheticEnvironment } from '../config/synthetic';
import { isHostedPractice, validateHostedPracticeEnvironment } from './profile';

export type PracticeEnvironment = 'synthetic-local' | 'synthetic-hosted';
/** Explicit alternative; the exact local contract remains unchanged. */
export function requirePracticeEnvironment(env: NodeJS.ProcessEnv = process.env): PracticeEnvironment {
  if (isHostedPractice(env)) { validateHostedPracticeEnvironment(env); return 'synthetic-hosted'; }
  if (env.EPDG_HOSTED_PRACTICE_MODE) throw new Error('Invalid hosted practice mode');
  validateSyntheticEnvironment(env); return 'synthetic-local';
}
/** Response label only. Entry/configuration gates validate before feature execution. */
export function practiceEnvironment(env: NodeJS.ProcessEnv = process.env): PracticeEnvironment {
  if (isHostedPractice(env)) { validateHostedPracticeEnvironment(env); return 'synthetic-hosted'; }
  return 'synthetic-local';
}
