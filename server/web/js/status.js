/*
 * ☆ status page
 * -> asks the server how its doing (/status.json) and paints the little dashboard
 * -> refreshes every few seconds so uptime + memory stay live, nothing fancy going on here
 */

// all the spots we drop values into, grabbed once up front so we dont keep re-finding them
const el = {
	pic: document.getElementById('serverPic'),
	name: document.getElementById('serverName'),
	desc: document.getElementById('serverDesc'),
	version: document.getElementById('statVersion'),
	uptime: document.getElementById('statUptime'),
	memory: document.getElementById('statMemory'),
	storage: document.getElementById('statStorage'),
	api: document.getElementById('statApi'),
	page: document.getElementById('statPage'),
	connectBox: document.getElementById('connectBox'),
	connectList: document.getElementById('connectList'),
	auth: document.getElementById('statAuth'),
	signup: document.getElementById('statSignup'),
};

// copy an ip:port to the clipboard when its chip gets clicked, tiny "copied!" flash after
function copyChip(chip, text) {
	chip.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(text);
			const original = chip.textContent;
			chip.textContent = 'copied!';
			setTimeout(() => { chip.textContent = original; }, 900);
		} catch (err) { /* clipboard not available, no big deal */ }
	});
}

// paint one chip per address, each one an "ip:port" ready to paste into the app - lan
// addresses (the ones a phone on the same wifi can actually reach) come first and plain,
// anything else (tailscale, radmin, other vpns) gets the adapter name so its obvious
// its a different network, not something to guess-copy by mistake
function renderAddresses(addresses, apiPort) {
	el.connectList.innerHTML = '';
	if (!addresses || !addresses.length) {
		el.connectBox.hidden = true;
		return;
	}
	el.connectBox.hidden = false;
	for (const addr of addresses) {
		const text = `${addr.address}:${apiPort}`;
		const chip = document.createElement('button');
		chip.type = 'button';
		chip.className = addr.lan ? 'connect-chip' : 'connect-chip connect-chip--other';
		chip.textContent = addr.lan ? text : `${text} (${addr.iface})`;
		copyChip(chip, text);
		el.connectList.appendChild(chip);
	}
}

// seconds -> a friendly "2h 5m 12s" kinda string, just easier to read at a glance
function prettyUptime(total) {
	const s = total % 60;
	const m = Math.floor(total / 60) % 60;
	const h = Math.floor(total / 3600);
	const bits = [];
	if (h) bits.push(h + 'h');
	if (m || h) bits.push(m + 'm');
	bits.push(s + 's');
	return bits.join(' ');
}

// pull the latest status and pour it into the page
async function refresh() {
	try {
		const res = await fetch('/status.json');
		const s = await res.json();

		el.name.textContent = s.name;
		el.desc.textContent = s.description || '';
		el.version.textContent = 'v' + s.version;
		el.uptime.textContent = prettyUptime(s.uptime_seconds);
		el.memory.textContent = s.memory.used_mb + ' / ' + s.memory.max_mb + ' mb';
		el.storage.textContent = s.storage.max_gb + ' gb';
		el.api.textContent = s.ports.api;
		el.page.textContent = s.ports.page;
		renderAddresses(s.addresses, s.ports.api);

		const mode = (s.auth && s.auth.mode) || 'unknown';
		el.auth.textContent = mode;
		el.signup.textContent = mode === 'userpass' ? (s.auth.allow_signup ? 'open' : 'closed') : 'n/a';

		document.title = s.name;

		// the picture rides in as a css variable, so the styling stays over in the css where it belongs
		const pic = s.picture ? `url('${s.picture}')` : 'none';
	} catch (err) {
		el.name.textContent = 'cant reach the server';
	}
}

refresh();
setInterval(refresh, 4000);
