<script lang="ts">
	import type { PageData } from './$types.js';
	import type { VideoClip } from '$lib/server/db/schema.js';

	let { data }: { data: PageData } = $props();
	const { project, track } = data;
	const planTier      = data.planTier as string;
	const hasStripe     = data.hasStripe as boolean;
	const connectedAccounts = $state((data.connectedAccounts ?? []) as { platform: string; platformUsername?: string | null; platformAvatar?: string | null }[]);

	// ── Export/Publish panel ───────────────────────────────────────────────────
	let showExportPanel = $state(false);
	let exportTab       = $state<'download' | 'publish'>('download');
	let selectedQuality = $state('720p');
	let downloadBusy    = $state(false);
	let downloadMsg     = $state('');
	let publishTarget   = $state('');
	let publishBusy     = $state(false);
	let publishMsg      = $state('');
	let publishTitle    = $state((track as {title?:string}).title ?? '');
	let publishDesc     = $state('');
	let publishPrivacy  = $state<'public'|'private'|'unlisted'>('public');

	const QUALITY_TIERS = [
		{ id: '720p',  label: '720p HD',  badge: 'HD',  plans: ['free','starter','pro','advanced'] },
		{ id: '1080p', label: '1080p FHD', badge: 'FHD', plans: ['starter','pro','advanced'] },
		{ id: '4k',    label: '4K UHD',    badge: '4K',  plans: ['pro','advanced'] },
		{ id: '8k',    label: '8K',        badge: '8K',  plans: ['advanced'] },
	];

	// ── Right panel tabs ──────────────────────────────────────────────────────
	let rightTab = $state<'scenes' | 'agent' | 'upload' | 'history'>('agent');

	// ── History ───────────────────────────────────────────────────────────────
	type HistoryItem = {
		id: string;
		status: string | null;
		config: Record<string,string> | null;
		clips: { clipStatus?: string; clipUrl?: string }[] | null;
		createdAt: string;
		updatedAt: string;
		trackTitle: string | null;
		trackCoverUrl: string | null;
	};
	const history = (data.history ?? []) as HistoryItem[];

	function historyDoneCount(h: HistoryItem) {
		return (h.clips ?? []).filter(c => c.clipStatus === 'done').length;
	}
	function historyTotalCount(h: HistoryItem) {
		return (h.clips ?? []).length;
	}
	function historyStatusColor(h: HistoryItem) {
		if (h.status === 'editor' || h.status === 'done') return '#4ade80';
		if (h.status === 'rendering') return 'var(--ga-gold)';
		if (h.status === 'storyboard') return 'var(--ga-purple)';
		return 'var(--ga-muted)';
	}
	function historyStatusLabel(h: HistoryItem) {
		const map: Record<string,string> = { config:'Config', script:'Guión', storyboard:'Storyboard', rendering:'Renderizando', editor:'Listo', done:'Publicado' };
		return map[h.status ?? ''] ?? h.status ?? '—';
	}
	function fmtDate(iso: string) {
		const d = new Date(iso);
		return d.toLocaleDateString('es', { day:'2-digit', month:'short', year:'numeric' });
	}

	// ── AI Chat Agent ─────────────────────────────────────────────────────────
	interface ChatMsg { role: 'user'|'assistant'; content: string; suggestions?: {id:string;label:string;description:string}[]; requiresConfirm?: boolean; pendingUpdates?: unknown[]; }
	let chatHistory = $state<ChatMsg[]>([
		{ role: 'assistant', content: '👋 ¡Hola! Soy tu agente de edición de video. Puedo aplicar efectos, editar escenas, sugerir transiciones, remixiar el audio con Suno y mucho más. ¿En qué te ayudo?' }
	]);
	let chatInput   = $state('');
	let chatBusy    = $state(false);
	let chatEl      = $state<HTMLDivElement|undefined>(undefined);
	let pendingSuggestion = $state<{id:string;label:string;description:string}[]|null>(null);

	const QUICK_EFFECTS = [
		{ id: 'cinematic_lut',  label: 'Cine',       icon: '🎬', prompt: 'Apply cinematic orange and teal color grading' },
		{ id: 'neon_glow',      label: 'Neón',       icon: '💜', prompt: 'Add vibrant neon glow effect with purple and pink tones' },
		{ id: 'vintage',        label: 'Vintage',    icon: '📽', prompt: 'Apply vintage film grain and warm sepia tones' },
		{ id: 'slow_motion',    label: 'Slow-mo',    icon: '🐢', prompt: 'Cinematic slow motion with motion blur' },
		{ id: 'rain',           label: 'Lluvia',     icon: '🌧', prompt: 'Add heavy rain atmosphere with dark moody lighting' },
		{ id: 'smoke',          label: 'Humo',       icon: '🌫', prompt: 'Mystical smoke and fog effect in background' },
		{ id: 'glitch',         label: 'Glitch',     icon: '⚡', prompt: 'Digital glitch cyberpunk distortion effect' },
		{ id: 'golden_hour',    label: 'Dorado',     icon: '🌅', prompt: 'Golden hour warm sunset lighting, lens flare' },
	];

	async function sendChat(msg?: string) {
		const text = (msg ?? chatInput).trim();
		if (!text || chatBusy) return;
		chatInput = '';
		chatBusy = true;
		chatHistory = [...chatHistory, { role: 'user', content: text }];
		scrollChat();

		try {
			const r = await fetch(`/api/video-projects/${project.id}/workspace-agent`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: text,
					history: chatHistory.slice(-10).map(m => ({ role: m.role, content: m.content })),
					pendingSuggestion,
				}),
			});
			const d = await r.json() as { reply?: string; suggestions?: typeof QUICK_EFFECTS; sceneUpdates?: unknown[]; requiresConfirm?: boolean; audioAction?: string; error?: string };

			if (d.error) {
				chatHistory = [...chatHistory, { role: 'assistant', content: `❌ ${d.error}` }];
			} else {
				const assistantMsg: ChatMsg = {
					role: 'assistant',
					content: d.reply ?? '...',
					suggestions: d.suggestions as ChatMsg['suggestions'],
					requiresConfirm: d.requiresConfirm,
					pendingUpdates: d.sceneUpdates as unknown[],
				};
				chatHistory = [...chatHistory, assistantMsg];
				if (d.suggestions?.length) pendingSuggestion = d.suggestions as {id:string;label:string;description:string}[];
				if (d.sceneUpdates?.length && !d.requiresConfirm) {
					// Refresh clips from DB
					const pr = await fetch(`/api/video-projects/${project.id}`).catch(()=>null);
					if (pr?.ok) { const pd = await pr.json() as {clips?:VideoClip[]}; if (pd.clips) clips = pd.clips; }
				}
			}
		} catch (e) {
			chatHistory = [...chatHistory, { role: 'assistant', content: `❌ Error: ${e instanceof Error ? e.message : String(e)}` }];
		} finally {
			chatBusy = false;
			scrollChat();
		}
	}

	async function confirmSuggestion(confirmed: boolean) {
		if (!pendingSuggestion) return;
		if (!confirmed) { pendingSuggestion = null; chatHistory = [...chatHistory, { role: 'user', content: '❌ No, cancela los cambios.' }]; await sendChat('Cancelado por el usuario.'); return; }
		const prev = [...chatHistory];
		pendingSuggestion = null;
		chatHistory = [...prev, { role: 'user', content: '✓ Sí, aplica los cambios.' }];
		chatBusy = true;
		// Re-send with confirmed=true
		try {
			const r = await fetch(`/api/video-projects/${project.id}/workspace-agent`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: '✓ Confirmar', history: chatHistory.slice(-8).map(m=>({role:m.role,content:m.content})), confirmed: true }),
			});
			const d = await r.json() as { reply?: string };
			chatHistory = [...chatHistory, { role: 'assistant', content: d.reply ?? '✓ Cambios aplicados.' }];
		} finally { chatBusy = false; scrollChat(); }
	}

	function scrollChat() {
		setTimeout(() => chatEl?.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' }), 50);
	}

	// ── Upload ────────────────────────────────────────────────────────────────
	let uploadBusy   = $state(false);
	let uploadMsg    = $state('');
	let uploadTarget = $state<'video'|'audio'>('video');
	let uploadSceneIdx = $state(0);

	async function handleUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || uploadBusy) return;
		uploadBusy = true; uploadMsg = '';
		const form = new FormData();
		form.append('type', uploadTarget);
		form.append('file', file);
		if (uploadTarget === 'video') form.append('sceneIndex', String(uploadSceneIdx));
		try {
			const r = await fetch(`/api/video-projects/${project.id}/upload`, { method: 'POST', body: form });
			const d = await r.json() as { ok?: boolean; url?: string; error?: string };
			if (d.error) { uploadMsg = `Error: ${d.error}`; return; }
			uploadMsg = `✓ ${uploadTarget === 'video' ? 'Video' : 'Audio'} subido correctamente.`;
			if (uploadTarget === 'video') {
				const pr = await fetch(`/api/video-projects/${project.id}`).catch(()=>null);
				if (pr?.ok) { const pd = await pr.json() as {clips?:VideoClip[]}; if (pd.clips) clips = pd.clips; }
			}
		} catch (err) { uploadMsg = `Error: ${err instanceof Error ? err.message : String(err)}`; }
		finally { uploadBusy = false; input.value = ''; }
	}

	const SOCIAL_PLATFORMS = [
		{ id: 'youtube',   label: 'YouTube',   icon: '▶', color: '#FF0000', needsSetup: false },
		{ id: 'tiktok',    label: 'TikTok',    icon: '🎵', color: '#010101', needsSetup: true  },
		{ id: 'instagram', label: 'Instagram', icon: '📷', color: '#E1306C', needsSetup: true  },
		{ id: 'facebook',  label: 'Facebook',  icon: '📘', color: '#1877F2', needsSetup: true  },
		{ id: 'twitter',   label: 'Twitter/X', icon: '𝕏',  color: '#000000', needsSetup: true  },
	];

	const PLAN_LABELS: Record<string, string> = { free:'Free', starter:'Starter', pro:'Pro', advanced:'Advanced' };

	function isQualityLocked(qid: string) {
		const tier = QUALITY_TIERS.find(t => t.id === qid);
		return !tier?.plans.includes(planTier);
	}

	function isConnected(platform: string) {
		return connectedAccounts.some(a => a.platform === platform);
	}

	function connectedUser(platform: string) {
		return connectedAccounts.find(a => a.platform === platform)?.platformUsername ?? null;
	}

	function connectPlatform(platform: string) {
		if (platform === 'youtube') {
			window.location.href = `/auth/social?provider=google&scope=youtube.upload&redirect=/workspace/${project.id}`;
		} else {
			publishMsg = `Para conectar ${platform}, configura las credenciales de API en el panel de administración.`;
		}
	}

	async function downloadVideo() {
		if (downloadBusy) return;
		downloadBusy = true; downloadMsg = '';
		try {
			const r = await fetch('/api/export/download', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ projectId: project.id, quality: selectedQuality }),
			});
			const d = await r.json() as { downloadUrl?: string; error?: string; upgrade?: boolean; note?: string };
			if (d.upgrade) { downloadMsg = `⬆ ${d.error}`; return; }
			if (d.error)   { downloadMsg = `Error: ${d.error}`; return; }
			if (d.downloadUrl) {
				const a = document.createElement('a');
				a.href = d.downloadUrl;
				a.download = `${(track as {title?:string}).title ?? 'video'}_${selectedQuality}.mp4`;
				a.click();
				downloadMsg = d.note ?? `✓ Descargando en ${selectedQuality}`;
			}
		} catch (e) { downloadMsg = `Error: ${e instanceof Error ? e.message : String(e)}`; }
		finally { downloadBusy = false; }
	}

	async function publishVideo() {
		if (!publishTarget || publishBusy) return;
		if (!isConnected(publishTarget)) { publishMsg = 'Conecta la cuenta primero'; return; }
		publishBusy = true; publishMsg = '';
		try {
			const r = await fetch('/api/social/publish', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectId: project.id,
					platform: publishTarget,
					title: publishTitle,
					description: publishDesc,
					privacy: publishPrivacy,
				}),
			});
			const d = await r.json() as { ok?: boolean; url?: string; error?: string };
			if (d.error) { publishMsg = `Error: ${d.error}`; return; }
			publishMsg = `✓ Publicado${d.url ? ` → ${d.url}` : ''}`;
		} catch (e) { publishMsg = `Error: ${e instanceof Error ? e.message : String(e)}`; }
		finally { publishBusy = false; }
	}

	// ── Platform / format presets ──────────────────────────────────────────────
	const FORMATS = [
		{ id: 'cinema',    label: '🎬 Cine',        ar: '16/9', badge: '1920×1080' },
		{ id: 'youtube',   label: '▶ YouTube',      ar: '16/9', badge: '16:9' },
		{ id: 'tiktok',    label: '🎵 TikTok',      ar: '9/16', badge: '9:16' },
		{ id: 'reels',     label: '📷 Reels',       ar: '9/16', badge: '9:16' },
		{ id: 'shorts',    label: '▶ YT Shorts',   ar: '9/16', badge: '9:16' },
		{ id: 'facebook',  label: '📘 Facebook',    ar: '16/9', badge: '16:9' },
		{ id: 'ig_post',   label: '📸 Post IG',     ar: '4/5',  badge: '4:5' },
	] as const;
	type FormatId = typeof FORMATS[number]['id'];

	// Detect initial format from project config
	const cfgPlatform = (project.config as { platform?: string } | null)?.platform ?? 'tiktok';
	const initFormat: FormatId = (cfgPlatform === 'youtube' ? 'youtube' : 'tiktok') as FormatId;

	let activeFormat = $state<FormatId>(initFormat);
	const fmt = $derived(FORMATS.find(f => f.id === activeFormat) ?? FORMATS[0]);
	const isPortrait = $derived(fmt.ar === '9/16' || fmt.ar === '4/5');

	// ── Playback state ────────────────────────────────────────────────────────
	let clips          = $state<VideoClip[]>((project.clips ?? project.scenes ?? []) as VideoClip[]);
	let masterTime     = $state(0);
	let isPlaying      = $state(false);
	let atEnd          = $state(false);
	let currentClipIdx = $state(0);
	let activeVid      = $state<0 | 1>(0);

	let audioEl  = $state<HTMLAudioElement | undefined>(undefined);
	let videoA   = $state<HTMLVideoElement | undefined>(undefined);
	let videoB   = $state<HTMLVideoElement | undefined>(undefined);

	// ── AI state ──────────────────────────────────────────────────────────────
	let aiPanel  = $state<number | null>(null);
	let aiText   = $state('');
	let aiLoading = $state(false);
	let aiMsg    = $state('');

	// ── Derived ───────────────────────────────────────────────────────────────
	const totalSec  = $derived(clips.length > 0 ? (clips[clips.length - 1]?.endSec ?? 0) : 0);
	const doneClips = $derived(clips.filter(c => c.clipStatus === 'done' && c.clipUrl));
	const allDone   = $derived(clips.length > 0 && clips.every(c => c.clipStatus === 'done' || c.clipStatus === 'error'));
	const audioUrl  = (track as { audioUrl?: string }).audioUrl ?? '';

	function fmtTime(s: number) {
		const m = Math.floor(s / 60);
		return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
	}

	// ── A/B crossfade ─────────────────────────────────────────────────────────
	function getActive()   { return activeVid === 0 ? videoA : videoB; }
	function getInactive() { return activeVid === 0 ? videoB : videoA; }

	function clipAtTime(t: number) {
		for (let i = doneClips.length - 1; i >= 0; i--)
			if (t >= doneClips[i].startSec) return i;
		return 0;
	}

	function switchClip(index: number, offset: number) {
		const clip = doneClips[index];
		if (!clip?.clipUrl) return;
		const active = getActive();
		if (index === currentClipIdx) {
			if (active && Math.abs(active.currentTime - offset) > 0.3) active.currentTime = offset;
			return;
		}
		const inactive = getInactive();
		if (!inactive) return;
		inactive.src = clip.clipUrl;
		inactive.load();
		inactive.currentTime = offset;
		inactive.muted = true;
		if (isPlaying) inactive.play().catch(() => {});
		const old = active;
		activeVid = activeVid === 0 ? 1 : 0;
		currentClipIdx = index;
		setTimeout(() => old?.pause(), 400);
	}

	// ── Master clock ──────────────────────────────────────────────────────────
	function onTimeUpdate() {
		if (!audioEl) return;
		const t = audioEl.currentTime;
		if (totalSec > 0 && t >= totalSec) {
			audioEl.pause(); audioEl.currentTime = totalSec;
			getActive()?.pause();
			masterTime = totalSec; isPlaying = false; atEnd = true;
			return;
		}
		masterTime = t;
		if (!doneClips.length) return;
		const idx = clipAtTime(t);
		const clip = doneClips[idx];
		if (clip) switchClip(idx, Math.max(0, t - clip.startSec));
	}

	// ── Controls ──────────────────────────────────────────────────────────────
	function togglePlay() {
		if (!audioEl) return;
		if (atEnd) {
			atEnd = false; masterTime = 0; currentClipIdx = 0; audioEl.currentTime = 0;
			const first = doneClips[0];
			if (first?.clipUrl) {
				const a = getActive();
				if (a) { a.src = first.clipUrl; a.load(); a.currentTime = 0; }
			}
			audioEl.play().catch(() => {}); isPlaying = true; return;
		}
		if (isPlaying) { audioEl.pause(); getActive()?.pause(); isPlaying = false; }
		else { audioEl.play().catch(() => {}); getActive()?.play().catch(() => {}); isPlaying = true; }
	}

	function seekTo(sec: number) {
		if (!audioEl) return;
		atEnd = false; masterTime = sec; audioEl.currentTime = sec;
		if (!doneClips.length) return;
		const idx = clipAtTime(sec);
		const clip = doneClips[idx];
		if (!clip) return;
		const a = getActive();
		if (a) { a.src = clip.clipUrl!; a.load(); a.currentTime = Math.max(0, sec - clip.startSec); if (isPlaying) a.play().catch(() => {}); }
		currentClipIdx = idx;
	}

	// ── Init ──────────────────────────────────────────────────────────────────
	$effect(() => {
		const first = doneClips[0];
		if (first?.clipUrl && videoA && !videoA.src) { videoA.src = first.clipUrl; videoA.load(); }
	});

	// ── Poll webhook clips ────────────────────────────────────────────────────
	$effect(() => {
		if (!clips.some(c => c.clipStatus === 'generating' && c.taskId)) return;
		const t = setInterval(async () => {
			const r = await fetch(`/api/video-projects/${project.id}`).catch(() => null);
			if (!r?.ok) return;
			const d = await r.json() as { clips?: VideoClip[] };
			if (d.clips) clips = d.clips;
		}, 5000);
		return () => clearInterval(t);
	});

	// ── AI Agent ──────────────────────────────────────────────────────────────
	async function runAI(idx: number) {
		if (!aiText.trim() || aiLoading) return;
		aiLoading = true; aiMsg = '';
		try {
			const r = await fetch(`/api/video-projects/${project.id}/ai-scene-edit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sceneIndex: idx, userRequest: aiText }),
			});
			const d = await r.json() as { newPrompt?: string; newCameraMovement?: string; newDescription?: string; error?: string };
			if (d.error) { aiMsg = `Error: ${d.error}`; return; }
			if (d.newPrompt) {
				clips = clips.map((c, i) => i === idx
					? { ...c, prompt: d.newPrompt!, cameraMovement: d.newCameraMovement ?? c.cameraMovement, description: d.newDescription ?? c.description, imageStatus: 'pending', imageUrl: undefined, clipUrl: undefined, clipStatus: 'pending' }
					: c);
				aiMsg = '✓ Escena actualizada — regenera la imagen para aplicar.';
				aiText = '';
			}
		} catch (e) { aiMsg = `Error: ${e instanceof Error ? e.message : String(e)}`; }
		finally { aiLoading = false; }
	}

	async function regenImage(idx: number) {
		clips[idx] = { ...clips[idx], imageStatus: 'generating' };
		const r = await fetch(`/api/video-projects/${project.id}/storyboard`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sceneIndex: idx }),
		}).catch(() => null);
		const d = r?.ok ? await r.json() as { imageUrl?: string } : {};
		clips[idx] = d.imageUrl
			? { ...clips[idx], imageUrl: d.imageUrl, imageStatus: 'done' }
			: { ...clips[idx], imageStatus: 'error' };
	}

	async function regenClip(idx: number) {
		clips[idx] = { ...clips[idx], clipStatus: 'generating' };
		const r = await fetch(`/api/video-projects/${project.id}/render`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sceneIndex: idx }),
		}).catch(() => null);
		const d = r?.ok ? await r.json() as { clipUrl?: string; pending?: boolean } : {};
		if (d.clipUrl) clips[idx] = { ...clips[idx], clipUrl: d.clipUrl, clipStatus: 'done' };
		else if (!d.pending) clips[idx] = { ...clips[idx], clipStatus: 'error' };
	}
</script>

<!-- ══════════════════════════════════════════════════════════════════════════
     TOP BAR
══════════════════════════════════════════════════════════════════════════ -->
<header class="fixed top-0 inset-x-0 z-50 h-12 flex items-center gap-4 px-4 border-b" style="background:var(--ga-dark);border-color:var(--ga-border);">
	<a href="/create-video/{(track as {id:string}).id}" class="text-xs shrink-0 opacity-60 hover:opacity-100 transition-opacity" style="color:var(--ga-muted);">← Pipeline</a>
	<span class="text-xs font-bold truncate" style="color:var(--ga-gold);">{(track as {title?:string}).title ?? 'Sin título'}</span>

	<!-- Format picker -->
	<div class="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1" style="min-width:0;">
		{#each FORMATS as f}
			<button
				onclick={() => activeFormat = f.id}
				class="text-[10px] px-2.5 py-1 rounded-full shrink-0 font-medium transition-all"
				style={activeFormat === f.id
					? 'background:var(--ga-gold);color:#000;'
					: 'background:rgba(255,255,255,0.06);color:var(--ga-muted);'}
			>{f.label}</button>
		{/each}
	</div>

	<!-- Status chip -->
	{#if allDone}
		<span class="text-[10px] px-2 py-0.5 rounded-full shrink-0 font-semibold" style="background:rgba(34,197,94,0.15);color:#4ade80;">✓ {doneClips.length} clips</span>
	{:else}
		<span class="text-[10px] px-2 py-0.5 rounded-full shrink-0" style="background:rgba(255,255,255,0.05);color:var(--ga-muted);">{doneClips.length}/{clips.length} clips</span>
	{/if}

	<!-- Export button -->
	<button
		onclick={() => showExportPanel = !showExportPanel}
		class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-all"
		style="background:{showExportPanel ? 'var(--ga-gold)' : 'rgba(212,175,55,0.15)'};color:{showExportPanel ? '#000' : 'var(--ga-gold)'};"
	>
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
		Exportar
	</button>
</header>

<!-- ══════════════════════════════════════════════════════════════════════════
     BODY: [Player + Timeline] | [Scene panel]
══════════════════════════════════════════════════════════════════════════ -->
<div class="pt-12 flex h-screen overflow-hidden" style="background:#0a0a0f;">

	<!-- ── Left: Player area ──────────────────────────────────────────────── -->
	<div class="flex flex-col flex-1 min-w-0 overflow-hidden">

		<!-- Player stage: fills available height above transport -->
		<div class="flex-1 flex items-center justify-center min-h-0 p-4" style="background:#0d0d14;">

			<!-- Outer frame — mimics the target platform bezel -->
			<div class="relative flex flex-col items-center justify-center" style="height:100%;max-height:calc(100vh - 220px);">

				<!-- Platform label above player -->
				<div class="flex items-center gap-2 mb-2">
					<span class="text-[10px] font-bold uppercase tracking-widest" style="color:var(--ga-muted);">{fmt.label}</span>
					<span class="text-[9px] px-1.5 py-0.5 rounded" style="background:rgba(255,255,255,0.06);color:var(--ga-muted);">{fmt.badge}</span>
				</div>

				<!-- Video box — correct aspect ratio, centered, shadow frame -->
				<div
					class="relative overflow-hidden"
					style="
						aspect-ratio:{fmt.ar};
						{isPortrait ? 'height:100%;max-height:calc(100vh - 220px);' : 'width:100%;max-width:calc(100vw - 440px);'}
						background:#000;
						border-radius:8px;
						box-shadow:0 0 0 1px rgba(255,255,255,0.08), 0 20px 60px rgba(0,0,0,0.6);
					"
				>
					<!-- Letterbox bars for cinema -->
					{#if activeFormat === 'cinema'}
						<div class="absolute inset-x-0 top-0 h-[5%] z-10" style="background:#000;"></div>
						<div class="absolute inset-x-0 bottom-0 h-[5%] z-10" style="background:#000;"></div>
					{/if}

					{#if doneClips.length > 0}
						<video bind:this={videoA} muted playsinline
							class="absolute inset-0 w-full h-full"
							style="object-fit:{isPortrait ? 'cover' : 'contain'};opacity:{activeVid===0?1:0};transition:opacity 0.35s ease;"></video>
						<video bind:this={videoB} muted playsinline
							class="absolute inset-0 w-full h-full"
							style="object-fit:{isPortrait ? 'cover' : 'contain'};opacity:{activeVid===1?1:0};transition:opacity 0.35s ease;"></video>
					{:else}
						<div class="absolute inset-0 flex flex-col items-center justify-center gap-3">
							<div class="w-14 h-14 rounded-full flex items-center justify-center" style="background:rgba(255,255,255,0.04);">
								<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--ga-muted);"><polygon points="5 3 19 12 5 21 5 3"/></svg>
							</div>
							<p class="text-xs text-center" style="color:var(--ga-muted);">Sin clips listos</p>
						</div>
					{/if}

					<!-- Overlay: current clip badge -->
					{#if isPlaying && doneClips[currentClipIdx]}
						<div class="absolute top-2 left-2 z-20 text-[9px] px-2 py-0.5 rounded font-mono" style="background:rgba(0,0,0,0.6);color:var(--ga-gold);">
							#{currentClipIdx + 1} · {fmtTime(masterTime)}
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- ── Transport controls ──────────────────────────────────────────── -->
		<div class="px-5 py-3 flex items-center gap-4 border-t" style="background:var(--ga-dark);border-color:var(--ga-border);">
			<!-- Play / Pause / Replay -->
			<button onclick={togglePlay}
				class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-transform hover:scale-105 active:scale-95"
				style="background:{atEnd ? 'var(--ga-purple)' : 'var(--ga-gold)'};"
				title={atEnd ? 'Reproducir de nuevo' : isPlaying ? 'Pausar' : 'Reproducir'}
			>
				{#if atEnd}
					<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
				{:else if isPlaying}
					<svg width="14" height="14" viewBox="0 0 14 14" fill="#000"><rect x="2" y="1" width="4" height="12" rx="1"/><rect x="8" y="1" width="4" height="12" rx="1"/></svg>
				{:else}
					<svg width="14" height="14" viewBox="0 0 14 14" fill="#000"><path d="M3 1.5l9 5.5-9 5.5V1.5z"/></svg>
				{/if}
			</button>

			<!-- Time -->
			<span class="text-sm font-mono shrink-0 tabular-nums" style="color:{atEnd ? 'var(--ga-gold)' : 'var(--ga-muted)'};">
				{fmtTime(masterTime)} <span style="opacity:0.4;">/</span> {fmtTime(totalSec)}
			</span>

			<!-- Scrubber -->
			<div class="flex-1 relative h-2 rounded-full cursor-pointer group"
				style="background:rgba(255,255,255,0.08);"
				onclick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekTo(((e.clientX - r.left) / r.width) * totalSec); }}
			>
				<!-- Filled -->
				<div class="absolute left-0 top-0 h-full rounded-full pointer-events-none" style="width:{totalSec>0?(masterTime/totalSec)*100:0}%;background:var(--ga-gold);"></div>
				<!-- Clip segments -->
				{#each clips as c}
					{#if totalSec > 0}
						<div class="absolute top-0 h-full pointer-events-none opacity-30"
							style="left:{(c.startSec/totalSec)*100}%;width:{((c.endSec-c.startSec)/totalSec)*100}%;border-left:1px solid rgba(255,255,255,0.3);"></div>
					{/if}
				{/each}
				<!-- Thumb -->
				{#if totalSec > 0}
					<div class="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 pointer-events-none"
						style="left:{(masterTime/totalSec)*100}%;transform:translate(-50%,-50%);background:var(--ga-gold);border-color:var(--ga-dark);box-shadow:0 0 6px var(--ga-gold);"></div>
				{/if}
			</div>

			{#if atEnd}
				<span class="text-[10px] font-semibold shrink-0" style="color:var(--ga-gold);">FIN</span>
			{/if}
		</div>

		<!-- ── Timeline ───────────────────────────────────────────────────── -->
		{#if totalSec > 0}
			<div class="px-5 py-2 border-t" style="background:rgba(0,0,0,0.3);border-color:var(--ga-border);">
				<div class="relative h-7 rounded-lg overflow-hidden" style="background:rgba(255,255,255,0.03);border:1px solid var(--ga-border);">
					{#each clips as c, i}
						<div
							class="absolute top-1 bottom-1 rounded-sm cursor-pointer transition-all hover:brightness-125"
							style="
								left:{(c.startSec/totalSec)*100}%;
								width:{((c.endSec-c.startSec)/totalSec)*100}%;
								background:{c.type==='vocals'?'rgba(253,54,88,0.55)':'rgba(142,85,234,0.55)'};
								outline:{i===currentClipIdx&&c.clipUrl?'1px solid var(--ga-gold)':'none'};
							"
							onclick={() => seekTo(c.startSec)}
							title="Escena {i+1}: {fmtTime(c.startSec)}–{fmtTime(c.endSec)}"
						></div>
					{/each}
					<!-- Playhead -->
					<div class="absolute top-0 bottom-0 w-px pointer-events-none"
						style="left:{(masterTime/totalSec)*100}%;background:var(--ga-gold);box-shadow:0 0 6px var(--ga-gold);">
						<div class="absolute -top-px left-1/2 -translate-x-1/2 w-2 h-2 rotate-45" style="background:var(--ga-gold);"></div>
					</div>
				</div>
				<div class="flex gap-3 mt-1">
					<span class="text-[8px] flex items-center gap-1" style="color:var(--ga-muted);"><span class="inline-block w-2.5 h-1.5 rounded-sm" style="background:rgba(253,54,88,0.55);"></span>Vocals</span>
					<span class="text-[8px] flex items-center gap-1" style="color:var(--ga-muted);"><span class="inline-block w-2.5 h-1.5 rounded-sm" style="background:rgba(142,85,234,0.55);"></span>Instrumental</span>
				</div>
			</div>
		{/if}
	</div>

	<!-- ── Right: Tabbed panel ───────────────────────────────────────────── -->
	<div class="shrink-0 flex flex-col border-l overflow-hidden" style="width:360px;border-color:var(--ga-border);">

		<!-- Tab bar -->
		<div class="flex border-b shrink-0" style="border-color:var(--ga-border);">
			{#each [['agent','🤖 Agente'],['scenes','🎬 Escenas'],['upload','⬆ Subir'],['history','🕘 Historial']] as [tab, label]}
				<button onclick={() => rightTab = tab as 'agent'|'scenes'|'upload'|'history'}
					class="flex-1 py-2.5 text-[9px] font-bold transition-all"
					style="color:{rightTab===tab?'var(--ga-gold)':'var(--ga-muted)'};border-bottom:2px solid {rightTab===tab?'var(--ga-gold)':'transparent'};">
					{label}
				</button>
			{/each}
		</div>

		<!-- ── AGENT TAB ──────────────────────────────────────────────────── -->
		{#if rightTab === 'agent'}
			<div class="flex flex-col flex-1 overflow-hidden">

				<!-- Quick effects bar -->
				<div class="px-3 py-2 border-b shrink-0" style="border-color:var(--ga-border);">
					<p class="text-[8px] uppercase tracking-widest mb-1.5" style="color:var(--ga-muted);">Efectos rápidos</p>
					<div class="grid grid-cols-4 gap-1.5">
						{#each QUICK_EFFECTS as ef}
							<button
								onclick={() => sendChat(`Aplica el efecto "${ef.label}" al video: ${ef.prompt}`)}
								class="flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-lg transition-all hover:brightness-125"
								style="background:rgba(255,255,255,0.04);border:1px solid var(--ga-border);"
								title={ef.prompt}
							>
								<span class="text-lg leading-none">{ef.icon}</span>
								<span class="text-[7px] font-semibold" style="color:var(--ga-muted);">{ef.label}</span>
							</button>
						{/each}
					</div>
				</div>

				<!-- Chat messages -->
				<div bind:this={chatEl} class="flex-1 overflow-y-auto p-3 space-y-3">
					{#each chatHistory as msg, i}
						<div class="flex {msg.role==='user'?'justify-end':'justify-start'}">
							<div class="max-w-[85%] rounded-2xl px-3 py-2 text-[10px] leading-relaxed whitespace-pre-wrap"
								style="
									background:{msg.role==='user'?'var(--ga-purple)':'rgba(255,255,255,0.05)'};
									color:{msg.role==='user'?'#fff':'var(--ga-text)'};
									border-radius:{msg.role==='user'?'18px 18px 4px 18px':'18px 18px 18px 4px'};
								"
							>{msg.content}</div>
						</div>

						<!-- Suggestions grid -->
						{#if msg.suggestions?.length}
							<div class="space-y-1">
								{#each msg.suggestions as sug}
									<div class="px-3 py-2 rounded-lg text-[9px]" style="background:rgba(142,85,234,0.08);border:1px solid rgba(142,85,234,0.2);">
										<p class="font-bold" style="color:var(--ga-purple);">{sug.label}</p>
										<p style="color:var(--ga-muted);">{sug.description}</p>
									</div>
								{/each}
								{#if msg.requiresConfirm && i === chatHistory.length - 1}
									<div class="flex gap-2 mt-1">
										<button onclick={() => confirmSuggestion(true)} class="flex-1 text-[9px] py-1.5 rounded-lg font-bold" style="background:rgba(34,197,94,0.15);color:#4ade80;">✓ Aplicar</button>
										<button onclick={() => confirmSuggestion(false)} class="flex-1 text-[9px] py-1.5 rounded-lg font-bold" style="background:rgba(248,113,113,0.1);color:#f87171;">✗ Cancelar</button>
									</div>
								{/if}
							</div>
						{/if}
					{/each}

					{#if chatBusy}
						<div class="flex justify-start">
							<div class="px-3 py-2 rounded-2xl text-[10px]" style="background:rgba(255,255,255,0.05);color:var(--ga-muted);">
								<span class="animate-pulse">···</span>
							</div>
						</div>
					{/if}
				</div>

				<!-- Chat input -->
				<div class="p-3 border-t shrink-0" style="border-color:var(--ga-border);">
					<div class="flex gap-2">
						<input
							bind:value={chatInput}
							placeholder='Pídeme cualquier cosa: efectos, escenas, remix...'
							class="flex-1 text-xs px-3 py-2 rounded-xl"
							style="background:rgba(255,255,255,0.05);border:1px solid var(--ga-border);color:var(--ga-text);"
							onkeydown={(e) => e.key === 'Enter' && !e.shiftKey && sendChat()}
						/>
						<button onclick={() => sendChat()} disabled={chatBusy || !chatInput.trim()}
							class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
							style="background:{chatBusy||!chatInput.trim()?'rgba(255,255,255,0.05)':'var(--ga-purple)'};color:{chatBusy||!chatInput.trim()?'var(--ga-muted)':'#fff'};">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
						</button>
					</div>
					<div class="flex gap-1.5 mt-2 flex-wrap">
						{#each ['Remix el audio con Suno','Agrega transición de fuego','Haz la escena 1 más dramática','Sugiere efectos para el coro'] as sug}
							<button onclick={() => { chatInput = sug; sendChat(sug); }}
								class="text-[8px] px-2 py-0.5 rounded-full"
								style="background:rgba(142,85,234,0.08);color:var(--ga-purple);border:1px solid rgba(142,85,234,0.15);"
							>{sug}</button>
						{/each}
					</div>
				</div>
			</div>

		<!-- ── SCENES TAB ─────────────────────────────────────────────────── -->
		{:else if rightTab === 'scenes'}
			<div class="flex-1 overflow-y-auto p-3 space-y-2">
				<p class="text-[9px] mb-2" style="color:var(--ga-muted);">{clips.length} escenas · Haz clic en una para ir ahí</p>
				{#each clips as clip, i}
					{@const vc = clip as VideoClip}
					<div class="flex rounded-xl overflow-hidden cursor-pointer transition-all hover:brightness-110"
						style="border:1px solid {i===currentClipIdx&&vc.clipUrl?'var(--ga-gold)':'var(--ga-border)'};background:var(--ga-box);"
						onclick={() => vc.clipUrl && seekTo(vc.startSec)}
					>
						<div class="w-24 h-16 shrink-0 relative bg-black">
							{#if vc.clipUrl}
								<video src={vc.clipUrl} class="w-full h-full object-cover" muted playsinline></video>
							{:else if vc.imageUrl}
								<img src={vc.imageUrl} alt="Escena {i+1}" class="w-full h-full object-cover opacity-50" />
							{:else}
								<div class="absolute inset-0 flex items-center justify-center text-lg opacity-20">🎞</div>
							{/if}
							<div class="absolute bottom-1 left-1 text-[7px] px-1 rounded font-mono" style="background:rgba(0,0,0,0.8);color:var(--ga-muted);">{fmtTime(vc.startSec)}</div>
							<div class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style="background:{vc.clipStatus==='done'?'#4ade80':vc.clipStatus==='generating'?'var(--ga-gold)':vc.clipStatus==='error'?'#f87171':'rgba(255,255,255,0.2)'}"></div>
						</div>
						<div class="flex-1 p-2 min-w-0">
							<div class="flex items-center gap-1 mb-0.5">
								<span class="text-[7px] font-bold px-1 py-px rounded" style="background:{vc.type==='vocals'?'rgba(253,54,88,0.15)':'rgba(142,85,234,0.15)'};color:{vc.type==='vocals'?'var(--ga-pink)':'var(--ga-purple)'};">{vc.type==='vocals'?'🎤':'🎸'} #{i+1}</span>
							</div>
							<p class="text-[8px] line-clamp-2" style="color:var(--ga-muted);">{vc.description}</p>
							<div class="flex gap-1 mt-1">
								{#if vc.imageUrl && vc.clipStatus !== 'generating'}
									<button onclick={(e)=>{e.stopPropagation();regenClip(i);}} class="text-[7px] px-1.5 py-px rounded" style="background:rgba(255,255,255,0.05);color:var(--ga-muted);">↺ Clip</button>
								{/if}
								{#if vc.imageStatus === 'pending'}
									<button onclick={(e)=>{e.stopPropagation();regenImage(i);}} class="text-[7px] px-1.5 py-px rounded" style="background:rgba(245,158,11,0.08);color:var(--ga-gold);">🖼 Imagen</button>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>

		<!-- ── UPLOAD TAB ─────────────────────────────────────────────────── -->
		{:else}
			<div class="flex-1 overflow-y-auto p-4 space-y-5">
				<div>
					<h3 class="text-xs font-bold mb-1" style="color:var(--ga-text);">Subir video manual</h3>
					<p class="text-[9px] mb-3" style="color:var(--ga-muted);">Reemplaza el clip generado por IA con tu propio video.</p>

					<label class="text-[9px] font-semibold mb-1 block" style="color:var(--ga-muted);">ESCENA DESTINO</label>
					<select bind:value={uploadSceneIdx}
						class="w-full text-xs px-3 py-2 rounded-lg mb-3"
						style="background:rgba(255,255,255,0.05);border:1px solid var(--ga-border);color:var(--ga-text);">
						{#each clips as c, i}
							<option value={i}>Escena {i+1} — {fmtTime(c.startSec)}-{fmtTime(c.endSec)}</option>
						{/each}
					</select>

					<label class="flex flex-col items-center justify-center gap-2 w-full py-6 rounded-xl cursor-pointer transition-all hover:brightness-110"
						style="background:rgba(255,255,255,0.03);border:2px dashed var(--ga-border);"
					>
						<span class="text-2xl">🎬</span>
						<span class="text-xs font-semibold" style="color:var(--ga-muted);">Subir video (MP4, MOV, WebM)</span>
						<span class="text-[9px]" style="color:var(--ga-muted);">Máx 200 MB</span>
						<input type="file" accept="video/*" class="hidden"
							onchange={(e) => { uploadTarget = 'video'; handleUpload(e); }} />
					</label>
				</div>

				<div class="border-t pt-4" style="border-color:var(--ga-border);">
					<h3 class="text-xs font-bold mb-1" style="color:var(--ga-text);">Subir audio / pista</h3>
					<p class="text-[9px] mb-3" style="color:var(--ga-muted);">Reemplaza el audio de la canción o añade una pista nueva.</p>

					<label class="flex flex-col items-center justify-center gap-2 w-full py-6 rounded-xl cursor-pointer transition-all hover:brightness-110"
						style="background:rgba(255,255,255,0.03);border:2px dashed var(--ga-border);"
					>
						<span class="text-2xl">🎵</span>
						<span class="text-xs font-semibold" style="color:var(--ga-muted);">Subir audio (MP3, WAV, M4A)</span>
						<span class="text-[9px]" style="color:var(--ga-muted);">Máx 200 MB</span>
						<input type="file" accept="audio/*" class="hidden"
							onchange={(e) => { uploadTarget = 'audio'; handleUpload(e); }} />
					</label>
				</div>

				{#if uploadBusy}
					<div class="flex items-center gap-2 px-3 py-2 rounded-lg" style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);">
						<span class="animate-spin">⏳</span>
						<span class="text-xs" style="color:var(--ga-gold);">Subiendo archivo...</span>
					</div>
				{/if}
				{#if uploadMsg}
					<p class="text-xs px-3 py-2 rounded-lg" style="background:rgba(255,255,255,0.04);color:{uploadMsg.startsWith('✓')?'#4ade80':'#f87171'};">{uploadMsg}</p>
				{/if}

				<div class="border-t pt-4" style="border-color:var(--ga-border);">
					<h3 class="text-xs font-bold mb-1" style="color:var(--ga-text);">🎵 Remix con Suno</h3>
					<p class="text-[9px] mb-3" style="color:var(--ga-muted);">Pídele al agente que remixie el audio. Escribe en el chat: "Remix el audio con Suno en estilo..." y el agente activará la API automáticamente.</p>
					<button onclick={() => { rightTab = 'agent'; chatInput = 'Remix el audio con Suno en estilo'; }}
						class="w-full py-2.5 rounded-xl text-xs font-bold"
						style="background:rgba(142,85,234,0.1);color:var(--ga-purple);border:1px solid rgba(142,85,234,0.2);">
						Ir al agente para remix →
					</button>
				</div>
			</div>
		<!-- ── HISTORY TAB ───────────────────────────────────────────────── -->
		{:else if rightTab === 'history'}
			<div class="flex-1 overflow-y-auto">
				<!-- Current project header -->
				<div class="px-3 py-2 border-b" style="border-color:var(--ga-border);background:rgba(212,175,55,0.05);">
					<p class="text-[9px] font-bold uppercase tracking-widest mb-0.5" style="color:var(--ga-gold);">Proyecto actual</p>
					<p class="text-xs font-semibold truncate" style="color:var(--ga-text);">{(track as {title?:string}).title ?? 'Sin título'}</p>
					<p class="text-[9px]" style="color:var(--ga-muted);">{doneClips.length}/{clips.length} clips · {allDone ? '✓ Listo' : 'En progreso'}</p>
				</div>

				{#if history.length === 0}
					<div class="flex flex-col items-center justify-center py-10 gap-2">
						<span class="text-2xl opacity-20">🕘</span>
						<p class="text-xs" style="color:var(--ga-muted);">Sin proyectos anteriores</p>
					</div>
				{:else}
					<div class="p-3 space-y-2">
						<p class="text-[9px] mb-2" style="color:var(--ga-muted);">{history.length} proyectos anteriores</p>
						{#each history as h}
							{@const done = historyDoneCount(h)}
							{@const total = historyTotalCount(h)}
							{@const pct = total > 0 ? Math.round((done / total) * 100) : 0}
							<a
								href="/workspace/{h.id}"
								class="flex gap-2.5 p-2.5 rounded-xl transition-all hover:brightness-110 block"
								style="background:var(--ga-box);border:1px solid var(--ga-border);"
							>
								<!-- Cover thumbnail -->
								<div class="w-14 h-14 rounded-lg shrink-0 overflow-hidden relative bg-black">
									{#if h.trackCoverUrl}
										<img src={h.trackCoverUrl} alt={h.trackTitle ?? ''} class="w-full h-full object-cover" />
									{:else}
										<div class="absolute inset-0 flex items-center justify-center text-xl opacity-20">🎬</div>
									{/if}
									<!-- Status dot -->
									<div class="absolute bottom-1 right-1 w-2 h-2 rounded-full border" style="background:{historyStatusColor(h)};border-color:rgba(0,0,0,0.5);"></div>
								</div>

								<!-- Info -->
								<div class="flex-1 min-w-0 flex flex-col justify-between">
									<div>
										<p class="text-[10px] font-semibold truncate" style="color:var(--ga-text);">{h.trackTitle ?? 'Sin título'}</p>
									</div>

									<!-- Progress bar -->
									{#if total > 0}
										<div class="mt-1">
											<div class="flex justify-between mb-0.5">
												<span class="text-[8px]" style="color:{historyStatusColor(h)};">{historyStatusLabel(h)}</span>
												<span class="text-[8px]" style="color:var(--ga-muted);">{done}/{total}</span>
											</div>
											<div class="h-1 rounded-full overflow-hidden" style="background:rgba(255,255,255,0.06);">
												<div class="h-full rounded-full transition-all" style="width:{pct}%;background:{historyStatusColor(h)};"></div>
											</div>
										</div>
									{:else}
										<span class="text-[8px]" style="color:var(--ga-muted);">{historyStatusLabel(h)}</span>
									{/if}

									<p class="text-[7px] mt-0.5" style="color:var(--ga-muted);">Actualizado {fmtDate(h.updatedAt)}</p>
								</div>
							</a>
						{/each}
					</div>
				{/if}

				<!-- CTA to create new -->
				<div class="px-3 pb-4 pt-2 border-t" style="border-color:var(--ga-border);">
					<a href="/create-video"
						class="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-xs font-bold transition-all hover:brightness-110"
						style="background:rgba(212,175,55,0.08);color:var(--ga-gold);border:1px solid rgba(212,175,55,0.2);">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
						Nuevo video
					</a>
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Hidden audio (master clock) -->
{#if audioUrl}
	<audio bind:this={audioEl} src={audioUrl}
		ontimeupdate={onTimeUpdate}
		onplay={() => { isPlaying = true; }}
		onpause={() => { isPlaying = false; }}
		class="hidden"></audio>
{/if}

<!-- ══════════════════════════════════════════════════════════════════════════
     EXPORT & PUBLISH PANEL (slide-over from right)
══════════════════════════════════════════════════════════════════════════ -->
{#if showExportPanel}
	<!-- Backdrop -->
	<div class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onclick={() => showExportPanel = false}></div>

	<!-- Drawer -->
	<div class="fixed top-0 right-0 bottom-0 z-50 w-96 flex flex-col shadow-2xl border-l" style="background:var(--ga-dark);border-color:var(--ga-border);">

		<!-- Header -->
		<div class="flex items-center justify-between px-5 py-4 border-b" style="border-color:var(--ga-border);">
			<div>
				<h2 class="text-sm font-bold" style="color:var(--ga-text);">Exportar & Publicar</h2>
				<p class="text-[10px] mt-0.5" style="color:var(--ga-muted);">
					Plan actual: <span class="font-semibold" style="color:var(--ga-gold);">{PLAN_LABELS[planTier] ?? planTier}</span>
					· <a href="/api/billing/portal" class="underline" style="color:var(--ga-purple);">Mejorar plan</a>
				</p>
			</div>
			<button onclick={() => showExportPanel = false} class="w-8 h-8 flex items-center justify-center rounded-lg opacity-60 hover:opacity-100 transition-opacity" style="background:rgba(255,255,255,0.06);">
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1l12 12M13 1L1 13"/></svg>
			</button>
		</div>

		<!-- Tabs -->
		<div class="flex border-b" style="border-color:var(--ga-border);">
			{#each [['download','⬇ Descargar'],['publish','📡 Publicar']] as [tab, label]}
				<button
					onclick={() => exportTab = tab as 'download'|'publish'}
					class="flex-1 py-3 text-xs font-semibold transition-all"
					style="color:{exportTab===tab?'var(--ga-gold)':'var(--ga-muted)'};border-bottom:2px solid {exportTab===tab?'var(--ga-gold)':'transparent'};"
				>{label}</button>
			{/each}
		</div>

		<!-- Tab content -->
		<div class="flex-1 overflow-y-auto p-5">

			<!-- ── DOWNLOAD TAB ── -->
			{#if exportTab === 'download'}
				<p class="text-xs mb-4" style="color:var(--ga-muted);">Selecciona la calidad de exportación según tu plan.</p>

				<div class="space-y-2 mb-5">
					{#each QUALITY_TIERS as q}
						{@const locked = isQualityLocked(q.id)}
						<button
							onclick={() => !locked && (selectedQuality = q.id)}
							class="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all"
							style="
								background:{selectedQuality===q.id&&!locked?'rgba(212,175,55,0.12)':'rgba(255,255,255,0.03)'};
								border:1px solid {selectedQuality===q.id&&!locked?'var(--ga-gold)':'var(--ga-border)'};
								opacity:{locked?0.45:1};
								cursor:{locked?'not-allowed':'pointer'};
							"
						>
							<div class="flex items-center gap-3">
								<div class="w-2 h-2 rounded-full" style="background:{selectedQuality===q.id&&!locked?'var(--ga-gold)':'rgba(255,255,255,0.15)'};">
								</div>
								<div class="text-left">
									<p class="text-xs font-bold" style="color:{locked?'var(--ga-muted)':'var(--ga-text)'};">{q.label}</p>
									{#if locked}
										<p class="text-[9px]" style="color:var(--ga-muted);">Requiere plan superior</p>
									{/if}
								</div>
							</div>
							<div class="flex items-center gap-2">
								<span class="text-[9px] px-2 py-0.5 rounded font-bold" style="background:{locked?'rgba(255,255,255,0.05)':'rgba(212,175,55,0.15)'};color:{locked?'var(--ga-muted)':'var(--ga-gold)'};">{q.badge}</span>
								{#if locked}
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--ga-muted);"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
								{/if}
							</div>
						</button>
					{/each}
				</div>

				{#if downloadMsg}
					<p class="text-[10px] mb-3 px-3 py-2 rounded-lg" style="background:rgba(255,255,255,0.04);color:{downloadMsg.startsWith('✓')?'#4ade80':downloadMsg.startsWith('⬆')?'var(--ga-gold)':'#f87171'};">{downloadMsg}</p>
				{/if}

				<button
					onclick={downloadVideo}
					disabled={downloadBusy || !doneClips.length}
					class="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all"
					style="background:{downloadBusy||!doneClips.length?'rgba(255,255,255,0.05)':'var(--ga-gold)'};color:{downloadBusy||!doneClips.length?'var(--ga-muted)':'#000'};"
				>
					{#if downloadBusy}
						<span class="animate-spin">⏳</span> Preparando...
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
						Descargar {selectedQuality}
					{/if}
				</button>

				<!-- Upgrade CTA if on free plan -->
				{#if planTier === 'free'}
					<div class="mt-4 p-4 rounded-xl" style="background:rgba(142,85,234,0.08);border:1px solid rgba(142,85,234,0.2);">
						<p class="text-xs font-semibold mb-1" style="color:var(--ga-purple);">🚀 Sube de plan</p>
						<p class="text-[10px] mb-3" style="color:var(--ga-muted);">Desbloquea 1080p, 4K y 8K para tus exports de máxima calidad.</p>
						<a href="/api/billing/portal" class="block text-center text-xs font-bold py-2 rounded-lg" style="background:var(--ga-purple);color:#fff;">Ver planes →</a>
					</div>
				{/if}

			<!-- ── PUBLISH TAB ── -->
			{:else}
				<p class="text-xs mb-4" style="color:var(--ga-muted);">Conecta tus redes y publica directamente desde el workspace.</p>

				<!-- Platform list -->
				<div class="space-y-2 mb-5">
					{#each SOCIAL_PLATFORMS as p}
						{@const connected = isConnected(p.id)}
						{@const username = connectedUser(p.id)}
						<div class="flex items-center gap-3 px-4 py-3 rounded-xl" style="background:rgba(255,255,255,0.03);border:1px solid {publishTarget===p.id?'rgba(255,255,255,0.15)':'var(--ga-border)'};">
							<!-- Platform icon -->
							<div class="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0" style="background:{p.color}22;">{p.icon}</div>

							<!-- Info -->
							<div class="flex-1 min-w-0">
								<p class="text-xs font-semibold" style="color:var(--ga-text);">{p.label}</p>
								{#if connected && username}
									<p class="text-[9px]" style="color:#4ade80;">✓ @{username}</p>
								{:else if p.needsSetup}
									<p class="text-[9px]" style="color:var(--ga-muted);">Requiere config en Admin</p>
								{:else}
									<p class="text-[9px]" style="color:var(--ga-muted);">No conectado</p>
								{/if}
							</div>

							<!-- Actions -->
							{#if connected}
								<button onclick={() => publishTarget = p.id}
									class="text-[9px] px-2.5 py-1 rounded-lg font-bold shrink-0"
									style="background:{publishTarget===p.id?'var(--ga-gold)':'rgba(212,175,55,0.1)'};color:{publishTarget===p.id?'#000':'var(--ga-gold)'};">
									{publishTarget===p.id?'✓ Selec.':'Publicar'}
								</button>
							{:else if !p.needsSetup}
								<button onclick={() => connectPlatform(p.id)}
									class="text-[9px] px-2.5 py-1 rounded-lg font-bold shrink-0"
									style="background:rgba(255,255,255,0.06);color:var(--ga-muted);">
									Conectar
								</button>
							{:else}
								<span class="text-[9px] px-2 py-0.5 rounded" style="background:rgba(255,255,255,0.04);color:var(--ga-muted);">Pronto</span>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Publish form (shown when a target is selected) -->
				{#if publishTarget}
					<div class="space-y-3 pt-3 border-t" style="border-color:var(--ga-border);">
						<p class="text-xs font-semibold" style="color:var(--ga-text);">Detalles de publicación</p>

						<div>
							<label class="text-[9px] font-semibold mb-1 block" style="color:var(--ga-muted);">TÍTULO</label>
							<input bind:value={publishTitle}
								class="w-full text-xs px-3 py-2 rounded-lg"
								style="background:rgba(255,255,255,0.05);border:1px solid var(--ga-border);color:var(--ga-text);"
								placeholder="Título del video" />
						</div>

						<div>
							<label class="text-[9px] font-semibold mb-1 block" style="color:var(--ga-muted);">DESCRIPCIÓN</label>
							<textarea bind:value={publishDesc} rows="3"
								class="w-full text-xs px-3 py-2 rounded-lg resize-none"
								style="background:rgba(255,255,255,0.05);border:1px solid var(--ga-border);color:var(--ga-text);"
								placeholder="Descripción (opcional)"></textarea>
						</div>

						<div>
							<label class="text-[9px] font-semibold mb-1 block" style="color:var(--ga-muted);">PRIVACIDAD</label>
							<select bind:value={publishPrivacy}
								class="w-full text-xs px-3 py-2 rounded-lg"
								style="background:rgba(255,255,255,0.05);border:1px solid var(--ga-border);color:var(--ga-text);">
								<option value="public">Público</option>
								<option value="unlisted">No listado</option>
								<option value="private">Privado</option>
							</select>
						</div>

						{#if publishMsg}
							<p class="text-[10px] px-3 py-2 rounded-lg" style="background:rgba(255,255,255,0.04);color:{publishMsg.startsWith('✓')?'#4ade80':'#f87171'};">{publishMsg}</p>
						{/if}

						<button onclick={publishVideo} disabled={publishBusy || !doneClips.length}
							class="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all"
							style="background:{publishBusy||!doneClips.length?'rgba(255,255,255,0.05)':'var(--ga-purple)'};color:{publishBusy||!doneClips.length?'var(--ga-muted)':'#fff'};">
							{#if publishBusy}
								<span>⏳</span> Publicando...
							{:else}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
								Publicar en {SOCIAL_PLATFORMS.find(p => p.id === publishTarget)?.label}
							{/if}
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}
