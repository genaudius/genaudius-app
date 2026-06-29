<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import type { VideoScene, VideoSceneWithImage, VideoClip } from '$lib/server/db/schema.js';

	let { data } = $props();

	type Step = 'config' | 'script' | 'storyboard' | 'rendering' | 'editor' | 'done';

	// Project state (synced with DB)
	let projectId = $state<string | null>(data.project?.id ?? null);
	const VALID_STEPS = new Set<string>(['config','script','storyboard','rendering','editor','done']);
	const savedStatus = data.project?.status ?? '';
	let step = $state<Step>(VALID_STEPS.has(savedStatus) ? (savedStatus as Step) : 'config');
	let script = $state<VideoScene[]>((data.project?.script as VideoScene[]) ?? []);
	let scenes = $state<(VideoSceneWithImage & { errorMsg?: string })[]>((data.project?.scenes as VideoSceneWithImage[]) ?? []);
	let clips = $state<VideoClip[]>((data.project?.clips as VideoClip[]) ?? []);
	let finalVideoUrl = $state<string | null>(data.project?.finalVideoUrl ?? null);

	let isLoading = $state(false);
	let loadingMsg = $state('');
	let error = $state('');

	// ── Async clip polling: refresh DB state while clips are 'generating' ─────
	$effect(() => {
		const pid = projectId;
		if (!pid) return;
		// Only poll when on rendering step and some clip is pending from webhook
		const hasPending = clips.some(c => (c as VideoClip).clipStatus === 'generating' && (c as VideoClip).taskId);
		if (!hasPending) return;

		const interval = setInterval(async () => {
			const res = await fetch(`/api/video-projects/${pid}`);
			if (!res.ok) return;
			const data = await res.json() as { clips?: VideoClip[]; status?: string };
			if (data.clips) clips = data.clips;
			if (data.status === 'editor') { step = 'editor'; clearInterval(interval); }
			// Stop polling if nothing generating anymore
			if (!data.clips?.some(c => c.clipStatus === 'generating')) clearInterval(interval);
		}, 5000);

		return () => clearInterval(interval);
	});

	// ── Timeline editor: audio is the master clock ────────────────────────────
	import { tick } from 'svelte';

	// Two video elements for crossfade transitions (A/B swap)
	let videoA = $state<HTMLVideoElement | undefined>(undefined);
	let videoB = $state<HTMLVideoElement | undefined>(undefined);
	let activeVid = $state<0 | 1>(0); // which video is visible

	let previewAudioEl = $state<HTMLAudioElement | undefined>(undefined);
	let timelineEl = $state<HTMLDivElement | undefined>(undefined);
	let currentClipIndex = $state(0);
	let masterTime = $state(0);
	let isPlaying = $state(false);
	let atEnd = $state(false); // reached totalSec

	// AI agent panel
	let aiPanelScene = $state<number | null>(null); // null = closed
	let aiPromptText = $state('');
	let aiLoading = $state(false);

	function getActive()   { return activeVid === 0 ? videoA : videoB; }
	function getInactive() { return activeVid === 0 ? videoB : videoA; }

	const doneClips = $derived(clips.filter(c => (c as VideoClip).clipStatus === 'done' && (c as VideoClip).clipUrl));
	const totalSec = $derived(doneClips.length ? (doneClips[doneClips.length - 1] as VideoClip).endSec : 0);

	function getActiveClip(t: number) {
		for (let i = 0; i < doneClips.length; i++) {
			const c = doneClips[i] as VideoClip;
			if (t >= c.startSec && t < c.endSec) return { clip: c, index: i, offset: t - c.startSec };
		}
		return null;
	}

	// Crossfade: load next clip into inactive video, then swap opacity
	function switchClip(index: number, offset: number) {
		const clip = doneClips[index] as VideoClip;
		if (!clip?.clipUrl) return;

		const active = getActive();
		if (index === currentClipIndex) {
			if (active && Math.abs(active.currentTime - offset) > 0.3)
				active.currentTime = offset;
			return;
		}

		const inactive = getInactive();
		if (!inactive) return;

		// Load new clip into the hidden video
		inactive.src = clip.clipUrl;
		inactive.load();
		inactive.currentTime = offset;
		inactive.muted = true;
		if (isPlaying) inactive.play().catch(() => {});

		// Swap: CSS opacity transition handles the crossfade visually
		currentClipIndex = index;
		activeVid = activeVid === 0 ? 1 : 0;

		// Pause the old video after the crossfade completes (400ms)
		const old = active;
		setTimeout(() => { old?.pause(); }, 400);
	}

	// Audio timeupdate → master clock for everything
	function onAudioTimeUpdate() {
		if (!previewAudioEl) return;
		const t = previewAudioEl.currentTime;

		// Hard stop at end of video project — audio must not run past clips
		if (totalSec > 0 && t >= totalSec) {
			previewAudioEl.pause();
			previewAudioEl.currentTime = totalSec;
			getActive()?.pause();
			masterTime = totalSec;
			isPlaying = false;
			atEnd = true;
			return;
		}

		masterTime = t;
		const active = getActiveClip(t);
		if (active) switchClip(active.index, active.offset);
	}

	function onAudioPlay()  { isPlaying = true; atEnd = false; getActive()?.play().catch(() => {}); }
	function onAudioPause() { isPlaying = false; getActive()?.pause(); }
	function onAudioEnded() { isPlaying = false; atEnd = true; }

	function togglePlay() {
		if (!previewAudioEl) return;
		if (atEnd) {
			// Replay from beginning
			atEnd = false;
			masterTime = 0;
			currentClipIndex = 0;
			previewAudioEl.currentTime = 0;
			const first = doneClips[0] as VideoClip;
			if (first?.clipUrl) {
				const active = getActive();
				if (active) { active.src = first.clipUrl; active.load(); active.currentTime = 0; }
			}
			previewAudioEl.play().catch(() => {});
			return;
		}
		if (isPlaying) previewAudioEl.pause();
		else previewAudioEl.play().catch(() => {});
	}

	function seekTo(t: number) {
		const clamped = Math.max(0, Math.min(t, totalSec));
		atEnd = false;
		if (previewAudioEl) previewAudioEl.currentTime = clamped;
		const active = getActiveClip(clamped);
		if (active) switchClip(active.index, active.offset);
	}

	// Initialise first clip when video elements mount
	$effect(() => {
		const a = videoA;
		if (!a || !doneClips.length) return;
		const first = doneClips[0] as VideoClip;
		if (!a.src && first.clipUrl) { a.src = first.clipUrl; a.load(); }
	});

	// ── AI Scene Editor ────────────────────────────────────────────────────────
	async function runAiSceneEdit(sceneIndex: number) {
		if (!projectId || !aiPromptText.trim()) return;
		aiLoading = true;
		try {
			const res = await fetch(`/api/video-projects/${projectId}/ai-scene-edit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sceneIndex, userRequest: aiPromptText }),
			});
			const d = await res.json() as { newPrompt?: string; newCameraMovement?: string; error?: string };
			if (!res.ok || d.error) { toast.error(d.error ?? 'Error al editar escena'); return; }
			// Refresh scenes from server
			const proj = await fetch(`/api/video-projects/${projectId}`).then(r => r.json()) as { scenes?: typeof scenes };
			if (proj.scenes) scenes = proj.scenes as typeof scenes;
			toast.success('✓ Escena actualizada — regenerando imagen y clip...');
			aiPromptText = '';
			aiPanelScene = null;
			// Regenerate this scene's storyboard image + clip
			await generateSceneImage(sceneIndex);
		} finally {
			aiLoading = false;
		}
	}

	// Generate a single storyboard image (reused from main storyboard flow)
	async function generateSceneImage(i: number) {
		if (!projectId) return;
		const res = await fetch(`/api/video-projects/${projectId}/storyboard`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sceneIndex: i }),
		});
		const d = await res.json() as { scene?: { imageUrl?: string }; error?: string };
		if (d.scene?.imageUrl) {
			scenes[i] = { ...scenes[i], imageUrl: d.scene.imageUrl, imageStatus: 'done' };
			clips[i] = { ...clips[i], imageUrl: d.scene.imageUrl };
		}
	}

	function onTimelineClick(e: MouseEvent) {
		if (!timelineEl) return;
		const rect = timelineEl.getBoundingClientRect();
		seekTo(((e.clientX - rect.left) / rect.width) * totalSec);
	}

	// ── Config step state ──────────────────────────────────────────────────────
	type Platform = 'reels' | 'youtube';
	let platform = $state<Platform>('reels');
	let videoDuration = $state<'15' | '30' | '60' | 'full'>('30');
	let hookEnabled = $state(false);
	let hookText = $state('');
	let hookTimingHint = $state('');
	let detectingHook = $state(false);
	let hookAiDetected = $state(false);

	function getNumScenes(dSec: number) { return Math.max(3, Math.min(10, Math.round(dSec / 6))); }
	function durationLabel(d: typeof videoDuration) {
		return d === '15' ? '15 seg' : d === '30' ? '30 seg' : d === '60' ? '1 min' : 'Completa';
	}
	const trackDurSec = $derived(Math.floor((track.durationMs ?? 180_000) / 1_000));
	const configDurSec = $derived(videoDuration === 'full' ? trackDurSec : parseInt(videoDuration));
	const previewScenes = $derived(getNumScenes(configDurSec));

	async function toggleHook() {
		hookEnabled = !hookEnabled;
		if (hookEnabled && !hookText) {
			detectingHook = true;
			try {
				const res = await fetch('/api/video-pipeline/detect-hook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ title: track.title, tags: track.tags, prompt: track.prompt, isInstrumental: track.isInstrumental }),
				});
				const json = await res.json();
				if (res.ok && json.hook) { hookText = json.hook; hookTimingHint = json.timingHint ?? ''; hookAiDetected = true; }
			} catch { /* silent */ } finally { detectingHook = false; }
		} else if (!hookEnabled) { hookAiDetected = false; hookTimingHint = ''; }
	}

	const track = data.track;
	// ── Ensure project exists in DB ───────────────────────────────────────────
	async function ensureProject(): Promise<string> {
		if (projectId) return projectId;
		const config = {
			platform,
			durationSec: configDurSec,
			hookText: hookEnabled && hookText.trim() ? hookText.trim() : undefined,
		};
		const res = await fetch('/api/video-projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ publicationId: track.id, config }),
		});
		const d = await res.json() as { projectId: string };
		projectId = d.projectId;
		return d.projectId;
	}

	// ── Start full pipeline (called from config step) ──────────────────────────
	async function startPipeline() {
		step = 'script';
		await generateScript();
	}

	// ── Step 1: Generate Script (auto-advances to storyboard) ─────────────────
	async function generateScript() {
		isLoading = true;
		error = '';
		loadingMsg = 'El agente IA está analizando la canción y generando el guion cinematográfico...';
		try {
			const pid = await ensureProject();
			const res = await fetch(`/api/video-projects/${pid}/script`, { method: 'POST' });
			const d = await res.json() as { scenes?: VideoScene[]; error?: string };
			if (!res.ok || d.error) throw new Error(d.error || 'Script generation failed');
			script = d.scenes ?? [];
			scenes = script.map(s => ({ ...s, imageStatus: 'pending' as const }));
			step = 'storyboard';
			toast.success(`✓ Guion listo: ${script.length} escenas`);
			// Auto-advance
			await generateStoryboard();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			toast.error('Error generando guion');
			isLoading = false;
		}
	}

	// ── Step 2: Generate Storyboard images (auto-advances to rendering) ───────
	async function generateStoryboard() {
		// isLoading already true from generateScript or direct call
		error = '';
		const pid = projectId!;
		let allOk = true;

		for (let i = 0; i < scenes.length; i++) {
			// Skip scenes already done (e.g. on retry)
			if (scenes[i].imageStatus === 'done' && scenes[i].imageUrl) continue;

			// Rate limit: wait 11s between calls to stay within Replicate free tier (6 req/min)
			if (i > 0) await new Promise(r => setTimeout(r, 11_000));

			loadingMsg = `Storyboard: generando imagen ${i + 1} de ${scenes.length}...`;
			scenes[i] = { ...scenes[i], imageStatus: 'generating' };

			try {
				const res = await fetch(`/api/video-projects/${pid}/storyboard`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sceneIndex: i }),
				});
				const d = await res.json() as { scene?: VideoSceneWithImage; error?: string };
				if (!res.ok || d.error) throw new Error(d.error || 'Image gen failed');
				if (d.scene) scenes[i] = d.scene;
			} catch (e) {
				const errMsg = e instanceof Error ? e.message : 'Error desconocido';
				scenes[i] = { ...scenes[i], imageStatus: 'error', errorMsg: errMsg };
				allOk = false;
				toast.error(`Imagen ${i + 1}: ${errMsg}`);
			}
		}

		if (allOk) {
			step = 'rendering';
			toast.success('✓ Storyboard completado');
			// Auto-advance
			await renderClips();
		} else {
			isLoading = false;
			step = 'storyboard'; // stay here so user can retry
		}
	}

	// ── Step 3: Render video clips ────────────────────────────────────────────
	async function renderClips() {
		error = '';
		const pid = projectId!;
		if (!clips.length) clips = scenes.map(s => ({ ...s, clipStatus: 'pending' as const }));
		let allOk = true;

		let renderCount = 0;
		for (let i = 0; i < scenes.length; i++) {
			if (scenes[i].imageStatus !== 'done') continue;
			// Skip clips already done (e.g. on retry)
			if (clips[i]?.clipStatus === 'done' && clips[i]?.clipUrl) continue;
			// Delay between calls to avoid Replicate rate limits
			if (renderCount > 0) await new Promise(r => setTimeout(r, 12_000));
			renderCount++;
			loadingMsg = `Renderizando clip ${i + 1} de ${scenes.length}... (1–2 min por escena)`;
			clips[i] = { ...clips[i], clipStatus: 'generating' };
			// Force Svelte reactivity
			clips = [...clips];

			try {
				const res = await fetch(`/api/video-projects/${pid}/render`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sceneIndex: i }),
				});
				const d = await res.json() as { clipUrl?: string; allDone?: boolean; error?: string };
				if (!res.ok || d.error) throw new Error(d.error || 'Render failed');
				clips[i] = { ...clips[i], clipStatus: 'done', clipUrl: d.clipUrl };
				clips = [...clips];
			} catch (e) {
				clips[i] = { ...clips[i], clipStatus: 'error' };
				clips = [...clips];
				allOk = false;
				toast.error(`Clip ${i + 1}: ${e instanceof Error ? e.message : 'Error'}`);
			}
		}

		step = 'editor';
		if (allOk) toast.success('✓ Todos los clips listos');
		isLoading = false;
	}

	function formatSec(s: number): string {
		const m = Math.floor(s / 60);
		return `${m}:${(s % 60).toString().padStart(2, '0')}`;
	}

	// ── Step icons ─────────────────────────────────────────────────────────────
	const STEPS: { id: Step; label: string; icon: string }[] = [
		{ id: 'script',     label: 'Guion',       icon: '📝' },
		{ id: 'storyboard', label: 'Storyboard',  icon: '🎨' },
		{ id: 'rendering',  label: 'Renderizado',  icon: '🎞️' },
		{ id: 'editor',     label: 'Editor',       icon: '🎬' },
	];

	function stepIndex(s: Step) {
		return STEPS.findIndex(x => x.id === s);
	}
</script>

<svelte:head>
	<title>Crear Video — {track.title} — GenAudius</title>
</svelte:head>

<div class="min-h-full" style="background:var(--ga-dark); color:var(--ga-text);">

	<!-- Header -->
	<div class="px-6 py-5 flex items-center gap-4" style="border-bottom:1px solid var(--ga-border);">
		<button onclick={() => goto('/create')} class="text-sm hover:opacity-70 transition-opacity" style="color:var(--ga-muted);">← Volver</button>
		<div class="flex-1 min-w-0">
			<h1 class="text-lg font-bold truncate">🎬 Crear Video — <span style="color:var(--ga-gold);">{track.title}</span></h1>
			<p class="text-xs mt-0.5" style="color:var(--ga-muted);">Pipeline de producción cinematográfica AI</p>
		</div>
		<!-- Track mini player -->
		{#if track.audioUrl}
			<audio src={track.audioUrl} controls class="h-8 opacity-70"></audio>
		{/if}
	</div>

	<!-- Step progress bar (hidden on config step) -->
	{#if step !== 'config'}
	<div class="px-6 py-4 flex items-center gap-0" style="border-bottom:1px solid var(--ga-border);">
		{#each STEPS as s, i}
			{@const active = s.id === step}
			{@const done = stepIndex(step) > i}
			<div class="flex items-center flex-1">
				<div class="flex items-center gap-2 px-3 py-2 rounded-lg flex-1"
					style={active ? 'background:rgba(214,200,6,0.08); border:1px solid var(--ga-gold);' : 'border:1px solid transparent;'}>
					<span class="text-lg" style={done ? 'opacity:1' : active ? 'opacity:1' : 'opacity:0.3'}>{done ? '✅' : s.icon}</span>
					<div>
						<p class="text-xs font-semibold" style={active ? 'color:var(--ga-gold);' : done ? 'color:var(--ga-muted);' : 'color:var(--ga-muted);opacity:0.5;'}>{s.label}</p>
						<p class="text-[10px]" style="color:var(--ga-muted);opacity:0.6;">Paso {i + 1}</p>
					</div>
				</div>
				{#if i < STEPS.length - 1}
					<div class="w-4 h-px mx-1" style={done ? 'background:var(--ga-gold);' : 'background:var(--ga-border);'}></div>
				{/if}
			</div>
		{/each}
	</div>
	{/if}

	<div class="max-w-5xl mx-auto px-6 py-8 space-y-8">

		<!-- Error display -->
		{#if error}
			<div class="rounded-xl px-5 py-4 flex items-start gap-3" style="background:rgba(253,54,88,0.08);border:1px solid rgba(253,54,88,0.3);">
				<span>⚠️</span>
				<div>
					<p class="text-sm font-semibold" style="color:var(--ga-pink);">Error</p>
					<p class="text-xs mt-1" style="color:var(--ga-muted);">{error}</p>
				</div>
			</div>
		{/if}

		<!-- Loading state -->
		{#if isLoading}
			<div class="rounded-2xl p-8 text-center space-y-4" style="border:1px solid var(--ga-gold);background:rgba(214,200,6,0.04);">
				<div class="flex justify-center gap-[4px] items-end h-8">
					<span class="ga-wave-bar" style="height:8px;"></span>
					<span class="ga-wave-bar" style="height:16px;"></span>
					<span class="ga-wave-bar" style="height:24px;"></span>
					<span class="ga-wave-bar" style="height:16px;"></span>
					<span class="ga-wave-bar" style="height:8px;"></span>
				</div>
				<p class="text-sm font-semibold" style="color:var(--ga-gold);">{loadingMsg}</p>
				<p class="text-xs" style="color:var(--ga-muted);">Por favor espera, el pipeline AI está trabajando...</p>
			</div>
		{/if}

		<!-- ── CONFIG STEP ──────────────────────────────────────────────────────── -->
		{#if step === 'config'}
			<div class="max-w-xl mx-auto space-y-6">
				<!-- Track card -->
				<div class="rounded-2xl p-5 flex items-center gap-4" style="border:1px solid var(--ga-border);background:var(--ga-box);">
					{#if track.coverUrl}
						<img src={track.coverUrl} alt="" class="w-16 h-16 rounded-xl object-cover shrink-0" />
					{:else}
						<div class="w-16 h-16 rounded-xl shrink-0 flex items-center justify-center text-3xl" style="background:var(--ga-purple);">🎵</div>
					{/if}
					<div>
						<p class="font-bold text-base">{track.title}</p>
						{#if track.tags}<p class="text-xs mt-0.5" style="color:var(--ga-muted);">{track.tags}</p>{/if}
					</div>
				</div>

				<!-- Duration -->
				<div class="rounded-2xl p-5 space-y-3" style="border:1px solid var(--ga-border);background:var(--ga-box);">
					<p class="text-sm font-semibold">Duración del video</p>
					<div class="flex gap-2 flex-wrap">
						{#each ['15','30','60','full'] as d}
							<button
								onclick={() => (videoDuration = d as typeof videoDuration)}
								class="px-4 py-2 rounded-full text-sm font-medium transition-all"
								style={videoDuration === d
									? 'background:var(--ga-gold);color:#000;'
									: 'background:rgba(255,255,255,0.06);color:var(--ga-muted);border:1px solid rgba(255,255,255,0.1);'}
							>{durationLabel(d as typeof videoDuration)}</button>
						{/each}
					</div>
					<p class="text-xs" style="color:var(--ga-muted);">~{previewScenes} escenas · clips de 5–9s cada uno</p>
				</div>

				<!-- Platform -->
				<div class="rounded-2xl p-5 space-y-3" style="border:1px solid var(--ga-border);background:var(--ga-box);">
					<p class="text-sm font-semibold">Plataforma</p>
					<div class="grid grid-cols-2 gap-3">
						{#each [['reels','📱','Reels / Shorts','9:16 vertical'],['youtube','🎬','YouTube','16:9 horizontal']] as [id,icon,label,fmt]}
							<button
								onclick={() => (platform = id as Platform)}
								class="flex flex-col items-center gap-2 py-4 rounded-xl border transition-all"
								style={platform === id
									? 'background:rgba(214,200,6,0.08);border-color:var(--ga-gold);color:var(--ga-text);'
									: 'background:rgba(255,255,255,0.03);border-color:rgba(255,255,255,0.08);color:var(--ga-muted);'}
							>
								<span class="text-2xl">{icon}</span>
								<p class="text-xs font-semibold">{label}</p>
								<p class="text-[10px] opacity-60">{fmt}</p>
							</button>
						{/each}
					</div>
				</div>

				<!-- Hook / Enganche -->
				<div class="rounded-2xl p-5 space-y-3" style="border:1px solid var(--ga-border);background:var(--ga-box);">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3">
							<button
								onclick={toggleHook}
								disabled={detectingHook}
								class="w-9 h-5 rounded-full transition-colors relative shrink-0"
								style={hookEnabled ? 'background:var(--ga-gold);' : 'background:rgba(255,255,255,0.15);'}
								role="switch" aria-checked={hookEnabled} aria-label="Activar enganche"
							>
								<span class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all"
									style={hookEnabled ? 'left:calc(100% - 18px);' : 'left:2px;'}></span>
							</button>
							<p class="text-sm font-semibold">Desde el enganche</p>
						</div>
						{#if detectingHook}
							<div class="flex items-center gap-1.5 text-xs" style="color:var(--ga-gold);">
								<div class="w-3 h-3 border border-t-transparent rounded-full animate-spin" style="border-color:var(--ga-gold);border-top-color:transparent;"></div>
								Detectando...
							</div>
						{:else if hookAiDetected}
							<span class="text-xs px-2 py-0.5 rounded-full" style="background:rgba(214,200,6,0.15);color:var(--ga-gold);">✦ IA detectó</span>
						{/if}
					</div>
					{#if hookEnabled}
						<div class="relative">
							<input type="text" placeholder='Ej: "nunca voy a olvidarte"' bind:value={hookText}
								class="w-full px-4 py-2.5 rounded-lg text-sm outline-none"
								style="background:rgba(255,255,255,0.05);border:1px solid {hookAiDetected?'rgba(214,200,6,0.4)':'rgba(255,255,255,0.1)'};color:var(--ga-text);" />
						</div>
						{#if hookTimingHint}<p class="text-xs" style="color:var(--ga-gold);">◎ {hookTimingHint}</p>{/if}
					{:else}
						<p class="text-xs" style="color:var(--ga-muted);">La IA detectará el momento más pegadizo y centrará el video ahí.</p>
					{/if}
				</div>

				<!-- CTA -->
				<button
					onclick={startPipeline}
					class="w-full py-4 rounded-xl text-base font-bold flex items-center justify-center gap-3 transition-all"
					style="background:var(--ga-gold);color:#000;"
				>
					🎬 Iniciar Pipeline — Crear Video
				</button>
			</div>

		<!-- ── STEP 1: Script ───────────────────────────────────────────────────── -->
		{:else if step === 'script'}
			<!-- Script step only shown briefly before auto-advancing (isLoading covers it) -->
			<div class="rounded-2xl p-8 text-center" style="border:1px solid var(--ga-gold);background:rgba(214,200,6,0.04);">
				<p class="text-sm font-semibold" style="color:var(--ga-gold);">Analizando la canción...</p>
			</div>

		<!-- ── STEP 2: Storyboard ───────────────────────────────────────────────── -->
		{:else if step === 'storyboard'}
			<div class="space-y-6">
				{#if scenes.some(s => s.errorMsg && (s.errorMsg.includes('402') || s.errorMsg.toLowerCase().includes('insufficient credit') || s.errorMsg.toLowerCase().includes('payment')))}
					<div class="rounded-xl px-5 py-4 flex items-start gap-3" style="background:rgba(253,54,88,0.08);border:1px solid rgba(253,54,88,0.3);">
						<span class="text-2xl">💳</span>
						<div>
							<p class="text-sm font-bold" style="color:var(--ga-pink);">Crédito Replicate insuficiente</p>
							<p class="text-xs mt-1" style="color:var(--ga-muted);">
								Para generar imágenes con IA necesitas crédito en Replicate. Ve a
								<a href="https://replicate.com/account/billing#billing" target="_blank" class="underline font-semibold" style="color:var(--ga-gold);">replicate.com/account/billing</a>,
								añade un método de pago (mínimo $5), y luego haz clic en ↻ Reintentar.
							</p>
						</div>
					</div>
				{/if}
				<div class="flex items-center justify-between">
					<h2 class="text-xl font-bold">🎨 Paso 2: Storyboard — {script.length} Escenas</h2>
					{#if !isLoading}
						<button onclick={generateStoryboard} class="px-4 py-2 rounded-lg text-xs font-bold" style="background:rgba(214,200,6,0.1);color:var(--ga-gold);border:1px solid rgba(214,200,6,0.3);">↻ Reintentar</button>
					{/if}
				</div>

				<div class="space-y-3">
					{#each scenes as scene, i}
						<div class="rounded-xl overflow-hidden flex gap-0" style="border:1px solid var(--ga-border);background:var(--ga-box);">
							<!-- Image preview -->
							<div class="w-48 h-28 shrink-0 relative flex items-center justify-center" style="background:var(--ga-box2);">
								{#if scene.imageUrl}
									<img src={scene.imageUrl} alt="Scene {i+1}" class="w-full h-full object-cover" />
								{:else if scene.imageStatus === 'generating'}
									<div class="flex flex-col items-center gap-1">
										<div class="flex gap-[2px] items-end h-5">
											<span class="ga-wave-bar" style="height:4px;width:2px;"></span>
											<span class="ga-wave-bar" style="height:8px;width:2px;"></span>
											<span class="ga-wave-bar" style="height:12px;width:2px;"></span>
											<span class="ga-wave-bar" style="height:8px;width:2px;"></span>
											<span class="ga-wave-bar" style="height:4px;width:2px;"></span>
										</div>
										<span class="text-[10px]" style="color:var(--ga-gold);">Generando...</span>
									</div>
								{:else if scene.imageStatus === 'error'}
									<div class="flex flex-col items-center gap-1 px-2">
										<span class="text-xl">❌</span>
										<span class="text-[8px] text-center leading-tight" style="color:var(--ga-pink);">Falló</span>
									</div>
								{:else}
									<span class="text-2xl opacity-20">🖼️</span>
								{/if}
								<!-- Time badge -->
								<div class="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded font-mono" style="background:rgba(0,0,0,0.7);color:var(--ga-gold);">
									{formatSec(scene.startSec)}–{formatSec(scene.endSec)}
								</div>
							</div>
							<!-- Scene info -->
							<div class="flex-1 p-3 space-y-1.5">
								<div class="flex items-center gap-2">
									<span class="text-xs font-bold px-2 py-0.5 rounded" style="background:rgba(214,200,6,0.12);color:var(--ga-gold);">Escena {i + 1}</span>
									<span class="text-xs px-2 py-0.5 rounded" style={
										scene.imageStatus === 'done' ? 'background:rgba(34,197,94,0.1);color:#4ade80;' :
										scene.imageStatus === 'generating' ? 'background:rgba(214,200,6,0.1);color:var(--ga-gold);' :
										scene.imageStatus === 'error' ? 'background:rgba(253,54,88,0.1);color:var(--ga-pink);' :
										'background:rgba(255,255,255,0.05);color:var(--ga-muted);'
									}>{scene.imageStatus}</span>
								</div>
								<p class="text-xs" style="color:var(--ga-text);">{scene.description}</p>
								{#if scene.imageStatus === 'error' && scene.errorMsg}
									<p class="text-[10px] leading-tight mt-1 px-2 py-1 rounded" style="color:var(--ga-pink);background:rgba(253,54,88,0.08);border:1px solid rgba(253,54,88,0.2);">
										{#if scene.errorMsg.includes('402') || scene.errorMsg.toLowerCase().includes('insufficient credit') || scene.errorMsg.toLowerCase().includes('payment')}
											💳 Sin crédito Replicate — <a href="https://replicate.com/account/billing#billing" target="_blank" class="underline">añade método de pago</a> y reintenta.
										{:else}
											⚠️ {scene.errorMsg}
										{/if}
									</p>
								{:else}
									<p class="text-[10px] leading-relaxed" style="color:var(--ga-muted);opacity:0.7;">{scene.prompt?.slice(0, 120)}...</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>

		<!-- ── STEP 3: Rendering ────────────────────────────────────────────────── -->
		{:else if step === 'rendering'}
			<div class="space-y-6">
				<div class="flex items-center justify-between">
					<h2 class="text-xl font-bold">🎞️ Paso 3: Renderizando Clips</h2>
					{#if !isLoading}
						<button onclick={renderClips} class="px-4 py-2 rounded-lg text-xs font-bold" style="background:rgba(142,85,234,0.1);color:var(--ga-purple);border:1px solid rgba(142,85,234,0.3);">↻ Reintentar</button>
					{/if}
				</div>
				<p class="text-sm" style="color:var(--ga-muted);">
					Generando clips de 5–9 segundos con imagen-a-video AI. {isLoading ? 'Por favor espera...' : ''}
				</p>

				<div class="space-y-3">
					{#each clips.length ? clips : scenes.map(s => ({ ...s, clipStatus: 'pending' as const })) as clip, i}
						<div class="rounded-xl flex gap-0 overflow-hidden" style="border:1px solid var(--ga-border);background:var(--ga-box);">
							<!-- Video / image preview -->
							<div class="w-48 h-28 shrink-0 relative flex items-center justify-center" style="background:#000;">
								{#if (clip as VideoClip).clipUrl}
									<video src={(clip as VideoClip).clipUrl} class="w-full h-full object-cover" muted></video>
									<div class="absolute inset-0 flex items-center justify-center">
										<span class="text-2xl">▶</span>
									</div>
								{:else if (clip as VideoClip).imageUrl}
									<img src={(clip as VideoClip).imageUrl} alt="Scene {i+1}" class="w-full h-full object-cover opacity-50" />
									{#if (clip as VideoClip).clipStatus === 'generating'}
										<div class="absolute inset-0 flex flex-col items-center justify-center gap-1" style="background:rgba(0,0,0,0.5);">
											<div class="flex gap-[2px] items-end h-5">
												<span class="ga-wave-bar" style="height:4px;width:2px;"></span>
												<span class="ga-wave-bar" style="height:8px;width:2px;"></span>
												<span class="ga-wave-bar" style="height:12px;width:2px;"></span>
											</div>
											<span class="text-[10px]" style="color:var(--ga-gold);">Renderizando...</span>
										</div>
									{/if}
								{:else}
									<span class="text-2xl opacity-20">🎞️</span>
								{/if}
								<div class="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded font-mono" style="background:rgba(0,0,0,0.7);color:var(--ga-gold);">
									{formatSec(clip.startSec)}–{formatSec(clip.endSec)}
								</div>
							</div>
							<div class="flex-1 p-3 flex flex-col justify-between">
								<div class="flex items-center gap-2">
									<span class="text-xs font-bold px-2 py-0.5 rounded" style="background:rgba(142,85,234,0.12);color:var(--ga-purple);">Clip {i + 1}</span>
									<span class="text-xs px-2 py-0.5 rounded" style={
										(clip as VideoClip).clipStatus === 'done' ? 'background:rgba(34,197,94,0.1);color:#4ade80;' :
										(clip as VideoClip).clipStatus === 'generating' ? 'background:rgba(214,200,6,0.1);color:var(--ga-gold);' :
										(clip as VideoClip).clipStatus === 'error' ? 'background:rgba(253,54,88,0.1);color:var(--ga-pink);' :
										'background:rgba(255,255,255,0.05);color:var(--ga-muted);'
									}>{(clip as VideoClip).clipStatus}</span>
								</div>
								<p class="text-xs" style="color:var(--ga-muted);">{clip.description}</p>
								<p class="text-[10px]" style="color:var(--ga-muted);opacity:0.5;">{Math.round(clip.endSec - clip.startSec)}s · Image-to-Video</p>
							</div>
						</div>
					{/each}
				</div>
			</div>

		<!-- ── STEP 4: Workspace (Editor Multitrack) ───────────────────────────── -->
		{:else if step === 'rendering' && !isLoading && clips.every(c => (c as VideoClip).clipStatus === 'done')}
			<!-- All clips done, prompt to open workspace -->
			<div class="flex flex-col items-center gap-4 py-10">
				<div class="w-14 h-14 rounded-2xl flex items-center justify-center" style="background:rgba(34,197,94,0.12);">
					<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
				</div>
				<h3 class="text-lg font-bold" style="color:#4ade80;">¡Todos los clips listos!</h3>
				<p class="text-sm text-center max-w-xs" style="color:var(--ga-muted);">Abre el workspace para editar, previsualizar y mezclar tu video con audio.</p>
				<a href="/workspace/{projectId}" class="px-6 py-3 rounded-xl font-bold text-sm" style="background:var(--ga-gold);color:#000;">
					Abrir Workspace →
				</a>
			</div>

		{:else if (step === 'editor' || step === 'done') && !isLoading}

			<!-- Workspace link banner -->
			{#if projectId}
				<div class="flex items-center justify-between px-4 py-3 rounded-xl mb-2" style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);">
					<div>
						<p class="text-xs font-bold" style="color:#4ade80;">✓ Clips listos</p>
						<p class="text-[10px]" style="color:var(--ga-muted);">Usa el workspace completo para editar y previsualizar</p>
					</div>
					<a href="/workspace/{projectId}" class="px-4 py-2 rounded-lg text-xs font-bold shrink-0 ml-4" style="background:var(--ga-gold);color:#000;">
						Workspace →
					</a>
				</div>
			{/if}

			<!-- Audio master clock — hidden, drives everything -->
			{#if track.audioUrl && !finalVideoUrl}
				<audio
					bind:this={previewAudioEl}
					src={track.audioUrl}
					preload="auto"
					ontimeupdate={onAudioTimeUpdate}
					onplay={onAudioPlay}
					onpause={onAudioPause}
					onended={onAudioEnded}
					style="display:none;"
				></audio>
			{/if}

			<div class="space-y-4">

				<!-- Header -->
				<div class="flex items-center justify-between flex-wrap gap-3">
					<h2 class="text-xl font-bold">🎬 Workspace</h2>
					<div class="flex items-center gap-2">
						{#if clips.some(c => !(c as VideoClip).clipUrl)}
							<button
								onclick={() => { step = 'rendering'; renderClips(); }}
								class="px-3 py-1.5 rounded-xl text-xs font-bold"
								style="background:rgba(142,85,234,0.15);color:var(--ga-purple);border:1px solid rgba(142,85,234,0.3);"
							>🎞️ Generar clips vacíos</button>
						{/if}
						{#if finalVideoUrl}
							<a href={finalVideoUrl} download="{track.title}-video.mp4"
								class="px-5 py-2 rounded-xl text-sm font-bold"
								style="background:var(--ga-gold);color:#000;">
								⬇️ Descargar
							</a>
						{/if}
					</div>
				</div>

				<!-- ── PREVIEW + TRANSPORT ─────────────────────────────────── -->
				<div class="rounded-2xl overflow-hidden" style="background:#000;border:1px solid var(--ga-border);">
					{#if finalVideoUrl}
						<video src={finalVideoUrl} controls class="w-full" style="max-height:420px;"></video>
					{:else if doneClips.length > 0}
						<!-- A/B crossfade video player -->
						<div class="relative w-full overflow-hidden" style="max-height:400px;background:#000;">
							<video bind:this={videoA} muted playsinline
								class="absolute inset-0 w-full h-full object-contain"
								style="opacity:{activeVid === 0 ? 1 : 0};transition:opacity 0.35s ease;"></video>
							<video bind:this={videoB} muted playsinline
								class="absolute inset-0 w-full h-full object-contain"
								style="opacity:{activeVid === 1 ? 1 : 0};transition:opacity 0.35s ease;"></video>
							<!-- Spacer to maintain height -->
							<div style="height:280px;"></div>
						</div>

						<!-- Transport bar -->
						<div class="px-4 py-3 flex items-center gap-4" style="background:rgba(255,255,255,0.03);">
							<!-- Play / Pause / Replay -->
							<button
								onclick={togglePlay}
								class="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform hover:scale-110"
								style="background:{atEnd ? 'var(--ga-purple)' : 'var(--ga-gold)'};"
								title={atEnd ? 'Reproducir de nuevo' : isPlaying ? 'Pausar' : 'Reproducir'}
							>
								{#if atEnd}
									<!-- Replay icon -->
									<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
										<path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
									</svg>
								{:else if isPlaying}
									<!-- Pause icon -->
									<svg width="14" height="14" viewBox="0 0 14 14" fill="#000">
										<rect x="2" y="1" width="4" height="12" rx="1"/>
										<rect x="8" y="1" width="4" height="12" rx="1"/>
									</svg>
								{:else}
									<!-- Play icon -->
									<svg width="14" height="14" viewBox="0 0 14 14" fill="#000">
										<path d="M3 1.5l9 5.5-9 5.5V1.5z"/>
									</svg>
								{/if}
							</button>

							<!-- Time display -->
							<span class="text-xs font-mono shrink-0" style="color:{atEnd ? 'var(--ga-gold)' : 'var(--ga-muted)'};">
								{formatSec(masterTime)} / {formatSec(totalSec)}
								{#if atEnd}<span class="ml-1 text-[10px]" style="color:var(--ga-gold);">· FIN</span>{/if}
							</span>

							<!-- Scrub bar -->
							<div
								class="flex-1 h-2 rounded-full cursor-pointer relative overflow-hidden"
								style="background:rgba(255,255,255,0.1);"
								onclick={(e) => {
									const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
									seekTo(((e.clientX - r.left) / r.width) * totalSec);
								}}
							>
								<div
									class="absolute inset-y-0 left-0 rounded-full"
									style="width:{totalSec ? (masterTime / totalSec) * 100 : 0}%;background:var(--ga-gold);"
								></div>
							</div>

							<!-- Clip badge -->
							<span class="text-[11px] font-mono shrink-0" style="color:var(--ga-purple);">
								{currentClipIndex + 1}/{doneClips.length}
							</span>
						</div>
					{:else}
						<div class="flex items-center justify-center" style="height:240px;">
							<div class="text-center" style="color:var(--ga-muted);">
								<div class="text-5xl mb-3">🎬</div>
								<p class="text-sm">Renderiza los clips para ver el preview</p>
							</div>
						</div>
					{/if}
				</div>

				<!-- ── TIMELINE MULTITRACK ──────────────────────────────────── -->
				{#if doneClips.length > 0}
				<div class="rounded-xl p-4 space-y-3" style="background:var(--ga-box);border:1px solid var(--ga-border);">
					<p class="text-[10px] uppercase font-bold tracking-widest" style="color:var(--ga-muted);">Timeline</p>

					<!-- Scrollable track area -->
					<div
						bind:this={timelineEl}
						class="relative cursor-pointer select-none"
						onclick={onTimelineClick}
						style="min-height:84px;"
					>
						<!-- Time ruler -->
						<div class="flex justify-between mb-1 px-0">
							{#each Array.from({length: 6}) as _, ti}
								<span class="text-[9px] font-mono" style="color:var(--ga-muted);">
									{formatSec((ti / 5) * totalSec)}
								</span>
							{/each}
						</div>

						<!-- Audio track -->
						<div class="relative h-6 rounded mb-2 overflow-hidden" style="background:rgba(214,200,6,0.08);border:1px solid rgba(214,200,6,0.2);">
							<div class="absolute inset-y-0 left-0 flex items-center pl-2 gap-1.5">
								<span class="text-[9px] uppercase font-bold" style="color:var(--ga-gold);">🎵</span>
								<span class="text-[9px] truncate" style="color:var(--ga-gold);opacity:0.7;">{track.title}</span>
							</div>
							<!-- Played progress -->
							<div
								class="absolute inset-y-0 left-0 pointer-events-none"
								style="width:{totalSec ? (masterTime / totalSec) * 100 : 0}%;background:rgba(214,200,6,0.15);"
							></div>
						</div>

						<!-- Video track: blocks positioned by startSec/endSec, colored by type -->
						<div class="relative rounded overflow-hidden" style="height:52px;background:rgba(255,255,255,0.02);border:1px solid var(--ga-border);">
							{#each doneClips as clip, i}
								{@const c = clip as VideoClip}
								{@const isVocal = c.type === 'vocals'}
								{@const leftPct = totalSec ? (c.startSec / totalSec) * 100 : 0}
								{@const widthPct = totalSec ? ((c.endSec - c.startSec) / totalSec) * 100 : 0}
								{@const isActive = i === currentClipIndex}
								<div
									class="absolute top-0 bottom-0 overflow-hidden rounded cursor-pointer"
									style="left:{leftPct}%;width:{widthPct}%;
										background:{isVocal ? 'rgba(253,54,88,0.18)' : 'rgba(142,85,234,0.18)'};
										border:1px solid {isActive ? 'var(--ga-gold)' : isVocal ? 'rgba(253,54,88,0.5)' : 'rgba(142,85,234,0.4)'};"
									title="{c.type === 'vocals' ? '🎤 Vocals' : '🎸 Instrumental'} · {c.description}"
									onclick={(e) => { e.stopPropagation(); seekTo(c.startSec); }}
								>
									{#if c.imageUrl}
										<img src={c.imageUrl} alt="" class="w-full h-full object-cover opacity-40" />
									{/if}
									<div class="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
										<span class="text-[8px]">{isVocal ? '🎤' : '🎸'}</span>
										<span class="text-[8px] font-bold text-white drop-shadow">{i + 1}</span>
									</div>
									{#if isActive}
										<div class="absolute inset-0 pointer-events-none" style="box-shadow:inset 0 0 0 2px var(--ga-gold);"></div>
									{/if}
								</div>
							{/each}
						</div>

						<!-- Type legend -->
						<div class="flex gap-3 mt-1.5">
							<span class="text-[9px] flex items-center gap-1" style="color:var(--ga-pink);">
								<span class="inline-block w-2 h-2 rounded-sm" style="background:rgba(253,54,88,0.5);"></span>🎤 Vocals
							</span>
							<span class="text-[9px] flex items-center gap-1" style="color:var(--ga-purple);">
								<span class="inline-block w-2 h-2 rounded-sm" style="background:rgba(142,85,234,0.5);"></span>🎸 Instrumental
							</span>
						</div>

						<!-- Playhead needle -->
						{#if totalSec > 0}
							<div
								class="absolute top-4 bottom-0 w-px pointer-events-none"
								style="left:{(masterTime / totalSec) * 100}%;background:var(--ga-pink);box-shadow:0 0 4px var(--ga-pink);"
							>
								<!-- Needle head -->
								<div class="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full" style="background:var(--ga-pink);"></div>
							</div>
						{/if}
					</div>
				</div>
				{/if}

				<!-- ── SCENE CARDS ──────────────────────────────────────────── -->
				<div class="space-y-2">
					{#each clips as clip, i}
						{@const vc = clip as VideoClip}
						<div class="rounded-xl flex overflow-hidden" style="border:1px solid {i === currentClipIndex && vc.clipUrl ? 'var(--ga-gold)' : 'var(--ga-border)'};background:var(--ga-box);">
							<!-- Thumbnail -->
							<div class="w-36 h-20 shrink-0 relative cursor-pointer" style="background:#000;" onclick={() => vc.clipUrl && seekTo(vc.startSec)}>
								{#if vc.clipUrl}
									<video src={vc.clipUrl} class="w-full h-full object-cover" muted loop playsinline></video>
								{:else if vc.imageUrl}
									<img src={vc.imageUrl} alt="Clip {i+1}" class="w-full h-full object-cover opacity-60" />
								{/if}
								<div class="absolute top-1 left-1 text-[8px] px-1 py-0.5 rounded font-mono" style="background:rgba(0,0,0,0.8);color:var(--ga-purple);">
									{formatSec(vc.startSec)}–{formatSec(vc.endSec)}
								</div>
							</div>
							<!-- Info -->
							<div class="flex-1 p-3 flex flex-col justify-between min-w-0">
								<div>
									<div class="flex items-center gap-1.5 mb-0.5">
										<span class="text-[9px] font-bold px-1.5 py-0.5 rounded"
											style="background:{vc.type === 'vocals' ? 'rgba(253,54,88,0.15)' : 'rgba(142,85,234,0.15)'};color:{vc.type === 'vocals' ? 'var(--ga-pink)' : 'var(--ga-purple)'};">
											{vc.type === 'vocals' ? '🎤 Vocals' : '🎸 Instrumental'}
										</span>
										{#if vc.cameraMovement}
											<span class="text-[9px] truncate" style="color:var(--ga-muted);">📷 {vc.cameraMovement}</span>
										{/if}
									</div>
									<p class="text-[10px] mt-0.5 line-clamp-2" style="color:var(--ga-muted);">{vc.description}</p>
								</div>
								<div class="flex gap-2 mt-2 flex-wrap">
									{#if vc.clipUrl}
										<button onclick={() => seekTo(vc.startSec)} class="text-[10px] px-2 py-0.5 rounded" style="background:rgba(34,197,94,0.1);color:#4ade80;">▶ Ir aquí</button>
									{/if}
									<button
										onclick={() => { aiPanelScene = aiPanelScene === i ? null : i; aiPromptText = ''; }}
										class="text-[10px] px-2 py-0.5 rounded"
										style="background:rgba(142,85,234,0.15);color:var(--ga-purple);"
										title="Editar esta escena con IA"
									>🤖 Editar con IA</button>
									{#if !vc.clipUrl}
										<button
											onclick={async () => {
												const pid = projectId!;
												clips[i] = { ...clips[i], clipStatus: 'generating' };
												const res = await fetch(`/api/video-projects/${pid}/render`, {
													method: 'POST',
													headers: { 'Content-Type': 'application/json' },
													body: JSON.stringify({ sceneIndex: i }),
												});
												const d = await res.json() as { clipUrl?: string; error?: string };
												if (d.clipUrl) clips[i] = { ...clips[i], clipUrl: d.clipUrl, clipStatus: 'done' };
												else clips[i] = { ...clips[i], clipStatus: 'error' };
											}}
											class="text-[10px] px-3 py-1 rounded-lg"
											style="background:rgba(142,85,234,0.15);color:var(--ga-purple);"
										>Regenerar</button>
									{/if}
								</div>

								<!-- IA Scene Editor panel -->
								{#if aiPanelScene === i}
									<div class="px-3 pb-3 pt-2 border-t" style="border-color:var(--ga-border);">
										<p class="text-[10px] mb-1.5 font-semibold" style="color:var(--ga-purple);">🤖 ¿Qué cambias en esta escena?</p>
										<div class="flex gap-2">
											<input
												bind:value={aiPromptText}
												placeholder='Ej: "Añade luces de neón", "Transición de fuego", "Fondo cyberpunk"'
												class="flex-1 text-xs px-3 py-2 rounded-lg"
												style="background:rgba(255,255,255,0.05);border:1px solid var(--ga-border);color:var(--ga-text);"
												onkeydown={(e) => e.key === 'Enter' && runAiSceneEdit(i)}
											/>
											<button
												onclick={() => runAiSceneEdit(i)}
												disabled={aiLoading || !aiPromptText.trim()}
												class="px-3 py-2 rounded-lg text-xs font-bold shrink-0"
												style="background:var(--ga-purple);color:#fff;opacity:{aiLoading ? 0.5 : 1};"
											>{aiLoading ? '...' : 'Aplicar'}</button>
										</div>
										<div class="flex gap-2 mt-2 flex-wrap">
											{#each ['Transición suave de luz', 'Efecto de neón parpadeante', 'Fondo atardecer playa', 'Cámara lenta dramática'] as sugg}
												<button onclick={() => { aiPromptText = sugg; }}
													class="text-[9px] px-2 py-0.5 rounded-full"
													style="background:rgba(142,85,234,0.1);color:var(--ga-purple);border:1px solid rgba(142,85,234,0.2);"
												>{sugg}</button>
											{/each}
										</div>
									</div>
								{/if}
							</div><!-- /info -->
						</div><!-- /card -->
						{/each}
					</div>

				</div>
			{/if}

	</div>
</div>
