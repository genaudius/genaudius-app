import type { PageServerLoad } from './$types.js';
import { error } from '@sveltejs/kit';
import { db, users, publications, artistProfiles, follows, likes } from '$lib/server/db/index.js';
import { eq, and, desc, count } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params, locals }) => {
	const session = await locals.auth();

	// Get artist user
	const [artist] = await db
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			image: users.image,
			createdAt: users.createdAt,
		})
		.from(users)
		.where(eq(users.id, params.id))
		.limit(1);

	if (!artist) error(404, 'Artist not found');

	// Get artist profile (optional extended info)
	const [profile] = await db
		.select()
		.from(artistProfiles)
		.where(eq(artistProfiles.userId, params.id))
		.limit(1);

	// Get public publications
	const tracks = await db
		.select({
			id: publications.id,
			type: publications.type,
			title: publications.title,
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
		})
		.from(publications)
		.where(and(eq(publications.userId, params.id), eq(publications.isPublic, true)))
		.orderBy(desc(publications.createdAt))
		.limit(50);

	// Follower / following counts
	const [followerRow] = await db
		.select({ cnt: count() })
		.from(follows)
		.where(eq(follows.followingId, params.id));

	const [followingRow] = await db
		.select({ cnt: count() })
		.from(follows)
		.where(eq(follows.followerId, params.id));

	// Is current user following this artist?
	let isFollowing = false;
	if (session?.user?.id && session.user.id !== params.id) {
		const [followRow] = await db
			.select({ id: follows.id })
			.from(follows)
			.where(and(eq(follows.followerId, session.user.id), eq(follows.followingId, params.id)))
			.limit(1);
		isFollowing = !!followRow;
	}

	// Liked track IDs for current user
	let likedIds = new Set<string>();
	if (session?.user?.id) {
		const userLikes = await db
			.select({ publicationId: likes.publicationId })
			.from(likes)
			.where(eq(likes.userId, session.user.id));
		likedIds = new Set(userLikes.map((l) => l.publicationId));
	}

	return {
		artist,
		profile: profile ?? null,
		tracks: tracks.map((t) => ({ ...t, isLiked: likedIds.has(t.id) })),
		followerCount: followerRow?.cnt ?? 0,
		followingCount: followingRow?.cnt ?? 0,
		isFollowing,
		currentUserId: session?.user?.id ?? null,
		isOwnProfile: session?.user?.id === params.id,
	};
};
