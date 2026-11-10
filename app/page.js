"use client";

import { useState } from "react";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

const NETWORKS = {
  mainnet: { label: "Ethereum", detail: "Ethereum mainnet", explorer: "https://eth.blockscout.com" },
  sepolia: { label: "Sepolia", detail: "Sepolia testnet", explorer: "https://eth-sepolia.blockscout.com" },
};

const explorerFor = (network) => (NETWORKS[network] || NETWORKS.mainnet).explorer;

function shortAddress(value = "") {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value || "—";
}

function formatAmount(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "0";
  return amount.toLocaleString(undefined, { maximumFractionDigits: 5 });
}

function formatTokenAmount(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "0";
  // Airdropped tokens often carry absurd supplies, so long values are shortened.
  if (Math.abs(amount) >= 1e9) {
    return amount.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 });
  }
  return amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function formatDate(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
  const [network, setNetwork] = useState("mainnet");
  const [wallet, setWallet] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // Cursor of every page visited so far; the first page has no cursor.
  const [cursorStack, setCursorStack] = useState([]);

  async function loadPage(walletAddress, cursor, stack, chain = network) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ network: chain });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/wallet/${walletAddress}?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load this wallet.");
      setWallet(data);
      setCursorStack(stack);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function searchWallet(event) {
    event.preventDefault();
    const cleanAddress = address.trim();
    if (!addressPattern.test(cleanAddress)) {
      setError("That doesn't look like an Ethereum address. It should start with 0x and be 42 characters long.");
      setWallet(null);
      return;
    }

    setWallet(null);
    setCursorStack([]);
    await loadPage(cleanAddress, null, [null]);
  }

  function goNextPage() {
    if (!wallet?.nextCursor || loading) return;
    loadPage(wallet.address, wallet.nextCursor, [...cursorStack, wallet.nextCursor]);
  }

  function goPreviousPage() {
    if (cursorStack.length <= 1 || loading) return;
    const stack = cursorStack.slice(0, -1);
    loadPage(wallet.address, stack[stack.length - 1], stack);
  }

  // Switching chains re-reads the wallet that is already on screen, so the
  // same address can be compared across networks without retyping it.
  function changeNetwork(next) {
    if (next === network || loading) return;
    setNetwork(next);
    if (wallet) {
      setCursorStack([]);
      loadPage(wallet.address, null, [null], next);
    }
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

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Wallet Overview home">
          <span className="brand-mark">W</span>
          Wallet Overview
        </a>
        <div className="seg" role="group" aria-label="Network">
          {Object.entries(NETWORKS).map(([id, chain]) => (
            <button
              key={id}
              type="button"
              aria-pressed={network === id}
              onClick={() => changeNetwork(id)}
              disabled={loading}
            >
              {chain.label}
            </button>
          ))}
        </div>
      </header>

      <section className="hero">
        <p className="kicker">Ethereum account explorer</p>
        <h1>Look up any wallet.</h1>
        <p className="lede">Paste a public Ethereum address to see its balance, recent transactions and token holdings. Switch between mainnet and Sepolia in the top right.</p>

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

        {error && <div className="alert" role="alert">{error}</div>}

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
              </div>
              <a className="ghost" href={`${explorerFor(wallet.network)}/address/${wallet.address}`} target="_blank" rel="noreferrer">
                Blockscout <ExternalIcon />
              </a>
            </div>

            <div className="stats">
              <div className="stat stat--accent">
                <div className="stat-label">Balance</div>
                <div className="stat-value">{formatAmount(wallet.balance)}<span className="stat-unit">ETH</span></div>
                <div className="stat-foot">{(NETWORKS[wallet.network] || NETWORKS.mainnet).detail}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Transactions</div>
                <div className="stat-value">{wallet.transactions.length}</div>
                <div className="stat-foot">{wallet.pendingCount > 0 ? `${wallet.pendingCount} pending` : "All confirmed"}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Tokens</div>
                <div className="stat-value">{wallet.tokens.length}</div>
                <div className="stat-foot">ERC-20 holdings</div>
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
                  <strong>No confirmed transactions</strong>
                  <p>This address has no indexed activity on {(NETWORKS[wallet.network] || NETWORKS.mainnet).detail}.</p>
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
                          <td><a className="link" href={`${explorerFor(wallet.network)}/tx/${tx.hash}`} target="_blank" rel="noreferrer">{shortAddress(tx.hash)}</a></td>
                          <td><span className="tag">{tx.direction}</span></td>
                          <td className="mono dim">{shortAddress(tx.from)} → {shortAddress(tx.to)}</td>
                          <td className="mono">{formatAmount(tx.value)} ETH</td>
                          <td className="dim">{formatDate(tx.timestamp)}</td>
                          <td><span className={`pill pill--${tx.status === "success" ? "ok" : tx.status === "pending" ? "pending" : "failed"}`}><i />{tx.status}</span></td>
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
                <span className="section-meta">ERC-20</span>
              </div>

              {wallet.tokens.length === 0 ? (
                <div className="empty">
                  <strong>No token balances</strong>
                  <p>This address holds no indexed ERC-20 tokens on {(NETWORKS[wallet.network] || NETWORKS.mainnet).detail}.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Token</th><th>Contract</th><th>Balance</th><th>Holders</th></tr>
                    </thead>
                    <tbody>
                      {wallet.tokens.map((token) => (
                        <tr key={token.address}>
                          <td>
                            <span className="token-symbol">{token.symbol}</span>
                            <span className="token-name">{token.name}</span>
                          </td>
                          <td><a className="link" href={`${explorerFor(wallet.network)}/token/${token.address}`} target="_blank" rel="noreferrer">{shortAddress(token.address)}</a></td>
                          <td className="mono">{formatTokenAmount(token.amount)}</td>
                          <td className="dim">{token.holders.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="footnote">Confirmed transactions only. Token balances as reported by Blockscout.</p>
          </section>
        )}
      </section>

      <footer>
        <span>Wallet Overview</span>
        <span>Public data from Blockscout · {NETWORKS[network].label}</span>
      </footer>
    </main>
  );
}
