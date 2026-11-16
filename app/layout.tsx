import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Chrome } from "@/components/chrome";
import { InlineScript } from "@/components/inline-script";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Factory",
  description: "The console for security workloads carried out by agents: approvals by named roles, limits enforced outside the model, and a record of every decision.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}
      data-accent="off"
      data-theme="light"
    >
      <head>
        <InlineScript html={`try{var a=localStorage.getItem("af.ui.accent");if(a)document.documentElement.dataset.accent=a;}catch(e){}`} />
      </head>
      <body className="min-h-full font-sans">
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
