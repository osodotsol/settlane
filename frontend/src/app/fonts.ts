import localFont from "next/font/local";

// Self-hosted, SIL OFL fonts (src/fonts/OFL-*.txt). No request to a font CDN, at build or at runtime.
export const newsreader = localFont({
  src: [
    { path: "../fonts/newsreader-latin-opsz-wght.woff2", weight: "200 800", style: "normal" },
    // The true italic (used for emphasis in display headings), not a synthesized slant.
    { path: "../fonts/newsreader-latin-opsz-italic-wght.woff2", weight: "200 800", style: "italic" },
  ],
  variable: "--font-newsreader",
  display: "swap",
});

export const plexSans = localFont({
  src: "../fonts/ibm-plex-sans-latin-wght.woff2",
  variable: "--font-plex-sans",
  weight: "100 700",
  display: "swap",
});

export const plexMono = localFont({
  src: [
    { path: "../fonts/ibm-plex-mono-latin-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-mono-latin-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  preload: false,
});
