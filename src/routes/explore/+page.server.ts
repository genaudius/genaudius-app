import type { PageServerLoad } from './$types.js';
import { db, publications, users, likes } from '$lib/server/db/index.js';
import { eq, desc, and, sql } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, url }) => {
	const session = await locals.auth();
	const type = (url.searchParams.get('type') as 'music' | 'video' | 'image') || 'music';
	const sort = url.searchParams.get('sort') || 'new'; // 'new' | 'trending'

	const orderBy = sort === 'trending'
		? desc(publications.playCount)
		: desc(publications.createdAt);

	const rows = await db
		.select({
			id: publications.id,
			userId: publications.userId,
			type: publications.type,
			title: publications.title,
			description: publications.description,
			audioUrl: publications.audioUrl,
			videoUrl: publications.videoUrl,
			coverUrl: publications.coverUrl,
			tags: publications.tags,
			model: publications.model,
			durationMs: publications.durationMs,
			isInstrumental: publications.isInstrumental,
			playCount: publications.playCount,
			likeCount: publications.likeCount,
			createdAt: publications.createdAt,
			artistName: users.name,
			artistImage: users.image,
		})
		.from(publications)
		.leftJoin(users, eq(users.id, publications.userId))
		.where(and(eq(publications.isPublic, true), eq(publications.type, type)))
		.orderBy(orderBy)
		.limit(50);

	// Check which ones the current user has liked
	let likedIds = new Set<string>();
	if (session?.user?.id) {
		const userLikes = await db
			.select({ publicationId: likes.publicationId })
			.from(likes)
			.where(eq(likes.userId, session.user.id));
		likedIds = new Set(userLikes.map((l) => l.publicationId));
	}

	return {
		tracks: rows.map((r) => ({ ...r, isLiked: likedIds.has(r.id) })),
		activeType: type,
		activeSort: sort,
		userId: session?.user?.id ?? null,
	};
};
