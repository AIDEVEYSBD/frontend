import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Chrome } from "@/components/chrome";
import { InlineScript } from "@/components/inline-script";
import { themeScript } from "@/components/theme";

const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Factory",
  description: "Design, deploy and oversee governed AI-enabled workflows for cyber and risk operations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plex.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        <InlineScript html={themeScript} />
        <InlineScript html={`try{var a=localStorage.getItem("af.ui.accent");if(a)document.documentElement.dataset.accent=a;}catch(e){}`} />
      </head>
      <body className="min-h-full font-sans">
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
