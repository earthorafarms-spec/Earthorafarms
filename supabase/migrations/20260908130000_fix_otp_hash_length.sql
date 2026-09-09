-- OTPs are stored as SHA-256 hex digests (64 characters), not plaintext 6-digit codes.
-- Keep production schemas created from older versions compatible with the hashed flow.
ALTER TABLE IF EXISTS public.otp_codes
  ALTER COLUMN otp TYPE VARCHAR(64);
