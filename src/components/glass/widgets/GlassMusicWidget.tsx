'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GlassChip } from '../GlassChip';
import { buildGlassProps } from '../config';
import { GlassWidget } from './GlassWidget';

export interface GlassMusicWidgetProps {
	pgValues: Record<string, number>;
	artSrc: string;
	title: string;
	subtitle: string;
	/** Apple Music / iTunes preview URL or any HTML5 audio source */
	audioSrc?: string;
	onPlay?: () => void;
	onPause?: () => void;
}

/** Music widget — album art, track info, and a glass play/pause pill (iOS style). */
export function GlassMusicWidget({
	pgValues,
	artSrc,
	title,
	subtitle,
	audioSrc,
	onPlay,
	onPause,
}: GlassMusicWidgetProps) {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		const onPlayEvent = () => setIsPlaying(true);
		const onPauseEvent = () => setIsPlaying(false);
		const onEnded = () => setIsPlaying(false);

		audio.addEventListener('play', onPlayEvent);
		audio.addEventListener('pause', onPauseEvent);
		audio.addEventListener('ended', onEnded);

		return () => {
			audio.removeEventListener('play', onPlayEvent);
			audio.removeEventListener('pause', onPauseEvent);
			audio.removeEventListener('ended', onEnded);
			audio.pause();
		};
	}, [audioSrc]);

	const togglePlayback = useCallback(async () => {
		if (!audioSrc || !audioRef.current) {
			onPlay?.();
			return;
		}

		const audio = audioRef.current;
		if (audio.paused) {
			try {
				await audio.play();
				onPlay?.();
			} catch {
				setIsPlaying(false);
			}
		} else {
			audio.pause();
			onPause?.();
		}
	}, [audioSrc, onPlay, onPause]);

	return (
		<GlassWidget
			pgValues={pgValues}
			className={`glass-music-widget${isPlaying ? ' is-playing' : ''}`}
		>
			{audioSrc ? (
				<audio ref={audioRef} src={audioSrc} preload="metadata" />
			) : null}
			<div className="widget-music-top">
				<img src={artSrc} alt="" className="widget-music-art" />
				<svg viewBox="0 0 24 24" className="widget-music-note" fill="currentColor" aria-hidden>
					<path d="M9 18.5a3 3 0 1 1-2-2.83V6.2a1 1 0 0 1 .76-.97l9-2.2A1 1 0 0 1 18 4v10.55a3 3 0 1 1-2-2.83V7.3l-7 1.71v9.49z" />
				</svg>
			</div>
			<div className="widget-music-title">{title}</div>
			<div className="widget-music-subtitle">{subtitle}</div>
			<GlassChip
				as="button"
				type="button"
				className="widget-play-pill"
				aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
				glassProps={buildGlassProps(pgValues, {
					'corner-radius': 99,
					'shadow-opacity': 0.15,
					'blur-amount': Math.min((pgValues['blur'] ?? 0.5) * 1.2, 1),
				})}
				onClick={togglePlayback}
			>
				{isPlaying ? (
					<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
						<path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
					</svg>
				) : (
					<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
						<path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86a1 1 0 0 0-1.5.86z" />
					</svg>
				)}
				<span>{isPlaying ? 'Pause' : 'Play'}</span>
			</GlassChip>
		</GlassWidget>
	);
}
