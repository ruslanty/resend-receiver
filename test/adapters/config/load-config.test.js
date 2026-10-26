import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError, loadConfig } from "../../../src/adapters/config/load-config.js";

const validEnvironment = {
  RESEND_API_KEY: "re_test_key",
  RESEND_WEBHOOK_SECRET: "whsec_dGVzdC1zZWNyZXQ=",
  FORWARD_ROUTES: JSON.stringify([
    {
      recipient: "support@example.com",
      to: "support-inbox@example.net",
      from: "support@example.com",
    },
  ]),
};

test("loads required values and defaults the port", () => {
  assert.deepEqual(loadConfig(validEnvironment), {
    resendApiKey: "re_test_key",
    resendWebhookSecret: "whsec_dGVzdC1zZWNyZXQ=",
    forwardRoutes: [
      {
        recipient: "support@example.com",
        to: "support-inbox@example.net",
        from: "support@example.com",
      },
    ],
    port: 3000,
  });
});

test("requires secrets and at least one forwarding route", () => {
  for (const env of [
    { ...validEnvironment, RESEND_API_KEY: " " },
    { ...validEnvironment, RESEND_WEBHOOK_SECRET: "" },
    { ...validEnvironment, FORWARD_ROUTES: "[]" },
  ]) {
    assert.throws(() => loadConfig(env), ConfigurationError);
  }
  assert.throws(
    () => loadConfig({ ...validEnvironment, RESEND_WEBHOOK_SECRET: "whsec_invalid!" }),
    /valid base64/,
  );
});

test("rejects invalid ports and malformed routes", () => {
  assert.throws(() => loadConfig({ ...validEnvironment, PORT: "3000abc" }), /PORT/);
  assert.throws(() => loadConfig({ ...validEnvironment, PORT: "65536" }), /PORT/);
  assert.throws(() => loadConfig({ ...validEnvironment, FORWARD_ROUTES: "not-json" }), /JSON/);
  assert.throws(
    () =>
      loadConfig({
        ...validEnvironment,
        FORWARD_ROUTES: JSON.stringify([
          {
            recipient: "not-an-address",
            to: "destination@example.net",
            from: "sender@example.com",
          },
        ]),
      }),
    /recipient/,
  );
});

test("rejects routes that collide after recipient normalization", () => {
  const routes = [
    { recipient: "support@example.com", to: "one@example.net", from: "sender@example.com" },
    { recipient: "support+ticket@example.com", to: "two@example.net", from: "sender@example.com" },
  ];

  assert.throws(
    () => loadConfig({ ...validEnvironment, FORWARD_ROUTES: JSON.stringify(routes) }),
    /duplicate recipient/i,
  );
});

test("does not include configured secret values in validation errors", () => {
  const secret = "private-test-value";
  assert.throws(
    () => loadConfig({ ...validEnvironment, RESEND_API_KEY: secret, PORT: "bad" }),
    (error) => error instanceof ConfigurationError && !error.message.includes(secret),
  );
});
