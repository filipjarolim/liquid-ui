'use client';

import { useEffect, useState } from 'react';

/** True after client hydration — safe to render glass custom elements. */
export function useGlassMount(): boolean {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	return mounted;
}
