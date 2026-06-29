<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	interface Track {
		id: string;
		title: string;
		audioUrl: string | null;
		coverUrl?: string | null;
		tags?: string | null;
		durationMs: number | null;
		prompt?: string | null;
		isInstrumental?: boolean;
	}

	let {
		track,
		open = $bindable(false),
	}: { track: Track; open: boolean } = $props();

	type Phase = 'config' | 'running' | 'done' | 'error';
	let phase = $state<Phase>('config');

	// Config
	let videoDuration = $state<'15' | '30' | '60' | 'full'>('30');
	let platform = $state<'reels' | 'youtube'>('reels');
	let hookEnabled = $state(false);
	let hookText = $state('');
	let hookTimingHint = $state('');
	let detectingHook = $state(false);
	let hookAiDetected = $state(false);

	async function toggleHook() {
		hookEnabled = !hookEnabled;
		if (hookEnabled && !hookText) {
			// Auto-detect hook when enabling
			detectingHook = true;
			hookAiDetected = false;
			try {
				const res = await fetch('/api/video-pipeline/detect-hook', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						title: track.title,
						tags: track.tags ?? '',
						prompt: track.prompt ?? '',
						isInstrumental: track.isInstrumental ?? false,
					}),
				});
				const json = await res.json();
				if (res.ok && json.hook) {
					hookText = json.hook;
					hookTimingHint = json.timingHint ?? '';
					hookAiDetected = true;
				}
			} catch {
				// Silent — user can still type manually
			} finally {
				detectingHook = false;
			}
		} else if (!hookEnabled) {
			hookAiDetected = false;
			hookTimingHint = '';
		}
	}

	// Pipeline state
	interface Scene {
		index: number;
		startSec: number;
		endSec: number;
		description: string;
		prompt: string;
		imageUrl?: string;
		imageStatus: 'pending' | 'generating' | 'done' | 'error';
		clipStatus: 'pending' | 'generating' | 'done' | 'error';
	}

	let scenes = $state<Scene[]>([]);
	let stageLabel = $state('');
	let errorMsg = $state<string | null>(null);
	let completedClips = $state(0);
	const totalScenes = $derived(scenes.length);
	const progressPct = $derived(totalScenes > 0 ? Math.round((completedClips / totalScenes) * 100) : 0);

	function handleClose() {
		if (phase === 'running') return; // block close while pipeline runs
		open = false;
		// reset after dialog closes
		setTimeout(() => {
			phase = 'config';
			scenes = [];
			stageLabel = '';
			errorMsg = null;
			completedClips = 0;
			hookEnabled = false;
			hookText = '';
			hookTimingHint = '';
			hookAiDetected = false;
			detectingHook = false;
		}, 300);
	}

	function durationLabel(d: typeof videoDuration) {
		return d === '15' ? '15 seg' : d === '30' ? '30 seg' : d === '60' ? '1 min' : 'Completa';
	}

	function getNumScenes(dSec: number) {
		return Math.max(3, Math.min(10, Math.round(dSec / 6)));
	}

	async function startPipeline() {
		phase = 'running';
		stageLabel = 'Analizando la canción y generando guión cinematográfico...';
		errorMsg = null;
		completedClips = 0;

		const trackDurSec = Math.floor((track.durationMs ?? 180_000) / 1_000);
		const durationSec = videoDuration === 'full' ? trackDurSec : parseInt(videoDuration);
		const numScenes = getNumScenes(durationSec);
		const aspectRatio = platform === 'reels' ? '9:16' : '16:9';

		// Step 1: AI script generation
		try {
			const res = await fetch('/api/video-pipeline/script', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: track.title,
					tags: track.tags ?? '',
					durationSec,
					platform,
					hookText: hookEnabled && hookText.trim() ? hookText.trim() : undefined,
					numScenes,
				}),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error || 'Script generation failed');

			scenes = (json.scenes as Omit<Scene, 'imageStatus' | 'clipStatus'>[]).map((s) => ({
				...s,
				imageStatus: 'pending' as const,
				clipStatus: 'pending' as const,
			}));
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
			phase = 'error';
			return;
		}

		// Steps 2 & 3: For each scene, generate image then video clip
		stageLabel = 'Creando storyboard...';
		for (const sceneItem of scenes) {
			const idx = sceneItem.index;

			// 2a: Generate scene image with flux-schnell
			scenes = scenes.map((s) => (s.index === idx ? { ...s, imageStatus: 'generating' } : s));
			try {
				const imgRes = await fetch('/api/image-generation', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ model: 'flux-schnell', prompt: sceneItem.prompt, size: aspectRatio }),
				});
				const imgJson = await imgRes.json();
				if (!imgRes.ok) throw new Error(imgJson.error || 'Image generation failed');

				const imageUrl = `/api/images/${imgJson.imageId}`;
				scenes = scenes.map((s) =>
					s.index === idx
						? { ...s, imageUrl, imageStatus: 'done', clipStatus: 'generating' }
						: s
				);

				stageLabel = `Renderizando clip ${idx + 1} de ${totalScenes}...`;

				// 2b: Generate video clip with ray-flash-2-720p (image-to-video)
				const vidRes = await fetch('/api/video-generation', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						model: 'ray-flash-2-720p',
						prompt: sceneItem.prompt,
						imageUrl,
						resolution: aspectRatio,
						duration: 5,
					}),
				});
				const vidJson = await vidRes.json();
				if (!vidRes.ok) throw new Error(vidJson.error || 'Video clip generation failed');

				scenes = scenes.map((s) => (s.index === idx ? { ...s, clipStatus: 'done' } : s));
				completedClips++;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				scenes = scenes.map((s) =>
					s.index === idx
						? {
								...s,
								imageStatus: s.imageStatus === 'generating' ? 'error' : s.imageStatus,
								clipStatus: 'error',
							}
						: s
				);
				toast.error(`Escena ${idx + 1}: ${msg}`);
				completedClips++;
			}
		}

		phase = 'done';
		stageLabel = '';
	}

	const statusIcon: Record<string, string> = {
		pending: '○',
		generating: '◌',
		done: '✓',
		error: '✗',
	};
	const statusColor: Record<string, string> = {
		pending: '#666',
		generating: 'var(--ga-gold)',
		done: '#22c55e',
		error: 'var(--ga-pink)',
	};
