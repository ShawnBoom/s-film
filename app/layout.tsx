import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "./pwa-register";

export const metadata: Metadata = {
  title: "S Film｜手机胶片滤镜",
  description: "不登录、不上传，在手机本地为照片添加胶片质感。",
  applicationName: "S Film",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "S Film",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "S Film｜手机胶片滤镜",
    description: "不登录、不上传，在手机本地为照片添加胶片质感。",
    images: [{ url: "/s-film-social.png", width: 1733, height: 909, alt: "S Film 胶片摄影" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f2efe7",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
