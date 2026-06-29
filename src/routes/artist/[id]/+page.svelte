<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { playerState } from '$lib/stores/player.svelte.js';

	let { data } = $props();

	let followerCount = $state(data.followerCount);
	let isFollowing = $state(data.isFollowing);

	type TrackLikeMap = Record<string, { liked: boolean; count: number }>;
	let likeState = $state<TrackLikeMap>(
		Object.fromEntries(data.tracks.map((t) => [t.id, { liked: t.isLiked, count: t.likeCount }]))
	);

	$effect(() => {
		followerCount = data.followerCount;
		isFollowing = data.isFollowing;
		likeState = Object.fromEntries(
			data.tracks.map((t) => [t.id, { liked: t.isLiked, count: t.likeCount }])
		);
	});

	// ─── Follow/Unfollow ──────────────────────────────────────────────────────────
	async function toggleFollow() {
		if (!data.currentUserId) {
			toast.error('Sign in to follow artists');
			return;
		}

		const wasFollowing = isFollowing;
		isFollowing = !wasFollowing;
		followerCount += wasFollowing ? -1 : 1;

		try {
			const res = await fetch(`/api/artist/${data.artist.id}/follow`, { method: 'POST' });
			if (!res.ok) {
				isFollowing = wasFollowing;
				followerCount += wasFollowing ? 1 : -1;
				toast.error('Action failed');
			}
		} catch {
			isFollowing = wasFollowing;
			followerCount += wasFollowing ? 1 : -1;
		}
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
					artist: data.artist.name || 'Unknown',
					artistId: data.artist.id,
					coverUrl: t.coverUrl ?? undefined,
					audioUrl: t.audioUrl!,
					durationMs: t.durationMs ?? undefined,
					model: t.model ?? undefined,
					isInstrumental: t.isInstrumental,
				})),
			data.tracks.filter((t) => t.audioUrl).findIndex((t) => t.id === track.id)
		);
		fetch(`/api/publications/${track.id}/play`, { method: 'POST' }).catch(() => {});
	}

	// ─── Toggle like ──────────────────────────────────────────────────────────────
	async function toggleLike(trackId: string) {
		if (!data.currentUserId) { toast.error('Sign in to like tracks'); return; }
		const current = likeState[trackId];
		likeState[trackId] = { liked: !current.liked, count: current.count + (current.liked ? -1 : 1) };
		const res = await fetch(`/api/publications/${trackId}/like`, { method: 'POST' });
		if (!res.ok) likeState[trackId] = current;
	}

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

	const DEFAULT_AVATAR = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#141718"/><circle cx="24" cy="20" r="8" fill="#d6c806" opacity="0.6"/><ellipse cx="24" cy="38" rx="14" ry="10" fill="#d6c806" opacity="0.4"/></svg>')}`;
</script>

<svelte:head>
	<title>{data.artist.name || 'Artist'} — GenAudius</title>
</svelte:head>

