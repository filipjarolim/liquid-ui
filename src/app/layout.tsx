import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { GlassProvider } from "@/lib/glass-provider";

const outfit = Outfit({
	subsets: ["latin"],
	weight: ["300", "400", "500", "600", "700", "800"],
	variable: "--font-outfit",
});

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	weight: ["400", "500"],
	variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
	title: "LiquidGlass — Optimized WebGL Custom Elements",
	description: "An optimized liquid glass effect library for the web, packaged as Custom Elements. Apply realistic glass refraction, blur, and lighting using WebGL2.",
};

const themeInitScript = `
try {
  var t = localStorage.getItem('glass-ui-theme');
  if (t === 'light' || t === 'dark') {
    document.documentElement.setAttribute('data-theme', t);
  }
} catch (e) {}
`;

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			lang="en"
			className={`${outfit.variable} ${jetbrainsMono.variable}`}
			suppressHydrationWarning
		>
			<head>
				<script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
			</head>
			<body>
				<GlassProvider>{children}</GlassProvider>
			</body>
		</html>
	);
}
