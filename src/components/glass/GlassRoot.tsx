'use client';

import type { ReactNode } from 'react';
import { useGlassMount } from './hooks/useGlassMount';

export interface GlassRootProps {
	id: string;
	className?: string;
	children: ReactNode;
}

export function GlassRoot({ id, className, children }: GlassRootProps) {
	const mounted = useGlassMount();
	const Tag = (mounted ? 'glass-container' : 'div') as any;

	return (
		<Tag id={id} className={className}>
			{children}
		</Tag>
	);
}
