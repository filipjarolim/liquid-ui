'use client';

import { GlassChip } from '../GlassChip';
import { buildGlassProps } from '../config';

export interface GlassToggleProps {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label?: string;
	pgValues: Record<string, number>;
}

export function GlassToggle({ checked, onChange, label, pgValues }: GlassToggleProps) {
	return (
		<div className="glass-toggle-row">
			{label ? <span className="glass-toggle-label">{label}</span> : null}
			<GlassChip
				as="button"
				type="button"
				className={`glass-toggle${checked ? ' on' : ''}`}
				glassProps={buildGlassProps(pgValues, {
					'corner-radius': 99,
					'shadow-opacity': 0.2,
				})}
				onClick={() => onChange(!checked)}
				title={label}
			>
				<span className="glass-toggle-thumb" />
			</GlassChip>
		</div>
	);
}
