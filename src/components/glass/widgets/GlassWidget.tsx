'use client';

import type { ReactNode } from 'react';
import { GlassChip } from '../GlassChip';
import { buildGlassProps } from '../config';

export interface GlassWidgetProps {
	children: ReactNode;
	className?: string;
	pgValues: Record<string, number>;
	overrides?: Record<string, string | number | boolean>;
}

/** iOS home-screen style widget panel — large radius, soft frost. */
export function GlassWidget({ children, className, pgValues, overrides = {} }: GlassWidgetProps) {
	return (
		<GlassChip
			className={['glass-widget', className].filter(Boolean).join(' ')}
			inline={false}
			glassProps={buildGlassProps(pgValues, {
				'corner-radius': 32,
				'shadow-opacity': 0.22,
				...overrides,
			})}
		>
			{children}
		</GlassChip>
	);
}
