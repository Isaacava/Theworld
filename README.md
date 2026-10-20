# 🌍 THE WORLD

### The world is more than places. It's the people, conversations, and experiences that happen there.

**THE WORLD** is a location-based social platform built around a simple idea: every real place can have a digital community.

Users explore an interactive globe, zoom into real countries, cities, neighbourhoods and streets, discover conversations connected to those places, and contribute to local communities when they are physically present.

**Explore anywhere. Participate where you are. Discover the world through the people connected to its places.**

> **Project status:** Early prototype / product foundation. This repository will evolve from the first working map-to-community experience. Features described as planned are not yet implemented unless the code explicitly confirms otherwise.

---

## Contents

- [Product vision](#product-vision)
- [What makes THE WORLD different](#what-makes-the-world-different)
- [How it works](#how-it-works)
- [Core experiences](#core-experiences)
- [Presence and privacy principles](#presence-and-privacy-principles)
- [Revenue model](#revenue-model)
- [Initial technology plan](#initial-technology-plan)
- [Development and cost strategy](#development-and-cost-strategy)
- [Roadmap](#roadmap)
- [MVP acceptance criteria](#mvp-acceptance-criteria)
- [Product principles](#product-principles)

---

## Product vision

Most maps help people find places. Most social networks organize conversations around accounts, groups, or interests.

THE WORLD aims to connect the two: **a social network organized around the real geography of Earth**.

A user should be able to rotate the globe, select a country, zoom into a city, choose a neighbourhood or street, and open the community attached to that real location. They can read public content from anywhere. To add a new contribution to a location's live local feed, they must pass a location-presence check for that community.

The map is the way into the experience. The conversations, discoveries, local knowledge, and people make it valuable.

### Product goals

1. Make exploring the world visually engaging and straightforward.
2. Let users discover genuine conversations associated with real places.
3. Encourage useful participation without rewarding spam or compulsive posting.
4. Preserve helpful place-related knowledge after live conversations become less current.
5. Give local businesses and event organizers responsible ways to reach relevant audiences.
6. Protect users' privacy and safety in a product that uses location.

---

## What makes THE WORLD different

THE WORLD is designed around three connected concepts:

- **People** have profiles and a record of their contributions.
- **Places** are real geographical locations, such as countries, cities, neighbourhoods, streets, landmarks, venues, and businesses.
- **Conversations** are attached to an appropriate place or community, so people can discover them through the map or search.

A place can have a live feed, longer-lasting useful discussions, public questions, and a business or event page where applicable.

The product is not intended to replace turn-by-turn navigation, nor is it meant to expose a live map of individual users.

### The defining rule

**Explore anywhere. Contribute to LIVE HERE when your presence is verified.**

People can browse public communities remotely. A separate place-question feature lets someone ask about a place they plan to visit without pretending to be there. Creating or replying to a post in a location's LIVE HERE feed requires a successful presence check.

Presence verification is a practical barrier to false local participation, not a guarantee that every device reading is impossible to spoof. The product must be honest about what was checked and must never publicly expose a contributor's precise coordinates.

---

## How it works

### 1. Explore the real Earth

The homepage will feature an interactive globe. Users can rotate and zoom it, move between countries and cities, and continue into mapped neighbourhoods, streets, and points of interest.

Users should also be able to search directly for a place rather than needing to navigate the globe each time.

### 2. Open a real location

Selecting a supported location opens its THE WORLD page. The underlying map provider supplies geographical map data; THE WORLD stores its own community records and social content associated with that location.

Where a street boundary or place cannot be identified reliably, the app should offer a broader neighbourhood or area instead of inventing inaccurate precision.

### 3. Discover what people have shared

A location page can show recent conversations, questions, discoveries, relevant public event discussions, and longer-lasting place knowledge. Content should be timestamped so old observations are not mistaken for current conditions.

### 4. Participate locally

When a user tries to contribute to LIVE HERE, the app requests location permission when needed and performs a server-validated eligibility check against the relevant geographical area. Ambiguous or inaccurate readings should fail safely or offer a broader community.

### 5. Build lasting community knowledge

Useful discussions can be preserved in PLACE MEMORY, subject to moderation and author controls. This allows the platform to remain useful after a live post is no longer timely.

---

## Core experiences

### 🌐 EXPLORE

- Interactive 3D globe.
- Progressive navigation: Earth → country → city → neighbourhood → street or place.
- Direct search for mapped places.
- Shareable links to place and community pages.
- Public browsing without requiring location permission.

### 📍 LIVE HERE

The live, place-based conversation feed.

Planned post formats include:
- Short text posts and observations.
- Questions and answers.
- Polls.
- Photos and, later, supported short video or voice formats.
- Replies and reactions.
- Relevant local discoveries and current observations.

New posts and replies require verified presence in the appropriate community. Content should become less prominent as it ages; current reports should not be treated as permanently valid facts.

### 🧭 PLACE MEMORY

A searchable collection of useful, longer-lasting place-related discussions and community knowledge.

Examples include helpful recommendations, answers to recurring questions, and discussions that remain relevant after the immediate moment. Place Memory must show the age and source of information, distinguish user-submitted claims from verified information, and provide reporting and correction controls.

### 💬 ASK LOCALS

A remote-friendly way to ask a question about a place. People can ask before travelling, moving, attending an event, or visiting a business. Eligible local contributors can answer. These questions are distinct from LIVE HERE, which represents presence-verified local participation.

### ⚡ WORLD PULSE

A planned discovery layer for noteworthy community activity, unanswered questions, recent discussions, and public event conversations. Activity indicators should reflect genuine recent activity and should never expose individual users' live positions.

### 👤 WORLD IDENTITY

User profiles and contribution-based recognition. Possible labels include Helpful Contributor, Community Guide, and Place Explorer. Recognition should favour useful, well-received contributions over raw post volume. Visiting a place must not imply that someone lives there, and reputation must not mean that every statement is automatically true.

---

## Presence and privacy principles

Location is central to the product, so privacy and safety must be part of the architecture from the beginning.

- **No public live-user map.** Map activity indicators represent communities and aggregated activity, not individual positions.
- **No precise coordinates on public posts.** Public content identifies the relevant community, not the author's exact location.
- **Check presence only when needed.** Do not continuously track people just to let them post.
- **Use the least data necessary.** Minimize collection and retention of raw location information and restrict access to verification data.
- **Be transparent.** Show that presence was verified at the time of contribution; do not imply that the person still remains there or lives there.
- **Handle GPS uncertainty.** Streets can be close together and location readings can be inaccurate. Where the target street cannot be identified reliably, use a broader area rather than attaching a contribution to the wrong place.
- **Treat anti-spoofing as risk reduction, not perfect proof.** Combine server-side checks with rate limits, abuse detection, reporting, and moderation.
- **Provide user controls.** Support blocking, reporting, content deletion, privacy settings, and notification preferences.
- **Protect residential areas.** Some locations may be better served by broader neighbourhood feeds instead of highly granular street communities.

All location handling must be reviewed against applicable privacy laws and platform requirements before public launch.

---

## Revenue model

The core social experience should remain free. Revenue should come from useful business services and clearly labelled commercial placements, without allowing payment to buy trust or suppress legitimate criticism.

### 1. Promoted places

Businesses can pay for clearly labelled sponsored visibility when users explore relevant areas or search for related places. Organic listings and community recommendations must remain distinguishable from paid placements.

### 2. Business subscriptions

A free basic business page can show approved public details. Paid plans may offer enhanced pages, multiple-location management, offer tools, analytics, and event-management features.

### 3. Sponsored community activities

Businesses may sponsor appropriate polls, challenges, or activities. Sponsorship must be disclosed, and promotional content must not overwhelm ordinary community discussions.

### 4. Events and ticketing

Event organizers may promote eligible public events. Later, approved ticketing integrations may generate a negotiated commission on qualifying transactions.

### 5. Deals and referrals

Participating businesses may provide trackable offers or referral links. THE WORLD can earn an agreed commission where a qualifying transaction occurs. Paid relationships must be clearly disclosed.

### 6. Business analytics

Businesses may pay for aggregated reporting on page visits, menu opens, offer interactions, and other measurable campaign outcomes. A click must not be reported as a confirmed visit or purchase unless that outcome is actually measured. Selling users' precise location histories is not part of the model.

### Revenue rollout

Commercial features should be introduced only after there are active communities and the product can demonstrate real value. The prototype is for testing the product experience, not collecting payments.

---

## Initial technology plan

The stack is chosen to support a mobile-friendly web prototype with minimal initial infrastructure spending. Components should remain replaceable so that a provider change does not require rewriting the social platform.

| Component | Initial choice | Purpose |
|---|---|---|
| Web application | Next.js + TypeScript | Application interface and routes |
| Interactive map | MapLibre GL JS | Globe and map rendering |
| Prototype map tiles | OpenFreeMap | Map styles and geographical display |
| Prototype place search | OpenStreetMap Nominatim, used under its public usage policy | Search for locations during development |
| Database | MongoDB Atlas | Users, place/community records, posts, and business data |
| Hosting | Vercel Hobby for non-commercial development/testing | Web deployment and suitable API routes |
| Media | Object storage when media uploads are introduced | Keep large files out of database documents |

### Provider limitations

- OpenFreeMap is a convenient free prototype map source, but the public service has no availability guarantee. Keep map-style URLs and provider-specific code configurable so another compatible provider can be adopted later.
- Nominatim's public service is not an unlimited production geocoder. Follow its usage policy, rate limit requests, cache appropriately, identify the application as required, and replace it with an appropriate provider or self-hosted solution if demand grows.
- MongoDB Atlas free-cluster resources and Vercel Hobby usage are limited. Stay within their current terms and usage caps.
- Vercel Hobby is for personal, non-commercial use. Use it for the non-commercial prototype only; move to a plan that permits commercial use before operating paid campaigns or commercial production features.
- Mapping and geocoding providers have different data licences, attribution rules, caching rules, and storage permissions. Check the selected providers' current terms before launch.

No provider is guaranteed to stay free or unlimited. The goal is to validate the product without committing to paid infrastructure prematurely.

---

## Running the prototype locally

### Requirements

- Node.js 20.9 or later (Node.js 22 is recommended).
- npm.
- A modern browser with WebGL support for the interactive globe.

### Start the development server

```bash
git clone https://github.com/Isaacava/Theworld.git
cd Theworld
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The initial build is a map-explorer prototype. It supports the interactive globe, real-place search, quick links to sample destination cities, a location preview panel, a temporary session-only saved-place list, browser-based nearby positioning when permission is granted, and a globe/flat-map toggle. Community posts, account authentication, MongoDB persistence, and server-enforced presence verification are not connected yet.

The default map style is OpenFreeMap's dark style. To test another compatible MapLibre style, create a local `.env.local` file:

```dotenv
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
```

Do not commit real secrets or private environment files. Place search, map-tap reverse lookup, and server-side place verification use the public OpenStreetMap Nominatim service only for low-volume prototype testing. When MongoDB is configured, search results and reverse lookups are cached there and requests reserve a shared Nominatim request slot through MongoDB so concurrent Vercel functions do not independently burst against the public service. Without MongoDB, the explorer falls back to a process-local cache and throttle for testing by a small number of users; it is not production-ready or globally coordinated.

### Validate the application

```bash
npm run typecheck
npm run build
```

A GitHub Actions workflow runs the type-check and production build on pushes and pull requests to `main`.

---

## Run the prototype locally

### Requirements

- Node.js 22 or newer (Node.js 24 is used by the current hosted test deployment).
- npm.
- A modern browser with WebGL support.

### Install and start

```bash
git clone https://github.com/Isaacava/Theworld.git
cd Theworld
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). If using Windows or a shell without `cp`, copy `.env.example` to `.env.local` manually.

### Enable accounts and persistent community posts

The globe and place explorer can run without MongoDB. Accounts and persistent community posts require a MongoDB Atlas connection.

1. Create a database user with access only to the test database and allow access from the test deployment.
2. Put the connection string in `MONGODB_URI` in `.env.local`.
3. Set `MONGODB_DB=theworld` (or another database name).
4. Restart the development server.
5. Open `/api/health`; `databaseConfigured` should be `true`. The endpoint reports whether the variable exists, not whether database connectivity has already been proven.
6. In Vercel Project Settings → Environment Variables, add the same variables to the **prototype Preview** environment before testing hosted accounts. Keep secrets out of Git and do not commit `.env.local`.

The application creates required indexes when the database is first used. If login or post creation fails, check the MongoDB connection string, database user's permissions, and Atlas network access rules.

### Community prototype behavior

- Place pages use the external map feature ID (for example `way-12345`) as a stable community key.
- Register and sign in use an opaque, server-side session in an HttpOnly cookie; passwords are hashed with Node's scrypt function.
- Posting requires a browser location reading and a server-side lookup of the selected OpenStreetMap feature. Presence distance is checked against canonical server-fetched OSM point/line/polygon geometry, not the coordinates sent by the browser.
- Raw browser coordinates are not stored in community posts or published to other users. The post stores a verification timestamp and method, not the user's location.
- This is still a prototype safeguard, **not production-grade proof of physical presence**. Browser GPS can be spoofed, and the public Nominatim service is not a production geocoder. Email verification, robust login/register rate-limiting, a moderation queue, and stronger anti-abuse controls are not implemented yet. Keep this test deployment access-controlled until those controls are completed.

### Automated checks

```bash
npm test
npm run typecheck
npm run build
```

The unit tests cover geographic coordinate validation, great-circle distance calculations, and the prototype's proximity-radius rules. GitHub Actions runs tests, type-checking, and a production build on pushes and pull requests to `main`.

---

## Development and cost strategy

### Prototype phase

Build and test the essential map-to-community path first:

1. Load the interactive globe.
2. Search for a real place.
3. Fly to the selected place.
4. Open the associated THE WORLD community page.
5. Display the location's public content.
6. Add and test the LIVE HERE presence-verification flow before enabling local posting.
7. Publish a post and show it in the correct community.
8. Test the experience on mobile browsers and slower connections.

The first prototype should not require paid advertisements, payments, ticketing, live streaming, or a complex ranking system.

### Keep costs under control

- Use available free tiers only within their terms and limits.
- Avoid sending repeated geocoding requests for the same search.
- Keep media out of MongoDB documents.
- Load detailed map data only when needed.
- Avoid continuous background location collection.
- Add real-time infrastructure only when ordinary requests and refreshes no longer meet the product's needs.
- Monitor usage and document when a service needs to be upgraded or replaced.

---

## Roadmap

### Phase 1 — Foundation

- [ ] Repository and product documentation.
- [x] Responsive application shell.
- [x] Interactive globe and map.
- [x] Search for real-world places.
- [x] Location/community page structure.
- [ ] Mobile interaction and loading/error states.

### Phase 2 — Social MVP

- [ ] Account authentication and profiles.
- [x] Initial MongoDB data model and persistent local posts (replies remain planned).
- [ ] Public browsing of community content.
- [x] Initial location-presence check for LIVE HERE posting (prototype-grade, with server-fetched OSM geometry; production anti-spoofing remains planned).
- [ ] Text posts, replies, and basic polls.
- [ ] Reporting, blocking, and basic moderation controls.

### Phase 3 — Retention and useful discovery

- [ ] PLACE MEMORY.
- [ ] ASK LOCALS.
- [ ] Follow places and conversations.
- [ ] Meaningful reply notifications.
- [ ] Search improvements and cached results.
- [ ] Basic contribution recognition.
- [ ] Community activity indicators based on real activity.

### Phase 4 — Businesses and monetization

- [ ] Business claim and verification workflow.
- [ ] Business pages.
- [ ] Sponsored-place campaigns.
- [ ] Business subscriptions and campaign management.
- [ ] Event pages and promotions.
- [ ] Analytics and tracked offers.
- [ ] Paid features only after commercial hosting, legal, privacy, and payment requirements are addressed.

### Phase 5 — Scale and reliability

- [ ] Evaluate map/geocoding usage and provider alternatives.
- [ ] Improve presence-abuse detection.
- [ ] Performance monitoring and cost controls.
- [ ] Evaluate managed real-time updates if justified.
- [ ] Expand communities only where sustained participation is possible.

---

## MVP acceptance criteria

The first usable prototype is ready when all of the following work:

- [ ] The globe loads on a mobile browser and can be rotated and zoomed.
- [ ] A user can search for a real city, neighbourhood, street, or mapped place.
- [ ] Selecting a result moves the map to the correct location.
- [ ] The application can associate the selected geographical feature with a THE WORLD community record.
- [ ] A place with no community content shows a clear, honest empty state rather than fabricated activity.
- [ ] Users can browse public location content without pretending to be physically there.
- [ ] LIVE HERE rejects contributions when the required presence check fails.
- [ ] Public posts do not expose the author's precise coordinates.
- [ ] A successful post appears in the correct community.
- [ ] API errors, denied location permission, inaccurate location readings, and empty search results are handled clearly.
- [ ] Map attribution and third-party usage requirements are respected.
- [ ] No paid revenue feature is required to test the core experience.

---

## Product principles

1. **Real places, real communities.** Location pages must connect to actual geographical features where those features can be identified reliably.
2. **Useful participation over posting volume.** Do not reward spam or make raw activity counts the goal.
3. **Explore anywhere; be honest about presence.** Remote visitors can browse and ask questions without misrepresenting themselves as local contributors.
4. **Privacy by design.** Never expose individual users' exact live positions publicly.
5. **Freshness matters.** Clearly timestamp observations and avoid presenting old information as current.
6. **Trust is not for sale.** Sponsored placements must not buy positive ratings or suppress legitimate criticism.
7. **Build for real phones and real connections.** Keep the interface responsive and lightweight.
8. **Validate before scaling.** Establish useful, active communities before expanding advertising and other commercial features.
9. **Make the product worth returning to.** Replies, discovery, community knowledge, and recognition should create genuine value without manipulative engagement mechanics.
10. **Keep providers replaceable.** The globe, geocoding provider, storage, and hosting must not be so tightly coupled that a future change becomes a full rewrite.

---

## Guiding statement

**THE WORLD is a social map of Earth: explore any place, discover the conversations connected to it, and contribute to its live local community when your presence is verified.**

The globe attracts attention. Real places provide context. Conversations create connections. Place Memory builds lasting usefulness. Responsible business tools create a path to revenue.

The first milestone is simple: **open the globe, find a real street, enter its community, and make the map-to-community experience work reliably.**
