import type { PageServerLoad } from './$types.js';
import { redirect } from '@sveltejs/kit';
import { getSunoApiKey } from '$lib/server/settings-store.js';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db/index.js';
import { publications } from '$lib/server/db/schema.js';
import { eq, desc } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	const session = await locals.auth();
	if (!session?.user) redirect(302, '/login');

	// Check if Suno API key is configured
	let sunoConfigured = false;
	try {
		const dbKey = await getSunoApiKey();
		const envKey = (env as Record<string, string>)['SUNO_API_KEY'] || '';
		sunoConfigured = !!(dbKey || envKey);
	} catch { sunoConfigured = false; }

	// Load recent music publications for history panel
	const history = await db
		.select()
		.from(publications)
		.where(eq(publications.userId, session.user.id))
		.orderBy(desc(publications.createdAt))
		.limit(50);

	return {
		user: { id: session.user.id, name: session.user.name, image: session.user.image },
		sunoConfigured,
		history: history.map((t) => ({
			...t,
			createdAt: t.createdAt.toISOString(),
			updatedAt: t.updatedAt.toISOString(),
		})),
	};
};
