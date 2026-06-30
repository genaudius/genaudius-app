import type { Actions, PageServerLoad } from './$types'
import { db, pricingPlans } from '$lib/server/db'
import { fail, redirect } from '@sveltejs/kit'
import { isDemoModeEnabled, DEMO_MODE_MESSAGES } from '$lib/constants/demo-mode.js'

export const load: PageServerLoad = async () => {
  return {
    isDemoMode: isDemoModeEnabled()
  }
}

export const actions: Actions = {
  create: async ({ request }) => {
    // Check demo mode - block modifications
    if (isDemoModeEnabled()) {
      return fail(403, {
        error: DEMO_MODE_MESSAGES.ADMIN_SAVE_DISABLED
      });
    }

    const data = await request.formData()
    
    const name = data.get('name')?.toString()
    const tier = data.get('tier')?.toString()
    const stripePriceId = data.get('stripePriceId')?.toString()
    const priceAmount = data.get('priceAmount')?.toString()
    const currency = data.get('currency')?.toString() || 'usd'
    const billingInterval = data.get('billingInterval')?.toString()
    const creditLimit = data.get('creditLimit')?.toString()
    const features = data.get('features')?.toString()

    // Validation
    if (!name || !tier || !stripePriceId || !priceAmount || !billingInterval) {
      return fail(400, {
        error: 'Required fields are missing',
        name,
        tier,
        stripePriceId,
        priceAmount,
        currency,
        billingInterval,
        creditLimit,
        features
      })
    }

    if (!['free', 'plus', 'pro'].includes(tier)) {
      return fail(400, {
        error: 'Invalid tier selected',
        name,
        tier,
        stripePriceId,
        priceAmount,
        currency,
        billingInterval,
        creditLimit,
        features
      })
    }

    if (!['month', 'year'].includes(billingInterval)) {
      return fail(400, {
        error: 'Invalid billing interval selected',
        name,
        tier,
        stripePriceId,
        priceAmount,
        currency,
        billingInterval,
        creditLimit,
        features
      })
    }

    const priceAmountNum = parseInt(priceAmount)
    if (isNaN(priceAmountNum) || priceAmountNum < 0) {
      return fail(400, {
        error: 'Price amount must be a valid positive number',
        name,
        tier,
        stripePriceId,
        priceAmount,
        currency,
        billingInterval,
        creditLimit,
        features
      })
    }

    try {
      // Parse limits (null for unlimited, 0 for no access)
      const parsedCreditLimit = creditLimit === '' || creditLimit === undefined || creditLimit === null ? null : parseInt(creditLimit)

      // Parse features array
      let featuresArray: string[] = []
      if (features) {
        try {
          featuresArray = features.split('\n').map(f => f.trim()).filter(f => f.length > 0)
        } catch (error) {
          featuresArray = []
        }
      }

      // Create the plan
      await db.insert(pricingPlans).values({
        name,
        tier: tier as 'free' | 'plus' | 'pro',
        stripePriceId,
        priceAmount: priceAmountNum,
        currency,
        billingInterval: billingInterval as 'month' | 'year',
        creditLimit: parsedCreditLimit !== null && !isNaN(parsedCreditLimit) ? parsedCreditLimit : null,
        features: featuresArray,
        isActive: true
      })

      throw redirect(303, '/admin/settings/plans')
    } catch (error) {
      // Check if this is a redirect response (SvelteKit redirects are Response objects)
      if (error instanceof Response || (error && typeof error === 'object' && 'status' in error && error.status === 303)) {
        throw error
      }
      
      console.error('Error creating plan:', error)
      return fail(500, {
        error: 'Failed to create plan',
        name,
        tier,
        stripePriceId,
        priceAmount,
        currency,
        billingInterval,
        creditLimit,
        features
      })
    }
  }
}