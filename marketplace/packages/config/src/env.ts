import { z } from "zod";

// Every external service is optional in development: when its key is missing
// the integrations package falls back to a local fake (see
// packages/integrations). Production refuses to boot without the keys that
// move money or send mail (see assertProductionEnv).
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  /** Bearer secret for /api/cron (external once-a-minute tick, e.g. cPanel cron). Unset = endpoint disabled. */
  CRON_SECRET: z.string().optional(),
  /** One-time token for /setup (create the first admin). Unset = page disabled. */
  SETUP_TOKEN: z.string().optional(),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  // Branding (addendum §12) — never hard-code the brand in UI, email or SMS.
  BRAND_NAME: z.string().default("CoverageOnCall"),
  BRAND_DOMAIN: z.string().default("coverageoncall.com"),
  BRAND_TAGLINE: z.string().default("Licensed coverage for your clinic, on call."),
  BRAND_SUPPORT_EMAIL: z.string().default("support@coverageoncall.com"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  /** Sent to browsers for address suggestions: restrict it to your domain and to Maps JavaScript API + Places API (New). */
  GOOGLE_MAPS_BROWSER_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  /** Defaults to "<BRAND_NAME> <mail@BRAND_DOMAIN>". */
  EMAIL_FROM: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  ESIGN_API_KEY: z.string().optional(),
  /** "true" = allow the built-in click-to-sign test page in production while
   *  Dropbox Sign isn't connected yet (build & test phase). Ignored once
   *  ESIGN_API_KEY is set. */
  ESIGN_TEST_MODE: z.string().optional(),
  ESIGN_CLINIC_TEMPLATE_ID: z.string().optional(),
  ESIGN_DOCTOR_TEMPLATE_ID: z.string().optional(),
  GCS_BUCKET: z.string().optional(),
  GCS_BUCKET_CREDENTIALS: z.string().optional(),
  UPLOAD_DIR: z.string().default(".uploads"),
  SENTRY_DSN: z.string().optional(),
  NPPES_API_BASE: z.string().default("https://npiregistry.cms.hhs.gov/api/"),
});
export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

export interface Brand {
  name: string;
  domain: string;
  tagline: string;
  supportEmail: string;
  emailFrom: string;
}

export function brand(e: Env = env()): Brand {
  return {
    name: e.BRAND_NAME,
    domain: e.BRAND_DOMAIN,
    tagline: e.BRAND_TAGLINE,
    supportEmail: e.BRAND_SUPPORT_EMAIL,
    emailFrom: e.EMAIL_FROM ?? `${e.BRAND_NAME} <mail@${e.BRAND_DOMAIN}>`,
  };
}

export function assertProductionEnv(e: Env = env(), opts: { worker?: boolean } = {}) {
  if (e.NODE_ENV !== "production") return;
  const required: (keyof Env)[] = ["SESSION_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SENDGRID_API_KEY", "GOOGLE_MAPS_API_KEY"];
  // The BullMQ worker needs Redis; the web app (and cron-driven hosting) does not.
  if (opts.worker) required.push("REDIS_URL");
  const missing = required.filter((k) => !e[k]);
  if (missing.length) throw new Error(`Missing required production env vars: ${missing.join(", ")}`);
}
