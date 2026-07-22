import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  // Without SMTP credentials (local dev) fall back to a JSON transport that
  // captures the message instead of sending it — the reset link is logged.
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    logger.warn('SMTP credentials missing — emails will be logged, not sent');
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendMail({ to, subject, html, text }: MailOptions): Promise<void> {
  const apiKey = env.BREVO_EMAIL_API_KEY;
  if (apiKey) {
    const senderEmail = env.BREVO_SENDER_EMAIL || 'rajatkatiyar157@gmail.com';
    const senderName = env.BREVO_SENDER_NAME || 'Khatavala';
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: to }],
          subject,
          htmlContent: html,
          textContent: text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401 && errorText.includes('unrecognised IP')) {
          logger.error(
            `Brevo Security IP Restriction: Brevo blocked request from this IP. Please authorize your IP at https://app.brevo.com/security/authorised_ips`
          );
          throw new Error(
            `Brevo IP restriction error: Please add your IP at https://app.brevo.com/security/authorised_ips`
          );
        }
        logger.error(`Brevo email delivery error (${response.status}): ${errorText}`);
        throw new Error(`Brevo mail error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as { messageId?: string };
      logger.info(`Email sent via Brevo: ${subject} → ${to} (MessageId: ${data.messageId || 'ok'})`);
      return;
    } catch (err) {
      logger.error('Failed to send email via Brevo REST API', err);
      throw err;
    }
  }

  const info = await getTransporter().sendMail({
    from: env.MAIL_FROM,
    to,
    subject,
    text,
    html,
  });
  logger.info(`Email queued: ${subject} → ${to} (${info.messageId})`);
  if (info.message) logger.debug(`Email body: ${info.message}`);
}

export async function sendPasswordResetEmail(
  to: string,
  fullName: string,
  rawToken: string
): Promise<void> {
  const link = `${env.APP_URL}/reset-password?token=${rawToken}`;
  const ttl = env.PASSWORD_RESET_TTL_MIN;

  await sendMail({
    to,
    subject: 'Reset your Khatavala password',
    text: `Hi ${fullName},\n\nReset your password using this link (valid for ${ttl} minutes):\n${link}\n\nIf you did not request this, you can ignore this email.`,
    html: `
      <p>Hi ${fullName},</p>
      <p>We received a request to reset your Khatavala password.</p>
      <p><a href="${link}">Reset my password</a></p>
      <p>This link is valid for ${ttl} minutes. If you did not request it, you can safely ignore this email.</p>
    `,
  });

  // Convenience for Mailtrap-less local runs.
  if (env.NODE_ENV !== 'production') logger.info(`Password reset link: ${link}`);
}

interface InviteEmailOptions {
  to: string;
  companyName: string;
  roleName: string;
  rawToken: string;
  /** Existing account → they only need to sign in; otherwise they set a password. */
  hasAccount: boolean;
  expiresInHours: number;
}

export async function sendInviteEmail({
  to,
  companyName,
  roleName,
  rawToken,
  hasAccount,
  expiresInHours,
}: InviteEmailOptions): Promise<void> {
  const link = `${env.APP_URL}/accept-invite?token=${rawToken}`;
  const action = hasAccount
    ? 'Sign in and accept the invitation'
    : 'Set your password and join';

  await sendMail({
    to,
    subject: `You've been invited to join ${companyName} on Khatavala`,
    text: `You have been invited to join ${companyName} on Khatavala as a ${roleName}.\n\n${action}:\n${link}\n\nThis invitation expires in ${expiresInHours} hours.\n\nIf you weren't expecting this, you can ignore this email.`,
    html: `
      <p>You have been invited to join <strong>${companyName}</strong> on Khatavala as a <strong>${roleName}</strong>.</p>
      <p><a href="${link}">${action}</a></p>
      <p>This invitation expires in ${expiresInHours} hours. If you weren't expecting it, you can safely ignore this email.</p>
    `,
  });

  if (env.NODE_ENV !== 'production') logger.info(`Invite link for ${to}: ${link}`);
}
