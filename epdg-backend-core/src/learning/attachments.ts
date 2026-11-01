import { PortalError } from '../security/primitives';

export const attachmentLimit = 1024 * 1024;
const mediaTypes: Record<string, string> = { txt: 'text/plain', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const invalid = () => new PortalError(400, 'File must be a supported fictional TXT, PDF, PNG or JPEG with a safe filename');

export function attachmentName(filename: unknown): string {
  if (typeof filename !== 'string' || filename.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.(txt|pdf|png|jpg|jpeg)$/i.test(filename) ||
      filename.includes('..') || /[. ]$/.test(filename)) throw invalid();
  return filename;
}
export function attachmentMediaType(filename: string, supplied: string): string {
  attachmentName(filename);
  const canonical = mediaTypes[filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()];
  if (!['', 'application/octet-stream', canonical].includes(supplied)) throw invalid();
  return canonical;
}
export function multipartRevision(value: unknown): number {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(value) || Number(value) > 2147483647) {
    throw new PortalError(400, 'A canonical nonnegative integer revision is required');
  }
  return Number(value);
}
export function validateAttachment(filename: string, supplied: string, bytes: Buffer) {
  const name = attachmentName(filename); const mediaType = attachmentMediaType(name, supplied);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw invalid();
  if (bytes.length > attachmentLimit) throw new PortalError(413, 'File exceeds the 1 MiB limit');
  let valid = false;
  if (mediaType === 'text/plain') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      valid = !Array.from(text).some(character => {
        const code = character.codePointAt(0) ?? 0;
        return (code < 32 && ![9, 10, 13].includes(code)) || (code >= 127 && code <= 159);
      }) &&
        !/^\s*(?:%PDF-|<(?:!doctype\s+html|html|head|body|script|svg|iframe|object|embed|meta|link|style)\b|<\?xml)/i.test(text);
    } catch { valid = false; }
  } else if (mediaType === 'application/pdf') {
    const first = bytes.subarray(0, 9).toString('ascii');
    const last = bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1');
    valid = /^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(first) && /%%EOF[\t\r\n ]*$/.test(last);
  } else if (mediaType === 'image/png') {
    valid = bytes.length >= 20 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'));
  } else if (mediaType === 'image/jpeg') {
    valid = bytes.length >= 5 && bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) &&
      bytes.subarray(-2).equals(Buffer.from('ffd9', 'hex'));
  }
  if (!valid) throw invalid();
  return { filename: name, mediaType, bytes };
}
