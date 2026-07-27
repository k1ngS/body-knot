import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { publicAsset } from "@/lib/publicAsset";
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
  title: "BODY//KNOT",
  description:
    "A short browser horror game about knotting a living chain inside a host that learns your cursor.",
  icons: {
    icon: publicAsset("favicon.ico"),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
