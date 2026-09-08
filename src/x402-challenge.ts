/**
 * Shared x402 payment-required challenge parser.
 *
 * Prefer the HTTP `payment-required` header (base64 JSON challenge), then fall
 * back to a JSON response body for older/body-based deployments.
 * Accepts both v2 `accepts[].amount` and older `accepts[].maxAmountRequired`.
 *
 * Closes: https://github.com/ThoughtProof/thoughtproof-mcp/issues/16
 */

export type X402Accept = {
  maxAmountRequired?: string | number;
  amount?: string | number;
  payTo?: string;
  [key: string]: unknown;
};

export type X402ChallengeDetails = {
  accepts?: X402Accept[];
  [key: string]: unknown;
};

export type ParsedX402Pricing = {
  details: X402ChallengeDetails;
  /** Display string like "$0.050" or "varies" */
  thisRequest: string;
  payTo: string | undefined;
  /** Raw atomic amount string when present */
  amountAtomic: string | undefined;
  source: "header" | "body" | "none";
};

const DEFAULT_PAY_TO = "0xAB9f84864662f980614bD1453dB9950Ef2b82E83";

/** Decode a payment-required header value into challenge JSON, if possible. */
export function decodePaymentRequiredHeader(headerValue: string | null | undefined): X402ChallengeDetails | null {
  if (!headerValue) return null;
  const raw = headerValue.trim();
  if (!raw) return null;

  // Try base64 → UTF-8 JSON first (common x402 header form).
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    if (decoded.startsWith("{") || decoded.startsWith("[")) {
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === "object") return parsed as X402ChallengeDetails;
    }
  } catch {
    /* fall through */
  }

  // Some deployments may send raw JSON in the header.
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as X402ChallengeDetails;
    } catch {
      /* ignore */
    }
  }

  return null;
}

function pickAmountAtomic(accept: X402Accept | undefined): string | undefined {
  if (!accept) return undefined;
  const v = accept.amount ?? accept.maxAmountRequired;
  if (v == null || v === "") return undefined;
  return String(v);
}

function formatUsdcFromAtomic(amountAtomic: string | undefined): string {
  if (!amountAtomic) return "varies";
  const n = Number.parseInt(amountAtomic, 10);
  if (!Number.isFinite(n) || n < 0) return "varies";
  return `$${(n / 1_000_000).toFixed(3)}`;
}

/**
 * Build pricing fields from a 402 Response.
 * Header wins; body is fallback; hard-coded payTo only when neither provides one.
 */
export async function parseX402PaymentRequired(response: {
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}): Promise<ParsedX402Pricing> {
  const headerRaw =
    response.headers.get("payment-required") ??
    response.headers.get("Payment-Required") ??
    response.headers.get("PAYMENT-REQUIRED");

  let details: X402ChallengeDetails = {};
  let source: ParsedX402Pricing["source"] = "none";

  const fromHeader = decodePaymentRequiredHeader(headerRaw);
  if (fromHeader) {
    details = fromHeader;
    source = "header";
  } else {
    try {
      const body = await response.json();
      if (body && typeof body === "object") {
        details = body as X402ChallengeDetails;
        source = "body";
      }
    } catch {
      /* empty body / non-JSON */
    }
  }

  const accept = Array.isArray(details.accepts) ? details.accepts[0] : undefined;
  const amountAtomic = pickAmountAtomic(accept);
  const payTo = typeof accept?.payTo === "string" && accept.payTo.length > 0 ? accept.payTo : undefined;

  return {
    details,
    thisRequest: formatUsdcFromAtomic(amountAtomic),
    payTo,
    amountAtomic,
    source,
  };
}

export function defaultPayToFallback(payTo: string | undefined): string {
  return payTo ?? DEFAULT_PAY_TO;
}
