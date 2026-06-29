import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { videoProjects, users, publications } from '$lib/server/db/schema.js';
import { eq, desc, and, isNotNull } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	const session = await locals.auth();

	// Public video projects that have at least one done clip
	// We join with publications to get track info and users for creator info
	const rows = await db
		.select({
			projectId: videoProjects.id,
			config:    videoProjects.config,
			clips:     videoProjects.clips,
			createdAt: videoProjects.createdAt,
			trackTitle: publications.title,
			trackCoverUrl: publications.coverUrl,
			trackAudioUrl: publications.audioUrl,
			creatorName: users.name,
			creatorImage: users.image,
		})
		.from(videoProjects)
		.innerJoin(publications, eq(publications.id, videoProjects.publicationId))
		.innerJoin(users, eq(users.id, videoProjects.userId))
		.where(and(
			eq(videoProjects.status, 'editor'),
			isNotNull(videoProjects.clips),
		))
		.orderBy(desc(videoProjects.createdAt))
		.limit(50);

	const ser = <T>(v: T) => JSON.parse(JSON.stringify(v, (_, val) =>
		val instanceof Date ? val.toISOString() : val
	)) as T;

	return {
		videos: ser(rows),
		userId: session?.user?.id ?? null,
	};
};
