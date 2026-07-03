'use client';

import type { ReactNode } from 'react';
import { GlassChip } from '../GlassChip';
import { buildGlassProps } from '../config';

export interface GlassHeaderIconButtonProps {
	children: ReactNode;
	pgValues: Record<string, number>;
	onClick?: () => void;
	title?: string;
	className?: string;
}

export function GlassHeaderIconButton({
	children,
	pgValues,
	onClick,
	title,
	className = 'header-icon-btn',
}: GlassHeaderIconButtonProps) {
	return (
		<GlassChip
			as="button"
			type="button"
			className={className}
			glassProps={buildGlassProps(pgValues, { 'corner-radius': 99 })}
			onClick={onClick}
			title={title}
		>
			{children}
		</GlassChip>
	);
}

export function GlassHeaderStarButton({
	children,
	pgValues,
	onClick,
}: {
	children: ReactNode;
	pgValues: Record<string, number>;
	onClick?: () => void;
}) {
	return (
		<GlassChip
			as="button"
			type="button"
			className="header-star-btn"
			glassProps={buildGlassProps(pgValues, { 'corner-radius': 99 })}
			onClick={onClick}
		>
			{children}
		</GlassChip>
	);
}
