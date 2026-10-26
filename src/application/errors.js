export class InvalidEmailEventError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidEmailEventError";
  }
}

export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super("Webhook signature is invalid.");
    this.name = "InvalidWebhookSignatureError";
  }
}

export class ReceivedEmailTooLargeError extends Error {
  constructor() {
    super("Received email exceeds the configured size limit.");
    this.name = "ReceivedEmailTooLargeError";
  }
}
