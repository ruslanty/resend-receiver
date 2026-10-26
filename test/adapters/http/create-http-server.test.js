import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Webhook } from "svix";
import { createHttpServer } from "../../../src/adapters/http/create-http-server.js";
import { SvixWebhookVerifier } from "../../../src/adapters/webhook/svix-webhook-verifier.js";

const webhookSecret = `whsec_${Buffer.from("test-secret").toString("base64")}`;
const signer = new Webhook(webhookSecret);
let server;
let baseUrl;
let processingCalls = 0;
let shouldFail = false;

before(async () => {
  server = createHttpServer({
    webhookVerifier: new SvixWebhookVerifier(webhookSecret),
    async forwardReceivedEmail(event) {
      processingCalls += 1;
      if (shouldFail) throw new Error("temporary upstream failure");
      if (event.type !== "email.received") return { kind: "ignored" };
      return { kind: event.data.to[0] === "support@example.com" ? "forwarded" : "unmatched" };
    },
    maxWebhookBodyBytes: 1024,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function signedHeaders(payload) {
  const id = `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = new Date();
  return {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": signer.sign(id, timestamp, payload),
  };
}

test("accepts a valid signature and acknowledges supported and unsupported events", async () => {
  const payload = JSON.stringify({
    type: "email.received",
    data: { email_id: "email_123", to: ["support@example.com"] },
  });
  const response = await fetch(`${baseUrl}/webhooks/resend`, {
    method: "POST",
    headers: signedHeaders(payload),
    body: payload,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const ignoredPayload = JSON.stringify({ type: "email.delivered", data: {} });
  const ignoredResponse = await fetch(`${baseUrl}/webhooks/resend`, {
    method: "POST",
    headers: signedHeaders(ignoredPayload),
    body: ignoredPayload,
  });
  assert.equal(ignoredResponse.status, 200);
  assert.deepEqual(await ignoredResponse.json(), { ok: true, ignored: true });
});

test("rejects invalid webhook signatures and malformed signed JSON", async () => {
  const invalidSignature = await fetch(`${baseUrl}/webhooks/resend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(invalidSignature.status, 400);

  const malformed = "{";
  const malformedResponse = await fetch(`${baseUrl}/webhooks/resend`, {
    method: "POST",
    headers: signedHeaders(malformed),
    body: malformed,
  });
  assert.equal(malformedResponse.status, 400);
});

test("returns success for unmatched routes so Resend does not retry a permanent miss", async () => {
  const payload = JSON.stringify({
    type: "email.received",
    data: { email_id: "email_123", to: ["unknown@example.com"] },
  });
  const response = await fetch(`${baseUrl}/webhooks/resend`, {
    method: "POST",
    headers: signedHeaders(payload),
    body: payload,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, ignored: true });
});

test("returns a retryable server failure when processing fails", async () => {
  shouldFail = true;
  const payload = JSON.stringify({
    type: "email.received",
    data: { email_id: "email_123", to: ["support@example.com"] },
  });
  const response = await fetch(`${baseUrl}/webhooks/resend`, {
    method: "POST",
    headers: signedHeaders(payload),
    body: payload,
  });
  shouldFail = false;

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "temporary processing failure" });
});

test("rejects an oversized webhook body and unknown routes", async () => {
  const oversized = await fetch(`${baseUrl}/webhooks/resend`, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "2048" },
    body: " ".repeat(2048),
  });
  assert.equal(oversized.status, 413);

  const before = processingCalls;
  const notFound = await fetch(`${baseUrl}/unknown`);
  assert.equal(notFound.status, 404);
  assert.equal(processingCalls, before);
});
