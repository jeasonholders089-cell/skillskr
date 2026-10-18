import { config } from "../config.ts";
import { get } from "../db.ts";

export interface MailMessage {
  to: string;
  subject: string;
  body: string;
  actionUrl?: string;
  sentAt: string;
}

const OUTBOX_LIMIT = 50;
const outbox: MailMessage[] = [];

/**
 * Development transport.
 *
 * Nothing is sent over the network: messages are logged and kept in memory so
 * the verification / reset / invite links can be picked up locally. Swap this
 * for SMTP, Resend, Postmark, ... by replacing the body of `sendMail`.
 */
export function sendMail(message: Omit<MailMessage, "sentAt">): MailMessage {
  const entry: MailMessage = { ...message, sentAt: new Date().toISOString() };
  outbox.unshift(entry);
  if (outbox.length > OUTBOX_LIMIT) outbox.length = OUTBOX_LIMIT;

  const divider = "─".repeat(72);
  console.log(
    [
      "",
      divider,
      `  ✉  to: ${entry.to}`,
      `     subject: ${entry.subject}`,
      entry.actionUrl ? `     link: ${entry.actionUrl}` : "",
      divider,
      indent(entry.body),
      divider,
      "",
    ]
      .filter(Boolean)
      .join("\n")
  );
  return entry;
}

export function outboxMessages(): MailMessage[] {
  return [...outbox];
}

export function clearOutbox(): void {
  outbox.length = 0;
}

export function verificationMail(to: string, token: string, name?: string | null): MailMessage {
  const url = `${config.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return sendMail({
    to,
    subject: "Confirm your email address",
    actionUrl: url,
    body: `Hi${name ? ` ${name}` : ""},\n\nConfirm your email address to activate your workspace:\n${url}\n\nThe link expires in 60 minutes.`,
  });
}

export function passwordResetMail(to: string, token: string): MailMessage {
  const url = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return sendMail({
    to,
    subject: "Reset your password",
    actionUrl: url,
    body: `Use this link to choose a new password:\n${url}\n\nThe link expires in 60 minutes. If you did not ask for this, ignore the email.`,
  });
}

export function inviteMail(input: {
  to: string;
  token: string;
  tenantName: string;
  invitedByEmail: string;
  role: string;
}): MailMessage {
  const url = `${config.appUrl}/invite?token=${encodeURIComponent(input.token)}`;
  return sendMail({
    to: input.to,
    subject: `${input.invitedByEmail} invited you to ${input.tenantName}`,
    actionUrl: url,
    body: `You have been invited to join "${input.tenantName}" as ${input.role}.\n\nAccept the invitation:\n${url}\n\nThe link expires in 7 days.`,
  });
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

/** Notify the inviter once an invitation is accepted. Best effort. */
export function invitationAccepted(
  inviterUserId: string | null,
  acceptedByEmail: string,
  tenantName: string
): MailMessage | null {
  if (!inviterUserId) return null;
  const email = inviterEmail(inviterUserId);
  if (!email) return null;
  return sendMail({
    to: email,
    subject: `${acceptedByEmail} joined ${tenantName}`,
    body: `${acceptedByEmail} accepted your invitation and is now a member of "${tenantName}".`,
  });
}

function inviterEmail(userId: string): string | null {
  return get<{ email: string }>("SELECT email FROM users WHERE id = ?", userId)?.email ?? null;
}
