<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { playerState } from '$lib/stores/player.svelte.js';
	import { goto } from '$app/navigation';

	let { data } = $props();

	// ─── Filters ─────────────────────────────────────────────────────────────────
	let activeType = $state<'all' | 'music' | 'video' | 'image'>('all');
	let activeView = $state<'all' | 'public' | 'private'>('all');

	let filtered = $derived(
		data.tracks.filter((t) => {
			if (activeType !== 'all' && t.type !== activeType) return false;
			if (activeView === 'public' && !t.isPublic) return false;
			if (activeView === 'private' && t.isPublic) return false;
			return true;
		})
	);

	// ─── Track state (isPublic toggle) ────────────────────────────────────────────
	type TrackVis = Record<string, boolean>;
	let visibility = $state<TrackVis>(
		Object.fromEntries(data.tracks.map((t) => [t.id, t.isPublic]))
	);

	// ─── Format helpers ───────────────────────────────────────────────────────────
	function formatDuration(ms: number | null): string {
		if (!ms) return '';
		const s = Math.floor(ms / 1000);
		return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
	}

	function timeAgo(date: string): string {
		const diff = Date.now() - new Date(date).getTime();
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
			filtered
				.filter((t) => t.audioUrl)
				.map((t) => ({
					id: t.id,
					publicationId: t.id,
					title: t.title,
					artist: data.userName || 'Me',
					coverUrl: t.coverUrl ?? undefined,
					audioUrl: t.audioUrl!,
					durationMs: t.durationMs ?? undefined,
					lyrics: (t.lyrics as Array<{ time: number; text: string }> | null) ?? undefined,
					model: t.model ?? undefined,
					isInstrumental: t.isInstrumental,
				})),
			filtered.filter((t) => t.audioUrl).findIndex((t) => t.id === track.id)
		);
		fetch(`/api/publications/${track.id}/play`, { method: 'POST' }).catch(() => {});
	}

	// ─── Toggle public/private ────────────────────────────────────────────────────
	async function toggleVisibility(trackId: string) {
		const current = visibility[trackId];
		visibility[trackId] = !current;
		try {
			const res = await fetch(`/api/publications/${trackId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isPublic: !current }),
			});
			if (!res.ok) {
				visibility[trackId] = current;
				toast.error('Failed to update visibility');
			} else {
				toast.success(!current ? 'Published to Explore' : 'Set to private');
			}
		} catch {
			visibility[trackId] = current;
		}
	}

	// ─── Delete track ─────────────────────────────────────────────────────────────
	async function deleteTrack(trackId: string) {
		if (!confirm('Delete this track? This cannot be undone.')) return;
		try {
			const res = await fetch(`/api/publications/${trackId}`, { method: 'DELETE' });
			if (res.ok) {
				toast.success('Track deleted');
				// Redirect to reload
				goto('/library', { invalidateAll: true });
			} else {
				toast.error('Failed to delete');
			}
		} catch {
			toast.error('Failed to delete');
		}
	}

	const counts = $derived({
		all: data.tracks.length,
		music: data.tracks.filter((t) => t.type === 'music').length,
		video: data.tracks.filter((t) => t.type === 'video').length,
		image: data.tracks.filter((t) => t.type === 'image').length,
		public: data.tracks.filter((t) => t.isPublic).length,
		private: data.tracks.filter((t) => !t.isPublic).length,
	});
</script>

<svelte:head>
	<title>Library — GenAudius</title>
</svelte:head>

<div class="min-h-full" style="background: var(--ga-dark); color: var(--ga-text);">
	<!-- Header -->
	<div class="sticky top-0 z-10" style="background: rgba(7,7,7,0.92); backdrop-filter: blur(12px); border-bottom: 1px solid var(--ga-border);">
		<div class="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
			<div>
				<h1 class="text-2xl font-bold tracking-tight">My Library</h1>
				<p class="text-sm mt-0.5" style="color: var(--ga-muted);">{counts.all} track{counts.all !== 1 ? 's' : ''} · {counts.public} public · {counts.private} private</p>
			</div>
			<a
				href={activeType === 'image' || activeType === 'video' ? '/image-video' : '/create'}
				class="px-4 py-2 rounded-lg text-sm font-bold transition-opacity hover:opacity-90"
				style="background: var(--ga-gold); color: #000;"
			>
				+ {activeType === 'image' ? 'Create Image' : activeType === 'video' ? 'Create Video' : 'Create Music'}
			</a>
		</div>

		<!-- Filter bar -->
		<div class="max-w-5xl mx-auto px-6 pb-0 flex items-center justify-between">
			<!-- Type tabs -->
			<div class="flex gap-1">
				{#each [['all', 'All', counts.all], ['music', '🎵 Music', counts.music], ['video', '🎬 Video', counts.video], ['image', '🖼 Images', counts.image]] as [type, label, count]}
					<button
						class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5"
						style={activeType === type
							? 'border-color: var(--ga-gold); color: var(--ga-gold);'
							: 'border-color: transparent; color: var(--ga-muted);'}
						onclick={() => (activeType = type as typeof activeType)}
					>
						{label}
						<span class="text-xs px-1.5 py-0.5 rounded-full" style="background: rgba(255,255,255,0.06);">{count}</span>
					</button>
				{/each}
			</div>

			<!-- Visibility filter -->
			<div class="flex gap-2 pb-2">
				{#each [['all', 'All'], ['public', '🌐 Public'], ['private', '🔒 Private']] as [view, label]}
					<button
						class="px-3 py-1.5 text-xs rounded-lg transition-all font-medium"
						style={activeView === view
							? 'background: var(--ga-purple); color: #fff;'
							: `border: 1px solid var(--ga-border); color: var(--ga-muted); background: transparent;`}
						onclick={() => (activeView = view as typeof activeView)}
					>
						{label}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<div class="max-w-5xl mx-auto px-6 py-8">
		{#if filtered.length === 0}
			<div class="text-center py-24" style="color: var(--ga-muted);">
				<div class="text-5xl mb-4">
					{activeType === 'music' ? '🎵' : activeType === 'video' ? '🎬' : activeType === 'image' ? '🖼' : '📂'}
				</div>
				<p class="text-lg font-medium" style="color: var(--ga-text);">
					{data.tracks.length === 0 ? 'No tracks yet' : 'No tracks match this filter'}
				</p>
				{#if data.tracks.length === 0}
					<p class="text-sm mt-1">Generate your first track to get started.</p>
					<a href={activeType === 'image' || activeType === 'video' ? '/image-video' : '/create'} class="inline-block mt-6 px-6 py-3 rounded-xl font-bold transition-opacity hover:opacity-90" style="background: var(--ga-gold); color: #000;">
						{activeType === 'image' ? 'Create Image' : activeType === 'video' ? 'Create Video' : 'Create Music'}
					</a>
				{/if}
			</div>
		{:else}
			<!-- Track list -->
			<div class="space-y-1">
				<!-- Header row -->
				<div class="grid items-center gap-4 px-4 pb-2 text-xs font-medium" style="grid-template-columns: 40px 40px 1fr 80px 80px 60px 120px; color: var(--ga-muted); border-bottom: 1px solid var(--ga-border);">
					<span>#</span>
					<span></span>
					<span>Title</span>
					<span class="hidden md:block text-right">Plays</span>
					<span class="hidden md:block text-right">Created</span>
					<span class="hidden md:block text-right">Time</span>
					<span class="text-right">Actions</span>
				</div>

				{#each filtered as track, i}
					<div
						class="group grid items-center gap-4 px-4 py-2.5 rounded-lg transition-colors"
						style="grid-template-columns: 40px 40px 1fr 80px 80px 60px 120px;"
						onmouseenter={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(214,200,6,0.04)'}
						onmouseleave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
					>
						<!-- Index / Play -->
						<div class="text-center relative h-5">
							<span class="text-sm group-hover:invisible" style="color: var(--ga-muted);">{i + 1}</span>
							{#if track.audioUrl}
								<button
									onclick={() => playTrack(track)}
									class="absolute inset-0 hidden group-hover:flex items-center justify-center"
									style="color: var(--ga-gold);"
									aria-label="Play"
								>
									▶
								</button>
							{/if}
						</div>

						<!-- Cover -->
						<div class="w-10 h-10 rounded-md overflow-hidden shrink-0" style="background: var(--ga-box2);">
							{#if track.coverUrl}
								<img src={track.coverUrl} alt="" class="w-full h-full object-cover" />
							{:else}
								<div class="w-full h-full flex items-center justify-center text-sm" style="opacity: 0.3;">
									{track.type === 'video' ? '🎬' : track.type === 'image' ? '🖼' : '🎵'}
								</div>
							{/if}
						</div>

						<!-- Title + meta -->
						<div class="min-w-0">
							<p class="text-sm font-medium truncate">{track.title}</p>
							<div class="flex items-center gap-2 mt-0.5">
								<!-- Visibility badge -->
								<span
									class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
									style={visibility[track.id]
										? 'background: rgba(214,200,6,0.12); color: var(--ga-gold);'
										: 'background: rgba(255,255,255,0.06); color: var(--ga-muted);'}
								>
									{visibility[track.id] ? '🌐 Public' : '🔒 Private'}
								</span>
								{#if track.model}
									<span class="text-[10px] font-mono" style="color: var(--ga-muted);">{track.model.replace('suno-', 'S')}</span>
								{/if}
								{#if track.isInstrumental}
									<span class="text-[10px]" style="color: var(--ga-muted);">Instrumental</span>
								{/if}
							</div>
						</div>

						<!-- Plays -->
						<div class="hidden md:block text-right text-xs" style="color: var(--ga-muted);">
							▶ {track.playCount}
						</div>

						<!-- Date -->
						<div class="hidden md:block text-right text-xs" style="color: var(--ga-muted);">
							{timeAgo(track.createdAt)}
						</div>

						<!-- Duration -->
						<div class="hidden md:block text-right text-xs font-mono" style="color: var(--ga-muted);">
							{formatDuration(track.durationMs)}
						</div>

						<!-- Actions -->
						<div class="flex items-center justify-end gap-2">
							<!-- Publish/Unpublish toggle -->
							<button
								onclick={() => toggleVisibility(track.id)}
								class="text-xs px-2 py-1 rounded-md transition-all"
								style={visibility[track.id]
									? 'border: 1px solid var(--ga-border); color: var(--ga-muted);'
									: 'background: var(--ga-gold); color: #000; font-weight: 600;'}
								title={visibility[track.id] ? 'Make private' : 'Publish'}
							>
								{visibility[track.id] ? 'Unpublish' : 'Publish'}
							</button>

							<!-- Delete -->
							<button
								onclick={() => deleteTrack(track.id)}
								class="text-xs px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-all"
								style="border: 1px solid rgba(253,54,88,0.3); color: var(--ga-pink);"
								title="Delete track"
							>
								✕
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
