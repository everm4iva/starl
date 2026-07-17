# Login modes

_- [back to server docs](readme.md)_

Your server, your "door policy" heheh. You pick one of four ways people get in, set it in `auth.mode` in [config.yaml](config.md), done. No matter which one you pick, the client ends up with the same kind of login token afterward, so everything past the door works the same :3

## ☆ The four modes

**none** - the door's just open. Anybody who connects is in, no password, nothing. Everyone shares one library (one set of playlists, history, all that). Good for "it's just me and my friends on the same wifi".

**pin** - one shared code, like `4823`. Type the pin, you're in. Still one shared library. Set the code in `auth.pin`.

**password** - same idea as pin but a full password instead of a short code. Set it in `auth.password`. Still one shared library.

**userpass** - real accounts. Each person makes a username and a password, and each person gets their own library. Set `auth.allow_signup: true` to let new people register, or `false` to lock it to whoever already exists.

```yaml
auth:
  mode: "pin"
  pin: "4823"
  secret: "..."
```

## ☆ The client name

Whichever mode you use, the client sends a little "client name" when it connects, like `Michael's SamsungS10`. It's just a label so you can tell which device is which. The server keeps it clean: letters and numbers only, up to 15 characters, anything else gets trimmed off. In `userpass` mode the server even remembers the client names that logged into each account, so you can see who connected from what.

## ☆ How the token thing works (short version)

When you log in, the server hands the client two tokens:

- an **access token** - the everyday pass, good for about a week, sent on every request
- a **refresh token** - a longer pass (about two months) whose only job is to quietly get a new access token when the old one's about to run out

Both are signed with the `secret` from your config. No cloud, no third party, the server made them and the server checks them. Log out and the server blocks that token for good, even if someone kept a copy.

## » Which one should I pick?

- just you, or you and people you trust on the same network: **none** or **pin**
- a small friend group, want a shared vibe: **password**
- you want everyone to have their own separate library: **userpass**

You can switch anytime, just change `mode` and restart. Note that switching away from `userpass` means everyone lands on the one shared library instead of their own.
