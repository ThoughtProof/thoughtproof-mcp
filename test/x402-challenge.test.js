import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodePaymentRequiredHeader,
  defaultPayToFallback,
  parseX402PaymentRequired,
} from "../dist/x402-challenge.js";

function fakeResponse({ header, body }) {
  return {
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        if (key === "payment-required") return header ?? null;
        return null;
      },
    },
    async json() {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  };
}

describe("x402 payment-required parser (#16)", () => {
  it("decodes base64 payment-required header JSON", () => {
    const challenge = {
      accepts: [
        {
          amount: "50000",
          payTo: "0xabcPAYTO000000000000000000000000000001",
        },
      ],
    };
    const header = Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
    const decoded = decodePaymentRequiredHeader(header);
    assert.equal(decoded?.accepts?.[0]?.amount, "50000");
    assert.equal(decoded?.accepts?.[0]?.payTo, "0xabcPAYTO000000000000000000000000000001");
  });

  it("accepts raw JSON header (non-base64)", () => {
    const decoded = decodePaymentRequiredHeader(
      JSON.stringify({ accepts: [{ maxAmountRequired: "8000", payTo: "0xraw" }] }),
    );
    assert.equal(decoded?.accepts?.[0]?.maxAmountRequired, "8000");
    assert.equal(decoded?.accepts?.[0]?.payTo, "0xraw");
  });

  it("prefers header over body and prices v2 amount", async () => {
    const challenge = {
      accepts: [{ amount: "50000", payTo: "0xHEADER" }],
    };
    const header = Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
    const parsed = await parseX402PaymentRequired(
      fakeResponse({
        header,
        body: { accepts: [{ maxAmountRequired: "999999", payTo: "0xBODY" }] },
      }),
    );
    assert.equal(parsed.source, "header");
    assert.equal(parsed.thisRequest, "$0.050");
    assert.equal(parsed.payTo, "0xHEADER");
    assert.equal(parsed.amountAtomic, "50000");
  });

  it("falls back to body when header missing/unusable", async () => {
    const parsed = await parseX402PaymentRequired(
      fakeResponse({
        header: "",
        body: {
          accepts: [{ maxAmountRequired: "20000", payTo: "0xBODYONLY" }],
        },
      }),
    );
    assert.equal(parsed.source, "body");
    assert.equal(parsed.thisRequest, "$0.020");
    assert.equal(parsed.payTo, "0xBODYONLY");
  });

  it("returns varies + no payTo when neither source has accepts", async () => {
    const parsed = await parseX402PaymentRequired(fakeResponse({ header: null, body: {} }));
    assert.equal(parsed.source, "body");
    assert.equal(parsed.thisRequest, "varies");
    assert.equal(parsed.payTo, undefined);
    assert.equal(defaultPayToFallback(parsed.payTo), "0xAB9f84864662f980614bD1453dB9950Ef2b82E83");
  });

  it("prices older maxAmountRequired shape from body", async () => {
    const parsed = await parseX402PaymentRequired(
      fakeResponse({
        body: { accepts: [{ maxAmountRequired: "8000" }] },
      }),
    );
    assert.equal(parsed.thisRequest, "$0.008");
    assert.equal(parsed.amountAtomic, "8000");
  });
});
