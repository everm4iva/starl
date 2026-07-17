/**
 * ☆=========================================☆
 * Customize MIX page - the settings for how a MIX is built
 * Just a config handed to recommendation-page.js. The mix engine reads these choices
 * (from the 'mixSettings' account-state section) every time it builds a mix.
 *
 * --- What this file does? ---
 * - Describes the three sections (Artists / Genre / Scale mood) and their choices
 * - Opens from the "Customize MIX" row in the account tab
 *
 * --- Dictionary / Terms / Extra details ---
 * - There's no real BPM/genre in the data, so Genre and Scale mood are honest
 *   approximations (artist variety, radio order, track length) - said plainly in the notes
 * ☆=========================================☆
 */

(function () {
	function build() {
		if (!window.starlRecommendationPage) return;
		window.starlRecommendationPage.create({
			title: 'Customize MIX',
			buttonId: 'customize-mix-item',
			sectionName: 'mixSettings',
			defaults: {artists: 'new', genre: 'random', mood: 'consistent'},
			groups: [
				{
					key: 'artists',
					title: 'Artists',
					options: [
						{id: 'new', label: 'Prioritize new artists', note: 'Leans toward artists you rarely hear.'},
						{
							id: 'followed',
							label: 'Prioritize followed artists',
							note: 'Followed artists are more likely to appear.',
						},
						{
							id: 'followedAndQueue',
							label: 'Prioritize followed artists and artists in queue',
							note: 'Includes both followed artists and those in your queue.',
						},
						{id: 'random', label: 'Random', note: 'No preference, just random artists.'},
					],
				},
				{
					key: 'genre',
					title: 'Genre',
					note: 'No real genre data exists, so these nudge variety rather than filter hard.',
					options: [
						{
							id: 'shuffleDifferent',
							label: 'Shuffle different genres',
							note: 'Spreads artists out for variety.',
						},
						{id: 'shuffleCloser', label: 'Shuffle closer genres', note: 'Keeps it close to the seed.'},
						{id: 'sameOnly', label: 'Same genre only', note: 'Sticks near the seed artist.'},
						{id: 'random', label: 'Random', note: 'No preference, just random genres.'},
					],
				},
				{
					key: 'mood',
					title: 'Scale mood',
					note: 'Approximated from track length (no real tempo in the data).',
					options: [
						{
							id: 'upDown',
							label: 'Tempo and mood goes up and down',
							note: 'Mood and speed varies through the mix.',
						},
						{
							id: 'consistent',
							label: 'Tempo and mood stays consistent through mix',
							note: 'Maintains a consistent mood through the mix.',
						},
						{
							id: 'random',
							label: 'Tempo and mood varies randomly',
							note: 'Tempo and mood change unpredictably.',
						},
					],
				},
			],
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', build, {once: true});
	} else {
		build();
	}
})();
