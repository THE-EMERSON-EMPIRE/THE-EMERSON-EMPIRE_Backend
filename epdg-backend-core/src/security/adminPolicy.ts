import { isNeonAdminStaging, validateNeonAdminStagingEnvironment } from '../neon-admin-staging/profile';

export const ADMIN_STAGING_MODE = '1';

export const FOUNDER_ADMIN_PERMISSIONS = [
  'admin.overview.read',
  'admin.users.read',
  'admin.roles.read',
  'admin.roles.request',
] as const;

export const ADMIN_ROLE_CATALOG = [
  {
    code: 'founder_admin',
    name: 'Founder administrator',
    status: 'manual-bootstrap-only',
    requestable: false,
    permissions: FOUNDER_ADMIN_PERMISSIONS,
  },
  {
    code: 'webdev_technical',
    name: 'WebDev technical',
    status: 'awaiting-approved-scope',
    requestable: true,
    permissions: [],
  },
] as const;

export type AdminRoleCode = (typeof ADMIN_ROLE_CATALOG)[number]['code'];
export type AdminPermission = (typeof FOUNDER_ADMIN_PERMISSIONS)[number];

export function isAdminStagingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const localSynthetic = env.EPDG_ADMIN_STAGING_MODE === ADMIN_STAGING_MODE
    && env.EPDG_SYNTHETIC_MODE === '1'
    && env.NODE_ENV === 'test';
  if (isNeonAdminStaging(env)) {
    validateNeonAdminStagingEnvironment(env);
    return env.EPDG_ADMIN_STAGING_MODE === ADMIN_STAGING_MODE && env.EPDG_SYNTHETIC_MODE === '1';
  }
  return localSynthetic;
}

export function permissionsForAdminRoles(roleCodes: readonly string[]): AdminPermission[] {
  return roleCodes.includes('founder_admin') ? [...FOUNDER_ADMIN_PERMISSIONS] : [];
}

export function hasAdminPermission(user: { permissions: readonly string[] }, permission: AdminPermission): boolean {
  return user.permissions.includes(permission);
}
