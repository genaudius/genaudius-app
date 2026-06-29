<script lang="ts">
	import { playerState } from '$lib/stores/player.svelte.js';
	import { onDestroy } from 'svelte';

	// ─── Refs ────────────────────────────────────────────────────────────────────
	let audioEl = $state<HTMLAudioElement | null>(null);
	let progressBarEl = $state<HTMLDivElement | null>(null);
	let isDraggingProgress = $state(false);
	let isDraggingVolume = $state(false);
	let volumeBarEl = $state<HTMLDivElement | null>(null);

	// ─── Format helpers ──────────────────────────────────────────────────────────
	function formatTime(ms: number): string {
		const totalSec = Math.floor(ms / 1000);
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	// ─── Sync audio src when track changes ──────────────────────────────────────
	$effect(() => {
		const track = playerState.currentTrack;
		if (!audioEl || !track) return;

		if (audioEl.src !== track.audioUrl) {
			audioEl.src = track.audioUrl;
			audioEl.load();
		}

		if (playerState.isPlaying) {
			audioEl.play().catch(() => {});
		}
	});

	// ─── Sync play/pause ─────────────────────────────────────────────────────────
	$effect(() => {
		if (!audioEl) return;
		if (playerState.isPlaying) {
			audioEl.play().catch(() => {});
		} else {
			audioEl.pause();
		}
	});

	// ─── Sync volume ─────────────────────────────────────────────────────────────
	$effect(() => {
		if (!audioEl) return;
		audioEl.volume = playerState.effectiveVolume;
	});

	// ─── Sync seek ───────────────────────────────────────────────────────────────
	let lastSeekTime = -1;
	$effect(() => {
		const targetMs = playerState.currentTimeMs;
		if (!audioEl || isDraggingProgress) return;
		if (Math.abs(targetMs - lastSeekTime) > 500 && Math.abs(audioEl.currentTime * 1000 - targetMs) > 500) {
			audioEl.currentTime = targetMs / 1000;
			lastSeekTime = targetMs;
		}
	});

	// ─── Audio element events ─────────────────────────────────────────────────────
	function onTimeUpdate() {
		if (!audioEl || isDraggingProgress) return;
		playerState.currentTimeMs = audioEl.currentTime * 1000;
	}

	function onLoadedMetadata() {
		if (!audioEl) return;
		playerState.setDuration(audioEl.duration * 1000);
	}

	function onEnded() {
		if (playerState.hasNext) {
			playerState.next();
		} else {
			playerState.pause();
			playerState.setTime(0);
		}
	}

	function onAudioError() {
		playerState.pause();
	}

	// ─── Progress bar interaction ─────────────────────────────────────────────────
	function getProgressFromEvent(e: MouseEvent | TouchEvent): number {
		if (!progressBarEl) return 0;
		const rect = progressBarEl.getBoundingClientRect();
		const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
		const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		return ratio * playerState.durationMs;
	}

	function onProgressMouseDown(e: MouseEvent) {
		isDraggingProgress = true;
		playerState.setTime(getProgressFromEvent(e));
	}

	function onProgressMouseMove(e: MouseEvent) {
		if (!isDraggingProgress) return;
		playerState.setTime(getProgressFromEvent(e));
	}

	function onProgressMouseUp(e: MouseEvent) {
		if (!isDraggingProgress) return;
		const ms = getProgressFromEvent(e);
		playerState.setTime(ms);
		if (audioEl) audioEl.currentTime = ms / 1000;
		isDraggingProgress = false;
	}

	// ─── Volume bar interaction ───────────────────────────────────────────────────
	function getVolumeFromEvent(e: MouseEvent): number {
		if (!volumeBarEl) return playerState.volume;
		const rect = volumeBarEl.getBoundingClientRect();
		return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	}

	function onVolumeMouseDown(e: MouseEvent) {
		isDraggingVolume = true;
		playerState.setVolume(getVolumeFromEvent(e));
	}

	function onVolumeMouseMove(e: MouseEvent) {
		if (!isDraggingVolume) return;
		playerState.setVolume(getVolumeFromEvent(e));
	}

	function onVolumeMouseUp(e: MouseEvent) {
		if (!isDraggingVolume) return;
		playerState.setVolume(getVolumeFromEvent(e));
		isDraggingVolume = false;
	}

	// ─── Global mouse up listeners ────────────────────────────────────────────────
	function onGlobalMouseUp(e: MouseEvent) {
		if (isDraggingProgress) onProgressMouseUp(e);
		if (isDraggingVolume) onVolumeMouseUp(e);
	}

	// ─── Cleanup ─────────────────────────────────────────────────────────────────
	onDestroy(() => {
		if (audioEl) {
			audioEl.pause();
			audioEl.src = '';
		}
	});

	// ─── Cover art fallback ───────────────────────────────────────────────────────
	const DEFAULT_COVER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="6" fill="#1e1b4b"/><circle cx="24" cy="24" r="10" stroke="#7c3aed" stroke-width="2" fill="none"/><circle cx="24" cy="24" r="3" fill="#7c3aed"/></svg>')}`;
</script>

<!-- Hidden audio element — single source of truth for playback -->
<audio
	bind:this={audioEl}
	ontimeupdate={onTimeUpdate}
	onloadedmetadata={onLoadedMetadata}
	onended={onEnded}
	onerror={onAudioError}
	preload="metadata"
/>

<!-- Global drag listeners -->
<svelte:window onmousemove={onProgressMouseMove} onmouseup={onGlobalMouseUp} />

{#if playerState.currentTrack}
	<!-- Lyrics panel (slides up above bar) -->
	{#if playerState.showLyrics && playerState.currentTrack.lyrics?.length}
		<div class="fixed bottom-[72px] left-0 right-0 z-40 bg-black/95 backdrop-blur border-t border-white/10 max-h-[40vh] overflow-y-auto px-4 py-6">
			<div class="max-w-2xl mx-auto space-y-2 text-center">
				{#each playerState.currentTrack.lyrics as line, i}
					<p
						class="text-base transition-all duration-300 {i === playerState.currentLyricIndex
							? 'text-white font-semibold text-lg scale-105'
							: i < playerState.currentLyricIndex
							? 'text-white/30'
							: 'text-white/50'}"
					>
						{line.text}
					</p>
				{/each}
			</div>
		</div>
	{/if}

	<!-- NowPlaying Bar -->
	<div
		class="fixed bottom-0 left-0 right-0 z-50 h-[72px] bg-[oklch(0.16_0.006_285.885)] border-t border-white/10 flex items-center px-4 gap-4 select-none"
		role="region"
		aria-label="Now Playing"
	>
		<!-- LEFT: Cover + Track info -->
		<div class="flex items-center gap-3 w-[240px] min-w-0 shrink-0">
			<!-- Cover art -->
			<div class="relative shrink-0 w-12 h-12 rounded-md overflow-hidden shadow-lg">
				<img
					src={playerState.currentTrack.coverUrl || DEFAULT_COVER}
					alt={playerState.currentTrack.title}
					class="w-full h-full object-cover"
					onerror={(e) => { (e.target as HTMLImageElement).src = DEFAULT_COVER; }}
				/>
			</div>

			<!-- Title + Artist -->
			<div class="min-w-0 flex-1">
				<p class="text-sm font-medium text-white truncate leading-tight">
					{playerState.currentTrack.title}
				</p>
				<p class="text-xs text-white/50 truncate leading-tight mt-0.5">
					{playerState.currentTrack.artist}
					{#if playerState.currentTrack.isInstrumental}
						<span class="ml-1 text-violet-400 text-[10px] uppercase tracking-wider">Instrumental</span>
					{/if}
				</p>
			</div>

			<!-- Like / Lyrics buttons -->
			<div class="flex items-center gap-1 shrink-0">
				{#if playerState.currentTrack.lyrics?.length}
					<button
						onclick={() => playerState.toggleLyrics()}
						class="p-1.5 rounded-full transition-colors {playerState.showLyrics ? 'text-violet-400' : 'text-white/40 hover:text-white'}"
						title="Lyrics"
						aria-label="Toggle lyrics"
					>
						<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 17h8v1H8v-1zm0-3h8v1H8v-1zm0-3h5v1H8v-1z"/>
						</svg>
					</button>
				{/if}
			</div>
		</div>

		<!-- CENTER: Controls + Progress bar -->
		<div class="flex-1 flex flex-col items-center justify-center gap-1 min-w-0">
			<!-- Playback controls -->
			<div class="flex items-center gap-4">
				<!-- Prev -->
				<button
					onclick={() => playerState.prev()}
					class="text-white/60 hover:text-white transition-colors disabled:opacity-30"
					disabled={!playerState.hasPrev && playerState.currentTimeMs < 3000}
					aria-label="Previous"
				>
					<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
						<path d="M6 6h2v12H6zm3.5 6 8.5 6V6l-8.5 6z"/>
					</svg>
				</button>

				<!-- Play / Pause -->
				<button
					onclick={() => playerState.toggle()}
					class="w-9 h-9 rounded-full bg-white flex items-center justify-center text-black hover:scale-105 active:scale-95 transition-transform shadow-lg"
					aria-label={playerState.isPlaying ? 'Pause' : 'Play'}
				>
					{#if playerState.isPlaying}
						<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
							<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
						</svg>
					{:else}
						<svg class="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
							<path d="M8 5v14l11-7z"/>
						</svg>
					{/if}
				</button>

				<!-- Next -->
				<button
					onclick={() => playerState.next()}
					class="text-white/60 hover:text-white transition-colors disabled:opacity-30"
					disabled={!playerState.hasNext}
					aria-label="Next"
				>
					<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
						<path d="M6 18l8.5-6L6 6v12zm2.5-6 5.5 3.9V8.1L8.5 12zM16 6h2v12h-2z"/>
					</svg>
				</button>
			</div>

			<!-- Progress bar -->
			<div class="flex items-center gap-2 w-full max-w-lg">
				<span class="text-[10px] text-white/40 tabular-nums w-8 text-right shrink-0">
					{formatTime(playerState.currentTimeMs)}
				</span>

				<!-- Track bar -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					bind:this={progressBarEl}
					class="relative flex-1 h-1 bg-white/20 rounded-full cursor-pointer group"
					onmousedown={onProgressMouseDown}
					role="slider"
					aria-label="Seek"
					aria-valuemin={0}
					aria-valuemax={playerState.durationMs}
					aria-valuenow={playerState.currentTimeMs}
				>
					<!-- Filled portion -->
					<div
						class="absolute left-0 top-0 h-full bg-white rounded-full transition-none"
						style="width: {playerState.progressPercent}%"
					/>
					<!-- Thumb -->
					<div
						class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity {isDraggingProgress ? 'opacity-100' : ''}"
						style="left: calc({playerState.progressPercent}% - 6px)"
					/>
				</div>

				<span class="text-[10px] text-white/40 tabular-nums w-8 shrink-0">
					{formatTime(playerState.durationMs)}
				</span>
			</div>
		</div>

		<!-- RIGHT: Volume + extras -->
		<div class="flex items-center gap-3 w-[180px] justify-end shrink-0">
			<!-- Model badge -->
			{#if playerState.currentTrack.model}
				<span class="hidden lg:inline text-[10px] text-violet-400/60 font-mono uppercase tracking-wider truncate max-w-[72px]">
					{playerState.currentTrack.model.replace('suno-', 'S')}
				</span>
			{/if}

			<!-- Mute button -->
			<button
				onclick={() => playerState.toggleMute()}
				class="text-white/50 hover:text-white transition-colors shrink-0"
				aria-label={playerState.isMuted ? 'Unmute' : 'Mute'}
			>
				{#if playerState.isMuted || playerState.volume === 0}
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
						<path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0 0 17.73 18L19 19.27 20.27 18 5.27 3 4.27 4.27zM12 4 9.91 6.09 12 8.18V4z"/>
					</svg>
				{:else if playerState.volume < 0.5}
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
						<path d="M7 9v6h4l5 5V4l-5 5H7zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
					</svg>
				{:else}
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
						<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
					</svg>
				{/if}
			</button>

			<!-- Volume slider -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				bind:this={volumeBarEl}
				class="relative w-20 h-1 bg-white/20 rounded-full cursor-pointer group"
				onmousedown={onVolumeMouseDown}
				role="slider"
				aria-label="Volume"
				aria-valuemin={0}
				aria-valuemax={1}
				aria-valuenow={playerState.volume}
			>
				<div
					class="absolute left-0 top-0 h-full bg-white/80 rounded-full"
					style="width: {playerState.isMuted ? 0 : playerState.volume * 100}%"
				/>
				<div
					class="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow"
					style="left: calc({playerState.isMuted ? 0 : playerState.volume * 100}% - 5px)"
				/>
			</div>
		</div>
	</div>
{/if}
