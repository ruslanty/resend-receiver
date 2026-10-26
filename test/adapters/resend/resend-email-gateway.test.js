import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_RAW_EMAIL_BYTES,
  ResendEmailGateway,
} from "../../../src/adapters/resend/resend-email-gateway.js";
import { ReceivedEmailTooLargeError } from "../../../src/application/errors.js";

function createResend(overrides = {}) {
  return {
    emails: {
      receiving: {
        async get() {
          return {
            data: { id: "email_123", raw: { download_url: "https://files.example.test/raw" } },
            error: null,
          };
        },
      },
      async send() {
        return { data: { id: "sent_123" }, error: null };
      },
      ...overrides.emails,
    },
  };
}

test("downloads raw email content within the configured byte limit", async () => {
  let requestedUrl;
  const gateway = new ResendEmailGateway(createResend(), {
    maxRawEmailBytes: 20,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response("raw message", { status: 200 });
    },
  });

  const result = await gateway.getReceivedEmail("email_123");
  assert.equal(requestedUrl, "https://files.example.test/raw");
  assert.equal(result.email.id, "email_123");
  assert.equal(result.rawContent.toString(), "raw message");
});

test("rejects raw email content that exceeds the configured byte limit", async () => {
  const gateway = new ResendEmailGateway(createResend(), {
    maxRawEmailBytes: 5,
    fetchImpl: async () => new Response("too long", { status: 200 }),
  });

  await assert.rejects(gateway.getReceivedEmail("email_123"), ReceivedEmailTooLargeError);
  assert.equal(MAX_RAW_EMAIL_BYTES, 25 * 1024 * 1024);
});

test("does not fetch raw email content over a non-HTTPS URL", async () => {
  const resend = createResend({
    emails: {
      receiving: {
        async get() {
          return { data: { raw: { download_url: "http://files.example.test/raw" } }, error: null };
        },
      },
    },
  });
  let called = false;
  const gateway = new ResendEmailGateway(resend, {
    fetchImpl: async () => {
      called = true;
      return new Response("raw", { status: 200 });
    },
  });

  await assert.rejects(gateway.getReceivedEmail("email_123"));
  assert.equal(called, false);
});

test("maps the application message to the current Resend send API shape", async () => {
  let sentMessage;
  const resend = createResend({
    emails: {
      async send(message) {
        sentMessage = message;
        return { data: { id: "sent_123" }, error: null };
      },
    },
  });
  const gateway = new ResendEmailGateway(resend);

  await gateway.send({
    senderAddress: "support@example.com",
    senderName: "Alice Example",
    to: "support-inbox@example.net",
    subject: "Need help",
    text: "Message body",
    replyTo: ["reply@example.org"],
    inReplyTo: "<original@example.org>",
    attachments: [
      {
        filename: "details.txt",
        content: Buffer.from("case details"),
        mediaType: "text/plain",
        contentId: "attachment-1",
      },
    ],
  });

  assert.deepEqual(sentMessage, {
    from: "Alice Example <support@example.com>",
    to: "support-inbox@example.net",
    subject: "Need help",
    html: undefined,
    text: "Message body",
    replyTo: ["reply@example.org"],
    headers: { "In-Reply-To": "<original@example.org>" },
    attachments: [
      {
        filename: "details.txt",
        content: Buffer.from("case details").toString("base64"),
        contentType: "text/plain",
        contentId: "attachment-1",
      },
    ],
  });
});
