import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { InvestigationProvider } from "@/components/investigation/investigation-provider";
import { AiLens } from "@/components/operator/ai-lens";
import { AiContextProvider } from "@/components/operator/context";
import { ToastProvider } from "@/components/ui/toast";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
  variable: "--font-mono-family",
});

export const metadata: Metadata = {
  title: {
    default: "AI Marketplace",
    template: "%s · AI Marketplace",
  },
  description:
    "Find trusted AI tools and templates across RealPage, and check they are ready to use.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <ToastProvider>
          <InvestigationProvider>
            <AiContextProvider>
              {children}
              <AiLens />
            </AiContextProvider>
          </InvestigationProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
