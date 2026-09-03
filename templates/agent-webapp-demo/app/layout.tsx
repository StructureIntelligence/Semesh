export const metadata = {
  title: "Snippet Vault — built & shipped by an agent on Semesh",
  description:
    "A tiny full-stack demo: Semesh login, a managed database, and one quoted canonical Model Unit Action.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
          background: "#0b0d12",
          color: "#e7e9ee",
        }}
      >
        {children}
      </body>
    </html>
  );
}
