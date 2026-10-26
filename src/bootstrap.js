import { Resend } from "resend";
import { forwardReceivedEmail } from "./application/forward-received-email.js";
import { loadConfig } from "./adapters/config/load-config.js";
import { createHttpServer } from "./adapters/http/create-http-server.js";
import { PostalMimeParser } from "./adapters/mime/postal-mime-parser.js";
import { ResendEmailGateway } from "./adapters/resend/resend-email-gateway.js";
import { SvixWebhookVerifier } from "./adapters/webhook/svix-webhook-verifier.js";

export function createApplicationServer({
  environment = process.env,
  logger = console,
  fetchImpl,
} = {}) {
  const config = loadConfig(environment);
  const resend = new Resend(config.resendApiKey);
  const receivedEmailGateway = new ResendEmailGateway(resend, { fetchImpl });
  const mimeParser = new PostalMimeParser();
  const webhookVerifier = new SvixWebhookVerifier(config.resendWebhookSecret);
  const processEvent = (event) =>
    forwardReceivedEmail(event, {
      routes: config.forwardRoutes,
      receivedEmailGateway,
      mimeParser,
      emailSender: receivedEmailGateway,
    });

  return {
    server: createHttpServer({ webhookVerifier, forwardReceivedEmail: processEvent, logger }),
    port: config.port,
  };
}
