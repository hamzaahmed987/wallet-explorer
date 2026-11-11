import "./globals.css";

export const metadata = {
  title: "Wallet Overview | Multichain EVM Explorer",
  description: "Explore a wallet's balance, transactions and tokens on Ethereum, Base, Polygon, Arbitrum and Optimism.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
