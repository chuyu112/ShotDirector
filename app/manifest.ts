import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "漫镜 Manjing · AI 导演工作台",
    short_name: "漫镜",
    description: "在桌面和手机上审核漫画拆镜、脚本、分镜与生成提示词。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4f1e9",
    theme_color: "#175cff",
    lang: "zh-CN",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
