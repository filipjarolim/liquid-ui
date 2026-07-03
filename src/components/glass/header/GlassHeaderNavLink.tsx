'use client';

import type { ReactNode } from 'react';

export interface GlassHeaderNavLinkProps {
	href: string;
	children: ReactNode;
	onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

export function GlassHeaderNavLink({ href, children, onClick }: GlassHeaderNavLinkProps) {
	return (
		<a href={href} className="nav-link" onClick={onClick}>
			{children}
		</a>
	);
}
