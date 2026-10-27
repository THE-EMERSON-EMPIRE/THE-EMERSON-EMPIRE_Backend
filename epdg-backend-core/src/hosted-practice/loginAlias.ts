import { isHostedPractice, validateHostedPracticeEnvironment } from './profile';

/** Sign-in/recovery routing only. It grants no identity, membership or role. */
export function resolvePracticeEmail(email: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!isHostedPractice(env)) return email;
  const profile = validateHostedPracticeEnvironment(env);
  return email === profile.loginAlias ? 'learner-b@epdg.invalid' : email;
}
