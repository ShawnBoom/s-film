import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { PwaRegister } from "./pwa-register";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const socialImage = `${origin}/og.png`;

  return {
    title: "See｜手机胶片滤镜",
    description: "不登录、不上传，在手机本地为照片添加胶片质感。",
    applicationName: "See",
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [
        { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
        { url: "/icons/apple-touch-icon-167.png", sizes: "167x167", type: "image/png" },
        { url: "/icons/apple-touch-icon-152.png", sizes: "152x152", type: "image/png" },
        { url: "/icons/apple-touch-icon-120.png", sizes: "120x120", type: "image/png" },
      ],
    },
    appleWebApp: {
      capable: true,
      title: "See",
      statusBarStyle: "black-translucent",
    },
    openGraph: {
      title: "See｜手机胶片滤镜",
      description: "不登录、不上传，在手机本地为照片添加胶片质感。",
      images: [{ url: socialImage, width: 1731, height: 909, alt: "See" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "See｜手机胶片滤镜",
      description: "不登录、不上传，在手机本地为照片添加胶片质感。",
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f2eb" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1c1a" },
  ],
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
