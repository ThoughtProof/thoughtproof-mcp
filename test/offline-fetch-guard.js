/**
 * Replaces global fetch for the default test process.
 * A call throws before any socket is opened. Live tests do not load this file.
 */
if (!globalThis.__THOUGHTPROOF_OFFLINE_FETCH_GUARD) {
  globalThis.__THOUGHTPROOF_OFFLINE_FETCH_GUARD = true;
  const attempts = [];
  globalThis.__THOUGHTPROOF_OFFLINE_FETCH_ATTEMPTS = attempts;
  globalThis.fetch = async function offlineFetchGuard(input) {
    let url = "";
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.href;
    else if (input && typeof input.url === "string") url = input.url;
    attempts.push(url);
    throw new Error(`offline guard: unexpected network fetch ${url}`);
  };
}
