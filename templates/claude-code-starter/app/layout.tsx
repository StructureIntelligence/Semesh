export const metadata = {
  title: "Claude Code Starter",
  description: "A tiny Next.js app with Semesh login + managed database.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
