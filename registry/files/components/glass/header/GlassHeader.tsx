'use client';

import type { ReactNode } from 'react';
import {
	GlassHeaderIconButton,
	GlassHeaderStarButton,
} from './GlassHeaderIconButton';
import { GlassHeaderLogo } from './GlassHeaderLogo';
import { GlassHeaderNav } from './GlassHeaderNav';
import { GlassHeaderNavLink } from './GlassHeaderNavLink';
import { GlassHeaderSearch } from './GlassHeaderSearch';

export interface GlassHeaderProps {
	logo: ReactNode;
	pgValues: Record<string, number>;
	onSearchClick?: () => void;
	onStarClick?: () => void;
	onThemeToggle?: () => void;
	onSettingsClick?: () => void;
	themeIcon: ReactNode;
	navItems: Array<{
		label: string;
		href: string;
		onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void;
	}>;
}

export function GlassHeader({
	logo,
	pgValues,
	navItems,
	onSearchClick,
	onStarClick,
	onThemeToggle,
	onSettingsClick,
	themeIcon,
}: GlassHeaderProps) {
	return (
		<header className="main-header">
			<GlassHeaderLogo pgValues={pgValues}>{logo}</GlassHeaderLogo>

			<GlassHeaderNav pgValues={pgValues}>
				{navItems.map((item) => (
					<GlassHeaderNavLink key={item.href} href={item.href} onClick={item.onClick}>
						{item.label}
					</GlassHeaderNavLink>
				))}
			</GlassHeaderNav>

			<div className="header-cluster">
				<GlassHeaderSearch
					pgValues={pgValues}
					onClick={onSearchClick}
					onKeyDown={(e) => {
						if (e.key === 'Enter') onSearchClick?.();
					}}
				>
					<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
						<circle cx="11" cy="11" r="7" />
						<line x1="21" y1="21" x2="16.65" y2="16.65" />
					</svg>
					<span>Search variables...</span>
				</GlassHeaderSearch>

				<GlassHeaderStarButton pgValues={pgValues} onClick={onStarClick}>
					★ 11.7k
				</GlassHeaderStarButton>

				<GlassHeaderIconButton pgValues={pgValues} onClick={onThemeToggle} title="Toggle Theme">
					{themeIcon}
				</GlassHeaderIconButton>

				<GlassHeaderIconButton pgValues={pgValues} onClick={onSettingsClick} title="Open Settings">
					<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
						<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.44.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
					</svg>
				</GlassHeaderIconButton>
			</div>
		</header>
	);
}
