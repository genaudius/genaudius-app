import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { StripeService } from '$lib/server/stripe.js';
import { TOPUP_PACKAGES } from '$lib/config/topups.js';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	// Verify user is authenticated
	const session = await locals.auth();
	if (!session?.user?.id) {
		return error(401, 'Unauthorized');
	}

	try {
		const { packageId } = await request.json();

		if (!packageId) {
			return error(400, 'Package ID is required');
		}

		// Find the requested package
		const topupPackage = TOPUP_PACKAGES.find((p) => p.id === packageId);

		if (!topupPackage) {
			return error(400, 'Invalid package selected');
		}

		// Determine base URL for success/cancel redirects
		const baseUrl = `${url.protocol}//${url.host}`;
		
		// Create the Stripe checkout session
		const checkoutSession = await StripeService.createOneTimeCheckoutSession({
			userId: session.user.id,
			priceId: topupPackage.stripePriceId,
			successUrl: `${baseUrl}/settings/billing?topup=success`,
			cancelUrl: `${baseUrl}/settings/billing?topup=canceled`,
			credits: topupPackage.credits,
		});

		// Return the URL to the frontend for hosted checkout
		return json({
			url: checkoutSession.url,
		});
	} catch (err) {
		console.error('Error creating checkout session:', err);
		return error(500, 'Failed to create checkout session');
	}
};
