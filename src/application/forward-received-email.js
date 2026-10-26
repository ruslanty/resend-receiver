import { findForwardRoute } from "../domain/forwarding-route.js";
import { InvalidEmailEventError } from "./errors.js";

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const key = Object.keys(headers).find(
    (headerName) => headerName.toLowerCase() === name.toLowerCase(),
  );
  return key ? String(headers[key] || "").trim() : "";
}

function originalSenderName(email) {
  const value = headerValue(email?.headers, "from") || String(email?.from || "").trim();
  const match = value.match(/^\s*(.*?)\s*<[^<>]+>\s*$/);
  if (!match && value.includes("@")) return "";
  const name = (match ? match[1] : "")
    .trim()
    .replace(/[\r\n<>]/g, "")
    .replace(/["\\]/g, "'");
  return name || (match ? "" : value.replace(/[\r\n<>]/g, "").trim());
}

function originalReplyTo(email) {
  if (Array.isArray(email?.reply_to) && email.reply_to.length > 0) {
    const addresses = email.reply_to
      .filter((address) => typeof address === "string" && !/[\r\n]/.test(address))
      .map((address) => address.trim())
      .filter(Boolean);
    if (addresses.length > 0) return addresses;
  }

  const replyToHeader = headerValue(email?.headers, "reply-to");
  if (replyToHeader && !/[\r\n]/.test(replyToHeader)) return replyToHeader;

  const fromHeader = headerValue(email?.headers, "from");
  if (fromHeader && !/[\r\n]/.test(fromHeader)) return fromHeader;

  const senderAddress = String(email?.from || "").trim();
  return /[\r\n]/.test(senderAddress) ? "" : senderAddress;
}

function inReplyTo(emailId) {
  return typeof emailId === "string" && !/[\r\n]/.test(emailId) ? emailId.trim() : "";
}

function forwardedAttachments(attachments = []) {
  return attachments.map((attachment) => ({
    filename: attachment.filename || undefined,
    content: attachment.content,
    mediaType: attachment.mediaType,
    contentId: attachment.contentId,
  }));
}

export async function forwardReceivedEmail(
  event,
  { routes, receivedEmailGateway, mimeParser, emailSender },
) {
  if (
    !event ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    typeof event.type !== "string"
  ) {
    throw new InvalidEmailEventError("Webhook event must have a string type.");
  }
  if (event.type !== "email.received") return { kind: "ignored" };

  const data = event.data;
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.email_id !== "string" ||
    data.email_id.trim() === "" ||
    !Array.isArray(data.to)
  ) {
    throw new InvalidEmailEventError("email.received event is missing required fields.");
  }

  const route = findForwardRoute(event, routes);
  if (!route) return { kind: "unmatched" };

  const { email, rawContent } = await receivedEmailGateway.getReceivedEmail(data.email_id);
  if (!email || !(rawContent instanceof Uint8Array)) {
    throw new Error("Received email content is unavailable.");
  }

  const parsed = await mimeParser.parse(rawContent);
  const senderName = originalSenderName(email);
  const messageId = inReplyTo(data.message_id);
  const attachments = forwardedAttachments(parsed.attachments || []);
  const message = {
    senderAddress: route.from,
    senderName,
    to: route.to,
    subject: email.subject || "(no subject)",
    html: parsed.html || undefined,
    text: parsed.text || "",
    replyTo: originalReplyTo(email),
    inReplyTo: messageId || undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  await emailSender.send(message);
  return { kind: "forwarded" };
}
