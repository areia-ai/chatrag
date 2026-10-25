import { Metadata, Viewport } from "next";
import { getSiteTitle, getFaviconUrl } from "@/lib/env";
import ClientLayout from "./client-layout";

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

// Generate metadata dynamically to ensure environment variables are loaded
export async function generateMetadata(): Promise<Metadata> {
  const title = getSiteTitle();
  const faviconUrl = getFaviconUrl();

  // Debug logging
  console.log('Generating metadata - Title:', title, 'Favicon:', faviconUrl);

  return {
    title,
    description: "The easiest and quickest way to deploy your own RAG chatbot",
    icons: {
      icon: faviconUrl,
      shortcut: faviconUrl,
      apple: faviconUrl,
    },
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClientLayout>{children}</ClientLayout>;
}