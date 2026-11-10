import "./globals.css";

export const metadata = {
  title: "Wallet Overview | Ethereum Explorer",
  description: "Explore a wallet's balance, transactions and tokens on Ethereum mainnet or Sepolia.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
