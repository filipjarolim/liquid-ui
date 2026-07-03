'use client';

import type { ReactNode } from 'react';
import { GlassChip } from '../GlassChip';
import { buildGlassProps } from '../config';

export interface GlassHeaderSearchProps {
	children: ReactNode;
	pgValues: Record<string, number>;
	onClick?: () => void;
	onKeyDown?: (e: React.KeyboardEvent) => void;
}

export function GlassHeaderSearch({ children, pgValues, onClick, onKeyDown }: GlassHeaderSearchProps) {
	return (
		<GlassChip
			className="header-search-panel"
			glassProps={buildGlassProps(pgValues, { 'corner-radius': 99 })}
			role="button"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={onKeyDown}
		>
			{children}
		</GlassChip>
	);
}
