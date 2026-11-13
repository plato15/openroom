import { AwsClient } from "aws4fetch";
import { brand } from "./brand";
import type { Env } from "./env";
import { isLocalOrigin } from "./util";

export type Mail = { to: string; subject: string; text: string; html: string; link?: string };

/** Mail captured in tests and local dev instead of being sent. */
export const outbox: Mail[] = [];

/**
 * SMTP only exists in the Node build (Workers cannot open raw sockets to mail servers easily),
 * so the Node entry registers a sender here at start-up.
 */
type SmtpSender = (from: string, mail: Mail) => Promise<void>;
let smtpSender: SmtpSender | null = null;
export const registerSmtp = (send: SmtpSender) => {
  smtpSender = send;
};

export type MailProvider = "resend" | "smtp" | "ses" | null;

/** MAIL_PROVIDER picks one outright; otherwise the first one with its keys set wins. */
export function mailProvider(env: Env): MailProvider {
  const chosen = (env.MAIL_PROVIDER ?? "").trim().toLowerCase();
  if (chosen === "resend" || chosen === "smtp" || chosen === "ses") return chosen;
  if (env.RESEND_API_KEY) return "resend";
  if (env.SMTP_URL && smtpSender) return "smtp";
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return "ses";
  return null;
}

export async function sendMail(env: Env, mail: Mail): Promise<boolean> {
  // Mail is only captured instead of sent on a local address; anywhere else it is really sent.
  if (env.ENVIRONMENT !== "production" && isLocalOrigin(env.APP_ORIGIN)) {
    outbox.push(mail);
    if (env.ENVIRONMENT === "local") console.log(`[mail to ${mail.to}] ${mail.subject} ${mail.link ?? ""}`);
    return true;
  }
  const provider = mailProvider(env);
  try {
    if (provider === "resend") return await sendResend(env, mail);
    if (provider === "smtp") return await sendSmtp(env, mail);
    if (provider === "ses") return await sendSes(env, mail);
  } catch (err) {
    console.error(`mail not sent: ${provider} ${(err as Error).message}`);
    return false;
  }
  console.error("mail not sent: no email provider is set up (RESEND_API_KEY, SMTP_URL or AWS keys)");
  return false;
}

async function sendResend(env: Env, mail: Mail): Promise<boolean> {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
  });
  if (!res.ok) {
    console.error(`mail not sent: Resend ${res.status} ${(await res.text()).slice(0, 300)}`);
    return false;
  }
  return true;
}

async function sendSmtp(env: Env, mail: Mail): Promise<boolean> {
  if (!smtpSender || !env.SMTP_URL) throw new Error("SMTP is only available in the Docker build, with SMTP_URL set");
  await smtpSender(env.MAIL_FROM, mail);
  return true;
}

async function sendSes(env: Env, mail: Mail): Promise<boolean> {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw new Error("AWS keys are not set");
  const region = env.SES_REGION || "us-east-1";
  const aws = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    service: "ses",
    region,
  });
  const res = await aws.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      FromEmailAddress: env.MAIL_FROM,
      Destination: { ToAddresses: [mail.to] },
      Content: {
        Simple: {
          Subject: { Data: mail.subject, Charset: "UTF-8" },
          Body: { Text: { Data: mail.text, Charset: "UTF-8" }, Html: { Data: mail.html, Charset: "UTF-8" } },
        },
      },
    }),
  });
  if (!res.ok) {
    console.error(`mail not sent: SES ${res.status} ${(await res.text()).slice(0, 300)}`);
    return false;
  }
  return true;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function shell(origin: string, heading: string, paragraphs: string[], button?: { href: string; label: string }) {
  const b = brand();
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#334155">${esc(p)}</p>`).join("");
  const cta = button
    ? `<p style="margin:24px 0"><a href="${esc(button.href)}" style="display:inline-block;background:${b.color};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 22px;border-radius:10px">${esc(button.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#F4F6FA;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#ffffff;padding:24px 28px 18px;border-bottom:3px solid ${b.dark}">${b.emailLogo
  ? `<img src="${esc(origin)}${esc(b.emailLogo)}" alt="${esc(b.name)}" height="28" style="display:block;height:28px;border:0">`
  : `<span style="font-size:18px;font-weight:700;color:${b.dark}">${esc(b.name)}</span>`}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${b.dark}">${esc(heading)}</h1>
${body}${cta}
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#94A3B8">${esc(b.legalSentence)} Confidential. This message was sent to you because you were given access to the ${esc(b.roomName)}.</p>
</td></tr></table></td></tr></table></body></html>`;
}

export function signInMail(origin: string, to: string, link: string): Mail {
  const lines = [
    `Here is your link to the ${brand().roomName}. It works once and expires in 15 minutes.`,
    "If you did not ask for this, you can ignore this email.",
  ];
  return {
    to,
    link,
    subject: `Your sign-in link for the ${brand().roomName}`,
    text: `${lines[0]}\n\n${link}\n\n${lines[1]}\n`,
    html: shell(origin, `Sign in to the ${brand().roomName}`, lines, { href: link, label: "Open the data room" }),
  };
}

export function inviteMail(origin: string, to: string, name: string): Mail {
  const hello = name ? `Hi ${name.split(" ")[0]},` : "Hello,";
  const lines = [
    hello,
    `${brand().inviter} has shared documents with you in the ${brand().roomName}.`,
    `To open it, go to ${origin.replace(/^https?:\/\//, "")} and enter this email address. We will send you a sign-in link. There is no password to remember.`,
  ];
  return {
    to,
    subject: `${brand().name} has shared its data room with you`,
    text: `${lines.join("\n\n")}\n\n${origin}\n`,
    html: shell(origin, `You have access to the ${brand().roomName}`, lines, { href: origin, label: "Go to the data room" }),
  };
}
