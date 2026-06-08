import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Semantic Maze",
  description: "A Language and Mind creative project about the mental lexicon, semantic networks, and AI semantic space"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