</script>

<Dialog.Root bind:open onOpenChange={(v) => { if (!v) handleClose(); }}>
	<Dialog.Content
		class="[&]:p-0 overflow-hidden"
		style="max-width:680px; width:95vw; max-height:88vh; background:#0d0d0d; border:1px solid rgba(255,255,255,0.1); border-radius:16px;"
		showCloseButton={phase !== 'running'}
		escapeKeydownBehavior={phase === 'running' ? 'ignore' : 'close'}
		interactOutsideBehavior={phase === 'running' ? 'ignore' : 'close'}
	>
		<!-- Header -->
		<div
			class="flex items-center gap-3 px-6 py-4 shrink-0"
			style="border-bottom:1px solid rgba(255,255,255,0.08);"
		>
			{#if track.coverUrl}
				<img
					src={track.coverUrl}
					alt=""
					class="w-10 h-10 rounded-lg object-cover shrink-0"
				/>
			{:else}
				<div
					class="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center text-lg"
					style="background:var(--ga-purple);"
				>🎵</div>
			{/if}
			<div class="min-w-0">
				<p class="text-xs" style="color:var(--ga-muted);">Crear Video para</p>
				<p class="font-semibold text-sm truncate" style="color:var(--ga-text);">{track.title}</p>
			</div>
			<div
				class="ml-auto text-xs px-2 py-0.5 rounded-full"
				style="background:rgba(142,85,234,0.15); color:var(--ga-purple);"
			>
				{#if phase === 'config'}Config{:else if phase === 'running'}Generando...{:else if phase === 'done'}Listo ✓{:else}Error{/if}
			</div>
		</div>

		<!-- Body -->
		<div class="overflow-y-auto" style="max-height:calc(88vh - 140px);">

			<!-- ── CONFIG PHASE ── -->
			{#if phase === 'config'}
				<div class="px-6 py-6 flex flex-col gap-6">

					<!-- Duration -->
					<div>
						<p class="text-sm font-medium mb-3" style="color:var(--ga-muted);">Duración del video</p>
						<div class="flex gap-2">
							{#each ['15','30','60','full'] as d}
								<button
									onclick={() => (videoDuration = d as typeof videoDuration)}
									class="px-4 py-2 rounded-full text-sm font-medium transition-all"
									style={videoDuration === d
										? 'background:var(--ga-gold); color:#000;'
										: 'background:rgba(255,255,255,0.06); color:var(--ga-muted); border:1px solid rgba(255,255,255,0.1);'}
								>{durationLabel(d as typeof videoDuration)}</button>
							{/each}
						</div>
					</div>

					<!-- Platform -->
					<div>
						<p class="text-sm font-medium mb-3" style="color:var(--ga-muted);">Plataforma</p>
						<div class="flex gap-3">
							<button
								onclick={() => (platform = 'reels')}
								class="flex-1 flex flex-col items-center gap-2 py-4 rounded-xl border transition-all"
								style={platform === 'reels'
									? 'background:rgba(214,200,6,0.1); border-color:var(--ga-gold); color:var(--ga-text);'
									: 'background:rgba(255,255,255,0.03); border-color:rgba(255,255,255,0.08); color:var(--ga-muted);'}
							>
								<span class="text-2xl">📱</span>
								<div class="text-xs font-medium">Reels / Shorts</div>
								<div class="text-xs opacity-60">9:16 vertical</div>
							</button>
							<button
								onclick={() => (platform = 'youtube')}
								class="flex-1 flex flex-col items-center gap-2 py-4 rounded-xl border transition-all"
								style={platform === 'youtube'
									? 'background:rgba(214,200,6,0.1); border-color:var(--ga-gold); color:var(--ga-text);'
									: 'background:rgba(255,255,255,0.03); border-color:rgba(255,255,255,0.08); color:var(--ga-muted);'}
							>
								<span class="text-2xl">🎬</span>
								<div class="text-xs font-medium">YouTube</div>
								<div class="text-xs opacity-60">16:9 horizontal</div>
							</button>
						</div>
					</div>

					<!-- Hook (optional) -->
					<div>
						<div class="flex items-center justify-between mb-3">
							<div class="flex items-center gap-3">
								<button
									onclick={toggleHook}
									disabled={detectingHook}
									class="w-9 h-5 rounded-full transition-colors relative"
									style={hookEnabled ? 'background:var(--ga-gold);' : 'background:rgba(255,255,255,0.15);'}
									role="switch"
									aria-checked={hookEnabled}
									aria-label="Activar frase de enganche"
								>
									<span
										class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
										style={hookEnabled ? 'left:calc(100% - 18px);' : 'left:2px;'}
									></span>
								</button>
								<p class="text-sm font-medium" style="color:var(--ga-text);">
									Desde el enganche
								</p>
							</div>
							{#if detectingHook}
								<div class="flex items-center gap-1.5 text-xs" style="color:var(--ga-gold);">
									<div class="w-3 h-3 border border-t-transparent rounded-full animate-spin"
										style="border-color:var(--ga-gold); border-top-color:transparent;"></div>
									Detectando...
								</div>
							{:else if hookAiDetected}
								<span class="text-xs px-2 py-0.5 rounded-full" style="background:rgba(214,200,6,0.15); color:var(--ga-gold);">✦ IA detectó</span>
							{/if}
						</div>

						{#if hookEnabled}
							<!-- Hook input — pre-filled by AI, editable -->
							<div class="relative">
								<input
									type="text"
									placeholder='Ej: "nunca voy a olvidarte"'
									bind:value={hookText}
									class="w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-colors"
									style="background:rgba(255,255,255,0.05); border:1px solid {hookAiDetected ? 'rgba(214,200,6,0.4)' : 'rgba(255,255,255,0.1)'}; color:var(--ga-text); padding-right:{hookAiDetected ? '80px' : '16px'};"
								/>
								{#if hookAiDetected && hookText}
									<button
										onclick={() => { hookText = ''; hookAiDetected = false; hookTimingHint = ''; }}
										class="absolute right-3 top-1/2 -translate-y-1/2 text-xs px-2 py-0.5 rounded"
										style="background:rgba(255,255,255,0.08); color:var(--ga-muted);"
									>editar</button>
								{/if}
							</div>
							{#if hookTimingHint}
								<p class="text-xs mt-1.5 flex items-center gap-1" style="color:var(--ga-gold);">
									<span>◎</span> {hookTimingHint}
								</p>
							{/if}
							<p class="text-xs mt-1" style="color:var(--ga-muted);">
								La IA centrará la escena más impactante alrededor de este momento.
							</p>
						{:else}
							<p class="text-xs" style="color:var(--ga-muted);">
								Activa para que la IA detecte y centre el video en el momento más pegadizo.
							</p>
						{/if}
					</div>

					<!-- Summary info -->
					<div
						class="rounded-xl p-4 text-xs"
						style="background:rgba(255,255,255,0.04); color:var(--ga-muted); border:1px solid rgba(255,255,255,0.06);"
					>
						<p class="mb-1">
							✦ Se generarán ~<strong style="color:var(--ga-text);">{getNumScenes(videoDuration === 'full' ? Math.floor((track.durationMs ?? 180_000) / 1_000) : parseInt(videoDuration))}</strong> escenas
							de {platform === 'reels' ? '9:16' : '16:9'} con
							<strong style="color:var(--ga-text);">ray-flash-2-720p</strong>
						</p>
						<p>✦ Los clips aparecerán en tu panel de <strong style="color:var(--ga-text);">Videos</strong></p>
					</div>
				</div>

				<!-- Action -->
				<div
					class="px-6 py-4 shrink-0"
					style="border-top:1px solid rgba(255,255,255,0.06);"
				>
					<button
						onclick={startPipeline}
						class="w-full py-3 rounded-xl font-semibold text-sm transition-all"
						style="background:var(--ga-gold); color:#000;"
					>
						🎬 Crear Video
					</button>
				</div>

			<!-- ── RUNNING PHASE ── -->
			{:else if phase === 'running'}
				<div class="px-6 py-6 flex flex-col gap-5">

					<!-- Stage label + spinner -->
					<div class="flex items-center gap-3">
						<div class="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin shrink-0"
							style="border-color:var(--ga-gold); border-top-color:transparent;"></div>
						<p class="text-sm" style="color:var(--ga-text);">{stageLabel}</p>
					</div>

					<!-- Progress bar -->
					{#if totalScenes > 0}
						<div>
							<div class="flex justify-between text-xs mb-2" style="color:var(--ga-muted);">
								<span>{completedClips} de {totalScenes} clips</span>
								<span>{progressPct}%</span>
							</div>
							<div class="w-full h-1.5 rounded-full overflow-hidden" style="background:rgba(255,255,255,0.08);">
								<div
									class="h-full rounded-full transition-all duration-500"
									style="width:{progressPct}%; background:var(--ga-gold);"
								></div>
							</div>
						</div>
					{/if}

					<!-- Scene cards -->
					{#if scenes.length > 0}
						<div class="flex flex-col gap-2">
							{#each scenes as scene}
								<div
									class="flex items-center gap-3 rounded-xl px-4 py-3"
									style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06);"
								>
									<!-- Scene image preview -->
									<div
										class="w-14 h-9 rounded-lg shrink-0 overflow-hidden flex items-center justify-center"
										style="background:rgba(255,255,255,0.08);"
									>
										{#if scene.imageUrl && scene.imageStatus === 'done'}
											<img src={scene.imageUrl} alt="" class="w-full h-full object-cover" />
										{:else if scene.imageStatus === 'generating'}
											<div class="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
												style="border-color:var(--ga-gold); border-top-color:transparent;"></div>
										{:else if scene.imageStatus === 'error'}
											<span style="color:var(--ga-pink);">✗</span>
										{:else}
											<span class="text-xs" style="color:rgba(255,255,255,0.3);">{scene.index + 1}</span>
										{/if}
									</div>

									<!-- Scene info -->
									<div class="flex-1 min-w-0">
										<p class="text-xs font-medium truncate" style="color:var(--ga-text);">
											Escena {scene.index + 1}
										</p>
										<p class="text-xs truncate" style="color:var(--ga-muted);">{scene.description}</p>
									</div>

									<!-- Status indicators -->
									<div class="flex items-center gap-2 text-xs shrink-0">
										<span title="Imagen" style="color:{statusColor[scene.imageStatus]};">
											IMG {statusIcon[scene.imageStatus]}
										</span>
										<span class="opacity-30">│</span>
										<span title="Video" style="color:{statusColor[scene.clipStatus]};">
											VID {statusIcon[scene.clipStatus]}
										</span>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<p class="text-xs text-center" style="color:rgba(255,255,255,0.3);">
						Esto puede tomar varios minutos. No cierres esta ventana.
					</p>
				</div>

			<!-- ── DONE PHASE ── -->
			{:else if phase === 'done'}
				<div class="px-6 py-10 flex flex-col items-center gap-6 text-center">
					<div class="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
						style="background:rgba(34,197,94,0.15);">✓</div>
					<div>
						<h3 class="text-lg font-semibold mb-1" style="color:var(--ga-text);">¡Videos creados!</h3>
						<p class="text-sm" style="color:var(--ga-muted);">
							{completedClips} de {totalScenes} clips generados y guardados en tu panel de videos.
						</p>
					</div>

					<!-- Scene summary -->
					<div class="w-full grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(120px,1fr));">
						{#each scenes as scene}
							{#if scene.imageUrl}
								<div class="rounded-lg overflow-hidden relative" style="aspect-ratio:{platform==='reels'?'9/16':'16/9'};">
									<img src={scene.imageUrl} alt="Escena {scene.index+1}" class="w-full h-full object-cover" />
									{#if scene.clipStatus === 'done'}
										<div class="absolute bottom-1 right-1 text-xs px-1.5 py-0.5 rounded"
											style="background:rgba(34,197,94,0.8); color:#fff;">✓ clip</div>
									{:else if scene.clipStatus === 'error'}
										<div class="absolute bottom-1 right-1 text-xs px-1.5 py-0.5 rounded"
											style="background:rgba(253,54,88,0.8); color:#fff;">✗ error</div>
									{/if}
								</div>
							{/if}
						{/each}
					</div>

					<div class="flex gap-3 w-full">
						<button
							onclick={() => { open = false; goto('/image-video'); }}
							class="flex-1 py-3 rounded-xl font-semibold text-sm"
							style="background:var(--ga-gold); color:#000;"
						>
							Ver mis videos →
						</button>
						<button
							onclick={handleClose}
							class="px-5 py-3 rounded-xl text-sm"
							style="background:rgba(255,255,255,0.06); color:var(--ga-muted);"
						>
							Cerrar
						</button>
					</div>
				</div>

			<!-- ── ERROR PHASE ── -->
			{:else if phase === 'error'}
				<div class="px-6 py-10 flex flex-col items-center gap-5 text-center">
					<div class="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
						style="background:rgba(253,54,88,0.15);">✗</div>
					<div>
						<h3 class="text-lg font-semibold mb-1" style="color:var(--ga-text);">Algo salió mal</h3>
						<p class="text-sm" style="color:var(--ga-muted);">{errorMsg}</p>
					</div>
					<div class="flex gap-3">
						<button
							onclick={() => { phase = 'config'; errorMsg = null; }}
							class="px-6 py-2.5 rounded-xl text-sm font-medium"
							style="background:var(--ga-gold); color:#000;"
						>Reintentar</button>
						<button
							onclick={handleClose}
							class="px-6 py-2.5 rounded-xl text-sm"
							style="background:rgba(255,255,255,0.06); color:var(--ga-muted);"
						>Cerrar</button>
					</div>
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
