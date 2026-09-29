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
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("CoverageChiropractor <mail@coveragechiropractor.com>"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  ESIGN_API_KEY: z.string().optional(),
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

export function assertProductionEnv(e: Env = env()) {
  if (e.NODE_ENV !== "production") return;
  const required: (keyof Env)[] = ["SESSION_SECRET", "REDIS_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SENDGRID_API_KEY", "GOOGLE_MAPS_API_KEY"];
  const missing = required.filter((k) => !e[k]);
  if (missing.length) throw new Error(`Missing required production env vars: ${missing.join(", ")}`);
}
