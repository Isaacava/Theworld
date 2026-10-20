# THE WORLD — Product Design System

Version: prototype v0.2

## Product principle

THE WORLD is a map-first local-community product, not a futuristic dashboard and not a marketing landing page. The map is the main canvas. The surrounding UI should help someone answer three questions quickly:

1. Where am I looking?
2. What can I do with this place?
3. What are people who are actually nearby sharing?

Use this document as the visual source of truth for all interface work. Preserve the current map, place search, saved-place interactions, account flows, local posts, replies, and responsive behavior while improving their presentation.

## Visual direction: quiet cartography

Use a restrained cartographic/editorial style: a clear light map, warm paper-like panels, precise labels, good whitespace, fine dividers, and a small forest-green accent. The interface should feel like a considered public-space guide, not an AI-generated SaaS dashboard.

### Color tokens

| Token | Value | Use |
| --- | --- | --- |
| Canvas | `#F1F0EA` | App background outside map tiles |
| Surface | `#FCFBF7` | Panels, search results, dialogs |
| Surface subtle | `#F4F4EE` | Input fills, secondary sections |
| Text | `#202A25` | Headings and main body |
| Muted text | `#5E6B63` | Supporting information |
| Quiet text | `#7C877F` | Metadata and hints |
| Border | `#DCE1D9` | Dividers and control outlines |
| Primary | `#2D5D45` | Main actions, selected navigation, map marker |
| Primary hover | `#234B38` | Hover and pressed state |
| Primary tint | `#E8F0E9` | Selected navigation and quiet callouts |
| Danger | `#9B3D32` | Errors only |
| Caution | `#8B682B` | Warnings only |

Do not introduce neon green, cyberpunk cyan, purple-to-blue gradients, decorative glow, or unnecessary glass effects. Do not use color as the only status signal.

## Typography

- Product UI: DM Sans, with system sans-serif fallbacks.
- Occasional headline emphasis: Georgia or a system serif. Use it sparingly for editorial character, never in every card.
- Use a practical scale: 12–13 px for compact supporting text, 14–16 px for regular UI/body text, 18–22 px for panel headings, and 28–32 px for the single main heading.
- Avoid tracking-heavy uppercase labels. Uppercase is acceptable for a few short section labels, but the page must not be made of tiny all-caps microcopy.
- Body line-height should usually be 1.45–1.7. Do not squeeze explanations into 8–9 px text.

## Layout and spacing

- Keep the map as the full-screen canvas; map tiles carry most of the visual detail.
- Use a consistent 4/8 px spacing rhythm.
- Desktop panels: approximately 300 px for navigation and 350 px for place details. Use 12–14 px corner radii and light, low-elevation shadows.
- Use solid, opaque surfaces for controls and panels. Do not use blurred glass as the default container style.
- Keep the top navigation simple: wordmark, place search, account action.
- On narrow screens, prioritize the map and search; use the place details panel as a bottom sheet.
- Use one border or one surface change to group content. Avoid putting every piece of text inside its own rounded card.
- Prefer dividers and clear spacing over stacks of nested cards.

## Components

### Place search
- Bright surface, clear focus state, readable results, full place name and address.
- Show map-provider attribution.
- Loading/error copy should describe the task: “Searching places…”, “Couldn’t load the map”, or a useful retry instruction. Avoid theatrical status messages.

### Place navigation
- Navigation has one selected state, with a quiet green tint and readable icon/text contrast.
- Quick places are a simple list, not a row of colorful mini-cards.
- Use familiar location symbols, not arbitrary city abbreviations.

### Place details and community
- Give the place name and address priority over decorative labels.
- Use a clear “Local community” or “Conversations” heading.
- Post cards should read like a community feed: author, time, body, location, and reply control. Do not turn each post into a dashboard widget.
- Empty states explain what a user can do next without promising features that are not yet implemented.
- Keep composer and reply forms visually distinct from the feed, but use a light surface and subtle border rather than gradients.

### Account dialog
- Use a simple accessible dialog with a light surface, labels above fields, clear focus states, validation errors beside the form, and one primary action.
- Avoid decorative gradient hero blocks and unnecessary illustration tiles.

### Map marker and controls
- Use a small, high-contrast green marker with a white edge.
- Do not use a glowing animation as the default. Honor reduced-motion preferences.
- Map controls should be consistent, legible buttons with clear labels and keyboard focus.

## Interaction and accessibility

- Every visible action must do what its label promises.
- Keep tap targets at least 40 px wherever practical.
- Show hover, focus-visible, disabled, loading, error, and empty states.
- Keep text contrast at WCAG AA levels for normal text.
- Do not request device location just to browse the map. Only request it when the user takes an action that requires a presence check.
- Never publish raw browser coordinates.
- Reduced motion must be respected.

## Product copy rules

Avoid vague, AI-sounding phrases such as:
- “Your world is waiting”
- “Earth online”
- “More than a map. A world of stories.”
- “Something starts here.”
- “Coming next” when the interface already has a working flow

Prefer specific, useful copy:
- “Search a city, street or landmark”
- “No conversations yet”
- “Add to this community”
- “Your location is checked when you post”
- “The map couldn’t load. Check your connection and try again.”

## Anti-patterns to reject

- Neon colors and glows used only for visual excitement.
- Excessive gradients, glassmorphism, oversized rounded corners, and nested cards.
- Repeating the same capsule badge and uppercase eyebrow on every section.
- Tiny unreadable metadata.
- Random initials used as icons.
- Fake “live” indicators, activity counters, or status text that does not reflect real state.
- Placeholder copy that claims a feature is coming next when it is already partly implemented.
- Buttons that only show a toast instead of performing the action they promise.
- Decorative animation without functional purpose.

## Reference research

The design direction was informed by public design-system research rather than copying a reference site:
- [UI UX Pro Max — design reasoning and anti-pattern checklists](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- [VoltAgent — Awesome DESIGN.md, design-system analysis examples](https://github.com/VoltAgent/awesome-design-md)
- [OpenFreeMap — maintained map-style choices](https://github.com/hyperknot/openfreemap-styles)
- [OpenFreeMap quick start](https://openfreemap.org/quick_start/)

Use references to learn principles; do not reproduce another product's exact layout, brand, or styling.
