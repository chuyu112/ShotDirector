import type { Metadata, Viewport } from "next";
import "./globals.css";

const publicSiteUrl = process.env.NEXT_PUBLIC_MANJING_SITE_URL?.trim() || "https://manjing.jadecircle.cn";

export const metadata: Metadata = {
  metadataBase: new URL(publicSiteUrl),
  title: "漫镜 Manjing｜AI 导演工作台",
  description: "一次只审核、出图并锁定一个分镜，避免批量生成时遗漏剧情、站位与连续性细节。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "漫镜" },
  openGraph: {
    title: "漫镜 Manjing｜AI 导演工作台",
    description: "单镜、单关卡、单次确认；锁定一镜，再进入下一镜。",
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
