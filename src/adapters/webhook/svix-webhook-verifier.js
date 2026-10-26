import { Webhook } from "svix";
import { InvalidWebhookSignatureError } from "../../application/errors.js";

export class SvixWebhookVerifier {
  constructor(secret) {
    this.webhook = new Webhook(secret);
  }

  verify(payload, headers) {
    try {
      this.webhook.verify(payload, {
        "svix-id": headers["svix-id"],
        "svix-timestamp": headers["svix-timestamp"],
        "svix-signature": headers["svix-signature"],
      });
    } catch {
      throw new InvalidWebhookSignatureError();
    }
  }
}
