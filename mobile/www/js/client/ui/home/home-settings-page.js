/**
 * ☆=========================================☆
 * Customize Home page - the settings for what shows up on the home tab
 * A config handed to recommendation-page.js. The home section files read these choices
 * (from the 'homeSettings' account-state section) to decide what to render.
 *
 * --- What this file does? ---
 * - Describes the four sections (General / New releases / Pick up albums / Pick up artists)
 * - Opens from the "Customize Home page" row in the account tab
 * - When a choice changes, fires 'starl-home-settings-changed' so the home rows refresh
 *
 * --- Dictionary / Terms / Extra details ---
 * - "Pick up" = things you've been listening to a lot lately, resurfaced on home
 * ☆=========================================☆
 */

(function () {
	function build() {
		if (!window.starlRecommendationPage) return;
		window.starlRecommendationPage.create({
			title: 'Customize Home page',
			buttonId: 'customize-home-item',
			sectionName: 'homeSettings',
			defaults: {general: 'lastTrack', newReleases: 'followed', pickAlbums: 'yes', pickArtists: 'yes'},
			onChange() {
				try {
					window.dispatchEvent(new CustomEvent('starl-home-settings-changed'));
				} catch (error) {}
			},
			groups: [
				{
					key: 'general',
					title: 'General',
					options: [
						{id: 'none', label: 'No recommendations'},
						{id: 'lastTrack', label: 'Recommend based on last track'},
						{id: 'lastArtist', label: 'Recommend based on last artist'},
					],
				},
				{
					key: 'newReleases',
					title: 'New releases',
					options: [
						{id: 'none', label: "Don't show new releases from followed artists"},
						{id: 'followed', label: 'Show new releases from followed artists'},
						{id: 'all', label: 'Show new releases and new albums'},
					],
				},
				{
					key: 'pickAlbums',
					title: 'Pick up albums',
					note: 'Albums you have been listening to a lot show up on home?',
					options: [
						{id: 'yes', label: 'Yes'},
						{id: 'no', label: 'No'},
					],
				},
				{
					key: 'pickArtists',
					title: 'Pick up artists',
					note: 'Artists you have been listening to a lot show up on home?',
					options: [
						{id: 'yes', label: 'Yes'},
						{id: 'no', label: 'No'},
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
