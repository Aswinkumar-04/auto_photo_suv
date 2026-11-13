import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SUV Photo Gallery',
  description: 'Find your event photos instantly with face recognition',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
