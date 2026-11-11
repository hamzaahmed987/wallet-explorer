import test from "node:test";
import assert from "node:assert/strict";

// The route reads the key from the environment at request time; tests never call
// the real API because `fetch` is replaced below.
process.env.GOLDRUSH_API_KEY = "test-key";

const { GET } = await import("../app/api/wallet/[address]/route.js");

const ADDRESS = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const NATIVE = {
  contract_decimals: 18,
  contract_name: "Ether",
  contract_ticker_symbol: "ETH",
  contract_address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  balance: "123456789012345678901234567890",
  quote: 100.5,
  quote_rate: 2062.05,
  is_spam: false,
  type: "cryptocurrency",
  is_native_token: true,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch({ balances = { items: [NATIVE] }, activity = { items: [] }, fail = null } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (fail) return jsonResponse({ error: true, error_message: "upstream exploded" }, fail);
    if (String(url).includes("/balances_v2/")) return jsonResponse({ data: balances });
    if (String(url).includes("/transactions_v3")) return jsonResponse({ data: activity });
    return jsonResponse({ error: true, error_message: "unexpected path" }, 500);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function callRoute({ address = ADDRESS, network, cursor } = {}) {
  const params = new URLSearchParams();
  if (network !== undefined) params.set("network", network);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  const request = new Request(`http://localhost/api/wallet/${address}${query ? `?${query}` : ""}`);
  const response = await GET(request, { params: Promise.resolve({ address }) });
  return { status: response.status, body: await response.json() };
}

test("invalid address returns 400 without calling the upstream API", async (t) => {
  const mock = installFetch();
  t.after(mock.restore);

  const { status, body } = await callRoute({ address: "0x1234" });

  assert.equal(status, 400);
  assert.equal(mock.calls.length, 0);
  assert.ok(body.error);
});

test("unknown network returns 400 without calling the upstream API", async (t) => {
  const mock = installFetch();
  t.after(mock.restore);

  const { status } = await callRoute({ network: "solana" });

  assert.equal(status, 400);
  assert.equal(mock.calls.length, 0);
});

test("upstream failure returns 502 with a generic message", async (t) => {
  const mock = installFetch({ fail: 500 });
  t.after(mock.restore);

  const { status, body } = await callRoute({ network: "base" });

  assert.equal(status, 502);
  assert.doesNotMatch(body.error, /upstream exploded|GoldRush request failed/);
});

test("scales huge raw balances with BigInt and returns strings", async (t) => {
  const mock = installFetch({
    activity: {
      items: [
        {
          tx_hash: "0xabc",
          block_signed_at: "2026-11-01T00:00:00Z",
          successful: true,
          from_address: ADDRESS,
          to_address: "0x0000000000000000000000000000000000000001",
          value: "1000000000000000000",
        },
      ],
      links: { next: null, prev: null },
    },
  });
  t.after(mock.restore);

  const { status, body } = await callRoute({ network: "ethereum" });

  assert.equal(status, 200);
  assert.equal(body.balance, "123456789012.345678");
  assert.equal(body.transactions[0].value, "1");
  assert.equal(body.transactions[0].status, "success");
  assert.equal(body.transactions[0].direction, "Sent");
  assert.equal(body.pendingCount, 0);
  assert.equal(body.nextCursor, null);
  assert.match(mock.calls[0].url, /eth-mainnet/);
  assert.equal(mock.calls[0].init.headers.Authorization, "Bearer test-key");
  assert.doesNotMatch(JSON.stringify(body), /test-key/);
});

test("filters spam, dust, zero-balance and unpriced tokens and caps at 12", async (t) => {
  const token = (index, overrides = {}) => ({
    contract_decimals: 18,
    contract_name: `Token ${index}`,
    contract_ticker_symbol: `T${index}`,
    contract_address: `0x${String(index).padStart(40, "0")}`,
    balance: (10n ** 18n).toString(),
    quote: 1,
    quote_rate: 1,
    is_spam: false,
    type: "cryptocurrency",
    is_native_token: false,
    ...overrides,
  });

  const items = [
    NATIVE,
    token(101, { is_spam: true }),
    token(102, { type: "dust" }),
    token(103, { balance: "0" }),
    token(104, { quote_rate: null }),
    token(105, { balance: "123456789012345678901234567890123456789" }),
    token(106, { contract_name: null, contract_ticker_symbol: null }),
    ...Array.from({ length: 12 }, (_, index) => token(200 + index)),
  ];

  const mock = installFetch({ balances: { items } });
  t.after(mock.restore);

  const { status, body } = await callRoute();

  assert.equal(status, 200);
  assert.equal(body.tokens.length, 12);
  const addresses = body.tokens.map((entry) => entry.address);
  assert.ok(!addresses.includes(token(101).contract_address));
  assert.ok(!addresses.includes(token(102).contract_address));
  assert.ok(!addresses.includes(token(103).contract_address));
  assert.ok(!addresses.includes(token(104).contract_address));
  assert.equal(body.tokens[0].amount, "123456789012345678901.234567");
  assert.equal(body.tokens[1].name, "Unknown token");
  assert.equal(body.tokens[1].symbol, "???");
  assert.equal(body.tokens[2].amount, "1");
});

test("uses the provider label for the wallet name only when present", async (t) => {
  const mock = installFetch({
    activity: {
      items: [
        {
          tx_hash: "0xabc",
          block_signed_at: "2026-11-01T00:00:00Z",
          successful: false,
          from_address: "0x0000000000000000000000000000000000000002",
          to_address: ADDRESS,
          to_address_label: "Exchange hot wallet",
          value: "0",
        },
      ],
      links: { next: null, prev: null },
    },
  });
  t.after(mock.restore);

  const { body } = await callRoute();

  assert.equal(body.name, "Exchange hot wallet");
  assert.equal(body.transactions[0].status, "failed");
  assert.equal(body.transactions[0].direction, "Received");
});

test("older pages are read from the previous page link via an opaque cursor", async (t) => {
  const mock = installFetch({
    activity: {
      items: [],
      links: { next: null, prev: `https://api.covalenthq.com/v1/eth-mainnet/address/${ADDRESS}/transactions_v3/page/2709/` },
    },
  });
  t.after(mock.restore);

  const first = await callRoute();
  assert.ok(first.body.nextCursor);

  mock.calls.length = 0;
  const second = await callRoute({ cursor: first.body.nextCursor });

  assert.equal(second.status, 200);
  assert.ok(mock.calls.some((call) => call.url.includes("/transactions_v3/page/2709/")));
});
