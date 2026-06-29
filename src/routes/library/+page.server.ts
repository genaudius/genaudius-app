import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { publications } from '$lib/server/db/schema.js';
import { eq, desc } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	const session = await locals.auth();
	if (!session?.user?.id) redirect(302, '/login');

	const tracks = await db
		.select()
		.from(publications)
		.where(eq(publications.userId, session.user.id))
		.orderBy(desc(publications.createdAt));

	return {
		tracks: tracks.map((t) => ({
			...t,
			createdAt: t.createdAt.toISOString(),
			updatedAt: t.updatedAt.toISOString(),
		})),
		userId: session.user.id,
		userName: session.user.name,
	};
};
