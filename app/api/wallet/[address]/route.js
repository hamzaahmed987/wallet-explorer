// Explicit .js extension so the module also resolves under Node's native ESM
// resolver, which the route tests use.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server.js";
import { DEFAULT_NETWORK, NETWORKS, isNetwork } from "../../../../lib/networks.js";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const API_BASE = "https://api.covalenthq.com";
const TOKEN_LIMIT = 12;
const CACHE_SECONDS = 20;
const TIMEOUT_MS = 10000;
const MAX_CURSOR_LENGTH = 512;

// The API key is read here, server-side only. It is never returned, logged or
// forwarded to the client.
class UpstreamError extends Error {
  constructor(status = 502) {
    super(`GoldRush request failed with status ${status}.`);
    this.status = status;
  }
}

// Non-reversible fingerprint used only in server logs, so an operator can tell
// whether the running process picked up the key from .env.local. Never log the
// key itself.
function keyFingerprint(key) {
  return `${key.length} chars, sha256:${createHash("sha256").update(key).digest("hex").slice(0, 8)}`;
}

function encodeCursor(page) {
  return Buffer.from(JSON.stringify({ p: page }), "utf8").toString("base64url");
}

// Cursors are opaque to the client and only ever carry a single integer page
// number, so a crafted cursor cannot smuggle anything into the upstream URL.
function decodeCursor(raw) {
  if (typeof raw !== "string" || !raw || raw.length > MAX_CURSOR_LENGTH) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const page = parsed?.p;
    return Number.isSafeInteger(page) && page >= 0 ? page : null;
  } catch {
    return null;
  }
}

// GoldRush paginates transactions by page number on the URL path, with page 0
// holding the earliest transactions. The default page is the newest one and
// `links.prev` points at the next (older) page, which is what we expose.
function pageFromLink(link) {
  if (typeof link !== "string") return null;
  const match = link.match(/\/page\/(\d+)\//);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) ? page : null;
}

async function goldrush(path) {
  const key = process.env.GOLDRUSH_API_KEY;
  if (!key) throw new UpstreamError(500);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      next: { revalidate: CACHE_SECONDS },
      signal: controller.signal,
    });
    if (!response.ok) throw new UpstreamError(response.status);
    const payload = await response.json();
    if (payload?.error) throw new UpstreamError(response.status);
    return payload?.data ?? null;
  } finally {
    clearTimeout(timer);
  }
}

