import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="bg-background text-foreground min-h-screen">
        <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between gap-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Food Everything
            </Link>
            <Link
              href="/add"
              className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium hover:opacity-90"
            >
              + Add
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
