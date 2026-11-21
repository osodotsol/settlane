import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/ui/Providers";
import { plexMono, plexSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Settlane · Milestone settlement on Ethereum", template: "%s · Settlane" },
  description:
    "Settlane is a Fe smart contract on the Sepolia testnet that holds ETH per milestone and releases it by rules fixed in advance: approved work is claimed by the provider, expired work is refunded to the client.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f3ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
        >
          Skip to content
        </a>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
