import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SpikeLab - AI Volleyball Spike Analysis",
  description: "Upload a video of your volleyball spike. AI analyzes 15 biomechanical checkpoints, identifies your biggest power leaks, and builds a personalized 4-week training plan.",
  keywords: ["volleyball", "spike analysis", "biomechanics", "AI coaching", "training plan", "sports science"],
  authors: [{ name: "SpikeLab" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "SpikeLab - AI Volleyball Spike Analysis",
    description: "Upload your spike video. Get AI-powered biomechanical analysis and a personalized training plan.",
    siteName: "SpikeLab",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SpikeLab - AI Volleyball Spike Analysis",
    description: "AI-powered volleyball spike analysis and personalized training plans.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
