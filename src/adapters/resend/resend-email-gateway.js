import { ReceivedEmailTooLargeError } from "../../application/errors.js";

export const MAX_RAW_EMAIL_BYTES = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;

export class ResendGatewayError extends Error {
  constructor() {
    super("Resend could not complete the email operation.");
    this.name = "ResendGatewayError";
  }
}

async function downloadRawContent(url, { fetchImpl, maxRawEmailBytes, timeoutMs }) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ResendGatewayError();
  }
  if (parsedUrl.protocol !== "https:") throw new ResendGatewayError();

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new ResendGatewayError();
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxRawEmailBytes) {
    await response.body.cancel();
    throw new ReceivedEmailTooLargeError();
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxRawEmailBytes) {
        await reader.cancel();
        throw new ReceivedEmailTooLargeError();
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

export class ResendEmailGateway {
  constructor(
    resend,
    {
      fetchImpl = globalThis.fetch,
      maxRawEmailBytes = MAX_RAW_EMAIL_BYTES,
      timeoutMs = UPSTREAM_TIMEOUT_MS,
    } = {},
  ) {
    this.resend = resend;
    this.fetchImpl = fetchImpl;
    this.maxRawEmailBytes = maxRawEmailBytes;
    this.timeoutMs = timeoutMs;
  }

  async getReceivedEmail(emailId) {
    const { data: email, error } = await this.resend.emails.receiving.get(
      emailId,
      {},
      {
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (error || !email?.raw?.download_url) throw new ResendGatewayError();

    const rawContent = await downloadRawContent(email.raw.download_url, {
      fetchImpl: this.fetchImpl,
      maxRawEmailBytes: this.maxRawEmailBytes,
      timeoutMs: this.timeoutMs,
    });

    return { email, rawContent };
  }

  async send(message) {
    const from = message.senderName
      ? `${message.senderName} <${message.senderAddress}>`
      : message.senderAddress;
    const attachments = (message.attachments || []).map((attachment) => ({
      filename: attachment.filename,
      content: Buffer.from(attachment.content).toString("base64"),
      contentType: attachment.mediaType,
      contentId: attachment.contentId,
    }));
    const resendMessage = {
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
      headers: message.inReplyTo ? { "In-Reply-To": message.inReplyTo } : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    const { error } = await this.resend.emails.send(resendMessage, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (error) throw new ResendGatewayError();
  }
}
