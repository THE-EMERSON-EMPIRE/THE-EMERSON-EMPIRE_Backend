export const CRM_APPLICATION_URL = 'https://emerson-crm.netlify.app/';

export const LEARNER_REGISTRATION_MESSAGE =
  'Intern applications, résumés, and onboarding are managed by Emerson HR in the CRM. This portal cannot create learner accounts; access begins only after HR verifies onboarding.';

export class LearnerRegistrationClosedError extends Error {
  readonly code = 'CRM_APPLICATION_REQUIRED';
  readonly statusCode = 410;

  constructor() {
    super(LEARNER_REGISTRATION_MESSAGE);
    this.name = 'LearnerRegistrationClosedError';
  }
}

export function publicRegistrationGate(role: unknown) {
  if (role !== 'intern') return null;

  return {
    status: 410 as const,
    body: {
      success: false,
      code: 'CRM_APPLICATION_REQUIRED',
      message: LEARNER_REGISTRATION_MESSAGE,
      application_url: CRM_APPLICATION_URL,
      errors: [] as string[],
    },
  };
}

export function assertPublicLearnerRegistrationClosed(role: unknown): void {
  if (role === 'intern') throw new LearnerRegistrationClosedError();
}
