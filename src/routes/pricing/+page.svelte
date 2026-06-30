<script lang="ts">
  import { getContext } from "svelte";
  import Button from "$lib/components/ui/button/button.svelte";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { toast } from "svelte-sonner";
  import { goto, preloadData } from "$app/navigation";
  import type { SettingsState } from "$lib/stores/settings.svelte.js";

  // Import icons
  import {
    CheckIcon,
    ArrowRightIcon,
    ArrowLeftIcon
  } from "$lib/icons/index.js";

  let { data } = $props();

  // Get settings from context
  const settingsState = getContext<SettingsState>("settings");

  const allPlans = $derived(data.plans || []);
  const currentSubscription = $derived(data.currentSubscription);
  const user = $derived(data.user);
  const userData = $derived(data.userData);

  // Billing interval toggle state
  let isYearly = $state(true);

  // Find dynamic price IDs from the database
  const getPriceId = (tier: string, interval: string) => {
    const plan = allPlans.find((p: any) => p.tier === tier && p.billingInterval === interval);
    return plan?.stripePriceId || "";
  };

  // Loading state for checkout
  let loadingPlan: string | null = $state(null);

  // Confirmation dialog state
  let showConfirmDialog = $state(false);
  let pendingAction = $state<{
    priceId: string;
    planName: string;
    changeType: string;
    isUpgrade: boolean;
  } | null>(null);

  function isCurrentPlan(planTier: string): boolean {
    if (planTier === "free") {
      return userData?.planTier === "free";
    }
    return currentSubscription?.plan?.tier === planTier;
  }

  function isDowngrade(planTier: string): boolean {
    const tierOrder = { free: 0, plus: 1, pro: 2 };
    let currentTier = "free"; 
    if (userData?.planTier === "free") {
      currentTier = "free";
    } else if (currentSubscription?.plan?.tier) {
      currentTier = currentSubscription.plan.tier;
    }

    const currentTierOrder = tierOrder[currentTier as keyof typeof tierOrder] || 0;
    const planTierOrder = tierOrder[planTier as keyof typeof tierOrder] || 0;
    return planTierOrder < currentTierOrder;
  }

  async function handleSubscribe(planTier: string, planName: string) {
    if (!user) {
      toast.error("Please log in to subscribe");
      goto("/login");
      return;
    }

    if (isCurrentPlan(planTier)) {
      toast.info("You are already subscribed to this plan");
      return;
    }

    if (planTier === 'free') {
      toast.info("You are already on the free tier.");
      return;
    }

    const priceId = getPriceId(planTier, isYearly ? 'year' : 'month');
    
    if (!priceId) {
      toast.error(`Missing Stripe Price ID for ${planName} (${isYearly ? 'Yearly' : 'Monthly'}). Please configure in Stripe.`);
      return;
    }

    loadingPlan = planTier;

    try {
      if (currentSubscription) {
        const isUpgrade = !isDowngrade(planTier);
        const changeType = isUpgrade ? "upgrade" : "downgrade";

        pendingAction = {
          priceId,
          planName,
          changeType,
          isUpgrade,
        };
        showConfirmDialog = true;
        loadingPlan = null;
        return;
      }

      await createCheckoutSession(priceId, planName);
    } catch (error) {
      console.error("Error processing subscription:", error);
      toast.error(error instanceof Error ? error.message : "Failed to process subscription change");
    } finally {
      loadingPlan = null;
    }
  }

  function getButtonText(planTier: string): string {
    if (isCurrentPlan(planTier)) return "Current Plan";
    if (isDowngrade(planTier)) return "Downgrade";
    if (!currentSubscription && planTier !== 'free') return "Get Started";
    if (planTier === 'free') return "Start Free";
    return "Upgrade";
  }

  // Dialog confirmation handlers
  function handleConfirmUpgrade() {
    if (!pendingAction) return;
    showConfirmDialog = false;
    proceedWithSubscriptionUpdate(pendingAction);
  }

  function handleCancelUpgrade() {
    showConfirmDialog = false;
    pendingAction = null;
    loadingPlan = null;
  }

  async function proceedWithSubscriptionUpdate(action: typeof pendingAction) {
    if (!action) return;
    loadingPlan = "pro"; // generic loading state
    try {
      const updateResponse = await fetch("/api/stripe/update-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId: action.priceId }),
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(errorData.message || "Failed to update subscription");
      }

      const updateResult = await updateResponse.json();

      if (updateResult.success) {
        if (updateResult.subscription?.proration_amount && updateResult.subscription.proration_amount > 0) {
          const prorationFormatted = (updateResult.subscription.proration_amount / 100).toFixed(2);
          toast.info(`A proration charge of $${prorationFormatted} has been applied.`);
        }

        const successUrl = new URL("/settings/billing", window.location.origin);
        successUrl.searchParams.set("subscription_updated", "true");
        successUrl.searchParams.set("plan_name", action.planName);
        successUrl.searchParams.set("change_type", action.changeType);
        successUrl.searchParams.set("expected_price_id", action.priceId);

        goto(successUrl.pathname + successUrl.search);
        return;
      } else if (updateResult.requiresCheckout) {
        createCheckoutSession(action.priceId, action.planName);
        return;
      }
    } catch (error) {
      console.error("Error processing subscription:", error);
      toast.error(error instanceof Error ? error.message : "Failed to process subscription change");
    } finally {
      loadingPlan = null;
      pendingAction = null;
    }
  }

  async function createCheckoutSession(priceId: string, planName: string) {
    try {
      const response = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });

      if (!response.ok) throw new Error("Failed to create checkout session");

      const { clientSecret } = await response.json();
      goto(`/checkout?client_secret=${clientSecret}&plan=${encodeURIComponent(planName)}`);
    } catch (error) {
      console.error("Error creating checkout session:", error);
      toast.error("Failed to start checkout process");
    }
  }

  function warmRoute(path: string) {
    void preloadData(path);
  }
