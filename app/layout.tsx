import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "镜导 ShotDirector｜AI 导演工作台",
  description: "一次只审核、出图并锁定一个分镜，避免批量生成时遗漏剧情、站位与连续性细节。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "镜导 ShotDirector｜AI 导演工作台",
    description: "单镜、单关卡、单次确认；锁定一镜，再进入下一镜。",
    images: [{ url: "/social-preview.png", width: 1536, height: 1024, alt: "分镜逐关审核与锁定工作台" }],
  },
  twitter: { card: "summary_large_image", images: ["/social-preview.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