// Raw balances are integer strings that routinely exceed 30 digits, so they are
// scaled with BigInt only. The result is a decimal string truncated (not
// rounded) to 6 fractional digits — never a float.
function formatUnits(raw, decimals) {
  const digits = Number(decimals);
  if (!Number.isInteger(digits) || digits < 0 || digits > 36) return null;

  let value;
  try {
    value = BigInt(raw ?? "0");
  } catch {
    return null;
  }
  if (value < 0n) return null;

  const scale = 10n ** BigInt(digits);
  const whole = value / scale;
  const fraction = (value % scale)
    .toString()
    .padStart(digits, "0")
    .replace(/0+$/, "")
    .slice(0, 6);
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function mapTransaction(tx, address, decimals) {
  const from = tx.from_address || "";
  const to = tx.to_address || "";
  return {
    hash: tx.tx_hash,
    from,
    to: to || "Contract creation",
    timestamp: tx.block_signed_at,
    value: formatUnits(tx.value ?? "0", decimals) ?? "0",
    direction: from.toLowerCase() === address.toLowerCase() ? "Sent" : "Received",
    status: tx.successful ? "success" : "failed",
  };
}

// A wallet address has no owner name of its own. We only surface a label the
// provider itself attached to the address, otherwise `null`.
function findName(items, address) {
  const target = address.toLowerCase();
  for (const tx of items) {
    if (tx.from_address?.toLowerCase() === target && tx.from_address_label) {
      return tx.from_address_label.trim().slice(0, 80);
    }
    if (tx.to_address?.toLowerCase() === target && tx.to_address_label) {
      return tx.to_address_label.trim().slice(0, 80);
    }
  }
  return null;
}

function mapTokens(items) {
  const seen = new Set();
  const tokens = [];

  for (const item of items || []) {
    if (!item || item.is_native_token) continue;
    if (item.is_spam === true) continue;
    if (item.type === "dust") continue;
    if (item.balance === "0") continue;
    if (item.quote_rate === null || item.quote_rate === undefined) continue;

    const amount = formatUnits(item.balance, item.contract_decimals);
    if (!amount || amount === "0") continue;

    const contract = item.contract_address || "";
    const key = contract.toLowerCase();
    if (!contract || seen.has(key)) continue;
    seen.add(key);

    tokens.push({
      address: contract,
      name: item.contract_name || item.contract_display_name || "Unknown token",
      symbol: item.contract_ticker_symbol || "???",
      amount,
      quote: typeof item.quote === "number" ? item.quote : null,
    });
    if (tokens.length >= TOKEN_LIMIT) break;
  }

  return tokens;
}

export async function GET(request, { params }) {
  const { address } = await params;
  if (!ADDRESS_PATTERN.test(address || "")) {
    return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
  }

  const search = new URL(request.url).searchParams;
  const network = search.get("network") || DEFAULT_NETWORK;
  if (!isNetwork(network)) {
    return NextResponse.json({ error: "Unsupported network." }, { status: 400 });
  }

  const chain = NETWORKS[network];
  const encodedAddress = encodeURIComponent(address);
  const basePath = `/v1/${chain.chainName}/address/${encodedAddress}`;
  const page = decodeCursor(search.get("cursor"));
  const transactionsPath =
    page === null
      ? `${basePath}/transactions_v3/?no-logs=true`
      : `${basePath}/transactions_v3/page/${page}/?no-logs=true`;

  try {
    const [balances, activity] = await Promise.all([
      // `no-spam=true` is a server-side filter; it cuts the payload from ~9 MB to
      // ~2.6 MB for busy wallets and backs up the spam checks in mapTokens.
      goldrush(`${basePath}/balances_v2/?no-spam=true`),
      goldrush(transactionsPath),
    ]);

    if (!balances && !activity) {
      return NextResponse.json(
        { error: "This address could not be found on the selected network." },
        { status: 404 },
      );
    }

    const balanceItems = balances?.items || [];
    const native = balanceItems.find((item) => item?.is_native_token) || null;
    const decimals = native?.contract_decimals ?? 18;
    const transactionItems = activity?.items || [];
    const olderPage = pageFromLink(activity?.links?.prev);

    return NextResponse.json({
      address,
      network,
      name: findName(transactionItems, address),
      balance: native ? formatUnits(native.balance, decimals) ?? "0" : "0",
      pendingCount: 0,
      transactions: transactionItems.map((tx) => mapTransaction(tx, address, decimals)),
      tokens: mapTokens(balanceItems),
      nextCursor: olderPage === null ? null : encodeCursor(olderPage),
    });
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 502;
    // Details stay in the server log; the client only ever sees a generic message.
    console.error("Wallet lookup failed:", status, error?.name || "UpstreamError");
    if (status === 500) {
      console.error("  → GOLDRUSH_API_KEY is not set in this server process.");
    } else if (status === 401 || status === 403) {
      const key = process.env.GOLDRUSH_API_KEY || "";
      console.error(
        `  → GoldRush rejected the API key (${keyFingerprint(key)}). Compare it with the key in .env.local; a shell variable set before the server started overrides that file, so restart the dev server from a fresh terminal.`,
      );
    }

    if (status === 404) {
      return NextResponse.json(
        { error: "This address could not be found on the selected network." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "Wallet data is temporarily unavailable. Please try again shortly." },
      { status: 502 },
    );
  }
}
