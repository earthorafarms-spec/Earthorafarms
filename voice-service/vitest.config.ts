import { defineConfig } from 'vitest/config';

// Dummy-but-schema-valid env vars so importing modules (which eagerly
// construct a Supabase client / validate config at import time — see
// src/config.ts) doesn't crash pure unit tests that never actually issue a
// network call. Integration/e2e tests override these with real values via
// RUN_INTEGRATION_TESTS=1 + a real .env (see tests/integration/*, tests/e2e/*).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      PUBLIC_APP_URL: 'http://localhost:5173',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      OPENAI_API_KEY: 'test-openai-key',
      RAZORPAY_KEY_ID: 'rzp_test_dummy',
      RAZORPAY_KEY_SECRET: 'test-razorpay-secret',
      RAZORPAY_WEBHOOK_SECRET: 'test-webhook-secret',
      RESEND_API_KEY: 'test-resend-key',
      RESEND_FROM_EMAIL: 'test@example.com',
      TOKEN_SIGNING_SECRET: 'test-token-signing-secret-value',
      PII_ENCRYPTION_KEY: '0'.repeat(64),
    },
  },
});
