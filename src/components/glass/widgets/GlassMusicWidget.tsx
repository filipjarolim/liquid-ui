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

const FADE_IN_MS  = 900;   // ramp-up after pressing play
const FADE_OUT_MS = 1800;  // ramp-down when approaching the end
const FADE_PAUSE_MS = 350; // quick ramp-down when user presses pause
const FADE_OUT_BEFORE_END_S = 3; // seconds before end to start fading out

/** Smooth ease-in-out curve (quad). */
function easeInOut(t: number): number {
	return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
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
	const fadeRafRef = useRef<number | null>(null);
	const fadingOutRef = useRef(false); // true while end-of-track fade is running

	const cancelFade = () => {
		if (fadeRafRef.current !== null) {
			cancelAnimationFrame(fadeRafRef.current);
			fadeRafRef.current = null;
		}
	};

	/** Animate audio.volume from `from` → `to` over `duration` ms. */
	const fadeVolume = useCallback(
		(from: number, to: number, duration: number, onDone?: () => void) => {
			cancelFade();
			const startTime = performance.now();
			const tick = (now: number) => {
				const audio = audioRef.current;
				if (!audio) { onDone?.(); return; }
				const t = Math.min((now - startTime) / duration, 1);
				audio.volume = Math.max(0, Math.min(1, from + (to - from) * easeInOut(t)));
				if (t < 1) {
					fadeRafRef.current = requestAnimationFrame(tick);
				} else {
					fadeRafRef.current = null;
					onDone?.();
				}
			};
			fadeRafRef.current = requestAnimationFrame(tick);
		},
		[],
	);

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) return;

		const onPlayEvent = () => setIsPlaying(true);
		const onPauseEvent = () => { setIsPlaying(false); fadingOutRef.current = false; };
		const onEnded = () => { setIsPlaying(false); fadingOutRef.current = false; };

		const onTimeUpdate = () => {
			if (!audio.duration || fadingOutRef.current || audio.paused) return;
			const remaining = audio.duration - audio.currentTime;
			if (remaining <= FADE_OUT_BEFORE_END_S) {
				fadingOutRef.current = true;
				const fadeDuration = Math.min(remaining * 1000, FADE_OUT_MS);
				fadeVolume(audio.volume, 0, fadeDuration, () => {
					audio.pause();
					audio.currentTime = 0;
					audio.volume = 1;
					fadingOutRef.current = false;
				});
			}
		};

		audio.addEventListener('play', onPlayEvent);
		audio.addEventListener('pause', onPauseEvent);
		audio.addEventListener('ended', onEnded);
		audio.addEventListener('timeupdate', onTimeUpdate);

		return () => {
			cancelFade();
			audio.removeEventListener('play', onPlayEvent);
			audio.removeEventListener('pause', onPauseEvent);
			audio.removeEventListener('ended', onEnded);
			audio.removeEventListener('timeupdate', onTimeUpdate);
			audio.pause();
		};
	}, [audioSrc, fadeVolume]);

	const togglePlayback = useCallback(async () => {
		if (!audioSrc || !audioRef.current) {
			onPlay?.();
			return;
		}

		const audio = audioRef.current;
		if (audio.paused) {
			// Reset any lingering fade state from previous play
			cancelFade();
			fadingOutRef.current = false;
			audio.volume = 0;
			try {
				await audio.play();
				fadeVolume(0, 1, FADE_IN_MS);
				onPlay?.();
			} catch {
				setIsPlaying(false);
			}
		} else {
			// Fade out quickly, then pause
			cancelFade();
			fadingOutRef.current = false;
			const fromVol = audio.volume;
			fadeVolume(fromVol, 0, FADE_PAUSE_MS, () => {
				audio.pause();
				audio.currentTime = 0;
				audio.volume = 1;
			});
			onPause?.();
		}
	}, [audioSrc, fadeVolume, onPlay, onPause]);

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
