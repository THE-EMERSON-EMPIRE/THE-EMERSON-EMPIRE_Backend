import { X509Certificate } from 'node:crypto';

/** A dedicated CA for the pinned synthetic database. Never disables verification. */
export function normalizeHostedPracticeCa(value: string | undefined): string {
  const invalid = () => new Error('Hosted practice database TLS configuration is unavailable');
  if (!value?.trim()) throw invalid();
  const ca = value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!ca.startsWith('-----BEGIN CERTIFICATE-----\n') || !ca.endsWith('\n-----END CERTIFICATE-----') ||
      ca.indexOf('-----BEGIN CERTIFICATE-----') !== ca.lastIndexOf('-----BEGIN CERTIFICATE-----') ||
      ca.indexOf('-----END CERTIFICATE-----') !== ca.lastIndexOf('-----END CERTIFICATE-----')) throw invalid();
  try {
    const cert = new X509Certificate(ca);
    const now = Date.now();
    if (!cert.ca || !Number.isFinite(Date.parse(cert.validFrom)) || !Number.isFinite(Date.parse(cert.validTo)) ||
        Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now) throw invalid();
  } catch { throw invalid(); }
  return `${ca}\n`;
}
