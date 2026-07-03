'use client';

import type { ReactNode } from 'react';
import { GlassChip } from '../GlassChip';
import { buildGlassProps } from '../config';

export interface GlassAppIconProps {
	pgValues: Record<string, number>;
	label: string;
	children: ReactNode;
	onClick?: () => void;
}

/** iOS home-screen glass app icon — squircle button with a label underneath. */
export function GlassAppIcon({ pgValues, label, children, onClick }: GlassAppIconProps) {
	return (
		<div className="glass-app-icon-wrap">
			<GlassChip
				as="button"
				type="button"
				className="glass-app-icon"
				glassProps={buildGlassProps(pgValues, {
					'corner-radius': 22,
					'z-radius': 24,
					'shadow-opacity': 0.25,
				})}
				onClick={onClick}
				title={label}
			>
				<span className="glass-app-icon-glyph">{children}</span>
			</GlassChip>
			<span className="glass-app-icon-label">{label}</span>
		</div>
	);
}
