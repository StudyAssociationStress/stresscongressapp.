-- Additive migration: add gdpr_requests table and unique index
-- Safe to run on existing databases (uses IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS "gdpr_requests" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL,
  "user_email" text NOT NULL,
  "user_name" text NOT NULL,
  "type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp,
  "resolved_by" text
);

-- Prevent duplicate active (pending or in_progress) requests per user per type.
-- Enforces at the DB level what the application-layer duplicate check cannot guarantee under concurrency.
CREATE UNIQUE INDEX IF NOT EXISTS gdpr_requests_active_unique
  ON "gdpr_requests" ("user_id", "type")
  WHERE (status = 'pending' OR status = 'in_progress');
