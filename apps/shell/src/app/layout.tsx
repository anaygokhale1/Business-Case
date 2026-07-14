import type { Metadata } from "next";
import { Manrope, Inter } from "next/font/google";
import { ReactNode } from "react";

import "./globals.css";

// next/font downloads and self-hosts these at build time, so there is no
// runtime call to Google Fonts.
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-display"
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: "SSA Pro Module Template",
  description: "A runnable SSA Pro shell for building one module at a time."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${manrope.variable} ${inter.variable}`}>{children}</body>
    </html>
  );
}
