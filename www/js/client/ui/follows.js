/**
 * ☆=========================================☆
 * Follows - followed artists and albums manager
 * Stores followed artists and albums in account state under the 'follows' section.
 *
 * --- What this file does? ---
 * - followArtist() / unfollowArtist() / isArtistFollowed(): manage artist follows
 * - followAlbum() / unfollowAlbum() / isAlbumFollowed(): manage album follows
 * - Fires 'starl-follows-updated' on every change
 *
 * --- Dictionary / Terms / Extra details ---
 * - Data shape: follows = { artists: { [id]: {...} }, albums: { [id]: {...} } }
 * ☆=========================================☆
 */

(function () {
	const SECTION_KEY = 'follows';
	const UPDATE_EVENT = 'starl-follows-updated';

	function getAccountState() {
		return window.starlAccountState || null;
	}

	function emptyFollows() {
		return {artists: {}, albums: {}};
	}

	function readFollows() {
		const state = getAccountState();
		if (state && typeof state.getSection === 'function') {
			const section = state.getSection(SECTION_KEY, null);
			if (section && typeof section === 'object') {
				return {
					artists: (section.artists && typeof section.artists === 'object') ? section.artists : {},
					albums: (section.albums && typeof section.albums === 'object') ? section.albums : {},
				};
			}
		}
		try {
			const raw = localStorage.getItem('starl_follows');
			if (raw) return JSON.parse(raw);
		} catch (e) {}
		return emptyFollows();
	}

	function writeFollows(next) {
		const state = getAccountState();
		if (state && typeof state.setSection === 'function') {
			if (typeof state.setState === 'function') {
				const current = (typeof state.getState === 'function') ? (state.getState() || {}) : {};
				state.setState({...current, [SECTION_KEY]: next});
			}
			state.setSection(SECTION_KEY, next);
		}
		try { localStorage.setItem('starl_follows', JSON.stringify(next)); } catch (e) {}
		try { window.dispatchEvent(new CustomEvent(UPDATE_EVENT, {detail: {follows: next}})); } catch (e) {}
	}

	function isFollowingArtist(id) {
		if (!id) return false;
		return Boolean(readFollows().artists[String(id)]);
	}

	function isFollowingAlbum(id) {
		if (!id) return false;
		return Boolean(readFollows().albums[String(id)]);
	}

	function followArtist(id, info) {
		if (!id) return;
		const follows = readFollows();
		follows.artists[String(id)] = {id, name: info && info.name || '', imageUrl: info && info.imageUrl || '', followedAt: Date.now()};
		writeFollows(follows);
	}

	function unfollowArtist(id) {
		if (!id) return;
		const follows = readFollows();
		delete follows.artists[String(id)];
		writeFollows(follows);
	}

	function toggleFollowArtist(id, info) {
		if (isFollowingArtist(id)) unfollowArtist(id);
		else followArtist(id, info);
		return isFollowingArtist(id);
	}

	function followAlbum(id, info) {
		if (!id) return;
		const follows = readFollows();
		follows.albums[String(id)] = {
			id,
			browseId: (info && info.browseId) || (info && info.id) || id,
			name: (info && info.name) || (info && info.title) || '',
			artist: (info && info.artist) || '',
			imageUrl: (info && info.imageUrl) || (info && info.thumbnail) || '',
			followedAt: Date.now(),
		};
		writeFollows(follows);
	}

	function unfollowAlbum(id) {
		if (!id) return;
		const follows = readFollows();
		delete follows.albums[String(id)];
		writeFollows(follows);
	}

	function toggleFollowAlbum(id, info) {
		if (isFollowingAlbum(id)) unfollowAlbum(id);
		else followAlbum(id, info);
		return isFollowingAlbum(id);
	}

	function getFollowedArtists() {
		return Object.values(readFollows().artists);
	}

	function getFollowedAlbums() {
		return Object.values(readFollows().albums);
	}

	window.starlFollows = {
		isFollowingArtist,
		isFollowingAlbum,
		followArtist,
		unfollowArtist,
		toggleFollowArtist,
		followAlbum,
		unfollowAlbum,
		toggleFollowAlbum,
		getFollowedArtists,
		getFollowedAlbums,
	};

	window.addEventListener('starl-account-state-updated', () => {
		try { window.dispatchEvent(new CustomEvent(UPDATE_EVENT, {detail: {follows: readFollows()}})); } catch (e) {}
	});
})();
