'use client';

import type { ReactNode } from 'react';
import { GlassChip } from '../GlassChip';
import { buildGlassProps } from '../config';

export interface GlassHeaderNavProps {
	children: ReactNode;
	pgValues: Record<string, number>;
}

export function GlassHeaderNav({ children, pgValues }: GlassHeaderNavProps) {
	return (
		<GlassChip
			className="header-nav-panel"
			inline={false}
			glassProps={buildGlassProps(pgValues, { 'corner-radius': 99 })}
		>
			<nav className="header-nav-inner">{children}</nav>
		</GlassChip>
	);
}
