'use client';

import { useState } from 'react';
import { GlassWidget } from './GlassWidget';

export interface GlassListWidgetProps {
	pgValues: Record<string, number>;
	title: string;
	items: string[];
}

/** Reminders-style list widget — title, count badge, tappable circle rows. */
export function GlassListWidget({ pgValues, title, items }: GlassListWidgetProps) {
	const [done, setDone] = useState<Set<number>>(new Set());

	const toggle = (idx: number) => {
		setDone((prev) => {
			const next = new Set(prev);
			if (next.has(idx)) next.delete(idx);
			else next.add(idx);
			return next;
		});
	};

	const remaining = items.length - done.size;

	return (
		<GlassWidget pgValues={pgValues} className="glass-list-widget">
			<div className="widget-list-header">
				<span className="widget-list-title">{title}</span>
				<span className="widget-list-count">{remaining}</span>
			</div>
			<ul className="widget-list-items">
				{items.map((item, idx) => (
					<li
						key={item}
						className={`widget-list-row${done.has(idx) ? ' done' : ''}`}
						onClick={() => toggle(idx)}
					>
						<span className="widget-list-circle" aria-hidden>
							{done.has(idx) ? (
								<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3">
									<polyline points="20 6 9 17 4 12" />
								</svg>
							) : null}
						</span>
						<span className="widget-list-text">{item}</span>
					</li>
				))}
			</ul>
		</GlassWidget>
	);
}
