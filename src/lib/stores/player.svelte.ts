export interface NowPlayingTrack {
	id: string;
	title: string;
	artist: string;
	artistId?: string;
	coverUrl?: string;
	audioUrl: string;
	durationMs?: number;
	lyrics?: Array<{ time: number; text: string }>;
	model?: string;
	publicationId?: string;
	isInstrumental?: boolean;
	tags?: string;
}

class PlayerState {
	currentTrack = $state<NowPlayingTrack | null>(null);
	isPlaying = $state(false);
	currentTimeMs = $state(0);
	durationMs = $state(0);
	volume = $state(0.8);
	isMuted = $state(false);
	queue = $state<NowPlayingTrack[]>([]);
	queueIndex = $state(-1);
	showLyrics = $state(false);
	showNowPlaying = $state(false);
	isLiked = $state(false);
	isExpanded = $state(false);

	get hasNext() {
		return this.queueIndex < this.queue.length - 1;
	}

	get hasPrev() {
		return this.queueIndex > 0;
	}

	get progressPercent() {
		return this.durationMs > 0 ? (this.currentTimeMs / this.durationMs) * 100 : 0;
	}

	get effectiveVolume() {
		return this.isMuted ? 0 : this.volume;
	}

	get currentLyricIndex() {
		const lyrics = this.currentTrack?.lyrics;
		if (!lyrics?.length) return -1;
		const currentSec = this.currentTimeMs / 1000;
		let idx = -1;
		for (let i = 0; i < lyrics.length; i++) {
			if (lyrics[i].time <= currentSec) idx = i;
			else break;
		}
		return idx;
	}

	play(track: NowPlayingTrack) {
		this.currentTrack = track;
		this.isPlaying = true;
		this.currentTimeMs = 0;
		this.durationMs = track.durationMs ?? 0;
	}

	pause() {
		this.isPlaying = false;
	}

	resume() {
		this.isPlaying = true;
	}

	toggle() {
		if (this.isPlaying) this.pause();
		else this.resume();
	}

	setQueue(tracks: NowPlayingTrack[], startIndex = 0) {
		this.queue = tracks;
		this.queueIndex = startIndex;
		this.play(tracks[startIndex]);
	}

	addToQueue(track: NowPlayingTrack) {
		this.queue = [...this.queue, track];
		if (!this.currentTrack) {
			this.queueIndex = this.queue.length - 1;
			this.play(track);
		}
	}

	next() {
		if (this.hasNext) {
			this.queueIndex++;
			this.play(this.queue[this.queueIndex]);
		}
	}

	prev() {
		if (this.currentTimeMs > 3000) {
			this.currentTimeMs = 0;
		} else if (this.hasPrev) {
			this.queueIndex--;
			this.play(this.queue[this.queueIndex]);
		} else {
			this.currentTimeMs = 0;
		}
	}

	setVolume(vol: number) {
		this.volume = Math.max(0, Math.min(1, vol));
		this.isMuted = false;
	}

	toggleMute() {
		this.isMuted = !this.isMuted;
	}

	setTime(ms: number) {
		this.currentTimeMs = Math.max(0, Math.min(this.durationMs || Infinity, ms));
	}

	setDuration(ms: number) {
		this.durationMs = ms;
	}

	toggleLyrics() {
		this.showLyrics = !this.showLyrics;
	}

	toggleNowPlaying() {
		this.showNowPlaying = !this.showNowPlaying;
	}

	toggleLike() {
		this.isLiked = !this.isLiked;
	}

	toggleExpanded() {
		this.isExpanded = !this.isExpanded;
	}

	stop() {
		this.currentTrack = null;
		this.isPlaying = false;
		this.currentTimeMs = 0;
		this.durationMs = 0;
		this.queue = [];
		this.queueIndex = -1;
		this.showLyrics = false;
		this.showNowPlaying = false;
		this.isLiked = false;
		this.isExpanded = false;
	}
}

export const playerState = new PlayerState();
