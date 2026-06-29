import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { generateMusic as elevenlabsGenerateMusic } from '$lib/ai/providers/elevenlabs.js';
import { sunoProvider, sunoSubmitTask, sunoCheckStatus } from '$lib/ai/providers/suno.js';
import { UsageTrackingService, UsageLimitError } from '$lib/server/usage-tracking.js';
import { saveMusicAndGetId } from '$lib/ai/utils.js';
import { isDemoModeRestricted, DEMO_MODE_MESSAGES } from '$lib/constants/demo-mode.js';

const VALID_ELEVENLABS_MUSIC_MODELS = ['music_v1'];
const VALID_SUNO_MODELS = ['suno-v3.5', 'suno-v4', 'suno-v4.5', 'suno-v4.5-plus', 'suno-v4.5-all', 'suno-v5', 'suno-v5.5'];

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const session = await locals.auth();
		if (!session?.user?.id) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		if (isDemoModeRestricted(!!session?.user?.id)) {
			return json({
				error: DEMO_MODE_MESSAGES.GENERAL_RESTRICTION,
				type: 'demo_mode_restricted'
			}, { status: 403 });
		}

		const body = await request.json();
		const {
			prompt,
			musicLengthMs,
			modelId = 'music_v1',
			forceInstrumental = false,
			outputFormat = 'mp3_44100_128',
			customMode = false,
			style,
			title,
		} = body;

		if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
			return json({ error: 'Prompt is required and must be a non-empty string' }, { status: 400 });
		}
		if (prompt.length > 4100) {
			return json({ error: 'Prompt exceeds maximum length of 4100 characters' }, { status: 400 });
		}

		const isSunoModel = VALID_SUNO_MODELS.includes(modelId);
		const isElevenLabsModel = VALID_ELEVENLABS_MUSIC_MODELS.includes(modelId);

		if (!isSunoModel && !isElevenLabsModel) {
			return json({
				error: `Invalid music model: ${modelId}. Valid models: ${[...VALID_ELEVENLABS_MUSIC_MODELS, ...VALID_SUNO_MODELS].join(', ')}`
			}, { status: 400 });
		}

		if (!isSunoModel && musicLengthMs != null) {
			const durationMs = Number(musicLengthMs);
			if (isNaN(durationMs) || durationMs < 3000 || durationMs > 300000) {
				return json({ error: 'Music duration must be between 3 seconds (3000ms) and 5 minutes (300000ms)' }, { status: 400 });
			}
		}

		try {
			await UsageTrackingService.checkUsageLimit(session.user.id, 'audio');
		} catch (error) {
			if (error instanceof UsageLimitError) {
				return json({
					error: error.message,
					type: 'usage_limit_exceeded',
					remainingQuota: error.remainingQuota
				}, { status: 429 });
			}
			throw error;
		}

		// ── Suno: submit only, return taskId immediately ──────────────────────────
		if (isSunoModel) {
			const origin = request.headers.get('origin') || new URL(request.url).origin;
			const taskId = await sunoSubmitTask({
				prompt: prompt.trim(),
				modelId,
				forceInstrumental: Boolean(forceInstrumental),
				customMode: Boolean(customMode),
				style,
				title,
				callBackUrl: `${origin}/api/suno-callback`,
			});
			return json({ taskId, provider: 'suno' });
		}

		// ── ElevenLabs: synchronous (fast, < 30s) ────────────────────────────────
		const response = await elevenlabsGenerateMusic({
			prompt: prompt.trim(),
			modelId,
			forceInstrumental: Boolean(forceInstrumental),
			outputFormat,
			musicLengthMs: musicLengthMs != null ? Number(musicLengthMs) : undefined
		});

		const musicId = await saveMusicAndGetId(
			response.audioData,
			response.mimeType,
			session.user.id,
			response.prompt,
			response.model,
			response.durationMs,
			response.isInstrumental
		);

		UsageTrackingService.trackUsage(session.user.id, 'audio').catch(console.error);
		return json({ ...response, musicId });

	} catch (error) {
		console.error('Music generation API error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Internal server error' },
			{ status: 500 }
		);
	}
};

// GET /api/music-generation?taskId=xxx — poll Suno task status from the frontend
export const GET: RequestHandler = async ({ url, locals, request }) => {
	const session = await locals.auth();
	if (!session?.user?.id) return json({ error: 'Authentication required' }, { status: 401 });

	const taskId = url.searchParams.get('taskId');
	if (!taskId) return json({ error: 'taskId required' }, { status: 400 });

	try {
		const result = await sunoCheckStatus(taskId);

		if (result.status === 'done' && result.track) {
			// Download audio, save to DB, return full response
			const audioRes = await fetch(result.track.audioUrl);
			if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`);
			const arrayBuffer = await audioRes.arrayBuffer();
			const audioData = Buffer.from(arrayBuffer).toString('base64');
			const durationMs = Math.round((result.track.duration || 0) * 1000);

			const musicId = await saveMusicAndGetId(
				audioData,
				'audio/mpeg',
				session.user.id,
				result.track.title || taskId,
				'suno',
				durationMs,
				false
			);

			UsageTrackingService.trackUsage(session.user.id, 'audio').catch(console.error);

			return json({
				status: 'done',
				audioData,
				mimeType: 'audio/mpeg',
				durationMs,
				audioUrl: result.track.audioUrl,
				coverUrl: result.track.imageUrl,
				title: result.track.title,
				tags: result.track.tags,
				musicId,
			});
		}

		if (result.status === 'error') {
			return json({ status: 'error', error: result.errorMessage || 'Generation failed' });
		}

		return json({ status: 'pending' });

	} catch (error) {
		console.error('Suno status check error:', error);
		return json({ status: 'error', error: error instanceof Error ? error.message : 'Status check failed' });
	}
};
