<script lang="ts">
	import type { PageData } from './$types.js';
	import type { VideoClip } from '$lib/server/db/schema.js';

	let { data }: { data: PageData } = $props();

	type VideoRow = {
		projectId: string;
		config: Record<string, string> | null;
		clips: VideoClip[] | null;
		createdAt: string;
		trackTitle: string | null;
		trackCoverUrl: string | null;
		trackAudioUrl: string | null;
		creatorName: string | null;
		creatorImage: string | null;
	};

	const videos = data.videos as VideoRow[];

	// Filter only videos with at least one done clip
	const published = videos.filter(v => {
		const clips = (v.clips ?? []) as VideoClip[];
		return clips.some(c => c.clipStatus === 'done' && c.clipUrl);
	});

	// Active preview (hover/click)
	let activeId    = $state<string | null>(null);
	let videoEls    = $state<Record<string, HTMLVideoElement | undefined>>({});
	let audioEls    = $state<Record<string, HTMLAudioElement | undefined>>({});
	let filterAr    = $state<'all' | '9/16' | '16/9'>('all');

	function getAr(config: Record<string, string> | null) {
		return config?.platform === 'youtube' ? '16/9' : '9/16';
	}

	const filtered = $derived(
		filterAr === 'all' ? published : published.filter(v => getAr(v.config) === filterAr)
	);

	function play(id: string) {
		if (activeId && activeId !== id) stop(activeId);
		activeId = id;
		videoEls[id]?.play().catch(() => {});
		audioEls[id]?.play().catch(() => {});
	}

	function stop(id: string) {
		videoEls[id]?.pause();
		audioEls[id]?.pause();
		if (activeId === id) activeId = null;
	}

	function firstClipUrl(clips: VideoClip[]) {
		return clips.find(c => c.clipStatus === 'done' && c.clipUrl)?.clipUrl ?? '';
	}
	function coverOrClip(v: VideoRow) {
		return v.trackCoverUrl ?? '';
	}
</script>

<div class="min-h-screen" style="background:var(--ga-dark);">
	<!-- Header -->
	<div class="border-b px-6 py-4 flex items-center gap-4" style="border-color:var(--ga-border);">
		<a href="/explore" class="text-xs opacity-60 hover:opacity-100" style="color:var(--ga-muted);">← Explore</a>
		<h1 class="text-sm font-bold" style="color:var(--ga-text);">🎬 Videos</h1>
		<span class="text-[10px] px-2 py-0.5 rounded-full" style="background:rgba(212,175,55,0.1);color:var(--ga-gold);">{published.length} videos</span>

		<!-- Format filter -->
		<div class="flex gap-1 ml-auto">
			{#each [['all','Todos'],['9/16','Vertical 9:16'],['16/9','Horizontal 16:9']] as [f, label]}
				<button onclick={() => filterAr = f as 'all'|'9/16'|'16/9'}
					class="text-[10px] px-3 py-1 rounded-full font-medium transition-all"
					style="background:{filterAr===f?'var(--ga-gold)':'rgba(255,255,255,0.05)'};color:{filterAr===f?'#000':'var(--ga-muted)'};">
					{label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Grid -->
	<div class="p-6">
		{#if filtered.length === 0}
			<div class="flex flex-col items-center justify-center py-20 gap-3">
				<span class="text-4xl opacity-20">🎬</span>
				<p class="text-sm" style="color:var(--ga-muted);">Aún no hay videos publicados</p>
				<a href="/create-video" class="text-xs px-4 py-2 rounded-lg font-bold" style="background:var(--ga-gold);color:#000;">Crear el primero →</a>
			</div>
		{:else}
			<div class="grid gap-4" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));">
				{#each filtered as v}
					{@const clips = (v.clips ?? []) as VideoClip[]}
					{@const ar = getAr(v.config)}
					{@const isActive = activeId === v.projectId}
					{@const clipUrl = firstClipUrl(clips)}

					<div class="group relative overflow-hidden rounded-2xl cursor-pointer"
						style="aspect-ratio:{ar === '9/16' ? '9/16' : '16/9'};background:#000;border:1px solid {isActive?'var(--ga-gold)':'var(--ga-border)'};box-shadow:{isActive?'0 0 16px rgba(212,175,55,0.3)':'none'};"
						onclick={() => isActive ? stop(v.projectId) : play(v.projectId)}
					>
						<!-- Cover thumbnail -->
						{#if coverOrClip(v) && !isActive}
							<img src={coverOrClip(v)} alt={v.trackTitle ?? ''}
								class="absolute inset-0 w-full h-full object-cover" />
						{/if}

						<!-- Video element -->
						{#if clipUrl}
							<video
								bind:this={videoEls[v.projectId]}
								src={clipUrl}
								muted
								loop
								playsinline
								class="absolute inset-0 w-full h-full object-cover transition-opacity"
								style="opacity:{isActive?1:0};"
							></video>
						{/if}

						<!-- Hidden audio -->
						{#if v.trackAudioUrl}
							<audio bind:this={audioEls[v.projectId]} src={v.trackAudioUrl} loop class="hidden"></audio>
						{/if}

						<!-- Overlay gradient -->
						<div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none"></div>

						<!-- Play indicator -->
						{#if !isActive}
							<div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
								<div class="w-12 h-12 rounded-full flex items-center justify-center" style="background:rgba(212,175,55,0.9);">
									<svg width="18" height="18" viewBox="0 0 14 14" fill="#000"><path d="M3 1.5l9 5.5-9 5.5V1.5z"/></svg>
								</div>
							</div>
						{:else}
							<!-- Stop indicator -->
							<div class="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center" style="background:rgba(0,0,0,0.6);">
								<svg width="8" height="8" viewBox="0 0 8 8" fill="#fff"><rect width="3" height="8" rx="0.5"/><rect x="5" width="3" height="8" rx="0.5"/></svg>
							</div>
						{/if}

						<!-- Format badge -->
						<div class="absolute top-2 left-2 text-[7px] px-1.5 py-px rounded font-bold" style="background:rgba(0,0,0,0.7);color:var(--ga-gold);">
							{ar}
						</div>

						<!-- Meta -->
						<div class="absolute bottom-0 inset-x-0 p-3">
							<p class="text-xs font-bold truncate" style="color:#fff;">{v.trackTitle ?? 'Sin título'}</p>
							<p class="text-[9px] truncate" style="color:rgba(255,255,255,0.6);">{v.creatorName ?? ''}</p>
							<div class="flex gap-1 mt-1">
								<span class="text-[7px] px-1.5 py-px rounded" style="background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7);">
									{clips.filter(c => c.clipStatus === 'done').length} clips
								</span>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
