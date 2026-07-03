'use client';

/** Registers WebGL custom elements — import once in root layout. */
import 'liquidglass-ui/elements';

export function GlassProvider({ children }: { children: React.ReactNode }) {
	return <>{children}</>;
}
