export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: "production" | "local" | "test";
  APP_ORIGIN: string;
  MAIL_FROM: string;
  SES_REGION: string;
  ADMIN_EMAILS?: string;
  BRAND_NAME?: string;
  BRAND_LEGAL_NAME?: string;
  BRAND_INVITER?: string;
  BRAND_COLOR?: string;
  BRAND_DARK?: string;
  BRAND_FONT_BODY?: string;
  BRAND_FONT_DISPLAY?: string;
  SHOW_CREDIT?: string;
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
  uploaded_at: number;
  updated_at: number;
};

export type Session =
  | { role: "admin"; email: string }
  | { role: "investor"; email: string; investor: Investor };

export type AppEnv = { Bindings: Env; Variables: { session: Session | null } };
