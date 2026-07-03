'use client';

import type { CSSProperties, ReactNode } from 'react';
import { GlassContent } from './GlassContent';
import { useGlassMount } from './hooks/useGlassMount';

export interface GlassChipProps {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
	as?: 'panel' | 'button';
	glassProps?: Record<string, string | number | boolean>;
	inline?: boolean;
	onClick?: () => void;
	type?: 'button';
	title?: string;
	role?: string;
	tabIndex?: number;
	onKeyDown?: (e: React.KeyboardEvent) => void;
}

export function GlassChip({
	children,
	className,
	style,
	as = 'panel',
	glassProps = {},
	inline = true,
	...handlers
}: GlassChipProps) {
	const mounted = useGlassMount();
	const Tag = (mounted ? (as === 'button' ? 'glass-button' : 'glass-panel') : as === 'button' ? 'button' : 'div') as any;

	return (
		<Tag
			className={className}
			style={style}
			{...(mounted ? glassProps : {})}
			{...handlers}
		>
			<GlassContent inline={inline}>{children}</GlassContent>
		</Tag>
	);
}
