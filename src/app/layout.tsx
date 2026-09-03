import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "E&C Fleet Fuel Portal",
  description: "Edward & Christie construction fleet fuel management and utilization auditing portal.",
};

// WHY suppressHydrationWarning IS ON <html> AND <body>, AND NOWHERE ELSE.
//
// Browser extensions edit these two elements before React hydrates. Grammarly
// adds data-gr-ext-installed and data-new-gr-c-s-check-loaded to <body>,
// ColorZilla adds cz-shortcut-listen="true", dark-mode and translation
// extensions add classes to <html>. React then reports "A tree hydrated but
// some attributes of the server rendered HTML didn't match the client
// properties" on every page, which buries any real mismatch underneath a
// warning nobody can act on — the offending code is not ours and not on the
// machine that runs the build.
//
// The flag is deliberately narrow. React applies it ONE LEVEL DEEP: it excuses
// a mismatch on the element's own attributes and text, and does nothing for any
// descendant. So a genuine hydration bug anywhere inside the app still reports
// normally. What it gives up is noticing a mismatch on <body className> itself,
// which is a static string here.
//
// It is NOT a fix for a mismatch of our own making. If this warning appears
// with a component stack pointing into src/, the answer is to fix that
// component — a date or random value computed during render, a
// typeof window branch, or invalid tag nesting — never to widen this.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
