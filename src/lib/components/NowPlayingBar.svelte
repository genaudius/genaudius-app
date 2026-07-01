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
		class="fixed bottom-0 z-50 h-[80px] flex items-center px-6 gap-6 select-none"
		style="left: {leftOffset}; right: {rightOffset}; transition: left 0.3s ease, right 0.3s ease; background: rgba(13,13,15,0.97); backdrop-filter: blur(20px); border-top: 1px solid rgba(255,255,255,0.07);"
		role="region"
		aria-label="Now Playing"
	>
		<!-- LEFT: Cover + info -->
		<div class="flex items-center gap-4 min-w-0 shrink-0" style="width: 250px;">
			<div class="relative shrink-0 w-12 h-12 rounded-md overflow-hidden shadow-lg">
				<img
					src={playerState.currentTrack.coverUrl || DEFAULT_COVER}
					alt={playerState.currentTrack.title}
					class="w-full h-full object-cover"
					onerror={(e) => { (e.target as HTMLImageElement).src = DEFAULT_COVER; }}
				/>
			</div>
			<div class="min-w-0 flex-1">
				<p class="text-sm font-semibold text-white truncate leading-tight">{playerState.currentTrack.title}</p>
				<p class="text-xs truncate leading-tight mt-1" style="color: rgba(255,255,255,0.45);">
					{playerState.currentTrack.artist}
				</p>
			</div>
		</div>

		<!-- CENTER: Streamio AudioPlayer Design -->
		<div class="flex-1 flex items-center justify-center gap-4 min-w-0">
			<!-- Previous track button -->
			<button onclick={() => playerState.prev()} class="text-gray-400 hover:text-white transition-colors" disabled={!playerState.hasPrev && playerState.currentTimeMs < 3000}>
				<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
					<path d="M6 6h2v12H6zm3.5 6 8.5 6V6l-8.5 6z"/>
				</svg>
			</button>

			<div class="audioplayer {playerState.isPlaying ? 'audioplayer-playing' : ''} flex-1 max-w-2xl">
				<!-- Play/Pause -->
				<div class="audioplayer-playpause" onclick={() => playerState.toggle()} aria-label={playerState.isPlaying ? 'Pause' : 'Play'}>
					<a href="javascript:void(0)" aria-label={playerState.isPlaying ? 'Pause' : 'Play'}></a>
				</div>
				
				<!-- Time Current -->
				<div class="audioplayer-time audioplayer-time-current">
					{formatTime(playerState.currentTimeMs)}
				</div>
				
				<!-- Progress Bar -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div 
					class="audioplayer-bar group"
					bind:this={progressBarEl}
					onmousedown={onProgressMouseDown}
				>
					<div class="audioplayer-bar-loaded" style="width: 100%;"></div>
					<div class="audioplayer-bar-played" style="width: {playerState.progressPercent}%;"></div>
				</div>
				
				<!-- Time Duration -->
				<div class="audioplayer-time audioplayer-time-duration">
					{formatTime(playerState.durationMs)}
				</div>
				
				<!-- Volume -->
				<div class="audioplayer-volume">
					<div class="audioplayer-volume-button" onclick={() => playerState.toggleMute()}>
						<a href="javascript:void(0)" style="{playerState.isMuted || playerState.volume === 0 ? 'background-color: #fd4f1a;' : ''}"></a>
					</div>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="audioplayer-volume-adjust" bind:this={volumeBarEl} onmousedown={onVolumeMouseDown}>
						<div>
							<div style="width: {playerState.isMuted ? 0 : playerState.volume * 100}%;"></div>
						</div>
					</div>
				</div>
			</div>

			<!-- Next track button -->
			<button onclick={() => playerState.next()} class="text-gray-400 hover:text-white transition-colors" disabled={!playerState.hasNext}>
				<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
					<path d="M6 18l8.5-6L6 6v12zm2.5-6 5.5 3.9V8.1L8.5 12zM16 6h2v12h-2z"/>
				</svg>
			</button>
		</div>

		<!-- RIGHT: Extra Controls -->
		<div class="flex items-center gap-3 justify-end shrink-0" style="width: 250px;">
			<button
				onclick={() => playerState.toggleLike()}
				class="p-2 rounded-full transition-colors hover:bg-white/10"
				style="color: {playerState.isLiked ? '#fd4f1a' : 'rgba(255,255,255,0.35)'};"
			>
				<svg class="w-5 h-5" style="fill: {playerState.isLiked ? '#fd4f1a' : 'none'};" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
				</svg>
			</button>
			<button
				onclick={() => playerState.toggleNowPlaying()}
				class="p-2 rounded-full transition-colors hover:bg-white/10"
				style="color: {playerState.showNowPlaying ? '#0059ff' : 'rgba(255,255,255,0.35)'};"
			>
				<svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 17h8v1H8v-1zm0-3h8v1H8v-1zm0-3h5v1H8v-1z"/>
				</svg>
			</button>
			<button
				onclick={() => playerState.stop()}
				class="p-2 rounded-full transition-colors hover:bg-white/10 text-gray-400 hover:text-white ml-2"
			>
				<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12"></path>
				</svg>
			</button>
		</div>
	</div>
{/if}
