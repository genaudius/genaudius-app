<script lang="ts">
  import { getContext } from "svelte";
  import { mode } from "mode-watcher";
  import type { SettingsState } from "$lib/stores/settings.svelte.js";

  let {
    class: className = "",
    alt = "GenAudius",
    fallbackSrc = "",
  }: {
    class?: string;
    alt?: string;
    fallbackSrc?: string;
  } = $props();

  const settingsState = getContext<SettingsState>("settings");

  const logoWidth = $derived(() => settingsState?.logoWidth ?? "170");
  const logoHeight = $derived(() => settingsState?.logoHeight ?? "34");

  const logoStyles = $derived(
    () => `width: ${logoWidth()}px; height: ${logoHeight()}px;`
  );
  const logoClasses = $derived(() =>
    `object-contain ${className}`.trim()
  );

  const customLogoUrl = $derived(() => {
    const currentMode = mode.current;
    if (currentMode === "dark") {
      return settingsState?.logoUrlDark || null;
    } else {
      return settingsState?.logoUrlLight || null;
    }
  });

  let imageError = $state(false);
  let isLoading = $state(true);
  let lastLoadedUrl = $state<string>("");

  $effect(() => {
    const url = customLogoUrl();
    if (url && url !== lastLoadedUrl) {
      imageError = false;
      isLoading = true;
    } else if (url === lastLoadedUrl && lastLoadedUrl !== "") {
      isLoading = false;
    }
  });

  function handleImageLoad() {
    isLoading = false;
    lastLoadedUrl = customLogoUrl() ?? "";
  }

  function handleImageError() {
    imageError = true;
    isLoading = false;
  }

  const isDark = $derived(() => mode.current === "dark");
</script>

{#if customLogoUrl() && !imageError}
  <!-- Custom logo uploaded via admin -->
  <div class="relative">
    <img
      src={customLogoUrl()!}
      {alt}
      style={logoStyles()}
      class={`${logoClasses()} ${isLoading ? "opacity-0" : "opacity-100"} transition-opacity duration-200`}
      onload={handleImageLoad}
      onerror={handleImageError}
    />
    {#if isLoading}
      <div
        style={logoStyles()}
        class={`absolute inset-0 bg-muted animate-pulse ${logoClasses()}`}
        aria-label="Loading logo"
      >
        <div class="w-full h-full bg-muted-foreground/20 rounded-lg"></div>
      </div>
    {/if}
  </div>
{:else}
  <!-- Default GenAudius inline SVG logo -->
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 200 40"
    width="170"
    height="34"
    aria-label={alt}
    class={className}
  >
    <!-- Waveform icon -->
    <g
      stroke={isDark() ? "#a78bfa" : "#7c3aed"}
      stroke-width="2.8"
      stroke-linecap="round"
      fill="none"
    >
      <line x1="4"  y1="18" x2="4"  y2="22" />
      <line x1="10" y1="13" x2="10" y2="27" />
      <line x1="16" y1="7"  x2="16" y2="33" />
      <line x1="22" y1="11" x2="22" y2="29" />
      <line x1="28" y1="4"  x2="28" y2="36" />
      <line x1="34" y1="11" x2="34" y2="29" />
      <line x1="40" y1="7"  x2="40" y2="33" />
      <line x1="46" y1="13" x2="46" y2="27" />
      <line x1="52" y1="18" x2="52" y2="22" />
    </g>
    <!-- GenAudius text -->
    <text
      x="62"
      y="28"
      font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"
      font-size="21"
      font-weight="700"
      letter-spacing="-0.3"
      fill={isDark() ? "#f5f5f5" : "#111111"}
    >GenAudius</text>
  </svg>
{/if}
