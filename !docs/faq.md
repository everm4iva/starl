# FAQ

The one file that casually explains the whole damn thing. If you have a question, it's probably in here - and if it's not, be free to ask in the [Issues page](https://github.com/everm4iva/starl/issues) with the tag "FAQ" to get it answered and added here.

*- [Back to documentation](./index.md)*

# ☆ Answered by the code

In case you didn't read it or didn't understand it.

## » What does "Local-First" mean for Starl, and how does it protect my privacy?

For me, local-first means the app is yours, content is yours, scripts are yours, data is yours. YOU OWN IT ALL, and i have no bussiness on it.

The app is a client that talks to a server, but the server is not a middleman, it's just a tool that helps the client do its thing.

The client stores everything locally on your device, and the server just serves as a proxy for YouTube and a cache for your data.

Simple as that.

Check the privacy out, if it concerns you: [Privacy & Data Security](../privacy&data.md)

## » Can I still log in and use the app if your hosting server goes down or if I have absolutely no internet?

Yes, as long you have used the app for a while and have some songs cached, you can log in to the "offline mode" that lets you browse and play your cached content without any internet connection.

The app is designed to work even when the server is unavailable, so you can still enjoy your music without interruption.

## » How did the app manage to drop streaming and loading latency from 17 seconds down to just 2 seconds?

Server's fault.

Every image.. every audio requested is stored to disk. Next time you request something that is already downloaded in the disk, server just streams it instead of downloading and requesting to youtube again.

And also the fact that i rebuilt the server in nodejs and only left the yt-dlp and ytmusicapi in python, so the server is way more efficient and faster than before... natively.

## » Isn't the app just a modified YouTube player? How is it different from YouTube Music?

The app is a music player that uses YouTube as a source, but it is not a YouTube player. 
This project was made with user choice, security and a local-first approach in mind - so it is far from being a modified YouTube player.

It shows, the code has been written from scratch, the app has its own design, its own features, its own way of doing things, and its own way of thinking about things even going beyond simple music playback.

## » Isn't the project ilegal because of YouTube's TOS?

No.. and yes.

Currently the project is in a gray area, YouTube cannot do anything about it because it's up to the user to use it, host it, i just provide the tool but i don't tell anyone to use it or incentivize anyone to pirate anything.

And yes.. because i provide a closed-source backend for the public server, which YouTube can take down if they want to.

The project is not intended to be used for commercial purposes, and it is not intended to be used to make money.

Use at your own risk, and please don't use it for commercial purposes.

## » Why isn't it on the Play Store?

It's more of a personal issue.
I don't want to keep it complicated, app stores are a legal inferno.

And open source it?
It's more of my nature, everything is here (except the server heheh), how can it be more accessible, transparent and trustworthy than this?

Also, side note! If users complain in app stores, they complain to the store, not to me; they can make false claims and get the app banned.

But here? if you have a problem, report it, and you can see the whole process of it being fixed, if you have a question - ask it and i'll answer as quick as i can.

## » When should I use the "Reset Track Cache" feature in the track context menu?

If a track fails to play.. or doesn't play correctly due to a bad/non cached music file, you can reset the cache for that track, which will delete the music file off your device and force the app to request it again from the server -> it will trigger a re-download and hopefully fix the problem.

Also.. be aware that those issues can also be fixed with songs that cut off near of mid song, which is an incomplete file read as being fully loaded.

## » There's no download button. So how do I have songs when I'm offline?

Client automaticly "caches" (a fancy and more techy word for "downloading"), while u listening, while you are doing ur bussiness, while you are enjoying a playlist - it's doing it all on the background. So when you want to listen to a song again, it will be there, even if you don't have internet connection.

Side note: if you are offline, there is this amazing thing called [smart-queue](dev/smart-queue.md) that will skip you to the next song that is cached, so the music never stops.

## » Resolving a YouTube URL takes 1-3 seconds. Why does skipping a track feel instant anyway?

The server does the slow but magic part! Every image.. every audio requested is stored to disk. Next time you request something that is already downloaded in the disk, server just streams it instead of downloading or requesting to youtube again.

Simple as hell.

And also client caching. If u already have those assets ready on the client, it will just use them, no need to ask the server for them again.

## » Could I just point the app at YouTube myself and skip the backend?

No - by design. The client *never* talks to YouTube directly; it only ever speaks to the server at `STARL_API_BASE`.

One url, one switch, the whole app follows.

So "running your own Starl" really means running your own backend.

## » What exactly happens under the hood when the "Batch Cache" triggers?

When the Batch Cache triggers, the app pre-caches the next and previous 8 tracks, it requests to server a small stream and loads it in the IndexedDB through a hidden audio element.

This means that while the current song is playing, the app is already working on caching the next song in the background. By the time you hit skip, the next track is usually already cached and ready to play, which is why skipping feels instant.

## » iOS?

Not planned anytime soon. I don't own any apple hardware, i don't want to deal with the super tight restrictions of the apple ecosystem.

Android right now is the target, a browser/desktop client is the someday-stretch.

## » How does the search bar find the artist I want even if I accidentally misspell a word or add random spaces?

The search bar uses a really rad search algorithm that can handle misspellings and extra spaces. It looks for matches that are close to the query, so even if you type "Nirva na" as "Nyrvana" or "Nir va na", it will still find the correct artist.

## » I have a great idea for a feature! How can I submit feedback or get involved in the project?

You can submit feedback, report bugs, or suggest features in the [Issues page](https://github.com/starl/starl/issues)! I'd be happy to hear your thoughts and ideas. Anything means a lot to me and i will do my best to respond and implement it.

## » What audio quality do I actually get?

Depends on the source the server thinks it is better.

If is from a YouTube video, the server will usually get 128kbps AAC.

If is from a YouTube Music track, the server will usually get 256kbps AAC.

Both are really good quality, and the app will play them without any problem.

## » What happens to my cached songs and data if I log out or reinstall?

Your cached data in the device? Poof.. all gone. The app will start fresh, and you will have to cache your songs again.

But good news! Your account data/settings, history and all of your stuff is stored on the server, so when you log in again, it will sync your data and you will have all your stuff back. And the server also probably has your cached songs, so the streaming will be instant again.

The bad news.. is that you have to manually re-cache your songs, but the app will do it automatically while you are listening to them.

# ☆ Answered by the creator (everm4iva / da crazy)

## » What made you build your own music app instead of just... using one of the big ones?

Others work... they have their own models, principles, and ways of doing things.

I don't agree with that model, those principles, and those ways of doing things.

My friends and i wanted a music app that really works for all of us, that we can trust with our data and understand, specially with the "BARE MINIMUM" of features that other big ones have behind paywalls.

And honestly, being closer to the code, just feels like home, the feeling of what this app could be a few months from now, the potential that my friends and i can implement anything toguether without corporate models. - That's mainly why.

I'd rather own a broken tool that belongs to me and my friends, than a perfect tool that belongs to a corporation, asks me for money for basic features and uses my stuff against me.

plus, we can add funny stuff and invent new features that never existed before.

## » Where does the name "Starl" come from, and what's with the star stamped on top of every file?

I JUST LOOOVE STARZZZ heheheh :3

Everything about them sparks something inside me.

## » Why Google and Discord for login? Why those two specifically, and no plain email/password?

Easy auth. Google and Discord are popular, widely used platforms that many people already have accounts with, so they provide a good balance of accessibility and security.

Also.. using e-mail and password AS THE ONLY METHOD is boring as hell.. if i saw something like that on a website, i would just leave it - so much friction, and for what? just to have another password to forget?

## » Vanilla JS, no framework, by hand. Why is that?

Frameworks take control and trade it for a bunch of tools that i might not need, just another word for bloat - not necessarily in size, but in complexity, in the way of doing things, in the way of thinking about things.

In a simple way: **i like control**, and **i like simplicity**. I don't want to learn a framework, i want to learn the tool and not be dependent on a framework that might die or change in a way that i don't like.

## » What made "instant skip" worth that much complexity to you?

Empathy.

## » You made your own Cordova plugins (background, music-controls, statusbar, splash, intent) instead of using community ones. What pushed you to write them yourself?

Again.. it's about control and simplicity.

The app has a really specific way of doing things. I want the system to work exactly to work toguether with it.

Even if some plugins have all the features i need + more, they might be bloating or complicating maintenance. I want to know my own code and i want it to have personality through.

## » Any telemetry, tracking, or analytics in the app?

No.

But yes for the analytics. Needed for the recommendations system, but if anything, you can easily erase all you data and disable it. It's your choice.

## » How much storage does the app use on my device, and how do you manage it?

You can set a limit in GB or use percentage relative to your device's free space. The app will manage the cache automatically, removing older items when the limit is reached, or compressing images to save space. Music files cannot be compressed client-side, so they will be removed first if needed.

More details in the [Storage System](dev/storage-system.md) page.


## » Looking back: what's the part you're proudest of, and the part you'd rip out and rewrite if you had a free weekend?

Everything... and everything.

I am loudly proud of this whole project. Every line of code and every word about it makes me feel whole.

At the same time... i'd toss it down, step on it and look at the sky before re-creating the whole thing from 0.

## » Is this a solo project? Roughly how long has it been going?

Currently, i consider it a solo project.

The concept idea of making a whole music app, platform, whatever.. started like.. back in 2023, i discovered my first self-hosted open-source music app, and i wanted make it my own. Shot to the moon, because i was afraid and didn't know what i was doing.

Tried to do once more in 2025, just testing the waters, i got really good feedback and loved the journey... and i destroyed it all for the sake of learning experience and exploring other stuff.

This project? um.. just a month (at the time i'm writing this down), was like around the end of may 2026, but it feels like i've been doing it for a couple hours.

## » Are you planning to make payments possible? Monetize anything?

No. Ever. Voluntaily not. Everm4iva denies. Really serious about this.

aka: NEVER

## » Why did you choose Fredoka as the default font instead of a traditional corporate sans-serif?

I don't know. I just got to [google fonts](https://fonts.google.com/) (nice website btw) and scrolled down until i found one that felt right.

I didn't have the full picture yet, but i knew i wanted something you can see everyday and not get tired of - not too plain or too rounded.


## » Who pays for hosting if it's free forever?

I mean.. the public server, i host, my personal server, it's free for everyone, i don't pay for it, use my own bare resources - and i don't plan in paying to host it on a cloud service or anything like that, as i said: Control.

And this time.. also privacy, i can't trust a cloud service with my users data, and i don't want to be responsible for that.

## » How do you handle privacy and data security for users?

Instead of saying something like "i don't store your data", i say "i don't have your data to store" or "I take privacy and data security very seriously" i will say brutally:

Fuck it. i have your data, but i don't care about it, i only care to make sure it's safe from me and anyone else in any way i can.

also.. the stored data is EXACTLY this:
- uuid (randomly generated on first login, used to identify your account and your data)
- email
- account name
- profile picture
- cached content (songs, playlists, albums, artists, settings, history.. basically everything you do in the app, except for your login credentials, which are handled by google and discord)

and nothing more.
- i don't have tokens
- i don't have ip's,
- i don't have logs (only internal errors),
- i can't access your account (neither the auth methods account),
i can't even access your data because it's encrypted and stored in a way that only you can access it.

This is how i want to be respected, so this is the way i am respecting you.

## » What's the hardest moment - the one that almost made you quit?

Suprisingly, none.
I am too blinded by potential too see the full picture, and i am too stubborn to quit.

## » What does "finished" look like for Starl?

By what i know of myself? Finished is when i can say "i am happy", and i'm happy as hell.. so it's a bit of a paradox.

Also, thinking about the people who will use it everyday.. i want to make this stable, self hosted, the most open, well documented and easy to use music app i possibly can.

So one day, when i actually quit, i want the users to be able to keep using it without me, and i want them to be able to do whatever they want with it, to be able to understand it and change it if they want.