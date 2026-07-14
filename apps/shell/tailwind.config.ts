import type { Config } from "tailwindcss";

const config: Config = {
  content: {
    // Anchor content globs to this config so dev/build always scan the shell and
    // the shared UI sources.
    relative: true,
    files: [
      "./src/**/*.{js,ts,jsx,tsx,mdx}",
      // The shared AppShell, ProjectSwitcher, Dialog and settings modal live in
      // @ssa/ui and are consumed as source. Without this glob, Tailwind purges
      // any utility used ONLY there (e.g. the sidebar's layout classes), which
      // silently renders the left nav display:none.
      "../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}"
    ]
  },
  theme: {
    extend: {
      colors: {
        ink: "#00346f",
        teal: "#006b5c",
        canvas: "#f7f9fb",
        panel: "#f2f4f6",
        card: "#ffffff",
        text: "#1f2937",
        muted: "#424751",
        outline: "#6b7280"
      },
      boxShadow: {
        ambient: "0px 4px 24px rgba(25, 28, 30, 0.06)"
      },
      backgroundImage: {
        "ink-gradient": "linear-gradient(135deg, #00346f 0%, #004a99 100%)"
      },
      fontFamily: {
        display: ["Manrope", "ui-sans-serif", "system-ui", "sans-serif"],
        body: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
