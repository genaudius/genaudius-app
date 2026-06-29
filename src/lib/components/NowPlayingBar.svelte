<script lang="ts">
	import { playerState } from '$lib/stores/player.svelte.js';
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import { fly } from 'svelte/transition';

	let { hasSidebar = false }: { hasSidebar?: boolean } = $props();

	// ─── Sidebar context (safe even if outside Provider) ─────────────────────────
	let sidebar: ReturnType<typeof useSidebar> | null = null;
	if (hasSidebar) {
		try {
			sidebar = useSidebar();
		} catch {}
	}

	const NP_WIDTH = 340;

	const leftOffset = $derived.by(() => {
		if (!sidebar) return '0px';
		if (sidebar.isMobile) return '0px';
		return sidebar.open ? 'var(--sidebar-width, 18rem)' : 'var(--sidebar-width-icon, 3rem)';
	});

	const rightOffset = $derived(playerState.showNowPlaying ? `${NP_WIDTH}px` : '0px');

	// ─── Refs ────────────────────────────────────────────────────────────────────
	let audioEl = $state<HTMLAudioElement | null>(null);
	let progressBarEl = $state<HTMLDivElement | null>(null);
	let volumeBarEl = $state<HTMLDivElement | null>(null);
	let lyricsContainerEl = $state<HTMLDivElement | null>(null);
	let isDraggingProgress = $state(false);
	let isDraggingVolume = $state(false);

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
		if (playerState.isPlaying) audioEl.play().catch(() => {});
	});

	// ─── Sync play/pause ─────────────────────────────────────────────────────────
	$effect(() => {
		if (!audioEl) return;
		if (playerState.isPlaying) audioEl.play().catch(() => {});
		else audioEl.pause();
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

	// ─── Auto-scroll lyrics ───────────────────────────────────────────────────────
	$effect(() => {
		const idx = playerState.currentLyricIndex;
		if (idx < 0 || !lyricsContainerEl || !playerState.showNowPlaying) return;
		const el = lyricsContainerEl.querySelector(`[data-lyric="${idx}"]`) as HTMLElement | null;
		if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	});

	// ─── Audio events ────────────────────────────────────────────────────────────
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
		return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * playerState.durationMs;
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

	function onGlobalMouseUp(e: MouseEvent) {
		if (isDraggingProgress) onProgressMouseUp(e);
		if (isDraggingVolume) onVolumeMouseUp(e);
	}

	// ─── Actions ─────────────────────────────────────────────────────────────────
	async function handleShare() {
		const track = playerState.currentTrack;
		if (!track?.publicationId) {
			toast.error('No shareable link yet — publish first');
			return;
		}
		const url = `${window.location.origin}/explore/${track.publicationId}`;
		try {
			await navigator.clipboard.writeText(url);
			toast.success('Link copied to clipboard');
		} catch {
			toast.error('Failed to copy link');
		}
	}

	async function handleDownload() {
		const track = playerState.currentTrack;
		if (!track) return;
		try {
			const res = await fetch(track.audioUrl);
			if (!res.ok) throw new Error();
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${track.title}.mp3`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('Download started');
		} catch {
			toast.error('Download failed');
		}
	}

	function handlePublish() {
		goto('/library');
	}

	// ─── Cleanup ─────────────────────────────────────────────────────────────────
	onDestroy(() => {
		if (audioEl) {
			audioEl.pause();
			audioEl.src = '';
		}
	});

	// ─── Default cover ────────────────────────────────────────────────────────────
	const DEFAULT_COVER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="6" fill="#1e1b4b"/><circle cx="24" cy="24" r="10" stroke="#7c3aed" stroke-width="2" fill="none"/><circle cx="24" cy="24" r="3" fill="#7c3aed"/></svg>')}`;
</script>

<!-- Hidden audio element -->
<audio
	bind:this={audioEl}
	ontimeupdate={onTimeUpdate}
	onloadedmetadata={onLoadedMetadata}
	onended={onEnded}
	onerror={onAudioError}
	preload="metadata"
/>

<svelte:window onmousemove={(e) => { onProgressMouseMove(e); onVolumeMouseMove(e); }} onmouseup={onGlobalMouseUp} />

<!-- ─── Now Playing Panel ──────────────────────────────────────────────────── -->
{#if playerState.currentTrack && playerState.showNowPlaying}
	<div
		class="fixed top-0 z-40 flex flex-col select-none"
		style="right: 0; width: {NP_WIDTH}px; bottom: 72px; background: rgba(10,10,13,0.97); backdrop-filter: blur(24px); border-left: 1px solid rgba(255,255,255,0.07);"
		transition:fly={{ x: NP_WIDTH, duration: 280 }}
	>
		<!-- Panel header -->
		<div class="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
			<span class="text-[10px] font-semibold tracking-widest uppercase" style="color: rgba(255,255,255,0.35);">Now Playing</span>
			<button
				onclick={() => playerState.toggleNowPlaying()}
				class="p-1.5 rounded-full transition-colors hover:bg-white/10"
				style="color: rgba(255,255,255,0.4);"
				aria-label="Close now playing"
			>
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
					<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
				</svg>
			</button>
		</div>

		<!-- Album art -->
		<div class="px-7 pb-5 shrink-0">
			<div class="w-full aspect-square rounded-2xl overflow-hidden shadow-2xl">
				<img
					src={playerState.currentTrack.coverUrl || DEFAULT_COVER}
					alt={playerState.currentTrack.title}
					class="w-full h-full object-cover"
					onerror={(e) => { (e.target as HTMLImageElement).src = DEFAULT_COVER; }}
				/>
			</div>
		</div>

		<!-- Track info -->
		<div class="px-5 pb-1 shrink-0">
			<p class="text-base font-bold text-white truncate leading-snug">{playerState.currentTrack.title}</p>
			<p class="text-sm truncate mt-0.5" style="color: rgba(255,255,255,0.45);">{playerState.currentTrack.artist}</p>
		</div>

		<!-- Action buttons -->
		<div class="px-5 py-4 flex items-center justify-around shrink-0 border-b" style="border-color: rgba(255,255,255,0.06);">
			<!-- Like -->
			<button
				onclick={() => playerState.toggleLike()}
				class="flex flex-col items-center gap-1.5 group transition-colors"
				title="Like"
				aria-label="Like"
			>
				<svg
					class="w-5 h-5 transition-all duration-200"
					style="color: {playerState.isLiked ? '#f43f5e' : 'rgba(255,255,255,0.4)'}; fill: {playerState.isLiked ? '#f43f5e' : 'none'}; transform: scale({playerState.isLiked ? '1.15' : '1'});"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
				</svg>
				<span class="text-[10px] transition-colors" style="color: {playerState.isLiked ? '#f43f5e' : 'rgba(255,255,255,0.35)'};">Like</span>
			</button>

			<!-- Share -->
			<button
				onclick={handleShare}
				class="flex flex-col items-center gap-1.5 group"
				title="Share"
				aria-label="Share"
			>
				<svg class="w-5 h-5 transition-colors group-hover:text-white" style="color: rgba(255,255,255,0.4);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
					<polyline points="16 6 12 2 8 6"/>
					<line x1="12" y1="2" x2="12" y2="15"/>
				</svg>
				<span class="text-[10px] transition-colors group-hover:text-white/70" style="color: rgba(255,255,255,0.35);">Share</span>
			</button>

			<!-- Publish -->
			<button
				onclick={handlePublish}
				class="flex flex-col items-center gap-1.5 group"
				title="Go to Library"
				aria-label="Publish"
			>
				<svg class="w-5 h-5 transition-colors group-hover:text-white" style="color: rgba(255,255,255,0.4);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10"/>
					<line x1="2" y1="12" x2="22" y2="12"/>
					<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
				</svg>
				<span class="text-[10px] transition-colors group-hover:text-white/70" style="color: rgba(255,255,255,0.35);">Publish</span>
			</button>

			<!-- Download -->
			<button
				onclick={handleDownload}
				class="flex flex-col items-center gap-1.5 group"
				title="Download"
				aria-label="Download"
			>
				<svg class="w-5 h-5 transition-colors group-hover:text-white" style="color: rgba(255,255,255,0.4);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
					<polyline points="7 10 12 15 17 10"/>
					<line x1="12" y1="15" x2="12" y2="3"/>
				</svg>
				<span class="text-[10px] transition-colors group-hover:text-white/70" style="color: rgba(255,255,255,0.35);">Download</span>
			</button>
		</div>

		<!-- Lyrics (scrollable, synced) -->
		{#if playerState.currentTrack.lyrics?.length}
			<div bind:this={lyricsContainerEl} class="flex-1 overflow-y-auto py-5 px-4 space-y-1 text-center" style="scrollbar-width: none;">
				{#each playerState.currentTrack.lyrics as line, i}
					<button
						data-lyric={i}
						onclick={() => playerState.setTime(line.time * 1000)}
						class="w-full px-2 py-1 rounded-lg text-center leading-relaxed transition-all duration-300 hover:bg-white/5"
						style="
							font-size: {i === playerState.currentLyricIndex ? '0.9rem' : '0.8rem'};
							font-weight: {i === playerState.currentLyricIndex ? '600' : '400'};
							color: {i === playerState.currentLyricIndex ? '#fff' : i < playerState.currentLyricIndex ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.45)'};
						"
					>
						{line.text}
					</button>
				{/each}
			</div>
		{:else}
			<div class="flex-1 flex flex-col items-center justify-center gap-2 pb-8" style="color: rgba(255,255,255,0.2);">
				<svg class="w-8 h-8 opacity-30" viewBox="0 0 24 24" fill="currentColor">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 17h8v1H8v-1zm0-3h8v1H8v-1zm0-3h5v1H8v-1z"/>
				</svg>
				<span class="text-sm">{playerState.currentTrack.isInstrumental ? 'Instrumental' : 'No lyrics'}</span>
			</div>
		{/if}
	</div>
{/if}

<!-- ─── Player Bar ─────────────────────────────────────────────────────────── -->
{#if playerState.currentTrack}
	<div
		class="fixed bottom-0 z-50 h-[72px] flex items-center px-4 gap-4 select-none"
		style="left: {leftOffset}; right: {rightOffset}; transition: left 0.3s ease, right 0.3s ease; background: rgba(13,13,15,0.97); backdrop-filter: blur(20px); border-top: 1px solid rgba(255,255,255,0.07);"
		role="region"
		aria-label="Now Playing"
	>
		<!-- LEFT: Cover + info + close -->
		<div class="flex items-center gap-3 min-w-0 shrink-0" style="width: 220px;">
			<!-- Cover art -->
			<div class="relative shrink-0 w-11 h-11 rounded-md overflow-hidden shadow-lg">
				<img
					src={playerState.currentTrack.coverUrl || DEFAULT_COVER}
					alt={playerState.currentTrack.title}
					class="w-full h-full object-cover"
					onerror={(e) => { (e.target as HTMLImageElement).src = DEFAULT_COVER; }}
				/>
			</div>

			<!-- Title + artist -->
			<div class="min-w-0 flex-1">
				<p class="text-sm font-medium text-white truncate leading-tight">{playerState.currentTrack.title}</p>
				<p class="text-xs truncate leading-tight mt-0.5" style="color: rgba(255,255,255,0.45);">
					{playerState.currentTrack.artist}
					{#if playerState.currentTrack.isInstrumental}
						<span class="ml-1 text-[10px] uppercase tracking-wider" style="color: #a78bfa;">Instr.</span>
					{/if}
				</p>
			</div>

			<!-- Like + Now Playing toggle -->
			<div class="flex items-center gap-0.5 shrink-0">
				<button
					onclick={() => playerState.toggleLike()}
					class="p-1.5 rounded-full transition-colors hover:bg-white/10"
					style="color: {playerState.isLiked ? '#f43f5e' : 'rgba(255,255,255,0.35)'};"
					title="Like"
					aria-label="Like"
				>
					<svg class="w-4 h-4" style="fill: {playerState.isLiked ? '#f43f5e' : 'none'};" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
					</svg>
				</button>
				<button
					onclick={() => playerState.toggleNowPlaying()}
					class="p-1.5 rounded-full transition-colors hover:bg-white/10"
					style="color: {playerState.showNowPlaying ? '#a78bfa' : 'rgba(255,255,255,0.35)'};"
					title="Now Playing"
					aria-label="Toggle now playing panel"
				>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 17h8v1H8v-1zm0-3h8v1H8v-1zm0-3h5v1H8v-1z"/>
					</svg>
				</button>
			</div>
		</div>

		<!-- CENTER: Controls + progress -->
		<div class="flex-1 flex flex-col items-center justify-center gap-1 min-w-0">
			<!-- Playback controls -->
			<div class="flex items-center gap-4">
				<button
					onclick={() => playerState.prev()}
					class="transition-colors disabled:opacity-30"
					style="color: rgba(255,255,255,0.55);"
					disabled={!playerState.hasPrev && playerState.currentTimeMs < 3000}
					aria-label="Previous"
				>
					<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
						<path d="M6 6h2v12H6zm3.5 6 8.5 6V6l-8.5 6z"/>
					</svg>
				</button>

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

				<button
					onclick={() => playerState.next()}
					class="transition-colors disabled:opacity-30"
					style="color: rgba(255,255,255,0.55);"
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
				<span class="text-[10px] tabular-nums w-8 text-right shrink-0" style="color: rgba(255,255,255,0.35);">
					{formatTime(playerState.currentTimeMs)}
				</span>

				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					bind:this={progressBarEl}
					class="relative flex-1 h-1 rounded-full cursor-pointer group"
					style="background: rgba(255,255,255,0.18);"
					onmousedown={onProgressMouseDown}
					role="slider"
					aria-label="Seek"
					aria-valuemin={0}
					aria-valuemax={playerState.durationMs}
					aria-valuenow={playerState.currentTimeMs}
				>
					<div
						class="absolute left-0 top-0 h-full bg-white rounded-full"
						style="width: {playerState.progressPercent}%; transition: width 0.1s linear;"
					/>
					<div
						class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity {isDraggingProgress ? '!opacity-100' : ''}"
						style="left: calc({playerState.progressPercent}% - 6px);"
					/>
				</div>

				<span class="text-[10px] tabular-nums w-8 shrink-0" style="color: rgba(255,255,255,0.35);">
					{formatTime(playerState.durationMs)}
				</span>
			</div>
		</div>

		<!-- RIGHT: Volume + stop -->
		<div class="flex items-center gap-3 justify-end shrink-0" style="width: 180px;">
			<!-- Mute toggle -->
			<button
				onclick={() => playerState.toggleMute()}
				class="transition-colors hover:text-white shrink-0"
				style="color: rgba(255,255,255,0.45);"
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
				class="relative w-20 h-1 rounded-full cursor-pointer group"
				style="background: rgba(255,255,255,0.18);"
				onmousedown={onVolumeMouseDown}
				role="slider"
				aria-label="Volume"
				aria-valuemin={0}
				aria-valuemax={1}
				aria-valuenow={playerState.volume}
			>
				<div
					class="absolute left-0 top-0 h-full rounded-full"
					style="width: {playerState.isMuted ? 0 : playerState.volume * 100}%; background: rgba(255,255,255,0.75);"
				/>
				<div
					class="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
					style="left: calc({playerState.isMuted ? 0 : playerState.volume * 100}% - 5px);"
				/>
			</div>

			<!-- Stop/close player -->
			<button
				onclick={() => playerState.stop()}
				class="p-1.5 rounded-full transition-colors hover:bg-white/10 shrink-0"
				style="color: rgba(255,255,255,0.3);"
				title="Close player"
				aria-label="Close player"
			>
				<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
					<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
				</svg>
			</button>
		</div>
	</div>
{/if}
