import type { ReactNode } from "react";
import { SiteFooter } from "@/ui/SiteFooter";
import { SiteHeader } from "@/ui/SiteHeader";

// The public site: landing, explorer, agreement pages and contract evidence. The application lives in /app
// and has its own shell (src/app/app/layout.tsx).
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
