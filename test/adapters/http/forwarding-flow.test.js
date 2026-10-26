import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Webhook } from "svix";
import { forwardReceivedEmail } from "../../../src/application/forward-received-email.js";
import { createHttpServer } from "../../../src/adapters/http/create-http-server.js";
import { PostalMimeParser } from "../../../src/adapters/mime/postal-mime-parser.js";
import { SvixWebhookVerifier } from "../../../src/adapters/webhook/svix-webhook-verifier.js";

const secret = `whsec_${Buffer.from("http-flow-test-secret").toString("base64")}`;
const signer = new Webhook(secret);
const routes = [
  {
    recipient: "support@example.com",
    to: "support-inbox@example.net",
    from: "support@example.com",
  },
];
const rawMessage = Buffer.from(
  [
    "From: Alice Example <alice@example.org>",
    "To: support@example.com",
    "Subject: Help needed",
    "Reply-To: reply@example.org",
    "Message-ID: <original-123@example.org>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="mail-boundary"',
    "",
    "--mail-boundary",
    'Content-Type: text/plain; charset="utf-8"',
    "",
    "Please see the attached details.",
    "--mail-boundary",
    'Content-Type: text/plain; name="details.txt"',
    'Content-Disposition: attachment; filename="details.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("case details").toString("base64"),
    "--mail-boundary--",
    "",
  ].join("\r\n"),
);
const sentMessages = [];
let server;
let baseUrl;

before(async () => {
  const processEvent = (event) =>
    forwardReceivedEmail(event, {
      routes,
      receivedEmailGateway: {
        async getReceivedEmail(emailId) {
          assert.equal(emailId, "email_123");
          return {
            email: {
              from: "alice@example.org",
              subject: "Help needed",
              reply_to: ["reply@example.org"],
              headers: {
                from: "Alice Example <alice@example.org>",
                "reply-to": "reply@example.org",
              },
            },
            rawContent: rawMessage,
          };
        },
      },
      mimeParser: new PostalMimeParser(),
      emailSender: {
        async send(message) {
          sentMessages.push(message);
        },
      },
    });

  server = createHttpServer({
    webhookVerifier: new SvixWebhookVerifier(secret),
    forwardReceivedEmail: processEvent,
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

test("signed webhook is parsed and forwarded with the original sender, reply address, and attachment", async () => {
  const payload = JSON.stringify({
    type: "email.received",
    data: {
      email_id: "email_123",
      message_id: "<original-123@example.org>",
      to: ["support+case@example.com"],
    },
  });
  const id = "msg_http_flow";
  const timestamp = new Date();
  const response = await fetch(`${baseUrl}/webhooks/resend`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signer.sign(id, timestamp, payload),
    },
    body: payload,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].senderName, "Alice Example");
  assert.equal(sentMessages[0].senderAddress, "support@example.com");
  assert.equal(sentMessages[0].to, "support-inbox@example.net");
  assert.deepEqual(sentMessages[0].replyTo, ["reply@example.org"]);
  assert.equal(sentMessages[0].text, "Please see the attached details.");
  assert.equal(sentMessages[0].inReplyTo, "<original-123@example.org>");
  assert.deepEqual(sentMessages[0].attachments, [
    {
      filename: "details.txt",
      content: new Uint8Array(Buffer.from("case details")),
      mediaType: "text/plain",
      contentId: undefined,
    },
  ]);
});
