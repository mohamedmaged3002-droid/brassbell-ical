// Live USD->EGP rate. Brassbell.net quotes nightly prices in USD; the BlueKeys
// site stores/show EGP, so we convert at fetch time. NEVER bake a fixed rate —
// the pound drifts (was ~53 in May 2026, ~49.6 in June 2026).
//
// FX_RATE env overrides the API (manual pin for a run). Otherwise we hit a free,
// keyless endpoint and fall back to a second source, then error if both fail
// (the caller's guard then refuses to wipe prices with a bad rate).

async function fetchJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function getUsdEgp() {
  const pin = parseFloat(process.env.FX_RATE || '');
  if (Number.isFinite(pin) && pin > 0) return { rate: pin, source: 'FX_RATE env' };

  const sources = [
    ['open.er-api.com', 'https://open.er-api.com/v6/latest/USD', (j) => j?.rates?.EGP],
    ['exchangerate.host', 'https://api.exchangerate.host/latest?base=USD&symbols=EGP', (j) => j?.rates?.EGP],
  ];
  const errs = [];
  for (const [name, url, pick] of sources) {
    try {
      const rate = pick(await fetchJson(url));
      if (Number.isFinite(rate) && rate > 20 && rate < 200) return { rate, source: name };
      errs.push(`${name}: implausible rate ${rate}`);
    } catch (e) {
      errs.push(`${name}: ${String(e).slice(0, 80)}`);
    }
  }
  throw new Error(`Could not fetch USD->EGP rate (${errs.join(' | ')}). Set FX_RATE env to override.`);
}

module.exports = { getUsdEgp };
