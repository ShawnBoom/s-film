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
      images: [{ url: socialImage, width: 1731, height: 909, alt: "S Film" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "S Film｜手机胶片滤镜",
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
