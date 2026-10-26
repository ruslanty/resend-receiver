export function normalizeRecipient(address) {
  const value = String(address || "")
    .trim()
    .toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0) return value;

  const localPart = value.slice(0, at).split("+", 1)[0];
  return `${localPart}${value.slice(at)}`;
}

export function findForwardRoute(event, routes) {
  const recipients = Array.isArray(event.data?.to) ? event.data.to : [];

  return routes.find((candidate) =>
    recipients.some(
      (recipient) => normalizeRecipient(recipient) === normalizeRecipient(candidate.recipient),
    ),
  );
}
