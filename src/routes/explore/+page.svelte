<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { playerState } from '$lib/stores/player.svelte.js';

	let { data } = $props();

	// ─── Local like state (optimistic UI) ─────────────────────────────────────────
	type TrackLikeMap = Record<string, { liked: boolean; count: number }>;
	let likeState = $state<TrackLikeMap>(
		Object.fromEntries(data.tracks.map((t) => [t.id, { liked: t.isLiked, count: t.likeCount }]))
	);

	$effect(() => {
		likeState = Object.fromEntries(
			data.tracks.map((t) => [t.id, { liked: t.isLiked, count: t.likeCount }])
		);
	});

	// ─── Format helpers ───────────────────────────────────────────────────────────
	function formatDuration(ms: number | null): string {
		if (!ms) return '';
		const s = Math.floor(ms / 1000);
		return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
	}

	function timeAgo(date: Date | string): string {
		const d = new Date(date);
		const diff = Date.now() - d.getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		return `${Math.floor(hrs / 24)}d ago`;
	}

	// ─── Play track ───────────────────────────────────────────────────────────────
	function playTrack(track: typeof data.tracks[0]) {
		if (!track.audioUrl) return;

		playerState.setQueue(
			data.tracks
				.filter((t) => t.audioUrl)
				.map((t) => ({
					id: t.id,
					publicationId: t.id,
					title: t.title,
					artist: t.artistName || 'Unknown Artist',
					coverUrl: t.coverUrl ?? undefined,
					audioUrl: t.audioUrl!,
					durationMs: t.durationMs ?? undefined,
					model: t.model ?? undefined,
					isInstrumental: t.isInstrumental,
				})),
			data.tracks.filter((t) => t.audioUrl).findIndex((t) => t.id === track.id)
		);

		// Increment play count (fire-and-forget)
		fetch(`/api/publications/${track.id}/play`, { method: 'POST' }).catch(() => {});
	}

	// ─── Toggle like ──────────────────────────────────────────────────────────────
	async function toggleLike(trackId: string) {
		if (!data.userId) {
			toast.error('Sign in to like tracks');
			return;
		}

		const current = likeState[trackId];
		// Optimistic update
		likeState[trackId] = {
			liked: !current.liked,
			count: current.count + (current.liked ? -1 : 1),
		};

		try {
			const res = await fetch(`/api/publications/${trackId}/like`, { method: 'POST' });
			const json = await res.json();
			if (!res.ok) {
				// Revert
				likeState[trackId] = current;
				toast.error('Failed to like');
			}
		} catch {
			likeState[trackId] = current;
		}
	}

	// ─── Nav helpers ──────────────────────────────────────────────────────────────
	function setFilter(key: string, value: string) {
		const params = new URLSearchParams(page.url.searchParams);
		params.set(key, value);
		goto(`/explore?${params}`);
	}

	const DEFAULT_COVER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none"><rect width="48" height="48" rx="6" fill="#1e1b4b"/><circle cx="24" cy="24" r="10" stroke="#7c3aed" stroke-width="2" fill="none"/><circle cx="24" cy="24" r="3" fill="#7c3aed"/></svg>')}`;
</script>

<svelte:head>
	<title>Explore — GenAudius</title>
</svelte:head>

