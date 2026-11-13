export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  /** Left out means production. "local" and "test" only ever take effect on a local address. */
  ENVIRONMENT?: "production" | "local" | "test";
  /** Left out on Cloudflare: the address the room was opened on is used (see src/index.ts). */
  APP_ORIGIN: string;
  /** Left out: DEFAULT_MAIL_FROM in src/email.ts. */
  MAIL_FROM?: string;
  /** Optional: "resend", "smtp" or "ses". Left out, the first provider with its keys set is used. */
  MAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  /** Docker build only: smtp://user:pass@host:587 or smtps://user:pass@host:465 */
  SMTP_URL?: string;
  SES_REGION?: string;
  ADMIN_EMAILS?: string;
  BRAND_NAME?: string;
  BRAND_LEGAL_NAME?: string;
  BRAND_INVITER?: string;
  BRAND_COLOR?: string;
  BRAND_DARK?: string;
  BRAND_FONT_BODY?: string;
  BRAND_FONT_DISPLAY?: string;
  SHOW_CREDIT?: string;
  /** "false" stops the daily check for a new Openroom version (see src/updates.ts). */
  UPDATE_CHECK?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
};

export type Investor = {
  id: string;
  email: string;
  name: string;
  firm: string;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
  last_seen_at: number | null;
};

export type Folder = {
  id: string;
  name: string;
  description: string;
  position: number;
  watermark: number;
  created_at: number;
  /** Set on a subfolder: the top-level folder it sits in. Access follows the top-level folder. */
  parent_id: string | null;
  /** Optional short link: /<slug> opens the room at this folder. */
  slug: string | null;
};

export type FileRow = {
  id: string;
  folder_id: string;
  name: string;
  r2_key: string;
  content_type: string;
  size: number;
  published: number;
  allow_download: number; // 1 = investors get a Download button for this file
  slug: string | null; // optional custom link: /d/<slug>
  orientation: "portrait" | "landscape" | null;
  placeholder: number; // 1 = a template placeholder: never visible until replaced
  uploaded_at: number;
  updated_at: number;
};

export type Session =
  | { role: "admin"; email: string }
  | { role: "investor"; email: string; investor: Investor };

export type AppEnv = { Bindings: Env; Variables: { session: Session | null } };
