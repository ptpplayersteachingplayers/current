// =============================================================================
// Stripe signature verification
// =============================================================================
//   node --experimental-strip-types tests/signature.test.mjs
//
// signature.ts is written against the Web Crypto API and uses no Deno global,
// so Node imports the very same source the edge function runs. That matters: a
// test against a re-implementation would prove nothing about the code that
// actually faces the internet.
//
// This is the one part of the edge layer where a mistake means anyone can
// confirm bookings for free, so it is the one part that gets executed rather
// than reasoned about.
// =============================================================================

import { createHmac } from "node:crypto";

const { verifyStripeSignature, parseSignatureHeader } = await import(
  new URL("../_shared/signature.ts", import.meta.url).href
);

const SECRET = "whsec_test_do_not_use_anywhere_real";
const BODY = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });

function sign(body, timestamp, secret = SECRET) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

let pass = 0;
let fail = 0;

async function check(description, run) {
  try {
    const result = await run();
    if (result === true) {
      console.log(`  ok   ${description}`);
      pass++;
    } else {
      console.log(`  FAIL ${description}\n         ${result}`);
      fail++;
    }
  } catch (error) {
    console.log(`  FAIL ${description}\n         threw: ${error.message}`);
    fail++;
  }
}

const now = 1_700_000_000;

console.log("STRIPE SIGNATURE");

await check("a genuine signature is accepted", async () => {
  const header = `t=${now},v1=${sign(BODY, now)}`;
  const r = await verifyStripeSignature(BODY, header, SECRET, 300, now);
  return r.ok === true || JSON.stringify(r);
});

await check("a body altered after signing is rejected", async () => {
  const header = `t=${now},v1=${sign(BODY, now)}`;
  const tampered = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded", amount: 1 });
  const r = await verifyStripeSignature(tampered, header, SECRET, 300, now);
  return r.ok === false && r.reason === "no_matching_signature" ? true : JSON.stringify(r);
});

await check("a signature from a different secret is rejected", async () => {
  const header = `t=${now},v1=${sign(BODY, now, "whsec_someone_elses")}`;
  const r = await verifyStripeSignature(BODY, header, SECRET, 300, now);
  return r.ok === false ? true : JSON.stringify(r);
});

await check("a replay outside the tolerance window is rejected", async () => {
  const old = now - 3600;
  const header = `t=${old},v1=${sign(BODY, old)}`;
  const r = await verifyStripeSignature(BODY, header, SECRET, 300, now);
  return r.ok === false && r.reason === "timestamp_outside_tolerance" ? true : JSON.stringify(r);
});

await check("a timestamp from the future is rejected too", async () => {
  const ahead = now + 3600;
  const header = `t=${ahead},v1=${sign(BODY, ahead)}`;
  const r = await verifyStripeSignature(BODY, header, SECRET, 300, now);
  return r.ok === false && r.reason === "timestamp_outside_tolerance" ? true : JSON.stringify(r);
});

await check("the timestamp is part of what is signed", async () => {
  // Correct HMAC of the body, but paired with a different t in the header.
  const header = `t=${now},v1=${sign(BODY, now - 10)}`;
  const r = await verifyStripeSignature(BODY, header, SECRET, 300, now);
  return r.ok === false ? true : JSON.stringify(r);
});

await check("a missing header is rejected", async () => {
  const r = await verifyStripeSignature(BODY, null, SECRET, 300, now);
  return r.ok === false && r.reason === "missing_signature_header" ? true : JSON.stringify(r);
});

await check("an unconfigured endpoint secret refuses everything", async () => {
  const header = `t=${now},v1=${sign(BODY, now)}`;
  const r = await verifyStripeSignature(BODY, header, "", 300, now);
  return r.ok === false && r.reason === "missing_endpoint_secret" ? true : JSON.stringify(r);
});

await check("a header with no v1 is rejected", async () => {
  const r = await verifyStripeSignature(BODY, `t=${now},v0=abc`, SECRET, 300, now);
  return r.ok === false && r.reason === "no_v1_signature" ? true : JSON.stringify(r);
});

await check("during a secret rotation, either signature passes", async () => {
  const header = `t=${now},v1=${sign(BODY, now, "whsec_old")},v1=${sign(BODY, now)}`;
  const r = await verifyStripeSignature(BODY, header, SECRET, 300, now);
  return r.ok === true ? true : JSON.stringify(r);
});

await check("an uppercase hex signature still matches", async () => {
  const header = `t=${now},v1=${sign(BODY, now).toUpperCase()}`;
  const r = await verifyStripeSignature(BODY, header, SECRET, 300, now);
  return r.ok === true ? true : JSON.stringify(r);
});

await check("the header parser survives junk", async () => {
  const parsed = parseSignatureHeader("nonsense,,t=,v1=,t=12,v1=ab");
  return parsed.timestamp === 12 && parsed.signatures.length === 2 ? true : JSON.stringify(parsed);
});

console.log("");
console.log("============================================================");
console.log(`  ${pass} passed, ${fail} failed`);
console.log("============================================================");

process.exit(fail === 0 ? 0 : 1);
