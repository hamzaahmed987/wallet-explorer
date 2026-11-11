// Central registry of supported chains. The server and client both import this,
// so adding a chain later is a single new entry here — no other code changes.
//
// Chain names are the GoldRush/Covalent chain slugs, verified against the live
// API. Sepolia is intentionally absent: `eth-sepolia` is not available on the
// free plan (the API answers 404 "Chain eth-sepolia not supported").
export const NETWORKS = {
  ethereum: {
    id: "ethereum",
    label: "Ethereum",
    chainName: "eth-mainnet",
    symbol: "ETH",
    explorerUrl: "https://eth.blockscout.com",
  },
  base: {
    id: "base",
    label: "Base",
    chainName: "base-mainnet",
    symbol: "ETH",
    explorerUrl: "https://base.blockscout.com",
  },
  polygon: {
    id: "polygon",
    label: "Polygon",
    chainName: "matic-mainnet",
    symbol: "POL",
    explorerUrl: "https://polygon.blockscout.com",
  },
  arbitrum: {
    id: "arbitrum",
    label: "Arbitrum",
    chainName: "arbitrum-mainnet",
    symbol: "ETH",
    explorerUrl: "https://arbitrum.blockscout.com",
  },
  optimism: {
    id: "optimism",
    label: "Optimism",
    chainName: "optimism-mainnet",
    symbol: "ETH",
    explorerUrl: "https://optimism.blockscout.com",
  },
};

export const DEFAULT_NETWORK = "ethereum";

export function isNetwork(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(NETWORKS, id);
}
