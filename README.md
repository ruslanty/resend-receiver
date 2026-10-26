# Resend Receiver

Resend Receiver is a small, self-hosted service that forwards inbound emails received by [Resend](https://resend.com/) to configured addresses. It accepts Resend `email.received` webhooks, verifies their signatures, selects a route by recipient, retrieves the original message, and sends a reconstructed email through Resend.

It is a focused open-source utility, not a general-purpose mail server or a high-availability platform.

## How it works

1. Resend sends an `email.received` webhook containing message metadata.
2. The service verifies the webhook signature and finds a route matching one of the event's recipients.
3. It retrieves the received email and its raw MIME content from Resend, then parses the message.
4. It sends the reconstructed message to the route's configured destination using Resend.

The forwarded message preserves the subject, text/HTML body, attachments, original sender display name, reply address, and `In-Reply-To` when available. MIME is reconstructed; the message is not forwarded byte-for-byte. Resend's [receiving email guide](https://resend.com/docs/dashboard/receiving/introduction), [webhook setup guide](https://resend.com/docs/dashboard/receiving/create-receiving-webhook), and [received-email API reference](https://resend.com/docs/api-reference/emails/retrieve-received-email) describe the provider-side flow.

## Requirements

- A Resend account and an API key that can retrieve received emails and send email. See Resend's [API key management guide](https://resend.com/docs/dashboard/api-keys/introduction).
- Inbound email receiving enabled for a Resend-managed receiving domain or a verified custom domain. See [Receiving Emails](https://resend.com/docs/dashboard/receiving/introduction) and [Custom Receiving Domains](https://resend.com/docs/dashboard/receiving/custom-domains).
- A verified Resend sending domain/address for each route's `from` value. See [Managing Domains](https://resend.com/docs/dashboard/domains/introduction).
- A Resend webhook subscribed to `email.received`, with its signing secret configured in the service. See [Create a receiving webhook](https://resend.com/docs/dashboard/receiving/create-receiving-webhook).
- Node.js 22 or newer for local development, or Docker with the Docker Compose plugin for container deployment.

If your existing domain already has MX records for a mailbox provider, Resend recommends using a separate subdomain for receiving so you do not disrupt existing mail delivery. Follow Resend's [custom receiving domain instructions](https://resend.com/docs/dashboard/receiving/custom-domains) and copy the MX record shown for your domain in the Resend dashboard; do not guess the record value.

## Configuration

The service validates configuration at startup and exits with an actionable error if a value is invalid. Error messages do not include secret values.

| Variable                | Required     | Default | Description                                                  |
| ----------------------- | ------------ | ------- | ------------------------------------------------------------ |
| `RESEND_API_KEY`        | Yes          | —       | Resend API key used to retrieve and send emails.             |
| `RESEND_WEBHOOK_SECRET` | Yes          | —       | Signing secret for the Resend webhook; starts with `whsec_`. |
| `FORWARD_ROUTES`        | Yes          | —       | Non-empty JSON array defining inbound recipient routes.      |
| `PORT`                  | No           | `3000`  | HTTP port inside the service/container.                      |
| `HOST_PORT`             | Compose only | `3000`  | Host loopback port mapped to the service's `PORT`.           |

Example `FORWARD_ROUTES` value:

```json
[
  {
    "recipient": "support@inbound.example.test",
    "to": "support@destination.example.test",
    "from": "support@sender.example.test"
  },
  {
    "recipient": "jobs@inbound.example.test",
    "to": "recruiting@destination.example.test",
    "from": "jobs@sender.example.test"
  }
]
```

The `.test` addresses above are reserved examples; replace them with your actual addresses. In each route:

- `recipient` is the inbound address used to select the route.
- `to` is the actual destination address for the forwarded email; it does not need to belong to your receiving or sending domain.
- `from` is the verified sender address Resend uses to send the forwarded email and must belong to a domain configured for sending.

At startup, addresses are checked for a basic email-address shape and duplicate recipients are rejected after normalization. Route matching ignores case and removes a `+tag` from the local part; for example, `support+ticket@inbound.example.test` matches `support@inbound.example.test`. This validation does not verify domains or sender permissions with Resend.

Keep API keys and webhook signing secrets out of version control. `.env` is ignored by Git; `.env.example` contains placeholders only. Resend explains how to [manage API keys](https://resend.com/docs/dashboard/api-keys/introduction) and [verify webhook requests](https://resend.com/docs/webhooks/verify-webhooks-requests). Verification must use the original raw request body, before JSON parsing or re-serialization.

## Run locally

```sh
cp .env.example .env
# Set the real API key and routes. Replace the webhook placeholder before connecting Resend.
npm ci
npm run quality
node --env-file=.env server.js
```

Node.js loads the local environment file using its built-in `--env-file` option. The placeholder signing secret permits startup but will not verify real Resend requests; use the endpoint's actual secret before testing webhook delivery. The server listens on `0.0.0.0:3000` by default; set `PORT` in `.env` to use a different port. Do not commit `.env` or share its contents in logs, screenshots, or support requests.

## Docker Compose deployment

Docker Compose is the supported container deployment path. The service runs as a non-root user, uses a read-only filesystem, drops Linux capabilities, and publishes its port on host loopback for access through an HTTPS reverse proxy.

For first-time setup, the placeholder signing secret in `.env.example` can be used only to start the service before creating its Resend webhook. It is not the real webhook secret: signature verification will fail for Resend requests until you replace it with the secret generated for your webhook and recreate the container. Complete the [Connect Resend](#connect-resend) steps before sending a test email.

```sh
cp .env.example .env
# Set the real API key and routes; replace the webhook placeholder after creating the webhook.
docker compose up --build -d
docker compose ps
docker compose logs -f resend-receiver
```

The service is available to a reverse proxy at `127.0.0.1:${HOST_PORT:-3000}`. Configure the proxy to pass `/webhooks/resend` to that address and expose the webhook over public HTTPS; Resend requires a publicly reachable HTTPS endpoint. Replace `HOST_PORT` in `.env` if the default host port is already in use. After changing environment values, recreate the container with `docker compose up -d --force-recreate`. Stop the service with `docker compose down`.

### Connect Resend

1. Enable receiving for a Resend-managed domain or configure a custom receiving domain. Add the MX record provided in the Resend dashboard and wait for the domain to show as verified. See [Receiving Emails](https://resend.com/docs/dashboard/receiving/introduction) and [Custom Receiving Domains](https://resend.com/docs/dashboard/receiving/custom-domains).
2. Start the Compose service and configure your reverse proxy to expose `/webhooks/resend` at a public HTTPS URL. In the examples below, replace `receiver.example.test` with your own public hostname.
3. In the Resend dashboard, create a webhook for the `email.received` event and set its endpoint URL, for example `https://receiver.example.test/webhooks/resend`. See [Create a receiving webhook](https://resend.com/docs/dashboard/receiving/create-receiving-webhook).
4. Copy that webhook's signing secret into `RESEND_WEBHOOK_SECRET` in `.env`, replacing the placeholder. Verify that each route's `from` address belongs to a domain configured for sending in Resend.
5. Recreate the service with `docker compose up -d --force-recreate`, then send a test email to a configured `recipient` address.

Resend webhooks contain metadata rather than the full email body and attachments. This service retrieves the message through Resend's [received-email API](https://resend.com/docs/api-reference/emails/retrieve-received-email); see also Resend's guides for [email content](https://resend.com/docs/dashboard/receiving/get-email-content) and [attachments](https://resend.com/docs/dashboard/receiving/attachments).

## HTTP endpoints and responses

| Method | Path               | Behavior                                                    |
| ------ | ------------------ | ----------------------------------------------------------- |
| `GET`  | `/health`          | Liveness response: `200 {"ok":true}`. Does not call Resend. |
| `POST` | `/webhooks/resend` | Verifies the Svix signature and processes the event.        |

The webhook endpoint responds as follows:

- `200`: email forwarded, or event intentionally ignored because its type is unsupported or no route matches. These cases are acknowledged so Resend does not retry them.
- `400`: invalid webhook signature or malformed event payload.
- `413`: webhook request body exceeds 256 KiB.
- `422`: retrieved raw email exceeds the service's 25 MiB limit.
- `503`: temporary failure retrieving, parsing, or sending an email.

The request-body limit applies to the webhook payload; the 25 MiB limit applies to the separately downloaded raw email. Resend retries failed webhook deliveries and allows manual replays, including for succeeded events. See [Retries and Replays](https://resend.com/docs/webhooks/retries-and-replays). Repeated endpoint failures can cause Resend to disable the webhook. The service logs an error category for processing failures, not email bodies or configured secrets.

## Quality checks

```sh
npm ci
npm run quality
npm audit --omit=dev --audit-level=high
```

`npm run quality` checks formatting with Prettier, lint rules with ESLint, and tests with Node's built-in test runner. Tests use fake Resend operations and local signed webhook fixtures; they do not need production credentials or send real email.

GitHub Actions runs quality checks and a production dependency audit on Node.js 22, 24, and 26, validates the Compose configuration, and builds the Docker image. Dependabot proposes weekly updates for npm dependencies, GitHub Actions, and the Docker base image; updates are not auto-merged.

## Delivery guarantee and limitations

- Delivery is at-least-once, not exactly-once. A provider retry or manual replay after a successful send may send the same email again.
- The service has no database, queue, durable retry store, or duplicate suppression.
- Processing is synchronous. Resend retries failed webhook deliveries according to its [retry schedule](https://resend.com/docs/webhooks/retries-and-replays); prolonged failures can lead Resend to disable the endpoint.
- Raw email messages larger than 25 MiB are rejected. Messages accepted by Resend but above this service limit will not be forwarded.
- The service handles Resend inbound webhook events; it is not an SMTP relay or general-purpose mail server.

## License

MIT. See [`LICENSE`](LICENSE).
