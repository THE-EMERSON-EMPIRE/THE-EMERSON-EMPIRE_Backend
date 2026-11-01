'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { AuthService } = require('../dist/services/AuthService.js');
const { register } = require('../dist/controllers/AuthController.js');
const {
  CRM_APPLICATION_URL,
  LEARNER_REGISTRATION_MESSAGE,
  LearnerRegistrationClosedError,
  assertPublicLearnerRegistrationClosed,
  publicRegistrationGate,
} = require('../dist/security/publicRegistrationGate.js');

test('intern self-registration gets a fixed CRM referral without reflecting request data', () => {
  const result = publicRegistrationGate('intern');
  assert.deepEqual(result, {
    status: 410,
    body: {
      success: false,
      code: 'CRM_APPLICATION_REQUIRED',
      message: LEARNER_REGISTRATION_MESSAGE,
      application_url: CRM_APPLICATION_URL,
      errors: [],
    },
  });
  assert.equal(publicRegistrationGate('company'), null);
  assert.equal(publicRegistrationGate('school'), null);
  assert.equal(publicRegistrationGate('admin'), null);
});

test('service guard refuses learner registration before any database connection', async () => {
  assert.throws(() => assertPublicLearnerRegistrationClosed('intern'), LearnerRegistrationClosedError);
  await assert.rejects(
    () => new AuthService().register({
      name: 'Synthetic Applicant',
      email: 'applicant@example.invalid',
      password: 'synthetic-only-password',
      role: 'intern',
    }),
    error => error instanceof LearnerRegistrationClosedError && error.statusCode === 410,
  );
});

test('legacy controller returns the CRM referral before validating or persisting applicant fields', async () => {
  let statusCode = 200;
  let responseBody;
  const response = {
    status(code) { statusCode = code; return this; },
    json(value) { responseBody = value; return this; },
  };

  await register({ body: { role: 'intern', email: 'applicant@example.invalid' } }, response);
  assert.equal(statusCode, 410);
  assert.deepEqual(responseBody, publicRegistrationGate('intern').body);
});

test('active and legacy registration handlers gate interns before auth validation or database work', () => {
  const activeRoutes = readFileSync('src/security/routes.ts', 'utf8');
  const authRoutes = readFileSync('src/routes/authRoutes.ts', 'utf8');
  const controller = readFileSync('src/controllers/AuthController.ts', 'utf8');
  const service = readFileSync('src/services/AuthService.ts', 'utf8');

  assert.match(activeRoutes, /router\.use\('\/auth\/register',[\s\S]*?publicRegistrationGate\(req\.body\?\.role\)[\s\S]*?disabled\(req, res\)/);
  assert.doesNotMatch(activeRoutes, /\['\/auth\/register'\s*,\s*'\/auth\/refresh'/);
  assert.match(authRoutes, /router\.post\([\s\S]*?publicRegistrationGate\(req\.body\?\.role\)[\s\S]*?body\('role'\)/);
  assert.match(controller, /publicRegistrationGate\(req\.body\?\.role\)[\s\S]*?publicValidationErrors\(req\)/);
  assert.ok(service.indexOf('assertPublicLearnerRegistrationClosed(data.role)') < service.indexOf('const pool = getPool();'));
});
