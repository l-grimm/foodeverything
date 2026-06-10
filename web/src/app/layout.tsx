import type { Metadata, Viewport } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import { Bowlby_One, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { SearchBar } from "./_search/search-bar";
import { HeaderAddButton } from "./_header/add-button";
import "./globals.css";

// General Sans (Indian Type Foundry, free for web via Fontshare license).
// Vendored in public/fonts/general-sans/. Acts as the body + UI face.
const generalSans = localFont({
  src: [
    { path: "../../public/fonts/general-sans/GeneralSans-Light.otf",   weight: "300", style: "normal" },
    { path: "../../public/fonts/general-sans/GeneralSans-Regular.otf", weight: "400", style: "normal" },
    { path: "../../public/fonts/general-sans/GeneralSans-Medium.otf",  weight: "500", style: "normal" },
    { path: "../../public/fonts/general-sans/GeneralSans-Bold.otf",    weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

// Bowlby One: fat geo-sans, Google Fonts. Stands in for the bespoke ROUX
// wordmark face — same circular + angular feel without licensing the original.
const bowlbyOne = Bowlby_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Food Everything",
  description: "Your recipe collection",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${generalSans.variable} ${bowlbyOne.variable} ${geistMono.variable} antialiased`}
    >
      <body className="bg-background text-foreground min-h-screen font-sans">
        {/* Solid bg (no transparency / backdrop-blur) so the sticky region
            doesn't visually wobble during iOS rubber-band scroll. */}
        <header className="sticky top-0 z-40 border-b border-border bg-background">
          <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between gap-3">
            <Link
              href="/"
              className="font-display tracking-tight text-foreground"
            >
              <span className="text-xl sm:text-2xl leading-none uppercase">
                Food Everything
              </span>
            </Link>
            <HeaderAddButton />
          </div>
          <div className="mx-auto max-w-5xl px-4 pb-3">
            <Suspense fallback={null}>
              <SearchBar />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
