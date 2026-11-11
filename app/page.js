"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_NETWORK, NETWORKS, isNetwork } from "../lib/networks";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

const chainOf = (network) => NETWORKS[network] || NETWORKS[DEFAULT_NETWORK];

function shortAddress(value = "") {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value || "—";
}

// Amounts arrive as decimal strings built with BigInt on the server, so they are
// only ever manipulated as text here — no Number() on raw balances.
function formatAmount(value) {
  const text = String(value ?? "0");
  if (!/^\d+(\.\d+)?$/.test(text)) return "0";
  const [whole, fraction = ""] = text.split(".");
  const prettyWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = fraction.replace(/0+$/, "").slice(0, 5);
  return trimmed ? `${prettyWhole}.${trimmed}` : prettyWhole;
}

function formatQuote(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value > 0 && value < 0.01) return "< $0.01";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function syncUrl(address, network) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (address) params.set("address", address);
  else params.delete("address");
  params.set("network", network);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M14 5h5v5M19 5l-8 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" strokeLinecap="round" />
    </svg>
  );
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState(DEFAULT_NETWORK);
  const [wallet, setWallet] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // Cursor of every page visited so far; the first page has no cursor.
  const [cursorStack, setCursorStack] = useState([]);
  // Last request, so the retry button can replay exactly the failed lookup.
  const lastRequest = useRef(null);

  const loadPage = useCallback(async (walletAddress, cursor, stack, chain) => {
    lastRequest.current = { walletAddress, cursor, stack, chain };
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ network: chain });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/wallet/${walletAddress}?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load this wallet.");
      setWallet(data);
      setCursorStack(stack);
      syncUrl(walletAddress, chain);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Restore the lookup from the URL once, on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlNetwork = params.get("network");
    const chain = isNetwork(urlNetwork) ? urlNetwork : DEFAULT_NETWORK;
    const urlAddress = (params.get("address") || "").trim();
    setNetwork(chain);
    if (addressPattern.test(urlAddress)) {
      setAddress(urlAddress);
      loadPage(urlAddress, null, [null], chain);
    } else {
      syncUrl("", chain);
    }
  }, [loadPage]);

  function searchWallet(event) {
    event.preventDefault();
    const cleanAddress = address.trim();
    if (!addressPattern.test(cleanAddress)) {
      lastRequest.current = null;
      setError("That doesn't look like an EVM address. It should start with 0x and be 42 characters long.");
      setWallet(null);
      return;
    }

    setWallet(null);
    setCursorStack([]);
    syncUrl(cleanAddress, network);
    loadPage(cleanAddress, null, [null], network);
  }

  function goNextPage() {
    if (!wallet?.nextCursor || loading) return;
    loadPage(wallet.address, wallet.nextCursor, [...cursorStack, wallet.nextCursor], wallet.network);
  }

  function goPreviousPage() {
    if (cursorStack.length <= 1 || loading) return;
    const stack = cursorStack.slice(0, -1);
    loadPage(wallet.address, stack[stack.length - 1], stack, wallet.network);
  }

  // Switching chains re-reads the wallet that is already on screen, so the
  // same address can be compared across chains without retyping it.
  function changeNetwork(next) {
    if (!isNetwork(next) || next === network) return;
    setNetwork(next);
    setWallet(null);
    setCursorStack([]);
    setError("");
    const typed = address.trim();
    syncUrl(addressPattern.test(typed) ? typed : "", next);
    if (wallet && !loading) {
      loadPage(wallet.address, null, [null], next);
    }
  }

  function retry() {
    const request = lastRequest.current;
    if (!request || loading) return;
    loadPage(request.walletAddress, request.cursor, request.stack, request.chain);
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const activeChain = chainOf(network);

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Wallet Overview home">
          <span className="brand-mark">W</span>
          Wallet Overview
        </Link>
        <label className="net">
          <span className="net-label">Network</span>
          <select
            value={network}
            onChange={(event) => changeNetwork(event.target.value)}
            aria-label="Network"
            disabled={loading}
          >
            {Object.values(NETWORKS).map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="hero">
        <p className="kicker">Multichain account explorer</p>
        <h1>Look up any wallet.</h1>
        <p className="lede">
          Paste a public EVM address to see its balance, recent transactions and token holdings. Pick
          a chain in the top right — Ethereum, Base, Polygon, Arbitrum or Optimism.
        </p>

        <form className="search" onSubmit={searchWallet} role="search">
          <div className="input">
            <SearchIcon />
            <input
              type="text"
              aria-label="Wallet address"
              autoComplete="off"
              spellCheck="false"
              placeholder="Paste a wallet address, 0x…"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
            {address && (
              <button type="button" className="clear" aria-label="Clear address" onClick={() => setAddress("")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          <button type="submit" className="submit" disabled={loading}>{loading ? "Searching…" : "Explore"}</button>
        </form>
        <p className="hint">Public data only — never paste a private key or recovery phrase.</p>

        {error && (
          <div className="alert" role="alert">
            <span>{error}</span>
            {lastRequest.current && (
              <button type="button" className="retry" onClick={retry} disabled={loading}>
                Try again
              </button>
            )}
          </div>
        )}

        {loading && (
          <div className="skeleton" aria-hidden="true">
            <div className="sk-row" />
            <div className="sk-row" />
            <div className="sk-row" />
          </div>
        )}

        {!wallet && !loading && !error && (
          <div className="empty first-run">
            <strong>Nothing loaded yet</strong>
            <p>Pick a network, then paste the address of any wallet or contract.</p>
          </div>
        )}

        {wallet && !loading && (
          <section className="results" aria-live="polite">
            <div className="result-head">
              <div>
                <h2>Account overview</h2>
                <div className="address-row">
                  <span className="address" title={wallet.address}>{wallet.address}</span>
                  <button type="button" className="ghost" onClick={copyAddress}>{copied ? "Copied ✓" : "Copy"}</button>
                </div>
                <p className={`wallet-name${wallet.name ? "" : " dim"}`}>Name: {wallet.name || "not available"}</p>
              </div>
              <a
                className="ghost"
                href={`${chainOf(wallet.network).explorerUrl}/address/${wallet.address}`}
                target="_blank"
                rel="noreferrer"
              >
                Blockscout <ExternalIcon />
              </a>
            </div>

            <div className="stats">
              <div className="stat stat--accent">
                <div className="stat-label">Balance</div>
                <div className="stat-value">
                  {formatAmount(wallet.balance)}
                  <span className="stat-unit">{chainOf(wallet.network).symbol}</span>
                </div>
                <div className="stat-foot">{chainOf(wallet.network).label}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Transactions</div>
                <div className="stat-value">{wallet.transactions.length}</div>
                <div className="stat-foot">{wallet.pendingCount > 0 ? `${wallet.pendingCount} pending` : "All confirmed"}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Tokens</div>
                <div className="stat-value">{wallet.tokens.length}</div>
                <div className="stat-foot">Priced holdings</div>
              </div>
            </div>

            <div className="section">
              <div className="section-head">
                <h3 className="section-title">Transactions <span className="count">{wallet.transactions.length}</span></h3>
                <span className="section-meta">Newest first</span>
              </div>

              {wallet.pendingCount > 0 && (
                <div className="note">
                  <span className="pill pill--pending"><i />{wallet.pendingCount} pending</span>
                  <span>Waiting for a block — they’ll show up here once confirmed.</span>
                </div>
              )}

              {wallet.transactions.length === 0 ? (
                <div className="empty">
                  <strong>No transactions</strong>
                  <p>This address has no indexed activity on {chainOf(wallet.network).label}.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Transaction</th><th>Type</th><th>From / To</th><th>Value</th><th>Date</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {wallet.transactions.map((tx) => (
                        <tr key={tx.hash}>
                          <td>
                            <a
                              className="link"
                              href={`${chainOf(wallet.network).explorerUrl}/tx/${tx.hash}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {shortAddress(tx.hash)}
                            </a>
                          </td>
                          <td><span className="tag">{tx.direction}</span></td>
                          <td className="mono dim">{shortAddress(tx.from)} → {shortAddress(tx.to)}</td>
                          <td className="mono">{formatAmount(tx.value)} {chainOf(wallet.network).symbol}</td>
                          <td className="dim">{formatDate(tx.timestamp)}</td>
                          <td>
                            <span className={`pill pill--${tx.status === "success" ? "ok" : tx.status === "pending" ? "pending" : "failed"}`}>
                              <i />{tx.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="pager">
                <button type="button" onClick={goPreviousPage} disabled={cursorStack.length <= 1 || loading}>← Newer</button>
                <span className="pager-label">Page {Math.max(cursorStack.length, 1)}</span>
                <button type="button" onClick={goNextPage} disabled={!wallet.nextCursor || loading}>Older →</button>
              </div>
            </div>

            <div className="section">
              <div className="section-head">
                <h3 className="section-title">Tokens <span className="count">{wallet.tokens.length}</span></h3>
                <span className="section-meta">Spam and unpriced tokens hidden</span>
              </div>

              {wallet.tokens.length === 0 ? (
                <div className="empty">
                  <strong>No token balances</strong>
                  <p>This address holds no priced tokens on {chainOf(wallet.network).label}.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Token</th><th>Contract</th><th>Balance</th><th>Value</th></tr>
                    </thead>
                    <tbody>
                      {wallet.tokens.map((token) => (
                        <tr key={token.address}>
                          <td>
                            <span className="token-symbol">{token.symbol}</span>
                            <span className="token-name">{token.name}</span>
                          </td>
                          <td>
                            <a
                              className="link"
                              href={`${chainOf(wallet.network).explorerUrl}/token/${token.address}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {shortAddress(token.address)}
                            </a>
                          </td>
                          <td className="mono">{formatAmount(token.amount)}</td>
                          <td className="dim">{formatQuote(token.quote)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="footnote">
              Confirmed transactions only. Token balances and prices as reported by GoldRush. Up to 12
              priced tokens are shown.
            </p>
          </section>
        )}
      </section>

      <footer>
        <span>Wallet Overview</span>
        <span>Public data from GoldRush · {activeChain.label}</span>
      </footer>
    </main>
  );
}
