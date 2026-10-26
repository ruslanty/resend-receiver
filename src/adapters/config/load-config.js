import { normalizeRecipient } from "../../domain/forwarding-route.js";

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function requiredValue(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigurationError(`${name} is required.`);
  }

  return value.trim();
}

function isEmailAddress(value) {
  return /^[^\s@<>]+@[^\s@<>.]+(?:\.[^\s@<>.]+)+$/.test(value);
}

function routeAddress(route, key, index) {
  const value = route?.[key];
  if (typeof value !== "string" || !isEmailAddress(value.trim())) {
    throw new ConfigurationError(`FORWARD_ROUTES[${index}].${key} must be an email address.`);
  }

  return value.trim();
}

function parseRoutes(value) {
  let routes;
  try {
    routes = JSON.parse(value);
  } catch {
    throw new ConfigurationError("FORWARD_ROUTES must contain valid JSON.");
  }

  if (!Array.isArray(routes) || routes.length === 0) {
    throw new ConfigurationError("FORWARD_ROUTES must be a non-empty JSON array.");
  }

  const recipients = new Set();
  return routes.map((route, index) => {
    if (!route || typeof route !== "object" || Array.isArray(route)) {
      throw new ConfigurationError(`FORWARD_ROUTES[${index}] must be an object.`);
    }

    const recipient = routeAddress(route, "recipient", index);
    const normalizedRecipient = normalizeRecipient(recipient);
    if (recipients.has(normalizedRecipient)) {
      throw new ConfigurationError(
        `FORWARD_ROUTES contains a duplicate recipient at index ${index}.`,
      );
    }
    recipients.add(normalizedRecipient);

    return {
      recipient,
      to: routeAddress(route, "to", index),
      from: routeAddress(route, "from", index),
    };
  });
}

function parsePort(value) {
  if (value === undefined || value === "") return 3000;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ConfigurationError("PORT must be an integer between 1 and 65535.");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

export function loadConfig(environment) {
  const resendApiKey = requiredValue(environment, "RESEND_API_KEY");
  const resendWebhookSecret = requiredValue(environment, "RESEND_WEBHOOK_SECRET");
  const encodedWebhookSecret = resendWebhookSecret.slice("whsec_".length);
  if (
    !resendWebhookSecret.startsWith("whsec_") ||
    encodedWebhookSecret.length === 0 ||
    encodedWebhookSecret.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedWebhookSecret)
  ) {
    throw new ConfigurationError(
      "RESEND_WEBHOOK_SECRET must be a valid base64 Resend/Svix secret beginning with whsec_.",
    );
  }

  const rawRoutes = requiredValue(environment, "FORWARD_ROUTES");
  return {
    resendApiKey,
    resendWebhookSecret,
    forwardRoutes: parseRoutes(rawRoutes),
    port: parsePort(environment.PORT),
  };
}
