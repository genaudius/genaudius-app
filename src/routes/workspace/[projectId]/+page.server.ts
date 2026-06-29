import type { PageServerLoad } from './$types.js';
import { redirect, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { publications, videoProjects, users, socialAccounts } from '$lib/server/db/schema.js';
import { eq, and, desc, ne } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params, locals }) => {
	const session = await locals.auth();
	if (!session?.user) redirect(302, '/login');

	const [project] = await db.select().from(videoProjects)
		.where(and(eq(videoProjects.id, params.projectId), eq(videoProjects.userId, session.user.id)));
	if (!project) error(404, 'Video project not found');

	if (!project.publicationId) error(404, 'Project has no associated track');
	const [track] = await db.select().from(publications)
		.where(eq(publications.id, project.publicationId));
	if (!track) error(404, 'Track not found');

	const [user] = await db.select({
		planTier: users.planTier,
		subscriptionStatus: users.subscriptionStatus,
		stripeCustomerId: users.stripeCustomerId,
	}).from(users).where(eq(users.id, session.user.id));

	const connected = await db.select({
		platform: socialAccounts.platform,
		platformUsername: socialAccounts.platformUsername,
		platformAvatar: socialAccounts.platformAvatar,
	}).from(socialAccounts).where(eq(socialAccounts.userId, session.user.id));

	// History: all other video projects for this user, newest first
	const history = await db
		.select({
			id: videoProjects.id,
			status: videoProjects.status,
			config: videoProjects.config,
			clips: videoProjects.clips,
			createdAt: videoProjects.createdAt,
			updatedAt: videoProjects.updatedAt,
			trackTitle: publications.title,
			trackCoverUrl: publications.coverUrl,
		})
		.from(videoProjects)
		.innerJoin(publications, eq(publications.id, videoProjects.publicationId))
		.where(and(eq(videoProjects.userId, session.user.id), ne(videoProjects.id, params.projectId)))
		.orderBy(desc(videoProjects.updatedAt))
		.limit(30);

	const ser = <T extends object>(obj: T) => JSON.parse(JSON.stringify(obj, (_, v) =>
		v instanceof Date ? v.toISOString() : v
	)) as T;

	return {
		project: ser(project),
		track: ser(track),
		planTier: user?.planTier ?? 'free',
		subscriptionStatus: user?.subscriptionStatus ?? 'incomplete',
		hasStripe: !!user?.stripeCustomerId,
		connectedAccounts: connected,
		history: ser(history),
	};
};
