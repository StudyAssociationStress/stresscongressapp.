-- Additive migration: add claim_token column to gdpr_requests
-- Used to bind a claim to the specific worker that acquired it, so
-- releases and finalization can only succeed for the owning worker.
ALTER TABLE "gdpr_requests" ADD COLUMN IF NOT EXISTS "claim_token" TEXT;
