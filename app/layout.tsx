import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./workbench.css";
import "./settings-workbench.css";

const publicSiteUrl = process.env.NEXT_PUBLIC_MANJING_SITE_URL?.trim() || "https://kakayiduo.cloud";

export const metadata: Metadata = {
  metadataBase: new URL(publicSiteUrl),
  title: "漫镜 Manjing｜AI 导演工作台",
  description: "将漫画整理成分镜与视频提示词，经独立审核和人工确认后生成 AI 视频的导演工具。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "漫镜" },
  openGraph: {
    title: "漫镜 Manjing｜AI 导演工作台",
    description: "漫画入库、分镜编组、提示词创作、独立审核与 AI 视频生成。",
    images: [{ url: "/social-preview.png", width: 1536, height: 1024, alt: "分镜逐关审核与锁定工作台" }],
  },
  twitter: { card: "summary_large_image", images: ["/social-preview.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#175cff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
