<script lang="ts">
	let { music, data } = $props();

	let activeTab = $state("easy");
	let studioMode = $state("vocal-remove");
	let studioAudioUrl = $state("");
	let studioPrompt = $state("");
	let customPrompt = $state("");
	let easyPrompt = $state("");
	let customInstrumental = $state(false);
	let customStyle = $state("");
	let customTitle = $state("");

	function generate() {
		let finalPrompt = "";
		if (activeTab === "easy") {
			finalPrompt = easyPrompt;
			music.forceInstrumental = false;
		} else {
			finalPrompt = `[Title: ${customTitle}]\n[Style: ${customStyle}]\n${customPrompt}`;
			music.forceInstrumental = customInstrumental;
		}
		
		music.inputPrompt = finalPrompt;
		music.handleGenerate();
	}

	function runStudio() {
		generate();
	}
	
	function optimizeLyrics() {}
	function generateLyrics() {}
	function enhanceStyle() {}
</script>

<!-- ── TOP PANEL: form ─────────────────────────────────────── -->
<div class="flex flex-col shrink-0 w-full px-5 pt-8 pb-4 items-center">
	<h1
		class="text-3xl font-bold text-center mb-6"
		style="color:var(--ga-text);"
	>
		What song to create?
	</h1>

	<!-- API warning -->
	{#if !data.sunoConfigured}
		<div
			class="mb-4 rounded-xl px-4 py-3 flex items-center gap-2 w-full max-w-3xl"
			style="background:rgba(253,54,88,0.08);border:1px solid rgba(253,54,88,0.3);"
		>
			<span>⚠️</span>
			<p class="text-xs" style="color:var(--ga-pink);">
				No API key configured. Go to <a
					href="/admin"
					class="underline"
					style="color:var(--ga-gold);">Admin → Settings</a
				>
			</p>
		</div>
	{/if}

	<div
		class="rounded-3xl p-4 flex flex-col w-full max-w-3xl transition-all"
		style="background:#1c1c1c; border:1px solid #333;"
	>
		{#if activeTab === "studio"}
			<!-- Studio Inputs -->
			<div class="flex gap-2 mb-3">
				<button
					onclick={() => (studioMode = "vocal-remove")}
					class="flex-1 py-1.5 rounded-lg text-xs font-semibold"
					style={studioMode === "vocal-remove"
						? "background:var(--ga-gold);color:#000;"
						: "background:#2a2a2a;color:#888;"}>Vocal Remove</button
				>
				<button
					onclick={() => (studioMode = "lyrics")}
					class="flex-1 py-1.5 rounded-lg text-xs font-semibold"
					style={studioMode === "lyrics"
						? "background:var(--ga-gold);color:#000;"
						: "background:#2a2a2a;color:#888;"}
					>Lyrics Extract</button
				>
			</div>
			{#if studioMode !== "lyrics"}
				<input
					bind:value={studioAudioUrl}
					type="url"
					placeholder="Audio URL..."
					class="w-full text-base mb-2 px-3 py-2 rounded-xl focus:outline-none"
					style="background:#111; color:var(--ga-text);"
				/>
			{/if}
			<textarea
				bind:value={studioPrompt}
				placeholder="Additional instructions..."
				rows="2"
				class="w-full text-base resize-none focus:outline-none bg-transparent"
				style="color:var(--ga-text);"
			></textarea>
		{:else if activeTab === "easy"}
			<textarea
				bind:value={easyPrompt}
				placeholder="Upbeat electronic track for a workout"
				rows="3"
				class="w-full text-base resize-none focus:outline-none bg-transparent"
				style="color:var(--ga-text);"
			></textarea>
		{:else}
			<textarea
				bind:value={customPrompt}
				placeholder="Upbeat electronic track for a workout"
				rows="3"
				class="w-full text-base resize-none focus:outline-none bg-transparent"
				style="color:var(--ga-text);"
			></textarea>
		{/if}

		<div class="flex items-center justify-between mt-4">
			<!-- Left controls -->
			<div class="flex flex-wrap items-center gap-2">
				<!-- Attach file -->
				<button
					class="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
					style="background:#2a2a2a; color:#888;"
					title="Attach file"
				>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><path
							d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
						/></svg
					>
				</button>

				<!-- Pro controls (toggles custom mode) -->
				<button
					onclick={() =>
						(activeTab = activeTab === "easy" ? "custom" : "easy")}
					class="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
					style="background:#2a2a2a; color:{activeTab === 'custom'
						? '#fff'
						: '#888'};"
					title="Pro controls"
				>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><line x1="4" y1="21" x2="4" y2="14" /><line
							x1="4"
							y1="10"
							x2="4"
							y2="3"
						/><line x1="12" y1="21" x2="12" y2="12" /><line
							x1="12"
							y1="8"
							x2="12"
							y2="3"
						/><line x1="20" y1="21" x2="20" y2="16" /><line
							x1="20"
							y1="12"
							x2="20"
							y2="3"
						/><line x1="1" y1="14" x2="7" y2="14" /><line
							x1="9"
							y1="8"
							x2="15"
							y2="8"
						/><line x1="17" y1="16" x2="23" y2="16" /></svg
					>
				</button>

				<!-- Instrumental Toggle -->
				<button
					onclick={() => {
						customInstrumental = !customInstrumental;
						activeTab = "custom";
					}}
					class="flex items-center gap-1.5 px-4 py-2.5 rounded-full transition-colors font-medium text-sm border"
					style="background:#1c1c1c; border-color:{customInstrumental
						? '#444'
						: '#222'}; color:{customInstrumental
						? '#fff'
						: '#888'};"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"><circle cx="12" cy="12" r="10" /></svg
					>
					Instrumental
				</button>

				<!-- Lyrics Toggle -->
				<button
					onclick={() => {
						customInstrumental = false;
						activeTab = "custom";
					}}
					class="flex items-center gap-1.5 px-4 py-2.5 rounded-full transition-colors font-medium text-sm border"
					style="background:#1c1c1c; border-color:{!customInstrumental &&
					activeTab === 'custom'
						? '#444'
						: '#222'}; color:{!customInstrumental &&
					activeTab === 'custom'
						? '#fff'
						: '#888'};"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><line x1="12" y1="5" x2="12" y2="19" /><line
							x1="5"
							y1="12"
							x2="19"
							y2="12"
						/></svg
					>
					Lyrics
				</button>

				<!-- Studio Mode (Optional toggle) -->
				<button
					onclick={() =>
						(activeTab =
							activeTab === "studio" ? "easy" : "studio")}
					class="flex items-center gap-1.5 px-4 py-2.5 rounded-full transition-colors font-medium text-sm border hidden md:flex"
					style="background:#1c1c1c; border-color:{activeTab ===
					'studio'
						? '#444'
						: '#222'}; color:{activeTab === 'studio'
						? '#fff'
						: '#888'};"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><path
							d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
						/></svg
					>
					Studio
				</button>
			</div>

			<!-- Right controls -->
			<div class="flex items-center gap-4 shrink-0">
				<!-- Tools dropdown (currently purely aesthetic match to screenshot) -->
				<button
					class="flex items-center gap-1 text-sm font-semibold text-white cursor-default"
				>
					Tools
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><polyline points="6 9 12 15 18 9" /></svg
					>
				</button>

				<!-- Submit -->
				{#if activeTab === "studio"}
					<button
						onclick={runStudio}
						disabled={music.isGenerating ||
							(studioMode !== "lyrics" &&
								!studioAudioUrl.trim()) ||
							(studioMode === "lyrics" && !studioPrompt.trim())}
						class="w-12 h-12 rounded-full flex items-center justify-center transition-colors disabled:opacity-50"
						style="background:#3a3a3a; color:#fff;"
					>
						{#if music.isGenerating}
							<span
								class="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"
							></span>
						{:else}
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								><line
									x1="5"
									y1="12"
									x2="19"
									y2="12"
								/><polyline points="12 5 19 12 12 19" /></svg
							>
						{/if}
					</button>
				{:else}
					<button
						onclick={generate}
						disabled={music.isGenerating ||
							(activeTab === "easy"
								? !easyPrompt.trim()
								: !customPrompt.trim() && !customInstrumental)}
						class="w-12 h-12 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 hover:bg-[#4a4a4a]"
						style="background:#3a3a3a; color:#fff;"
					>
						{#if music.isGenerating}
							<span
								class="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"
							></span>
						{:else}
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								><line
									x1="5"
									y1="12"
									x2="19"
									y2="12"
								/><polyline points="12 5 19 12 12 19" /></svg
							>
						{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>

	<!-- Pro Controls Expansion -->
	{#if activeTab === "custom" && !customInstrumental}
		<div
			class="mt-4 p-4 rounded-3xl w-full max-w-3xl"
			style="background:#1c1c1c; border:1px solid #333;"
		>
			<div class="flex justify-between items-center mb-2">
				<span
					class="text-sm font-semibold"
					style="color:var(--ga-text);">Lyrics</span
				>
				<div class="flex gap-2">
					<button
						onclick={optimizeLyrics}
						class="text-xs text-blue-400 hover:underline"
						>Optimize</button
					>
					<button
						onclick={generateLyrics}
						class="text-xs text-blue-400 hover:underline"
						>Generate</button
					>
				</div>
			</div>
			<textarea
				bind:value={customPrompt}
				placeholder="Enter custom lyrics here..."
				rows="6"
				class="w-full text-sm resize-none focus:outline-none bg-transparent mb-4"
				style="color:var(--ga-text);"
			></textarea>
		</div>
	{/if}

	{#if activeTab === "custom"}
		<div
			class="mt-4 p-4 rounded-3xl w-full max-w-3xl"
			style="background:#1c1c1c; border:1px solid #333;"
		>
			<div class="flex justify-between items-center mb-2">
				<span
					class="text-sm font-semibold"
					style="color:var(--ga-text);">Style & Meta</span
				>
				<button
					onclick={enhanceStyle}
					class="text-xs text-blue-400 hover:underline"
					>Enhance</button
				>
			</div>
			<textarea
				bind:value={customStyle}
				placeholder="Style (e.g. Acoustic pop, fast tempo)"
				rows="2"
				class="w-full text-sm resize-none focus:outline-none bg-transparent mb-3"
				style="color:var(--ga-text);"
			></textarea>
			<input
				bind:value={customTitle}
				type="text"
				placeholder="Song Title (optional)"
				class="w-full text-sm px-3 py-2 rounded-xl focus:outline-none bg-black/40"
				style="color:var(--ga-text);"
			/>
		</div>
	{/if}
</div>
