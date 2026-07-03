'use client';

import type { ReactNode } from 'react';
import { GlassChip } from '../GlassChip';
import { buildGlassProps } from '../config';

export interface GlassHeaderLogoProps {
	children: ReactNode;
	pgValues: Record<string, number>;
}

export function GlassHeaderLogo({ children, pgValues }: GlassHeaderLogoProps) {
	return (
		<GlassChip
			className="header-logo-panel"
			glassProps={buildGlassProps(pgValues, { 'corner-radius': 22 })}
		>
			{children}
		</GlassChip>
	);
}
