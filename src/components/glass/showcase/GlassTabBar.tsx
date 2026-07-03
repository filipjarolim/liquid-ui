'use client';

import { GlassChip } from '../GlassChip';
import { buildGlassProps } from '../config';

export interface GlassTabBarProps {
	tabs: Array<{ id: string; label: string }>;
	active: string;
	onChange: (id: string) => void;
	pgValues: Record<string, number>;
	className?: string;
}

export function GlassTabBar({ tabs, active, onChange, pgValues, className }: GlassTabBarProps) {
	return (
		<div className={['glass-tab-bar', className].filter(Boolean).join(' ')}>
			{tabs.map((tab) => (
				<GlassChip
					key={tab.id}
					as="button"
					type="button"
					className={`glass-tab-item${active === tab.id ? ' active' : ''}`}
					glassProps={buildGlassProps(pgValues, {
						'corner-radius': 12,
						'shadow-opacity': 0.18,
						'blur-amount': pgValues['blur'] * 0.7,
					})}
					onClick={() => onChange(tab.id)}
				>
					{tab.label}
				</GlassChip>
			))}
		</div>
	);
}
