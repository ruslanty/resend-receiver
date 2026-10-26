import assert from "node:assert/strict";
import test from "node:test";

import { findForwardRoute, normalizeRecipient } from "../../src/domain/forwarding-route.js";

test("normalizeRecipient trims whitespace and ignores address case", () => {
  assert.equal(normalizeRecipient("  Support@Example.COM "), "support@example.com");
});

test("normalizeRecipient removes a plus tag from the local part", () => {
  assert.equal(normalizeRecipient("support+ticket@example.com"), "support@example.com");
});

test("normalizeRecipient leaves values without a local-part separator intact", () => {
  assert.equal(normalizeRecipient("invalid-address"), "invalid-address");
  assert.equal(normalizeRecipient("@example.com"), "@example.com");
});

test("findForwardRoute matches any event recipient against configured routes", () => {
  const expected = {
    recipient: "support@example.com",
    to: "inbox@example.net",
    from: "support@example.com",
  };

  const route = findForwardRoute(
    { data: { to: ["other@example.com", "support+ticket@example.com"] } },
    [expected],
  );

  assert.equal(route, expected);
});

test("findForwardRoute returns undefined when recipients do not match", () => {
  const route = findForwardRoute({ data: { to: ["other@example.com"] } }, [
    { recipient: "support@example.com", to: "inbox@example.net", from: "support@example.com" },
  ]);

  assert.equal(route, undefined);
});

test("findForwardRoute ignores malformed events without a recipient array", () => {
  assert.equal(findForwardRoute({ data: { to: "support@example.com" } }, []), undefined);
  assert.equal(findForwardRoute({}, []), undefined);
});