</script>

<svelte:head>
  <title>Pricing Plans - GenAudius</title>
  <meta name="description" content="Choose the perfect plan for your AI music needs." />
</svelte:head>

<div class="min-h-screen bg-black text-white selection:bg-purple-500/30">
  <!-- Glowing Background Effects -->
  <div class="fixed inset-0 overflow-hidden pointer-events-none">
    <div class="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-purple-900/20 blur-[120px]"></div>
    <div class="absolute top-[40%] -right-[10%] w-[40%] h-[60%] rounded-full bg-emerald-900/20 blur-[120px]"></div>
  </div>

  <div class="container relative z-10 mx-auto px-4 py-12 max-w-7xl">
    
    <!-- Back Button -->
    <div class="mb-12">
      <Button
        variant="ghost"
        class="text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
        onclick={() => goto("/newchat")}
        onmouseenter={() => warmRoute("/newchat")}
      >
        <ArrowLeftIcon class="w-4 h-4 mr-2" />
        Back to App
      </Button>
    </div>

    <!-- Header -->
    <div class="text-center mb-16 space-y-4">
      <Badge class="bg-gradient-to-r from-purple-500/20 to-emerald-500/20 text-emerald-300 border-emerald-500/30 px-4 py-1.5 rounded-full uppercase tracking-wider text-xs font-semibold mb-6 inline-flex">
        GenAudius Happy Million Users
      </Badge>
      <h1 class="text-5xl md:text-6xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-white/70">
        Start Creating for Free
      </h1>
      <p class="text-lg text-zinc-400 max-w-2xl mx-auto mt-4">
        Choose a transparent plan that fits your creative journey. No lock-in. Cancel anytime.
      </p>
    </div>

    <!-- Billing Toggle -->
    <div class="flex flex-col items-center mb-16">
      <div class="flex items-center gap-2 p-1.5 bg-zinc-900/80 backdrop-blur-md rounded-2xl border border-white/5 shadow-2xl">
        <button 
          class={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${!isYearly ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-400 hover:text-zinc-200'}`}
          onclick={() => isYearly = false}
        >
          Monthly
        </button>
        <button 
          class={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 flex items-center gap-2 ${isYearly ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20' : 'text-zinc-400 hover:text-zinc-200'}`}
          onclick={() => isYearly = true}
        >
          Yearly <span class="bg-emerald-400/20 text-emerald-100 text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide">34% off</span>
        </button>
      </div>
    </div>

    <!-- Plans Grid -->
    <div class="grid lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
      
      <!-- FREE PLAN -->
      <Card.Root class="relative bg-zinc-900/50 backdrop-blur-xl border-white/10 overflow-hidden hover:border-white/20 transition-all duration-500 group">
        <Card.Content class="p-8 flex flex-col h-full">
          <div class="mb-8">
            <h3 class="text-2xl font-bold text-white mb-2">Free</h3>
            <div class="flex items-baseline gap-1 mb-2">
              <span class="text-5xl font-black text-white">$0</span>
              <span class="text-zinc-400 font-medium">/month</span>
            </div>
            <p class="text-zinc-500 text-sm">Free forever</p>
          </div>

          <ul class="space-y-4 mb-8 flex-grow">
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div class="flex items-center gap-1.5">
                <span class="text-zinc-300">500 credits /month</span>
                <Tooltip.Root>
                  <Tooltip.Trigger><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-zinc-500 hover:text-zinc-300 transition-colors"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></Tooltip.Trigger>
                  <Tooltip.Content class="bg-zinc-800 border-zinc-700 text-zinc-200 p-3">
                    <ul class="text-xs space-y-1">
                      <li>10 Full Songs</li>
                      <li>~20 Sound Generation</li>
                      <li>~5 Voice Changer</li>
                      <li>~10 AI Vocals</li>
                      <li>~15 Text to Speech<br/><span class="text-[10px] text-zinc-400">(Billed per 100 characters)</span></li>
                    </ul>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div class="flex items-center gap-1.5">
                <span class="text-zinc-300">Model v5.5</span>
                <Tooltip.Root>
                  <Tooltip.Trigger><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-zinc-500 hover:text-zinc-300 transition-colors"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></Tooltip.Trigger>
                  <Tooltip.Content class="bg-zinc-800 border-zinc-700 text-zinc-200 max-w-[200px] p-3">
                    <p class="text-xs">Newest music model, capable of generating almost anything audio.</p>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <span class="text-zinc-300">50 credits /download</span>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <span class="text-zinc-300">Basic features only</span>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <span class="text-zinc-300">Wait in queue to generate</span>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <span class="text-zinc-300">Personal use only</span>
            </li>
          </ul>

          <Button 
            class="w-full bg-white/10 hover:bg-white/20 text-white border-0 h-12 rounded-xl font-semibold transition-all mt-auto"
            disabled={isCurrentPlan('free')}
            onclick={() => handleSubscribe('free', 'Free')}
          >
            {getButtonText('free')}
          </Button>
        </Card.Content>
      </Card.Root>

      <!-- PLUS PLAN -->
      <Card.Root class="relative bg-zinc-900/50 backdrop-blur-xl border-white/10 overflow-hidden hover:border-purple-500/30 transition-all duration-500 group">
        <Card.Content class="p-8 flex flex-col h-full">
          <div class="mb-8">
            <h3 class="text-2xl font-bold text-white mb-2">Plus</h3>
            <div class="flex items-baseline gap-1 mb-2">
              <span class="text-5xl font-black text-white">${isYearly ? '9.99' : '15.00'}</span>
              <span class="text-zinc-400 font-medium">/month</span>
            </div>
            <p class="text-zinc-500 text-sm">{isYearly ? 'Billed yearly' : 'Billed monthly'}</p>
          </div>

          <ul class="space-y-4 mb-8 flex-grow">
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
              <div class="flex items-center gap-1.5">
                <span class="text-zinc-300">{isYearly ? '60K credits /year' : '5K credits /month'}</span>
                <Tooltip.Root>
                  <Tooltip.Trigger><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-zinc-500 hover:text-zinc-300 transition-colors"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></Tooltip.Trigger>
                  <Tooltip.Content class="bg-zinc-800 border-zinc-700 text-zinc-200 p-3">
                    <ul class="text-xs space-y-1">
                      <li>100 Full Songs</li>
                      <li>~200 Sound Generation</li>
                      <li>~50 Voice Changer</li>
                      <li>~100 AI Vocals</li>
                      <li>~151 Text to Speech<br/><span class="text-[10px] text-zinc-400">(Billed per 100 characters)</span></li>
                    </ul>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
              <div class="flex items-center gap-1.5">
                <span class="text-zinc-300">Model v6 Pro</span>
                <Tooltip.Root>
                  <Tooltip.Trigger><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-zinc-500 hover:text-zinc-300 transition-colors"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></Tooltip.Trigger>
                  <Tooltip.Content class="bg-zinc-800 border-zinc-700 text-zinc-200 max-w-[200px] p-3">
                    <p class="text-xs">Newest music model, capable of generating almost anything audio with improved musical structure and enhanced vocal clarity.</p>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
              <span class="text-zinc-300">Unlimited downloads</span>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
              <div class="flex items-center gap-1.5">
                <span class="text-zinc-300">Core features</span>
                <Tooltip.Root>
                  <Tooltip.Trigger><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-zinc-500 hover:text-zinc-300 transition-colors"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></Tooltip.Trigger>
                  <Tooltip.Content class="bg-zinc-800 border-zinc-700 text-zinc-200 p-3">
                    <p class="text-xs">Create songs and sound effects</p>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
              <span class="text-zinc-300">Fastlane queue</span>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
              <span class="text-zinc-300">Commercial use</span>
            </li>
          </ul>

          <Button 
            class="w-full bg-purple-600 hover:bg-purple-500 text-white border-0 h-12 rounded-xl font-semibold shadow-lg shadow-purple-500/25 transition-all mt-auto"
            disabled={loadingPlan === 'plus'}
            onclick={() => handleSubscribe('plus', 'Plus')}
          >
            {#if loadingPlan === 'plus'}
              <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div> Processing...
            {:else}
              {getButtonText('plus')}
            {/if}
          </Button>
        </Card.Content>
      </Card.Root>

      <!-- PRO PLAN -->
      <Card.Root class="relative bg-zinc-900/80 backdrop-blur-xl border-emerald-500/30 overflow-hidden hover:border-emerald-500/60 shadow-2xl shadow-emerald-900/20 transition-all duration-500 transform lg:-translate-y-2 group">
        <div class="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-emerald-400 to-emerald-600"></div>
        <div class="absolute top-0 right-0 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider py-1 px-3 rounded-bl-lg">Most Popular</div>
        
        <Card.Content class="p-8 flex flex-col h-full">
          <div class="mb-8">
            <h3 class="text-2xl font-bold text-white mb-2">Pro</h3>
            <div class="flex items-baseline gap-1 mb-2">
              <span class="text-5xl font-black text-white">${isYearly ? '16.99' : '25.00'}</span>
              <span class="text-zinc-400 font-medium">/month</span>
            </div>
            <p class="text-zinc-500 text-sm">{isYearly ? 'Billed yearly' : 'Billed monthly'}</p>
          </div>

          <ul class="space-y-4 mb-8 flex-grow">
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div class="flex items-center gap-1.5">
                <span class="text-zinc-300">{isYearly ? '300K credits /year' : '25K credits /month'}</span>
                <Tooltip.Root>
                  <Tooltip.Trigger><InfoIcon class="w-4 h-4 text-zinc-500 hover:text-zinc-300 transition-colors" /></Tooltip.Trigger>
                  <Tooltip.Content class="bg-zinc-800 border-zinc-700 text-zinc-200 p-3">
                    <ul class="text-xs space-y-1">
                      <li>~500 Full Songs</li>
                      <li>~1000 Sound Generation</li>
                      <li>~250 Voice Changer</li>
                      <li>~500 AI Vocals</li>
                      <li>~757 Text to Speech<br/><span class="text-[10px] text-zinc-400">(Billed per 100 characters)</span></li>
                    </ul>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div class="flex items-center gap-1.5">
                <span class="text-zinc-300">Model v6 Pro</span>
                <Tooltip.Root>
                  <Tooltip.Trigger><InfoIcon class="w-4 h-4 text-zinc-500 hover:text-zinc-300 transition-colors" /></Tooltip.Trigger>
                  <Tooltip.Content class="bg-zinc-800 border-zinc-700 text-zinc-200 max-w-[200px] p-3">
                    <p class="text-xs">Newest music model, capable of generating almost anything audio with improved musical structure and enhanced vocal clarity.</p>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <span class="text-zinc-300">Unlimited downloads</span>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div class="flex items-center gap-1.5">
                <span class="text-zinc-300 font-semibold text-emerald-100">Unlock all features</span>
                <Tooltip.Root>
                  <Tooltip.Trigger><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-emerald-500 hover:text-emerald-300 transition-colors"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></Tooltip.Trigger>
                  <Tooltip.Content class="bg-zinc-800 border-zinc-700 text-zinc-200 max-w-[200px] p-3">
                    <p class="text-xs">Create songs, sound effects, text to speech, remix, replace, extend and stem downloads</p>
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <span class="text-zinc-300">Fast generation</span>
            </li>
            <li class="flex items-start gap-3">
              <CheckIcon class="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <span class="text-zinc-300">Commercial use</span>
            </li>
          </ul>

          <Button 
            class="w-full bg-emerald-600 hover:bg-emerald-500 text-white border-0 h-12 rounded-xl font-semibold shadow-lg shadow-emerald-600/25 transition-all mt-auto"
            disabled={loadingPlan === 'pro'}
            onclick={() => handleSubscribe('pro', 'Pro')}
          >
            {#if loadingPlan === 'pro'}
              <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div> Processing...
            {:else}
              {getButtonText('pro')}
            {/if}
          </Button>
        </Card.Content>
      </Card.Root>

    </div>
  </div>

  <!-- Footer -->
  <div class="text-center py-12 text-zinc-500 text-sm">
    <div class="flex justify-center gap-4 mb-4 grayscale opacity-50">
      <div class="w-8 h-5 bg-white/20 rounded"></div>
      <div class="w-8 h-5 bg-white/20 rounded"></div>
      <div class="w-8 h-5 bg-white/20 rounded"></div>
    </div>
    <p>Secure payment processing. Cancel anytime.</p>
  </div>
</div>

<!-- Confirmation Dialog -->
<AlertDialog.Root bind:open={showConfirmDialog}>
  <AlertDialog.Content class="bg-zinc-900 border-white/10 text-white sm:max-w-[425px]">
    <AlertDialog.Header>
      <AlertDialog.Title>
        Confirm Subscription {pendingAction?.changeType || "Change"}
      </AlertDialog.Title>
      <AlertDialog.Description class="text-left space-y-3 text-zinc-400">
        <p>
          Are you sure you want to <strong class="text-white">{pendingAction?.changeType}</strong>
          your subscription to <strong class="text-white">{pendingAction?.planName}</strong>?
        </p>
        {#if pendingAction}
          <div class="p-4 rounded-xl bg-black/40 border border-white/5 mt-4">
            {#if pendingAction.isUpgrade}
              <div class="flex items-start gap-3">
                <span class="text-emerald-500 mt-0.5 text-xl">💳</span>
                <div class="text-sm">
                  <p class="font-medium text-emerald-400 mb-1">Upgrade Billing</p>
                  <p class="text-zinc-500 leading-relaxed">You will be charged a prorated amount immediately based on your current billing cycle.</p>
                </div>
              </div>
            {:else}
              <div class="flex items-start gap-3">
                <span class="text-purple-500 mt-0.5 text-xl">💰</span>
                <div class="text-sm">
                  <p class="font-medium text-purple-400 mb-1">Downgrade Credit</p>
                  <p class="text-zinc-500 leading-relaxed">You will receive a credit for your current plan that will be applied to future bills.</p>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer class="mt-6">
      <AlertDialog.Cancel class="bg-transparent border-white/10 hover:bg-white/5 hover:text-white" onclick={handleCancelUpgrade}>
        Cancel
      </AlertDialog.Cancel>
      <AlertDialog.Action class="bg-emerald-600 hover:bg-emerald-500 text-white" onclick={handleConfirmUpgrade}>
        Confirm {pendingAction?.changeType || "Change"}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
