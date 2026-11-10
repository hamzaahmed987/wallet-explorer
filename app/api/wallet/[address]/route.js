import { NextResponse } from "next/server";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const MIN_CONFIRMED = 12;
const MAX_PAGES = 3;
const TOKEN_LIMIT = 12;
const CURSOR_KEYS = ["block_number", "index", "value", "hash", "inserted_at", "fee"];

// Both networks expose the same Blockscout v2 API, so one set of helpers serves
// either chain; only the base URL changes.
const NETWORKS = {
  mainnet: process.env.BLOCKSCOUT_MAINNET_API_URL || "https://eth.blockscout.com/api/v2",
  sepolia: process.env.BLOCKSCOUT_API_URL || "https://eth-sepolia.blockscout.com/api/v2",
};
const DEFAULT_NETWORK = "mainnet";

function resolveNetwork(request) {
  const requested = new URL(request.url).searchParams.get("network") || DEFAULT_NETWORK;
  return Object.prototype.hasOwnProperty.call(NETWORKS, requested) ? requested : DEFAULT_NETWORK;
}

async function getJson(url, { optional = false } = {}) {
  const response = await fetch(url, { next: { revalidate: 20 } });
  if (!response.ok) {
    if (response.status === 404 || optional) return null;
    throw new Error(`Blockchain data provider returned ${response.status}.`);
  }
  return response.json();
}

function encodeCursor(params) {
  return Buffer.from(JSON.stringify(params), "utf8").toString("base64url");
}

// Only the cursor fields Blockscout actually paginates on are accepted, so a
// crafted cursor cannot smuggle extra query parameters upstream.
function decodeCursor(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = CURSOR_KEYS.filter((key) => parsed[key] !== undefined && parsed[key] !== null).map(
      (key) => [key, String(parsed[key])],
    );
    return entries.length ? Object.fromEntries(entries) : null;
  } catch {
    return null;
  }
}

function mapTransaction(tx, address) {
  const from = tx.from?.hash || "";
  const to = tx.to?.hash || "";
  return {
    hash: tx.hash,
    from,
    to: to || "Contract creation",
    timestamp: tx.timestamp,
    value: Number(tx.value || 0) / 1e18,
    direction: from.toLowerCase() === address.toLowerCase() ? "Sent" : "Received",
    status: tx.status === "error" ? "failed" : "success",
  };
}

async function collectTransactions(base, encodedAddress, startCursor, address) {
  const transactions = [];
  let pendingCount = 0;
  let cursor = startCursor;
  let nextCursor = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = cursor ? `?${new URLSearchParams(cursor).toString()}` : "";
    const data = await getJson(`${base}/addresses/${encodedAddress}/transactions${query}`);
    if (!data) break;

    for (const tx of data.items || []) {
      // Unmined transactions have no timestamp or block yet, which would leave
      // the table full of blank rows, so they are counted and left out.
      if (tx.result === "pending") {
        pendingCount += 1;
        continue;
      }
      transactions.push(mapTransaction(tx, address));
    }

    nextCursor = data.next_page_params ? encodeCursor(data.next_page_params) : null;
    // Whole pages are consumed so paging forward never skips a transaction.
    if (!nextCursor || transactions.length >= MIN_CONFIRMED) break;

    cursor = decodeCursor(nextCursor);
    if (!cursor) {
      nextCursor = null;
      break;
    }
  }

  return { transactions, pendingCount, nextCursor };
}

function formatUnits(value, decimals) {
  try {
    const raw = BigInt(value || "0");
    const scale = 10n ** BigInt(decimals);
    const whole = raw / scale;
    const fraction = (raw % scale)
      .toString()
      .padStart(decimals, "0")
      .replace(/0+$/, "")
      .slice(0, 6);
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return "0";
  }
}

async function collectTokens(base, encodedAddress) {
  const data = await getJson(`${base}/addresses/${encodedAddress}/token-balances`, { optional: true });
  if (!Array.isArray(data)) return [];

  const seen = new Set();
  return data
    .filter((entry) => {
      const token = entry?.token;
      if (!token || token.type !== "ERC-20" || token.decimals == null) return false;
      if (token.reputation === "spam" || token.reputation === "scam") return false;
      try {
        return BigInt(entry.value || "0") > 0n;
      } catch {
        return false;
      }
    })
    .map((entry) => ({
      address: entry.token.address_hash || "",
      name: entry.token.name || "Unknown token",
      symbol: entry.token.symbol || "???",
      amount: formatUnits(entry.value, Number(entry.token.decimals)),
      holders: Number(entry.token.holders_count || 0),
    }))
    .filter((token) => {
      if (!token.address || seen.has(token.address)) return false;
      seen.add(token.address);
      return true;
    })
    .slice(0, TOKEN_LIMIT);
}

export async function GET(request, { params }) {
  const { address } = await params;
  if (!ADDRESS_PATTERN.test(address || "")) {
    return NextResponse.json({ error: "Invalid Ethereum address." }, { status: 400 });
  }

  const network = resolveNetwork(request);
  const base = NETWORKS[network];
  const encodedAddress = encodeURIComponent(address);
  const cursor = decodeCursor(new URL(request.url).searchParams.get("cursor"));

  try {
    const [account, tokens, activity] = await Promise.all([
      getJson(`${base}/addresses/${encodedAddress}`),
      collectTokens(base, encodedAddress),
      collectTransactions(base, encodedAddress, cursor, address),
    ]);

    if (!account) return NextResponse.json({ error: "This address could not be found." }, { status: 404 });

    return NextResponse.json({
      address,
      network,
      balance: Number(account.coin_balance || 0) / 1e18,
      pendingCount: activity.pendingCount,
      transactions: activity.transactions,
      tokens,
      nextCursor: activity.nextCursor,
    });
  } catch (error) {
    console.error("Wallet lookup failed:", error);
    return NextResponse.json({ error: "Wallet data is temporarily unavailable. Please try again shortly." }, { status: 502 });
  }
}
