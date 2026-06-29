import type { PageServerLoad } from './$types.js';
import { redirect, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { publications, videoProjects } from '$lib/server/db/schema.js';
import { eq, and } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params, locals }) => {
	const session = await locals.auth();
	if (!session?.user) redirect(302, '/login');

	const [track] = await db.select().from(publications)
		.where(eq(publications.id, params.trackId));

	if (!track) error(404, 'Track not found');
	if (track.userId !== session.user.id) error(403, 'Forbidden');

	// Load existing video project if any
	const [project] = await db.select().from(videoProjects)
		.where(and(
			eq(videoProjects.publicationId, params.trackId),
			eq(videoProjects.userId, session.user.id),
		));

	const serialize = (p: typeof project | undefined) => p ? {
		...p,
		createdAt: p.createdAt.toISOString(),
		updatedAt: p.updatedAt.toISOString(),
	} : null;

	return {
		track: {
			...track,
			createdAt: track.createdAt.toISOString(),
			updatedAt: track.updatedAt.toISOString(),
		},
		project: serialize(project),
	};
};
