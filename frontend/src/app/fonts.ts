import localFont from "next/font/local";

// Self-hosted, SIL OFL fonts (src/fonts/OFL-IBM-Plex.txt). No request to a font CDN, at build or at runtime.
// One family does everything: IBM Plex Sans (headings at 600-700 with tight tracking, UI text at 400-500)
// and IBM Plex Mono for data. Fewer faces, less weight, a plainer and more professional voice.
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
