# Product

## Register

product

## Users

The primary user is the developer himself: a power user who knows exactly what Windows Explorer lacks, wants fast navigation, and expects the AI to act as a capable assistant rather than a feature. A handful of friends may use it eventually. Today: build for a single exacting user, not a general audience.

Context when using it: daily driver. Open all day. Files are scattered and need organizing; the user wants to spend zero mental energy on the filesystem itself. The job to be done is "get to the right file, or let the AI sort things out, and get out."

## Product Purpose

A personal Windows file explorer that replaces Windows Explorer entirely for daily use. The AI handles classification and proposes operations; the user approves or ignores. Success looks like: the user never has to think about folder structure again, and every interaction with the app is faster than the alternative.

## Brand Personality

Minimal. Legible. Satisfying.

No startup energy. No AI cosplay. Nothing decorative. The app should feel like a well-made tool that has been used and trusted for years, not a new product trying to impress. Every element earns its place by being immediately readable and immediately actionable — no second glance.

## Anti-references

- Windows Explorer: too sparse, no intelligence, no character
- Total Commander / Directory Opus: too cluttered, too many affordances at once, busy visual language
- Any "AI-powered" app that foregrounds the AI as a personality or uses gradient/glow/animation to signal intelligence
- Startup-style SaaS dashboards: metric cards, hero numbers, rounded corners on everything, purple-gradient sidebars
- Apps that look like they were designed by an AI or templated from a component library

The test: someone familiar with professional tools (Linear, Figma, Raycast, VSCode) should feel at home and not notice the design at all. The UI should disappear.

## Design Principles

1. **Zero interpretation lag.** Every element communicates its state at a glance. No tooltip required to understand what something does, no hover needed to decode a status. If the user has to look twice, the design failed.

2. **Density is a feature.** Information per pixel matters. The user is a power user who prefers a compact, information-rich interface over an airy, approachable one. Comfortable ≠ good here.

3. **AI is silent infrastructure.** The AI's presence is felt through results: better-organized files, smarter proposals. It is never expressed through visual personality, glowing indicators, or animated thinking states.

4. **The interface adapts, not the user.** Font scale, panel sizes, and accent color are user-owned. The design system must be built to flex — no hardcoded pixel dimensions in the wrong places, no color that can't be overridden by a custom accent.

5. **Every frame is a working frame.** There are no splash screens, no onboarding flows, no empty states that ask the user to "get started." The app opens ready. If something isn't loaded yet, show what is.

## Accessibility & Inclusion

No formal WCAG target for now. Required accommodations:
- Scalable UI: font size and panel sizes must be adjustable (larger/smaller without layout breaking)
- Accent color customization: the active accent value is read from a CSS custom property and ships as the brand amber by default. Power users may override it with a custom hex via Settings → Personalization. Brand identity is the design language as a whole — chrome treatment, type system, motion vocabulary, and sparing accent use — not a single locked color.
- Reduced motion: respect `prefers-reduced-motion` — animations are already minimal, but confirm they collapse to instant on this setting