<div class="min-h-full" style="background: var(--ga-dark); color: var(--ga-text);">
	<!-- Banner -->
	<div
		class="relative h-52 overflow-hidden"
		style={data.profile?.bannerUrl
			? `background-image: url('${data.profile.bannerUrl}'); background-size: cover; background-position: center`
			: 'background: linear-gradient(135deg, #0a0a0a 0%, #141411 50%, #1a1a0a 100%); border-bottom: 1px solid #d6c80620;'}
	>
		<div class="absolute inset-0" style="background: linear-gradient(to top, var(--ga-dark) 0%, transparent 60%)" />
	</div>

	<!-- Artist info -->
	<div class="max-w-5xl mx-auto px-6 -mt-16 relative z-10 pb-8">
		<div class="flex items-end gap-5 mb-6">
			<!-- Avatar -->
			<img
				src={data.artist.image || DEFAULT_AVATAR}
				alt={data.artist.name || 'Artist'}
				class="w-28 h-28 rounded-full shadow-2xl object-cover shrink-0"
				style="border: 3px solid var(--ga-gold);"
				onerror={(e) => { (e.target as HTMLImageElement).src = DEFAULT_AVATAR; }}
			/>

			<div class="pb-2 flex-1 min-w-0">
				<div class="flex items-center gap-2">
					<h1 class="text-2xl font-bold truncate">{data.artist.name || 'Unknown Artist'}</h1>
					{#if data.profile?.isVerified}
						<span style="color: var(--ga-gold);" title="Verified Artist">✓</span>
					{/if}
				</div>

				{#if data.profile?.genres?.length}
					<div class="flex gap-1 mt-1.5 flex-wrap">
						{#each data.profile.genres as genre}
							<span class="text-xs px-2 py-0.5 rounded-full" style="background: rgba(214,200,6,0.1); color: var(--ga-gold);">{genre}</span>
						{/each}
					</div>
				{/if}

				<div class="flex items-center gap-5 mt-2 text-sm" style="color: var(--ga-muted);">
					<span><strong style="color: var(--ga-text);">{followerCount}</strong> followers</span>
					<span><strong style="color: var(--ga-text);">{data.followingCount}</strong> following</span>
					<span><strong style="color: var(--ga-text);">{data.tracks.length}</strong> tracks</span>
				</div>
			</div>

			<!-- Actions -->
			{#if !data.isOwnProfile && data.currentUserId}
				<button
					onclick={toggleFollow}
					class="px-6 py-2 rounded-full text-sm font-bold transition-all"
					style={isFollowing
						? `border: 1px solid var(--ga-border); color: var(--ga-muted); background: transparent;`
						: `background: var(--ga-gold); color: #000;`}
				>
					{isFollowing ? 'Following' : 'Follow'}
				</button>
			{/if}

			{#if data.isOwnProfile}
				<a
					href="/settings/profile"
					class="px-5 py-2 rounded-full text-sm font-medium transition-colors"
					style="border: 1px solid var(--ga-border); color: var(--ga-muted); background: transparent;"
				>
					Edit Profile
				</a>
			{/if}
		</div>

		{#if data.profile?.bio}
			<p class="text-sm mb-4 max-w-2xl" style="color: var(--ga-muted);">{data.profile.bio}</p>
		{/if}

		<!-- Social Links -->
		{#if data.profile?.socialLinks && Object.keys(data.profile.socialLinks as Record<string,string>).length > 0}
			{@const links = data.profile.socialLinks as Record<string, string>}
			<div class="flex items-center gap-3 mb-6 flex-wrap">
				{#if links.twitter}
					<a
						href="https://x.com/{links.twitter.replace('@', '')}"
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-opacity hover:opacity-80"
						style="background: rgba(255,255,255,0.06); color: var(--ga-muted);"
					>𝕏 {links.twitter}</a>
				{/if}
				{#if links.instagram}
					<a
						href="https://instagram.com/{links.instagram.replace('@', '')}"
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-opacity hover:opacity-80"
						style="background: rgba(255,255,255,0.06); color: var(--ga-muted);"
					>📸 {links.instagram}</a>
				{/if}
				{#if links.soundcloud}
					<a
						href="https://{links.soundcloud}"
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-opacity hover:opacity-80"
						style="background: rgba(255,255,255,0.06); color: var(--ga-muted);"
					>☁️ SoundCloud</a>
				{/if}
			</div>
		{/if}

		<!-- Tracks -->
		{#if data.tracks.length === 0}
			<div class="text-center py-16" style="color: var(--ga-muted);">
				<div class="text-5xl mb-4">🎵</div>
				<p>No public tracks yet</p>
				{#if data.isOwnProfile}
					<a href="/create" class="inline-block mt-4 px-6 py-3 rounded-xl font-bold text-sm transition-opacity hover:opacity-90" style="background: var(--ga-gold); color: #000;">
						Create your first track
					</a>
				{/if}
			</div>
		{:else}
			<div class="space-y-1">
				<!-- Tracks header -->
				<div class="flex items-center gap-4 px-4 pb-2 text-xs font-medium" style="color: var(--ga-muted); border-bottom: 1px solid var(--ga-border);">
					<span class="w-8 text-center">#</span>
					<span class="w-10 shrink-0"></span>
					<span class="flex-1">Title</span>
					<span class="hidden sm:block w-20 text-right">Plays</span>
					<span class="hidden sm:block w-16 text-right">Added</span>
					<span class="hidden sm:block w-12 text-right">Time</span>
					<span class="w-12 text-right"></span>
				</div>

				{#each data.tracks as track, i}
					<div class="group flex items-center gap-4 px-4 py-2.5 rounded-lg transition-colors cursor-pointer" style="--hover-bg: rgba(214,200,6,0.04);"
						onmouseenter={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(214,200,6,0.04)'}
						onmouseleave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
					>
						<!-- Index / Play -->
						<div class="w-8 text-center shrink-0 relative h-5">
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
								<div class="w-full h-full flex items-center justify-center" style="opacity: 0.3;">🎵</div>
							{/if}
						</div>

						<!-- Info -->
						<div class="flex-1 min-w-0">
							<p class="text-sm font-medium truncate">{track.title}</p>
							<div class="flex items-center gap-2 text-xs mt-0.5" style="color: var(--ga-muted);">
								{#if track.model}
									<span class="font-mono">{track.model.replace('suno-', 'S')}</span>
								{/if}
								{#if track.tags}
									<span class="truncate" style="opacity: 0.6;">{track.tags}</span>
								{/if}
							</div>
						</div>

						<!-- Stats -->
						<div class="flex items-center gap-4 text-xs shrink-0" style="color: var(--ga-muted);">
							<span class="hidden sm:block w-20 text-right">▶ {track.playCount}</span>
							<span class="hidden sm:block w-16 text-right">{timeAgo(track.createdAt)}</span>
							{#if track.durationMs}
								<span class="hidden sm:block w-12 text-right font-mono">{formatDuration(track.durationMs)}</span>
							{/if}

							<button
								onclick={() => toggleLike(track.id)}
								class="w-12 text-right transition-colors"
								style={likeState[track.id]?.liked ? 'color: var(--ga-pink);' : ''}
								aria-label="Like"
							>
								{likeState[track.id]?.liked ? '♥' : '♡'} {likeState[track.id]?.count ?? track.likeCount}
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
