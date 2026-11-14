/**
 * Where verify_before_action sends a Sentinel call.
 *
 * Test mode never falls back to the production host. A deployment-protection
 * header is taken only from the environment, and only attached later when
 * the request origin is exactly the origin of SENTINEL_URL.
 * Header values are not logged.
 */

export const SENTINEL_URL_ENV = "SENTINEL_URL";
export const SENTINEL_TEST_MODE_ENV = "SENTINEL_TEST_MODE";
export const SENTINEL_PROTECTION_HEADER_ENV = "SENTINEL_DEPLOYMENT_PROTECTION_HEADER";
export const SENTINEL_PROTECTION_VALUE_ENV = "SENTINEL_DEPLOYMENT_PROTECTION";

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export interface DeploymentProtection {
  name: string;
  value: string;
  /** Exact origin of SENTINEL_URL, including scheme and port. */
  origin: string;
}

export interface SentinelTarget {
  testMode: boolean;
  url?: string;
  protection?: DeploymentProtection;
  /**
   * Set when protection env is present but unusable. The caller must fail
   * closed before fetch. The string never includes the header value.
   */
  protectionError?: string;
}

function enabled(value: unknown): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function resolveSentinelTarget(env: NodeJS.ProcessEnv): SentinelTarget {
  const testMode = enabled(env[SENTINEL_TEST_MODE_ENV]);
  const url = clean(env[SENTINEL_URL_ENV]);
  const name = clean(env[SENTINEL_PROTECTION_HEADER_ENV]);
  const value = clean(env[SENTINEL_PROTECTION_VALUE_ENV]);
  const target: SentinelTarget = {
    testMode,
    ...(url ? { url } : {}),
  };
  if (!name && !value) return target;

  if (!name || !value || !HEADER_NAME.test(name) || /[\r\n]/.test(value) || !url) {
    target.protectionError =
      "deployment protection header is not usable (refusing to call before it can be scoped)";
    return target;
  }
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    target.protectionError =
      "deployment protection header is not usable (refusing to call before it can be scoped)";
    return target;
  }
  if (!origin || origin === "null") {
    target.protectionError =
      "deployment protection header is not usable (refusing to call before it can be scoped)";
    return target;
  }
  target.protection = { name, value, origin };
  return target;
}

export const SENTINEL_TEST_URL_REQUIRED =
  "SENTINEL_TEST_MODE requires SENTINEL_URL (no production fallback)";
