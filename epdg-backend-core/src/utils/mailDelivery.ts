import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { requireEnvironmentVariable } from '../config/env';
import { validateSyntheticEnvironment } from '../config/synthetic';
import { isHostedPractice, validateHostedPracticeEnvironment } from '../hosted-practice/profile';
import { getPool } from '../db';

interface EmailMessage {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
}

export async function deliverEmail(message: EmailMessage): Promise<{ error: { message: string } | null }> {
  if (isHostedPractice()) {
    validateHostedPracticeEnvironment();
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    if (recipients.length !== 1 || !/^[a-z0-9._+-]+@[a-z0-9.-]+\.invalid$/.test(recipients[0]) ||
        message.from !== 'EPDG Synthetic <no-reply@epdg.invalid>' || message.subject !== 'EPDG portal password recovery' ||
        !message.html.length || Buffer.byteLength(message.html) > 16384) throw new Error('Hosted practice capture is unavailable');
    await getPool().query('INSERT INTO hosted_practice.mail_capture(from_address,recipient,subject,html) VALUES($1,$2,$3,$4)',
      [message.from, recipients[0], message.subject, message.html]);
    return { error: null };
  }
  if (process.env.EPDG_SYNTHETIC_MODE === '1') {
    validateSyntheticEnvironment();
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    if (!recipients.length || recipients.some((to) => !/^[a-z0-9._+-]+@[a-z0-9.-]+\.invalid$/i.test(to)) ||
        message.from !== process.env.SMTP_FROM) {
      throw new Error('Synthetic mail requires reserved .invalid mailboxes');
    }
    const transport = nodemailer.createTransport({
      host: '127.0.0.1', port: 51025, secure: false, ignoreTLS: true,
      connectionTimeout: 3000, socketTimeout: 5000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    await transport.sendMail(message);
    return { error: null };
  }
  if (process.env.MAIL_DELIVERY_MODE && process.env.MAIL_DELIVERY_MODE !== 'resend') {
    throw new Error('Mailpit delivery requires the isolated local test runner');
  }
  return new Resend(requireEnvironmentVariable('RESEND_API_KEY')).emails.send(message);
}
