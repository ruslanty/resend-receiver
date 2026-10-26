import assert from "node:assert/strict";
import test from "node:test";
import { forwardReceivedEmail } from "../../src/application/forward-received-email.js";
import { InvalidEmailEventError } from "../../src/application/errors.js";

const route = {
  recipient: "support@example.com",
  to: "support-inbox@example.net",
  from: "support@example.com",
};

function createDependencies(overrides = {}) {
  const calls = { getReceivedEmail: [], parse: [], send: [] };
  const dependencies = {
    routes: [route],
    receivedEmailGateway: {
      async getReceivedEmail(emailId) {
        calls.getReceivedEmail.push(emailId);
        return {
          email: {
            from: "alice@example.org",
            subject: "Support request",
            headers: {
              from: "Alice Example <alice@example.org>",
              "reply-to": "reply@example.org",
            },
          },
          rawContent: Buffer.from("raw-message"),
        };
      },
    },
    mimeParser: {
      async parse(rawContent) {
        calls.parse.push(rawContent);
        return {
          text: "Please help",
          html: "<p>Please help</p>",
          attachments: [
            {
              filename: "details.txt",
              content: Buffer.from("details"),
              mediaType: "text/plain",
              contentId: "details-1",
            },
          ],
        };
      },
    },
    emailSender: {
      async send(message) {
        calls.send.push(message);
      },
    },
    ...overrides,
  };

  return { dependencies, calls };
}

test("forwards the selected message while retaining sender, reply, and attachment data", async () => {
  const { dependencies, calls } = createDependencies();
  const result = await forwardReceivedEmail(
    {
      type: "email.received",
      data: {
        email_id: "email_123",
        message_id: "<message-123@example.org>",
        to: ["support+ticket@example.com"],
      },
    },
    dependencies,
  );

  assert.deepEqual(result, { kind: "forwarded" });
  assert.deepEqual(calls.getReceivedEmail, ["email_123"]);
  assert.equal(calls.send.length, 1);
  assert.deepEqual(calls.send[0], {
    senderAddress: "support@example.com",
    senderName: "Alice Example",
    to: "support-inbox@example.net",
    subject: "Support request",
    html: "<p>Please help</p>",
    text: "Please help",
    replyTo: "reply@example.org",
    inReplyTo: "<message-123@example.org>",
    attachments: [
      {
        filename: "details.txt",
        content: Buffer.from("details"),
        mediaType: "text/plain",
        contentId: "details-1",
      },
    ],
  });
});

test("ignores unsupported event types without calling dependencies", async () => {
  const { dependencies, calls } = createDependencies();
  const result = await forwardReceivedEmail({ type: "email.delivered", data: {} }, dependencies);

  assert.deepEqual(result, { kind: "ignored" });
  assert.deepEqual(calls, { getReceivedEmail: [], parse: [], send: [] });
});

test("acknowledges unmatched recipients without retrieving or sending email", async () => {
  const { dependencies, calls } = createDependencies();
  const result = await forwardReceivedEmail(
    { type: "email.received", data: { email_id: "email_123", to: ["other@example.com"] } },
    dependencies,
  );

  assert.deepEqual(result, { kind: "unmatched" });
  assert.deepEqual(calls, { getReceivedEmail: [], parse: [], send: [] });
});

test("rejects malformed email.received payloads", async () => {
  const { dependencies } = createDependencies();

  await assert.rejects(
    forwardReceivedEmail({ type: "email.received", data: { to: [] } }, dependencies),
    InvalidEmailEventError,
  );
});

test("propagates upstream failures so the HTTP adapter can request a retry", async () => {
  const upstreamError = new Error("temporary upstream failure");
  const { dependencies, calls } = createDependencies({
    receivedEmailGateway: {
      async getReceivedEmail() {
        throw upstreamError;
      },
    },
  });

  await assert.rejects(
    forwardReceivedEmail(
      { type: "email.received", data: { email_id: "email_123", to: ["support@example.com"] } },
      dependencies,
    ),
    upstreamError,
  );
  assert.deepEqual(calls.send, []);
});

test("does not treat a bare sender address as a display name", async () => {
  const { dependencies, calls } = createDependencies({
    receivedEmailGateway: {
      async getReceivedEmail() {
        return {
          email: { from: "alice@example.org", subject: "Support request", headers: {} },
          rawContent: Buffer.from("raw-message"),
        };
      },
    },
  });

  await forwardReceivedEmail(
    { type: "email.received", data: { email_id: "email_123", to: ["support@example.com"] } },
    dependencies,
  );

  assert.equal(calls.send[0].senderAddress, "support@example.com");
  assert.equal(calls.send[0].senderName, "");
  assert.equal(calls.send[0].replyTo, "alice@example.org");
});
