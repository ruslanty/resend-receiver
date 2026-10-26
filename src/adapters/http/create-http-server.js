import http from "node:http";
import {
  InvalidEmailEventError,
  InvalidWebhookSignatureError,
  ReceivedEmailTooLargeError,
} from "../../application/errors.js";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Webhook request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readRequestBody(request, maximumBytes) {
  const contentLength = Number(request.headers["content-length"]);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = Number.isFinite(contentLength) && contentLength > maximumBytes;

    request.on("data", (chunk) => {
      if (tooLarge) return;
      totalBytes += chunk.length;
      if (totalBytes > maximumBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => {
      if (tooLarge) {
        reject(new RequestBodyTooLargeError());
        return;
      }
      resolve(Buffer.concat(chunks, totalBytes).toString("utf8"));
    });
    request.once("error", reject);
    request.once("aborted", () => reject(new Error("Webhook request was aborted.")));
  });
}

function statusForError(error) {
  if (error instanceof RequestBodyTooLargeError) return 413;
  if (error instanceof InvalidWebhookSignatureError || error instanceof InvalidEmailEventError)
    return 400;
  if (error instanceof ReceivedEmailTooLargeError) return 422;
  return 503;
}

export function createHttpServer({
  webhookVerifier,
  forwardReceivedEmail,
  maxWebhookBodyBytes = MAX_WEBHOOK_BODY_BYTES,
  logger = console,
}) {
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, { ok: true });
    }
    if (request.method !== "POST" || request.url !== "/webhooks/resend") {
      return json(response, 404, { error: "not found" });
    }

    try {
      const rawPayload = await readRequestBody(request, maxWebhookBodyBytes);
      webhookVerifier.verify(rawPayload, request.headers);

      let event;
      try {
        event = JSON.parse(rawPayload);
      } catch {
        return json(response, 400, { error: "invalid webhook payload" });
      }

      const result = await forwardReceivedEmail(event);
      if (result.kind === "unmatched" || result.kind === "ignored") {
        return json(response, 200, { ok: true, ignored: true });
      }
      return json(response, 200, { ok: true });
    } catch (error) {
      const status = statusForError(error);
      if (status === 503 || status === 422) {
        logger.error("Resend webhook processing failed", { error: error.name || "Error" });
      }
      const bodies = {
        400: { error: "invalid webhook" },
        413: { error: "webhook payload too large" },
        422: { error: "received email exceeds the size limit" },
        503: { error: "temporary processing failure" },
      };
      const body = bodies[status];
      return json(response, status, body);
    }
  });

  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}
