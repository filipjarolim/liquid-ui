'use client';

import type { ReactNode } from 'react';
import { GlassChip } from '../GlassChip';
import { buildGlassProps } from '../config';

export interface ShowcaseGlassPanelProps {
	children: ReactNode;
	className?: string;
	pgValues: Record<string, number>;
	overrides?: Record<string, string | number | boolean>;
}

export function ShowcaseGlassPanel({
	children,
	className,
	pgValues,
	overrides = {},
}: ShowcaseGlassPanelProps) {
	return (
		<GlassChip
			className={className}
			inline={false}
			glassProps={buildGlassProps(pgValues, overrides)}
		>
			{children}
		</GlassChip>
	);
}

export function ShowcaseGlassButton({
	children,
	className,
	pgValues,
	overrides = {},
	onClick,
	style,
}: ShowcaseGlassPanelProps & {
	onClick?: () => void;
	style?: React.CSSProperties;
}) {
	return (
		<GlassChip
			as="button"
			type="button"
			className={className}
			style={style}
			glassProps={buildGlassProps(pgValues, overrides)}
			onClick={onClick}
		>
			{children}
		</GlassChip>
	);
}
