import type { CSSProperties, ReactNode } from 'react';

export interface GlassContentProps {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
	/** Use inline-flex for pills / buttons; block for panels. */
	inline?: boolean;
}

/** Keeps DOM text and icons above the WebGL canvas (z-index 2 inside isolated glass). */
export function GlassContent({ children, className, style, inline }: GlassContentProps) {
	return (
		<div
			className={['glass-content-layer', className].filter(Boolean).join(' ')}
			style={{
				display: inline ? 'inline-flex' : 'block',
				alignItems: inline ? 'center' : undefined,
				position: 'relative',
				zIndex: 2,
				width: inline ? undefined : '100%',
				...style,
			}}
		>
			{children}
		</div>
	);
}