<div class="min-h-full" style="background: var(--ga-dark); color: var(--ga-text);">
	<!-- Header + filters -->
	<div class="sticky top-0 z-10" style="background: rgba(7,7,7,0.92); backdrop-filter: blur(12px); border-bottom: 1px solid var(--ga-border);">
		<div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
			<div>
				<h1 class="text-2xl font-bold tracking-tight">Explore</h1>
				<p class="text-sm mt-0.5" style="color: var(--ga-muted);">Discover AI-generated music from the community</p>
			</div>
			<a href="/create" class="px-4 py-2 rounded-lg text-sm font-bold transition-opacity hover:opacity-90" style="background: var(--ga-gold); color: #000;">
				+ Create
			</a>
		</div>

		<!-- Filter bar -->
		<div class="max-w-6xl mx-auto px-6 pb-0 flex items-center gap-6">
			<div class="flex gap-1">
				{#each [['music', '🎵 Music'], ['video', '🎬 Video'], ['image', '🖼 Images']] as [type, label]}
					<button
						class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors"
						style={data.activeType === type
							? 'border-color: var(--ga-gold); color: var(--ga-gold);'
							: 'border-color: transparent; color: var(--ga-muted);'}
						onclick={() => setFilter('type', type)}
					>
						{label}
					</button>
				{/each}
			</div>

			<div class="flex-1" />

			<div class="flex gap-2 pb-2">
				{#each [['new', 'New'], ['trending', '🔥 Trending']] as [sort, label]}
					<button
						class="px-3 py-1.5 text-xs rounded-lg transition-all font-medium"
						style={data.activeSort === sort
							? 'background: var(--ga-pink); color: #fff;'
							: `border: 1px solid var(--ga-border); color: var(--ga-muted); background: transparent;`}
						onclick={() => setFilter('sort', sort)}
					>
						{label}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<div class="max-w-6xl mx-auto px-6 py-8">
		{#if data.tracks.length === 0}
			<div class="text-center py-24" style="color: var(--ga-muted);">
				<div class="text-5xl mb-4">🎵</div>
				<p class="text-lg font-medium" style="color: var(--ga-text);">No tracks yet</p>
				<p class="text-sm mt-1">Be the first to create and publish a track!</p>
				<a href="/create" class="inline-block mt-6 px-6 py-3 rounded-xl font-semibold transition-opacity hover:opacity-90" style="background: var(--ga-gold); color: #000;">
					Create Music
				</a>
			</div>
		{:else}
			<!-- Track grid -->
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
				{#each data.tracks as track (track.id)}
					<div class="group rounded-2xl overflow-hidden transition-all" style="border: 1px solid var(--ga-border); background: var(--ga-box);">
						<!-- Cover art / thumbnail -->
						<div class="relative aspect-square overflow-hidden" style="background: var(--ga-box2);">
							{#if track.coverUrl}
								<img
									src={track.coverUrl}
									alt={track.title}
									class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
									onerror={(e) => { (e.target as HTMLImageElement).src = DEFAULT_COVER; }}
								/>
							{:else}
								<div class="w-full h-full flex items-center justify-center">
									<span class="text-6xl" style="opacity: 0.2;">🎵</span>
								</div>
							{/if}

							<!-- Play overlay -->
							{#if track.audioUrl}
								<button
									onclick={() => playTrack(track)}
									class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
									aria-label="Play {track.title}"
								>
									<div class="w-14 h-14 rounded-full flex items-center justify-center shadow-xl hover:scale-105 transition-transform" style="background: var(--ga-gold);">
										<svg class="w-6 h-6 ml-0.5" viewBox="0 0 24 24" fill="black">
											<path d="M8 5v14l11-7z"/>
										</svg>
									</div>
								</button>
							{/if}

							{#if track.durationMs}
								<span class="absolute bottom-2 right-2 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded font-mono">
									{formatDuration(track.durationMs)}
								</span>
							{/if}
						</div>

						<!-- Track info -->
						<div class="p-3 space-y-2">
							<div>
								<h3 class="font-semibold text-sm truncate">{track.title}</h3>
								<button
									onclick={() => goto(`/artist/${track.userId}`)}
									class="text-xs truncate max-w-full text-left hover:opacity-80 transition-opacity"
									style="color: var(--ga-muted);"
								>
									{track.artistName || 'Unknown Artist'}
								</button>
							</div>

							{#if track.tags}
								<p class="text-[10px] truncate" style="color: var(--ga-gold); opacity: 0.7;">{track.tags}</p>
							{/if}

							<div class="flex items-center justify-between pt-1">
								<div class="flex items-center gap-3 text-xs" style="color: var(--ga-muted);">
									<span>▶ {track.playCount}</span>
									<span>{timeAgo(track.createdAt)}</span>
								</div>

								<button
									onclick={() => toggleLike(track.id)}
									class="flex items-center gap-1 text-xs transition-colors"
									style={likeState[track.id]?.liked ? 'color: var(--ga-pink);' : 'color: var(--ga-muted);'}
									aria-label="Like"
								>
									{likeState[track.id]?.liked ? '♥' : '♡'}
									<span>{likeState[track.id]?.count ?? track.likeCount}</span>
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
