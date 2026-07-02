<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { playerState } from '$lib/stores/player.svelte.js';
	import CreateVideoModal from '$lib/components/CreateVideoModal.svelte';

	let { data } = $props();

	// ─── Tab state ────────────────────────────────────────────────────────────────
	type Tab = 'easy' | 'custom' | 'studio';
	let activeTab = $state<Tab>('easy');

	// ─── Easy tab state ────────────────────────────────────────────────────────────
	let easyPrompt = $state('');
	let easyModel = $state('music_v2');

	// ─── Custom tab state ──────────────────────────────────────────────────────────
	let customPrompt = $state('');
	let customModel = $state('music_v2');
	let customStyle = $state('');
	let customTitle = $state('');
	let customInstrumental = $state(false);
	let customCustomMode = $state(true);
	let customVocalGender = $state<'female' | 'male'>('female');
	let customStyleChips = $state(['Indie Pop', 'Clean Electric Guitar', 'Hopeful', 'FM Synth']);
	const ALL_STYLE_CHIPS = ['Indie Pop','Clean Electric Guitar','Hopeful','FM Synth','Alt Pop','Pad Synth','Electro','Reggaeton','Latin','Funk','Cinematic','Jazz','Lo-fi','EDM','Trap','Folk'];
	function shuffleStyleChips() {
		const pool = ALL_STYLE_CHIPS.filter(c => !customStyleChips.includes(c));
		const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, 4);
		customStyleChips = picks;
	}
	async function generateLyrics() {
		if (!customStyle.trim() && !customTitle.trim()) { toast('Añade un título o estilo primero'); return; }
		toast('Generating lyrics with AI...');
	}
	async function optimizeLyrics() {
		if (!customPrompt.trim()) { toast('Write lyrics first'); return; }
		toast('Optimizing lyrics...');
	}
	async function enhanceStyle() {
		if (!customStyle.trim()) { toast('Escribe un estilo primero'); return; }
		toast('Enhancing style with AI...');
	}

	// ─── Studio tab state ──────────────────────────────────────────────────────────
	type StudioMode = 'extend' | 'vocal-remove' | 'add-vocals' | 'add-instrumental' | 'mashup' | 'lyrics' | 'music-video' | 'wav';
	let studioMode = $state<StudioMode>('extend');
	let studioAudioUrl = $state('');
	let studioPrompt = $state('');
	let studioInstrumental = $state(false);
	
	type StudioAudioSource = 'library' | 'upload' | 'url';
	let studioAudioSource = $state<StudioAudioSource>('library');
	let studioSelectedTrackId = $state<string>('');
	let isUploadingAudio = $state(false);

	async function handleAudioUpload(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		isUploadingAudio = true;
		const formData = new FormData();
		formData.append('file', file);

		try {
			const res = await fetch('/api/audio/upload', {
				method: 'POST',
				body: formData
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Failed to upload');
			studioAudioUrl = data.url;
			toast.success('Audio uploaded successfully');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Upload failed');
		} finally {
			isUploadingAudio = false;
		}
	}

	// ─── Generation state ─────────────────────────────────────────────────────────
	let isGenerating = $state(false);
	let generatingStatus = $state('');
	let generatingElapsed = $state(0);
	let generatingTaskId = $state('');
	let studioResult = $state<unknown>(null);

	// Ticker
	let _ticker: ReturnType<typeof setInterval> | null = null;
	function startTicker() {
		generatingElapsed = 0;
		_ticker = setInterval(() => { generatingElapsed += 1; }, 1000);
	}
	function stopTicker() {
		if (_ticker) { clearInterval(_ticker); _ticker = null; }
	}

	// ─── Unified track list (session new + DB history) ────────────────────────────
	interface TrackEntry {
		id: string;           // publication id OR temp uuid
		title: string;
		audioUrl: string | null;
		coverUrl?: string | null;
		durationMs: number | null;
		model: string | null;
		prompt: string | null;
		isInstrumental: boolean;
		tags?: string | null;
		isPublic: boolean;
		playCount: number;
		likeCount: number;
		musicId?: string | null;
		videoUrl?: string | null;
		isNew?: boolean;           // just generated this session
		isCreatingVideo?: boolean;
		createdAt: string;
	}

	// Start from DB history, new tracks prepended
	let tracks = $state<TrackEntry[]>(
		(data.history as typeof data.history).map((t) => ({
			id: t.id,
			title: t.title,
			audioUrl: t.audioUrl ?? null,
			coverUrl: t.coverUrl ?? null,
			durationMs: t.durationMs ?? null,
			model: t.model ?? null,
			prompt: t.prompt ?? null,
			isInstrumental: t.isInstrumental,
			tags: t.tags ?? null,
			isPublic: t.isPublic,
			playCount: t.playCount,
			likeCount: t.likeCount,
			createdAt: t.createdAt,
		}))
	);

	// Video creation modal state
	let videoModalOpen = $state(false);
	let videoModalTrack = $state<TrackEntry | null>(null);

	// Context menu state
	let openMenuId = $state<string | null>(null);
	function toggleMenu(id: string, e: MouseEvent) {
		e.stopPropagation();
		openMenuId = openMenuId === id ? null : id;
	}
	function closeMenu() { openMenuId = null; showModelDropdown = false; }

	// Library search + filtered derived
	let librarySearch = $state('');
	const filteredTracks = $derived(
		librarySearch.trim()
			? tracks.filter((t) =>
					t.title.toLowerCase().includes(librarySearch.toLowerCase()) ||
					(t.tags ?? '').toLowerCase().includes(librarySearch.toLowerCase()))
			: tracks
	);

	// Edit title state
	let editingId = $state<string | null>(null);
	let editingTitle = $state('');

	interface GeneratedTrack {
		title: string;
		audioUrl: string;
		coverUrl?: string;
		durationMs: number;
		model: string;
		prompt: string;
		isInstrumental: boolean;
		lyrics?: Array<{ time: number; text: string }>;
		tags?: string;
		musicId?: string;
		videoUrl?: string;        // filled after createVideo()
		isCreatingVideo?: boolean; // per-track video generation state
	}

	// ─── Models with full descriptions (Mureka-style dropdown) ──────────────────
	const ALL_MODELS = [
		{ id: 'music_v1', label: 'Music v1', desc: 'Alternative engine. Up to 5 min, different style.' },
		{ id: 'music_v2', label: 'Music v2', desc: 'Latest model. All genres, max quality, up to 10 min. Recommended.' },
		{ id: 'music_v3', label: 'Music v3', desc: 'Alternative engine for music generation.' },
	];

	// Shared model state (single model picker for all tabs)
	let selectedModel = $state('music_v2');
	let showModelDropdown = $state(false);
	const selectedModelInfo = $derived(ALL_MODELS.find((m) => m.id === selectedModel) ?? ALL_MODELS[1]);

	// Sync easy/custom model to selectedModel
	$effect(() => { easyModel = selectedModel; customModel = selectedModel; });

	// Sync library track to studio audio url
	$effect(() => {
		if (studioAudioSource === 'library' && studioSelectedTrackId) {
			const track = tracks.find(t => t.id === studioSelectedTrackId);
			if (track && track.audioUrl) {
				studioAudioUrl = track.audioUrl;
			}
		}
	});

	// ─── Studio modes ─────────────────────────────────────────────────────────────
	const STUDIO_MODES = [
		{ id: 'extend',           label: 'Extend',               icon: '⬆️', desc: 'Extend an existing track' },
		{ id: 'upload-cover',     label: 'Cover Generate',       icon: '🔄', desc: 'Cover an uploaded audio' },
		{ id: 'vocal-remove',     label: 'Stem Separate',        icon: '🎚️', desc: 'Extract vocals/instrumentals' },
		{ id: 'add-vocals',       label: 'Add Vocals',           icon: '🎤', desc: 'Add vocals to instrumental' },
		{ id: 'add-instrumental', label: 'Add Instrumental',     icon: '🎸', desc: 'Add music bed to vocals' },
		{ id: 'mashup',           label: 'Mashup',               icon: '🎭', desc: 'Blend two tracks together' },
		{ id: 'replace-section',  label: 'Replace Section',      icon: '✂️', desc: 'Replace a section of the track' },
		{ id: 'style-boost',      label: 'Boost Music Style',    icon: '🚀', desc: 'Enhance the track style' },
		{ id: 'midi',             label: 'Generate Midi',        icon: '🎹', desc: 'Extract MIDI from audio' },
		{ id: 'lyrics',           label: 'Generate Lyrics',      icon: '📝', desc: 'AI-written lyrics' },
		{ id: 'timestamped-lyrics',label: 'TimeStamped Lyrics',  icon: '⏱️', desc: 'Lyrics with timestamps' },
		{ id: 'persona',          label: 'Generate Persona',     icon: '👤', desc: 'Generate a voice persona' },
		{ id: 'generate-voice',   label: 'Generate Voice',       icon: '🗣️', desc: 'Synthesize a voice' },
		{ id: 'sounds',           label: 'Sounds',               icon: '🔊', desc: 'Generate sounds/FX' },
		{ id: 'music-video',      label: 'Music Video',          icon: '🎬', desc: 'Auto-generate a video' },
		{ id: 'wav',              label: 'WAV Convert',          icon: '💿', desc: 'Convert to lossless WAV' },
	] as const;

	// ─── Generate music ────────────────────────────────────────────────────────────
	async function generate() {
		const prompt = activeTab === 'easy' ? easyPrompt : customPrompt;
		if (!prompt.trim()) { toast.error('Please enter a prompt'); return; }

		const startModelId = activeTab === 'easy' ? easyModel : customModel;
		const modelsToTry = startModelId === 'music_v2' ? ['music_v2', 'music_v3', 'music_v1'] : [startModelId];

		isGenerating = true;
		generatingTaskId = '';
		
		for (let i = 0; i < modelsToTry.length; i++) {
			const currentModel = modelsToTry[i];
			generatingStatus = i === 0 ? 'Sending to AI...' : `Trying alternative (${currentModel})...`;
			stopTicker();
			startTicker();
			
			try {
				await attemptGeneration(prompt, currentModel);
				// Success
				break;
			} catch (err) {
				console.error(`Model ${currentModel} failed:`, err);
				if (i === modelsToTry.length - 1) {
					toast.error(err instanceof Error ? err.message : 'All generation attempts failed');
				} else {
					toast.info(`Generation failed, trying alternative...`);
				}
			}
		}

		stopTicker();
		isGenerating = false;
		generatingStatus = '';
		generatingTaskId = '';
	}

	async function attemptGeneration(prompt: string, modelId: string) {
		const isSunoOrMusicGpt = modelId === 'music_v2' || modelId === 'music_v3';

		const body: Record<string, unknown> = { prompt: prompt.trim(), modelId };
		if (activeTab === 'custom') {
			body.forceInstrumental = customInstrumental;
			if (!customInstrumental) body.vocalGender = customVocalGender;
			if (customCustomMode) {
				body.customMode = true;
				if (customStyle) body.style = customStyle;
				if (customTitle) body.title = customTitle;
			}
		}

		const res = await fetch('/api/music-generation', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		const json = await res.json();
		if (!res.ok) { throw new Error(json.error || 'Generation failed'); }

		// ── Polling (Async) ──────────────────────────────────────────────────────
		if (isSunoOrMusicGpt && json.taskId) {
			generatingTaskId = json.taskId;
			generatingStatus = 'Creating your track...';
			let done = false;
			let timeoutAttempts = 0;
			const MAX_POLL_ATTEMPTS = 40; // 2 minutes (40 * 3s)
			let pollCount = 0;

			while (!done && pollCount < MAX_POLL_ATTEMPTS) {
				pollCount++;
				await new Promise((r) => setTimeout(r, 3_000));
				if (generatingElapsed < 30) generatingStatus = 'Creating your track...';
				else if (generatingElapsed < 60) generatingStatus = 'Adding melodies and harmonies...';
				else if (generatingElapsed < 120) generatingStatus = 'Refining the sound...';
				else generatingStatus = 'Almost ready...';

				let statusJson: { status: string; error?: string; audioUrl?: string; audioData?: string; durationMs?: number; coverUrl?: string; title?: string; tags?: string; musicId?: string };
				try {
					const sr = await fetch(`/api/music-generation?taskId=${json.taskId}&provider=${json.provider}`);
					statusJson = await sr.json();
				} catch { 
					timeoutAttempts++;
					if (timeoutAttempts > 5) throw new Error("Connection lost during polling");
					continue; 
				}

				if (statusJson.status === 'done') {
					done = true;
					const audioUrl = statusJson.audioUrl
						|| URL.createObjectURL(base64ToBlob(statusJson.audioData!, 'audio/mpeg'));
					const trackTitle = statusJson.title
						|| (activeTab === 'custom' && customTitle ? customTitle : '')
						|| `Track - ${new Date().toLocaleTimeString()}`;
					const newTrack: TrackEntry = {
						id: crypto.randomUUID(),
						title: trackTitle,
						audioUrl,
						coverUrl: statusJson.coverUrl,
						durationMs: statusJson.durationMs || 0,
						model: modelId,
						prompt: prompt.trim(),
						isInstrumental: activeTab === 'custom' ? customInstrumental : false,
						tags: statusJson.tags,
						musicId: statusJson.musicId,
						isPublic: false,
						playCount: 0,
						likeCount: 0,
						isNew: true,
						createdAt: new Date().toISOString(),
					};
					tracks = [newTrack, ...tracks];
					playTrackEntry(newTrack);
					toast.success('Track ready!');
				} else if (statusJson.status === 'error') {
					throw new Error(statusJson.error || 'Generation failed');
				}
			}
			
			if (!done) {
				throw new Error("Music generation timed out. Proceeding to fallback.");
			}
			return;
		}

		// ── Sync (Music v1) ─────────────────────────────────────────────────
		const audioBlob = base64ToBlob(json.audioData, json.mimeType || 'audio/mpeg');
		const audioUrl = URL.createObjectURL(audioBlob);
		const newTrack: TrackEntry = {
			id: crypto.randomUUID(),
			title: customTitle || `Track - ${new Date().toLocaleTimeString()}`,
			audioUrl,
			durationMs: json.durationMs || 0,
			model: json.model || modelId,
			prompt: prompt.trim(),
			isInstrumental: json.isInstrumental ?? false,
			musicId: json.musicId,
			isPublic: false,
			playCount: 0,
			likeCount: 0,
			isNew: true,
			createdAt: new Date().toISOString(),
		};
		tracks = [newTrack, ...tracks];
		playTrackEntry(newTrack);
		toast.success('Track generated!');
	}

	// ─── Studio action ────────────────────────────────────────────────────────────
	async function runStudio() {
		if (!studioAudioUrl.trim()) { toast.error('Please provide an audio URL'); return; }
		isGenerating = true;
		studioResult = null;
		try {
			const payload: Record<string, any> = { action: studioMode, audioUrl: studioAudioUrl.trim(), prompt: studioPrompt.trim() || undefined, instrumental: studioInstrumental };
			
			// If using library, explicitly pass the real Suno task ID to avoid regex mismatch or local blob UUIDs
			if (studioAudioSource === 'library' && studioSelectedTrackId) {
				const t = tracks.find(x => x.id === studioSelectedTrackId);
				if (t?.musicId) {
					payload.audioId = t.musicId;
					payload.taskId = t.musicId;
				}
			}

			const res = await fetch('/api/suno-studio', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			const json = await res.json();
			if (!res.ok) { toast.error(json.error || 'Studio operation failed'); return; }

			const taskId = json.taskId;
			const finalAction = json.action || studioMode;
			
			// Poll until done
			while (isGenerating) {
				await new Promise(r => setTimeout(r, 10000));
				
				const statusRes = await fetch(`/api/suno-studio?action=${finalAction}&taskId=${taskId}`);
				const statusJson = await statusRes.json();
				
				if (!statusRes.ok) {
					throw new Error(statusJson.error || 'Failed to check status');
				}
				
				if (statusJson.status === 'SUCCESS') {
					studioResult = statusJson.result;
					toast.success(`${studioMode} completed!`);
					break;
				} else if (statusJson.status === 'FAILED') {
					throw new Error(statusJson.errorMessage || 'Studio generation failed');
				}
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Studio operation failed');
		} finally {
			isGenerating = false;
		}
	}

	// ─── Play track entry ─────────────────────────────────────────────────────────
	function playTrackEntry(track: TrackEntry) {
		if (!track.audioUrl) return;
		const queue = tracks
			.filter((t) => t.audioUrl)
			.map((t) => ({
				id: t.musicId || t.id,
				publicationId: t.id,
				title: t.title,
				artist: data.user.name || 'You',
				audioUrl: t.audioUrl!,
				coverUrl: t.coverUrl ?? undefined,
				durationMs: t.durationMs ?? undefined,
				model: t.model ?? undefined,
				isInstrumental: t.isInstrumental,
			}));
		const idx = queue.findIndex((q) => q.publicationId === track.id);
		playerState.setQueue(queue, idx >= 0 ? idx : 0);
		fetch(`/api/publications/${track.id}/play`, { method: 'POST' }).catch(() => {});
	}

	// ─── Track actions ────────────────────────────────────────────────────────────
	async function saveToLibrary(track: TrackEntry) {
		if (!track.isNew) { toast.info('Already saved'); return; }
		try {
			const res = await fetch('/api/publications', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: 'music', title: track.title, prompt: track.prompt,
					audioUrl: track.audioUrl, model: track.model, durationMs: track.durationMs,
					isInstrumental: track.isInstrumental, tags: track.tags,
					musicId: track.musicId, isPublic: false,
				}),
			});
			const json = await res.json();
			if (!res.ok) { toast.error(json.error || 'Failed to save'); return; }
			// Update local id with the real publication id
			tracks = tracks.map((t) => t.id === track.id ? { ...t, id: json.publication?.id || t.id, isNew: false } : t);
			toast.success('Saved to Library');
		} catch { toast.error('Failed to save'); }
	}

	async function togglePublish(track: TrackEntry) {
		if (track.isNew) { await saveToLibrary(track); return; }
		const newPublic = !track.isPublic;
		tracks = tracks.map((t) => t.id === track.id ? { ...t, isPublic: newPublic } : t);
		try {
			const res = await fetch(`/api/publications/${track.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isPublic: newPublic }),
			});
			if (!res.ok) {
				tracks = tracks.map((t) => t.id === track.id ? { ...t, isPublic: !newPublic } : t);
				toast.error('Failed to update');
			} else {
				toast.success(newPublic ? 'Published to Explore' : 'Removed from Explore');
			}
		} catch { tracks = tracks.map((t) => t.id === track.id ? { ...t, isPublic: !newPublic } : t); }
	}

	async function deleteTrack(track: TrackEntry) {
		if (!confirm(`¿Eliminar "${track.title}"?`)) return;
		if (track.isNew) {
			tracks = tracks.filter((t) => t.id !== track.id);
			return;
		}
		const res = await fetch(`/api/publications/${track.id}`, { method: 'DELETE' });
		if (res.ok) {
			tracks = tracks.filter((t) => t.id !== track.id);
			toast.success('Track deleted');
		} else {
			toast.error('Failed to delete');
		}
	}

	async function createVideo(track: TrackEntry) {
		// If unsaved, save first so we have a real ID
		if (track.isNew) {
			toast.info('Saving track before creating video...');
			await saveToLibrary(track);
			const saved = tracks.find((t) => t.title === track.title && !t.isNew);
			if (saved?.id) {
				goto(`/create-video/${saved.id}`);
			} else {
				toast.error('Could not save the track. Please save it first.');
			}
			return;
		}
		goto(`/create-video/${track.id}`);
	}

	async function quickStudioAction(track: TrackEntry, mode: any, label: string) {
		if (track.audioUrl) {
			studioAudioUrl = track.audioUrl;
		}
		studioAudioSource = 'library';
		studioSelectedTrackId = track.id;
		studioMode = mode;
		activeTab = 'studio';
		closeMenu();
		window.scrollTo({ top: 0, behavior: 'smooth' });
		toast.info(`Switched to Soundtrack → ${label} with your track`);
	}

	async function saveTitle(track: TrackEntry) {
		if (!editingTitle.trim()) return;
		const newTitle = editingTitle.trim();
		tracks = tracks.map((t) => t.id === track.id ? { ...t, title: newTitle } : t);
		editingId = null;
		if (!track.isNew) {
			await fetch(`/api/publications/${track.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: newTitle }),
			}).catch(() => {});
		}
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────────
	function base64ToBlob(base64: string, mimeType: string): Blob {
		const byteChars = atob(base64);
		const byteArrays = [];
		for (let i = 0; i < byteChars.length; i += 512) {
			const slice = byteChars.slice(i, i + 512);
			const byteNums = new Array(slice.length);
			for (let j = 0; j < slice.length; j++) byteNums[j] = slice.charCodeAt(j);
			byteArrays.push(new Uint8Array(byteNums));
		}
		return new Blob(byteArrays, { type: mimeType });
	}

	function formatDuration(ms: number): string {
		const s = Math.floor(ms / 1000);
		return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
	}
</script>


<!-- Close any open menu when clicking outside -->
<svelte:window onclick={closeMenu} />

<svelte:head>
	<title>Create — GenAudius</title>
</svelte:head>

<!-- Mureka-style split layout -->
<div class="flex" style="height:100%; background:var(--ga-dark); color:var(--ga-text); overflow:hidden;">

	<!-- ── LEFT PANEL: form ─────────────────────────────────────── -->
	<div class="flex flex-col shrink-0" style="width:440px; border-right:1px solid var(--ga-border);">

		<!-- Tabs row + model dropdown -->
		<div class="flex items-center justify-between px-5 shrink-0" style="border-bottom:1px solid var(--ga-border);">
			<div class="flex">
				{#each [['easy','Easy'],['custom','Custom'],['studio','Soundtrack']] as [id,label]}
					<button
						class="px-4 py-3 text-sm font-medium border-b-2 transition-colors"
						style={activeTab===id
							? 'border-color:var(--ga-gold); color:var(--ga-text);'
							: 'border-color:transparent; color:var(--ga-muted);'}
						onclick={() => (activeTab = id as Tab)}
					>{label}</button>
				{/each}
			</div>

			<!-- Model dropdown button -->
			<div class="relative">
				<button
					onclick={(e) => { e.stopPropagation(); showModelDropdown = !showModelDropdown; }}
					class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border"
					style="border-color:var(--ga-border); background:var(--ga-box); color:var(--ga-text);"
				>
					<span class="text-xs px-1.5 py-0.5 rounded font-bold" style="background:rgba(214,200,6,0.15);color:var(--ga-gold);">{selectedModelInfo.label}</span>
					<svg class="w-3 h-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
						<polyline points="6 9 12 15 18 9"/>
					</svg>
				</button>

				{#if showModelDropdown}
					<div
						class="absolute right-0 top-full mt-1 z-50 rounded-xl overflow-hidden shadow-2xl"
						style="width:300px; background:#111; border:1px solid var(--ga-border);"
						onclick={(e) => e.stopPropagation()}
					>
						{#each ALL_MODELS as model}
							<button
								class="w-full px-4 py-3 text-left flex items-start gap-3 transition-colors"
								style={selectedModel===model.id ? 'background:rgba(214,200,6,0.07);' : ''}
								onmouseenter={(e) => { if (selectedModel !== model.id) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
								onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.background = selectedModel === model.id ? 'rgba(214,200,6,0.07)' : ''; }}
								onclick={() => { selectedModel = model.id; showModelDropdown = false; }}
							>
								<span
									class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold shrink-0 mt-0.5"
									style={selectedModel===model.id ? 'background:var(--ga-gold);color:#000;' : 'background:rgba(214,200,6,0.12);color:var(--ga-gold);'}
								>{model.label}</span>
								<div class="flex-1 min-w-0">
									<p class="text-xs leading-relaxed" style="color:var(--ga-muted);">{model.desc}</p>
								</div>
								{#if selectedModel === model.id}
									<span class="text-xs shrink-0" style="color:var(--ga-gold);">✓</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- API warning -->
		{#if !data.sunoConfigured}
			<div class="mx-5 mt-4 rounded-xl px-4 py-3 flex items-center gap-2 shrink-0" style="background:rgba(253,54,88,0.08);border:1px solid rgba(253,54,88,0.3);">
				<span>⚠️</span>
				<p class="text-xs" style="color:var(--ga-pink);">No API key configured. Go to <a href="/admin" class="underline" style="color:var(--ga-gold);">Admin → Settings</a></p>
			</div>
		{/if}

		<!-- Scrollable form body -->
		<div class="flex-1 overflow-y-auto px-5 py-5 space-y-5">

			<!-- EASY TAB -->
			{#if activeTab === 'easy'}
				<div class="space-y-4">
					<textarea
						bind:value={easyPrompt}
						placeholder="Describe the music you want to create..."
						rows="9"
						class="w-full rounded-xl px-4 py-3 text-sm resize-none focus:outline-none"
						style="background:var(--ga-box);border:1px solid var(--ga-border);color:var(--ga-text);"
					></textarea>
					<label class="flex items-center gap-2 cursor-pointer text-sm" style="color:var(--ga-muted);">
						<input type="checkbox" bind:checked={customInstrumental} style="accent-color:var(--ga-gold);" />
						Instrumental (no vocals)
					</label>
				</div>

			<!-- CUSTOM TAB -->
			{:else if activeTab === 'custom'}
				<div class="space-y-3">

					<!-- Action buttons: + Reference  + Remix  + Vocal -->
					<div class="flex gap-2">
						{#each [['+  Reference','ref'],['+  Remix','remix'],['+  Vocal','vocal']] as [lbl, _id]}
							<button
								class="flex-1 py-2 rounded-xl text-xs font-medium transition-colors"
								style="background:rgba(255,255,255,0.06);color:var(--ga-muted);border:1px solid var(--ga-border);"
								onmouseenter={(e) => (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.1)'}
								onmouseleave={(e) => (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.06)'}
								onclick={() => toast(`${lbl.trim()} — coming soon`)}
							>{lbl}</button>
						{/each}
					</div>

					<!-- ── Lyrics box ──────────────────────────────────────────────────── -->
					<div class="rounded-2xl overflow-hidden" style="background:var(--ga-box);border:1px solid var(--ga-border);">
						<!-- Header -->
						<div class="flex items-center justify-between px-4 pt-3 pb-1">
							<span class="text-sm font-semibold" style="color:var(--ga-text);">Lyrics</span>
							<label class="flex items-center gap-2 cursor-pointer select-none">
								<span class="text-xs" style="color:var(--ga-muted);">Instrumental</span>
								<button
									onclick={() => (customInstrumental = !customInstrumental)}
									class="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
									style={customInstrumental ? 'background:#1db8b8;' : 'background:rgba(255,255,255,0.15);'}
									role="switch"
									aria-checked={customInstrumental}
								>
									<span
										class="absolute top-[3px] left-[3px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform"
										style={customInstrumental ? 'transform:translateX(16px)' : 'transform:translateX(0)'}
									></span>
								</button>
							</label>
						</div>
						<!-- Textarea -->
						<textarea
							bind:value={customPrompt}
							placeholder={customInstrumental ? 'Enter lyrics here or leave blank for instrumental' : 'Enter lyrics here or leave blank for instrumental'}
							rows="7"
							disabled={customInstrumental}
							class="w-full px-4 py-2 text-sm focus:outline-none resize-y"
							style="background:transparent;color:var(--ga-text);{customInstrumental?'opacity:0.35;cursor:not-allowed;':''};min-height:120px;max-height:320px;"
						></textarea>
						<!-- Footer actions -->
						<div class="flex items-center justify-between px-4 py-2" style="border-top:1px solid rgba(255,255,255,0.05);">
							<div class="flex gap-1">
								<button
									onclick={optimizeLyrics}
									class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
									style="background:rgba(255,255,255,0.06);color:var(--ga-muted);"
									onmouseenter={(e) => (e.currentTarget as HTMLElement).style.color='var(--ga-text)'}
									onmouseleave={(e) => (e.currentTarget as HTMLElement).style.color='var(--ga-muted)'}
								>
									<!-- sparkle -->
									<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0l1.2 4.8L14 8l-4.8 1.2L8 16l-1.2-4.8L2 8l4.8-1.2z"/></svg>
									Optimize
								</button>
								<button
									onclick={generateLyrics}
									class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
									style="background:rgba(255,255,255,0.06);color:var(--ga-muted);"
									onmouseenter={(e) => (e.currentTarget as HTMLElement).style.color='var(--ga-text)'}
									onmouseleave={(e) => (e.currentTarget as HTMLElement).style.color='var(--ga-muted)'}
								>
									<!-- circular arrow -->
									<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 8A6 6 0 1 1 8 2"/><polyline points="11 2 14 2 14 5"/></svg>
									Generate Lyrics
								</button>
							</div>
							<!-- resize handle icon -->
							<svg width="12" height="12" viewBox="0 0 10 10" fill="none" opacity="0.3">
								<path d="M2 8l6-6M5 8l3-3M8 8v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
							</svg>
						</div>
					</div>

					<!-- ── Style box ───────────────────────────────────────────────────── -->
					<div class="rounded-2xl overflow-hidden" style="background:var(--ga-box);border:1px solid var(--ga-border);">
						<!-- Header -->
						<div class="px-4 pt-3 pb-1">
							<span class="text-sm font-semibold" style="color:var(--ga-text);">Style</span>
						</div>
						<!-- Textarea -->
						<textarea
							bind:value={customStyle}
							placeholder="Enter style, mood, instrument, etc. to control the generated music"
							rows="3"
							class="w-full px-4 py-2 text-sm focus:outline-none resize-y"
							style="background:transparent;color:var(--ga-text);min-height:72px;max-height:200px;"
						></textarea>
						<!-- Enhance button -->
						<div class="px-4 pt-1 pb-2">
							<button
								onclick={enhanceStyle}
								class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
								style="background:rgba(255,255,255,0.08);color:var(--ga-muted);"
								onmouseenter={(e) => (e.currentTarget as HTMLElement).style.color='var(--ga-text)'}
								onmouseleave={(e) => (e.currentTarget as HTMLElement).style.color='var(--ga-muted)'}
							>
								<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0l1.2 4.8L14 8l-4.8 1.2L8 16l-1.2-4.8L2 8l4.8-1.2z"/></svg>
								Enhance
							</button>
						</div>
						<!-- Style chips -->
						<div class="flex items-center gap-1.5 px-4 pb-3 flex-wrap">
							<!-- Shuffle button -->
							<button
								onclick={shuffleStyleChips}
								class="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 transition-colors"
								style="background:rgba(255,255,255,0.06);color:var(--ga-muted);"
								onmouseenter={(e) => (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.12)'}
								onmouseleave={(e) => (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.06)'}
								title="Shuffle"
							>
								<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
									<path d="M2 4h2a6 6 0 0 1 5 2.7M2 12h2a6 6 0 0 0 5-2.7"/>
									<path d="M10 2l4 2-4 2M10 10l4 2-4 2"/>
								</svg>
							</button>
							{#each customStyleChips as chip}
								<button
									class="px-3 py-1 rounded-full text-xs transition-all"
									style="background:rgba(255,255,255,0.08);color:var(--ga-text);"
									onmouseenter={(e) => (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.15)'}
									onmouseleave={(e) => (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.08)'}
									onclick={() => { customStyle = customStyle ? customStyle + ', ' + chip : chip; }}
								>{chip}</button>
							{/each}
						</div>
						<!-- resize handle -->
						<div class="flex justify-end px-3 pb-2">
							<svg width="12" height="12" viewBox="0 0 10 10" fill="none" opacity="0.3">
								<path d="M2 8l6-6M5 8l3-3M8 8v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
							</svg>
						</div>
					</div>

					<!-- ── Vocal Gender ────────────────────────────────────────────────── -->
					<div class="flex items-center justify-between px-1">
						<span class="text-sm font-semibold" style="color:var(--ga-text);">Vocal Gender</span>
						<div class="flex gap-4">
							<button
								onclick={() => (customVocalGender = 'female')}
								class="text-sm font-medium transition-colors"
								style={customVocalGender === 'female' ? 'color:var(--ga-text);' : 'color:rgba(255,255,255,0.3);'}
							>Female</button>
							<button
								onclick={() => (customVocalGender = 'male')}
								class="text-sm font-medium transition-colors"
								style={customVocalGender === 'male' ? 'color:var(--ga-text);' : 'color:rgba(255,255,255,0.3);'}
							>Male</button>
						</div>
					</div>

					<!-- ── Song Title ──────────────────────────────────────────────────── -->
					<div class="relative">
						<input
							bind:value={customTitle}
							type="text"
							placeholder="Enter song title"
							maxlength="50"
							class="w-full rounded-2xl px-4 py-3 text-sm focus:outline-none pr-14"
							style="background:var(--ga-box);border:1px solid var(--ga-border);color:var(--ga-text);"
						/>
						<span
							class="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none select-none"
							style="color:rgba(255,255,255,0.3);"
						>{customTitle.length}/50</span>
					</div>

				</div>

			<!-- STUDIO TAB -->
			{:else if activeTab === 'studio'}
				<div class="space-y-4">
					<div class="grid grid-cols-2 gap-2">
						{#each STUDIO_MODES as mode}
							<button
								class="rounded-xl border px-3 py-3 text-left transition-all"
								style={studioMode === mode.id
									? 'border-color:var(--ga-pink);background:rgba(253,54,88,0.08);'
									: 'border-color:var(--ga-border);background:var(--ga-box);'}
								onclick={() => (studioMode = mode.id as StudioMode)}
							>
								<div class="text-base mb-0.5">{mode.icon}</div>
								<div class="text-xs font-semibold" style={studioMode === mode.id ? 'color:var(--ga-pink)' : ''}>{mode.label}</div>
								<div class="text-[10px] mt-0.5" style="color:var(--ga-muted);">{mode.desc}</div>
							</button>
						{/each}
					</div>
					{#if studioMode !== 'lyrics'}
						<div class="rounded-xl overflow-hidden" style="background:var(--ga-box);border:1px solid var(--ga-border);">
							<div class="flex border-b" style="border-color:var(--ga-border);">
								<button class="flex-1 py-2 text-xs font-semibold text-center transition-colors {studioAudioSource === 'library' ? 'bg-white/5 text-white' : 'text-white/50 hover:bg-white/5'}" onclick={() => studioAudioSource = 'library'}>My Library</button>
								<button class="flex-1 py-2 text-xs font-semibold text-center transition-colors border-l {studioAudioSource === 'upload' ? 'bg-white/5 text-white' : 'text-white/50 hover:bg-white/5'}" style="border-color:var(--ga-border);" onclick={() => studioAudioSource = 'upload'}>Upload File</button>
								<button class="flex-1 py-2 text-xs font-semibold text-center transition-colors border-l {studioAudioSource === 'url' ? 'bg-white/5 text-white' : 'text-white/50 hover:bg-white/5'}" style="border-color:var(--ga-border);" onclick={() => studioAudioSource = 'url'}>Paste URL</button>
							</div>
							<div class="p-4">
								{#if studioAudioSource === 'library'}
									<select
										bind:value={studioSelectedTrackId}
										class="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
										style="background:rgba(255,255,255,0.05); border:1px solid var(--ga-border); color:var(--ga-text);"
									>
										<option value="" disabled>Select a track...</option>
										{#each tracks as track}
											{#if track.audioUrl}
												<option value={track.id}>{track.title || 'Untitled'}</option>
											{/if}
										{/each}
									</select>
								{:else if studioAudioSource === 'upload'}
									<div class="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg" style="border-color:var(--ga-border);background:rgba(255,255,255,0.02);">
										{#if isUploadingAudio}
											<div class="flex flex-col items-center justify-center gap-2">
												<span class="inline-block w-6 h-6 border-2 border-white/30 border-t-[var(--ga-gold)] rounded-full animate-spin"></span>
												<span class="text-xs text-white/50">Uploading...</span>
											</div>
										{:else}
											<input type="file" id="studio-audio-upload" accept="audio/*" class="hidden" onchange={handleAudioUpload} />
											<label for="studio-audio-upload" class="cursor-pointer flex flex-col items-center justify-center gap-2">
												<svg class="w-8 h-8 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
												<span class="text-xs font-semibold" style="color:var(--ga-gold);">Choose an audio file</span>
												<span class="text-[10px] text-white/40">MP3 or WAV up to 15MB</span>
											</label>
											{#if studioAudioUrl && studioAudioUrl.includes('upload')}
												<div class="mt-3 text-xs text-green-400 font-medium">✓ Audio uploaded successfully</div>
											{/if}
										{/if}
									</div>
								{:else}
									<input
										bind:value={studioAudioUrl}
										type="url"
										placeholder="https://..."
										class="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
										style="background:rgba(255,255,255,0.05); border:1px solid var(--ga-border); color:var(--ga-text);"
									/>
								{/if}
							</div>
						</div>
					{/if}
					<textarea
						bind:value={studioPrompt}
						placeholder={studioMode === 'lyrics' ? 'Tema o estilo de las letras...' : 'Instrucciones adicionales (opcional)...'}
						rows="4"
						class="w-full rounded-xl px-4 py-3 text-sm resize-none focus:outline-none"
						style="background:var(--ga-box);border:1px solid var(--ga-border);color:var(--ga-text);"
					></textarea>
					{#if studioResult}
						<div class="rounded-xl p-4" style="border:1px solid var(--ga-pink);background:rgba(253,54,88,0.05);">
							<pre class="text-xs overflow-auto max-h-40 whitespace-pre-wrap" style="color:var(--ga-muted);">{JSON.stringify(studioResult, null, 2)}</pre>
						</div>
					{/if}
				</div>
			{/if}

		</div><!-- /form scroll -->

		<!-- Fixed Create button -->
		<div class="px-5 py-4 shrink-0" style="border-top:1px solid var(--ga-border);">
			{#if activeTab === 'studio'}
				<button
					onclick={runStudio}
					disabled={isGenerating || (studioMode !== 'lyrics' && !studioAudioUrl.trim()) || (studioMode === 'lyrics' && !studioPrompt.trim())}
					class="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
					style="background:var(--ga-pink);color:#fff;"
				>
					{#if isGenerating}
						<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
						Procesando...
					{:else}
						🎚️ {STUDIO_MODES.find(m => m.id === studioMode)?.label}
					{/if}
				</button>
			{:else}
				<button
					onclick={generate}
					disabled={isGenerating || (activeTab === 'easy' ? !easyPrompt.trim() : (!customPrompt.trim() && !customInstrumental))}
					class="w-full py-3.5 rounded-2xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
					style="background:#1a3535;color:#e0fafa;letter-spacing:0.01em;"
					onmouseenter={(e) => { if (!isGenerating) (e.currentTarget as HTMLElement).style.background='#224444'; }}
					onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.background='#1a3535'; }}
				>
					{#if isGenerating}
						<span class="flex gap-[3px] items-end h-4">
							<span class="ga-wave-bar" style="background:#e0fafa;height:3px;"></span>
							<span class="ga-wave-bar" style="background:#e0fafa;height:7px;"></span>
							<span class="ga-wave-bar" style="background:#e0fafa;height:11px;"></span>
							<span class="ga-wave-bar" style="background:#e0fafa;height:7px;"></span>
							<span class="ga-wave-bar" style="background:#e0fafa;height:3px;"></span>
						</span>
						{generatingStatus || 'Generating...'}
					{:else}
						<!-- music note SVG -->
						<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
							<path d="M9 18V5l12-2v13"/>
							<circle cx="6" cy="18" r="3"/>
							<circle cx="18" cy="16" r="3"/>
						</svg>
						Create
					{/if}
				</button>
			{/if}
		</div>

	</div><!-- /left panel -->


	<!-- ── RIGHT PANEL: Library ──────────────────────────────────── -->
	<div class="flex-1 flex flex-col overflow-hidden">

		<div class="flex items-center justify-between px-6 py-4 shrink-0" style="border-bottom:1px solid var(--ga-border);">
			<h2 class="text-xl font-bold">Library</h2>
			<a href="/library" class="text-xs hover:opacity-80 transition-opacity" style="color:var(--ga-muted);">View all →</a>
		</div>

		<!-- Search -->
		<div class="px-6 pt-3 pb-2 shrink-0">
			<div class="relative">
				<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none opacity-40" style="color:var(--ga-muted);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
				</svg>
				<input
					type="text"
					bind:value={librarySearch}
					placeholder="Search tracks..."
					class="w-full pl-9 pr-4 py-2 rounded-lg text-sm focus:outline-none"
					style="background:var(--ga-box);border:1px solid var(--ga-border);color:var(--ga-text);"
				/>
			</div>
		</div>

		<!-- Progress while generating -->
		{#if isGenerating}
			<div class="mx-6 mb-2 rounded-xl p-3 space-y-2 shrink-0" style="border:1px solid var(--ga-gold);background:rgba(214,200,6,0.04);">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<span class="flex gap-[3px] items-end h-4">
							<span class="ga-wave-bar" style="height:3px;"></span>
							<span class="ga-wave-bar" style="height:7px;"></span>
							<span class="ga-wave-bar" style="height:10px;"></span>
							<span class="ga-wave-bar" style="height:7px;"></span>
							<span class="ga-wave-bar" style="height:3px;"></span>
						</span>
						<span class="text-xs font-semibold" style="color:var(--ga-gold);">Generating...</span>
					</div>
					<span class="font-mono text-sm tabular-nums" style="color:var(--ga-gold);">
						{Math.floor(generatingElapsed / 60).toString().padStart(2, '0')}:{(generatingElapsed % 60).toString().padStart(2, '0')}
					</span>
				</div>
				<p class="text-xs" style="color:var(--ga-muted);">{generatingStatus}</p>
				<div class="h-1 rounded-full overflow-hidden" style="background:rgba(214,200,6,0.15);">
					<div class="h-full rounded-full" style="width:{Math.min(generatingElapsed / 180 * 100, 95)}%;background:var(--ga-gold);transition:width 1s linear;"></div>
				</div>
			</div>
		{/if}

		<!-- Track list -->
		<div class="flex-1 overflow-y-auto px-6 pb-6 pt-1 space-y-1">
			{#if filteredTracks.length === 0 && !isGenerating}
				<div class="flex flex-col items-center justify-center h-64 gap-3" style="color:var(--ga-muted);">
					<span class="text-4xl">🎵</span>
					<p class="text-sm">Create your first track</p>
				</div>
			{:else}
				{#each filteredTracks as track (track.id)}
					<div class="rounded-xl" style="background:var(--ga-box);">
						<div class="flex items-center gap-3 p-3">

							<!-- Circular cover + play -->
							<button
								onclick={() => playTrackEntry(track)}
								class="relative w-12 h-12 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
								style="background:var(--ga-box2);"
							>
								{#if track.coverUrl}
									<img src={track.coverUrl} alt="" class="w-full h-full object-cover" />
								{:else}
									<span class="text-xl">🎵</span>
								{/if}
								<div class="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 hover:opacity-100 transition-opacity rounded-full">
									<svg class="w-5 h-5" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
								</div>
							</button>

							<!-- Info -->
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-1.5 mb-0.5">
									{#if editingId === track.id}
										<input
											class="flex-1 text-sm font-semibold bg-transparent border-b focus:outline-none"
											style="border-color:var(--ga-gold);color:var(--ga-text);"
											bind:value={editingTitle}
											onkeydown={(e) => { if (e.key === 'Enter') saveTitle(track); if (e.key === 'Escape') editingId = null; }}
											onblur={() => saveTitle(track)}
										/>
									{:else}
										<span class="text-sm font-semibold truncate">{track.title}</span>
									{/if}
									{#if track.model}
										<span class="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0" style="background:rgba(214,200,6,0.12);color:var(--ga-gold);">
											{track.model.replace('suno-', 'V').replace('music_v1', 'EL')}
										</span>
									{/if}
									{#if track.isNew}
										<span class="text-[9px] px-1.5 py-0.5 rounded-full font-bold shrink-0" style="background:rgba(142,85,234,0.15);color:var(--ga-purple);">NEW</span>
									{/if}
								</div>
								<p class="text-xs truncate" style="color:var(--ga-muted);">
									{#if track.durationMs}{formatDuration(track.durationMs)} · {/if}{track.tags || (track.prompt?.slice(0, 50) ?? '')}
								</p>
								<!-- Action row -->
								<div class="flex items-center gap-2 mt-1.5">
									<button
										onclick={() => togglePublish(track)}
										class="text-[11px] px-3 py-0.5 rounded-full border font-medium transition-all"
										style={track.isPublic
											? 'border-color:var(--ga-gold);color:var(--ga-gold);background:transparent;'
											: 'border-color:var(--ga-border);color:var(--ga-muted);background:transparent;'}
									>{track.isPublic ? 'Publicado' : 'Publicar'}</button>
									<button
										onclick={() => { navigator.clipboard.writeText(window.location.origin + '/explore'); toast.success('Link copiado'); }}
										class="opacity-50 hover:opacity-100 transition-opacity" style="color:var(--ga-muted);" title="Compartir"
									>
										<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
									</button>
									{#if track.audioUrl}
										<a href={track.audioUrl} download="{track.title}.mp3" class="opacity-50 hover:opacity-100 transition-opacity" style="color:var(--ga-muted);">
											<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
										</a>
									{/if}
									<button class="opacity-50 hover:opacity-100 transition-opacity text-sm" style="color:var(--ga-muted);" title="Like">♡</button>
								</div>
							</div>

							<!-- Right: Remix | Video | ... -->
							<div class="flex items-center gap-1 shrink-0">
								<button
									onclick={() => { if (track.audioUrl) { studioAudioUrl = track.audioUrl; } activeTab = 'studio'; }}
									class="hidden lg:flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
									style="border-color:var(--ga-border);color:var(--ga-muted);"
									onmouseenter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--ga-gold)'; el.style.color = 'var(--ga-gold)'; }}
									onmouseleave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--ga-border)'; el.style.color = 'var(--ga-muted)'; }}
								>
									<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
									Remix
								</button>
								<button
									onclick={() => createVideo(track)}
									disabled={track.isCreatingVideo}
									class="hidden lg:flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
									style="border-color:var(--ga-border);color:var(--ga-muted);"
									onmouseenter={(e) => { const el = e.currentTarget as HTMLElement; if (!track.isCreatingVideo) { el.style.borderColor = 'var(--ga-purple)'; el.style.color = 'var(--ga-purple)'; } }}
									onmouseleave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--ga-border)'; el.style.color = 'var(--ga-muted)'; }}
								>
									{#if track.isCreatingVideo}
										<span class="inline-block w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin"></span>
									{:else}
										<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
									{/if}
									Video
								</button>

								<!-- Context menu -->
								<div class="relative">
									<button
										onclick={(e) => toggleMenu(track.id, e)}
										class="w-7 h-7 flex items-center justify-center rounded-lg border text-xs transition-colors"
										style="border-color:var(--ga-border);color:var(--ga-muted);"
										onmouseenter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--ga-gold)'; el.style.color = 'var(--ga-gold)'; }}
										onmouseleave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--ga-border)'; el.style.color = 'var(--ga-muted)'; }}
									>•••</button>

									{#if openMenuId === track.id}
										<div
											class="absolute right-0 top-8 z-50 rounded-xl py-1 shadow-2xl"
											style="min-width:200px;background:#111;border:1px solid var(--ga-border);"
											onclick={(e) => e.stopPropagation()}
										>
											<button class="w-full px-4 py-2 text-left text-xs flex items-center gap-3 hover:bg-white/5" onclick={() => { playTrackEntry(track); closeMenu(); }}>
												<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Reproducir
											</button>
											<button class="w-full px-4 py-2 text-left text-xs flex items-center gap-3 hover:bg-white/5" onclick={() => { editingId = track.id; editingTitle = track.title; closeMenu(); }}>
												<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Editar título
											</button>
											{#if track.isNew}
												<button class="w-full px-4 py-2 text-left text-xs flex items-center gap-3 hover:bg-white/5" onclick={() => { saveToLibrary(track); closeMenu(); }}>
													<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar en Library
												</button>
											{/if}
											<button class="w-full px-4 py-2 text-left text-xs flex items-center gap-3 hover:bg-white/5" onclick={() => { togglePublish(track); closeMenu(); }}>
												{#if track.isPublic}
													<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Quitar de Explore
												{:else}
													<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Publicar en Explore
												{/if}
											</button>
											<div style="border-top:1px solid var(--ga-border);margin:4px 0;"></div>
											
											<!-- Studio Quick Actions -->
											<button class="w-full px-4 py-2 text-left text-xs flex items-center gap-3 hover:bg-white/5" onclick={() => { quickStudioAction(track, 'extend', 'Extend'); }}>
												<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7-7 7 7"/></svg> Extend
											</button>
											<button class="w-full px-4 py-2 text-left text-xs flex items-center gap-3 hover:bg-white/5" onclick={() => { quickStudioAction(track, 'vocal-remove', 'Stem Separation'); }}>
												<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> Extraer stems
											</button>
											<button class="w-full px-4 py-2 text-left text-xs flex items-center gap-3 hover:bg-white/5" onclick={() => { quickStudioAction(track, 'style-boost', 'Boost Style'); }}>
												<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Boost Style
											</button>
											<button class="w-full px-4 py-2 text-left text-xs flex items-center gap-3 hover:bg-white/5" onclick={() => { quickStudioAction(track, 'midi', 'Generate Midi'); }}>
												<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg> Generate Midi
											</button>
											<button class="w-full px-4 py-2 text-left text-xs flex items-center gap-3 hover:bg-white/5" onclick={() => { quickStudioAction(track, 'wav', 'WAV Convert'); }}>
												<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> Convert to WAV
											</button>
											<button class="w-full px-4 py-2 text-left text-xs flex items-center gap-3 hover:bg-white/5" onclick={() => { createVideo(track); closeMenu(); }} disabled={track.isCreatingVideo}>
												<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
												{track.isCreatingVideo ? 'Creando video...' : 'Crear video'}
											</button>
											<button class="w-full px-4 py-2 text-left text-xs flex items-center gap-3 hover:bg-white/5" onclick={() => { if (track.audioUrl) { studioAudioUrl = track.audioUrl; } activeTab = 'studio'; closeMenu(); }}>
												<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Abrir en Studio
											</button>
											<div style="border-top:1px solid var(--ga-border);margin:4px 0;"></div>
											{#if track.audioUrl}
												<a class="w-full px-4 py-2 text-xs flex items-center gap-3 hover:bg-white/5" href={track.audioUrl} download="{track.title}.mp3" style="color:inherit;text-decoration:none;">
													<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Descargar MP3
												</a>
											{/if}
											{#if track.videoUrl}
												<a class="w-full px-4 py-2 text-xs flex items-center gap-3 hover:bg-white/5" href={track.videoUrl} download="{track.title}.mp4" style="color:inherit;text-decoration:none;">
													<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> Descargar Video
												</a>
											{/if}
											<div style="border-top:1px solid var(--ga-border);margin:4px 0;"></div>
											<button class="w-full px-4 py-2 text-left text-xs flex items-center gap-3 hover:bg-white/5" style="color:var(--ga-pink);" onclick={() => { deleteTrack(track); closeMenu(); }}>
												<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Eliminar
											</button>
										</div>
									{/if}
								</div>
							</div>
						</div>

						<!-- Video preview -->
						{#if track.videoUrl}
							<div class="px-3 pb-3">
								<video src={track.videoUrl} controls class="w-full rounded-xl max-h-40" style="background:#000;"></video>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>

	</div><!-- /right panel -->

</div><!-- /page -->

<!-- Video creation pipeline modal -->
{#if videoModalTrack}
	<CreateVideoModal track={videoModalTrack} bind:open={videoModalOpen} />
{/if}

