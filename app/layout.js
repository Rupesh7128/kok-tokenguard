import "./globals.css";

export const metadata = {
  title: "TokenGuard: a circuit breaker for LLM spend — Kingdom of Kumar Lab",
  description:
    "Budget proxy for OpenAI-compatible chat APIs. Counts tokens and USD per agent, warns at 80%, returns HTTP 429 at 100%. Demo mode needs no key. MCP server included.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
