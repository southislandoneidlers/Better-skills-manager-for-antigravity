# Changelog

All notable changes to **Better-skills-manager** will be documented in this file.

## [1.1.0] - 2026-11-26

### Added
- **Bilingual UI (`EN` / `繁中`)**: Full English and Taiwan Traditional Chinese interface with instant top-bar switching persisted to `${PLUGIN_DATA}/preferences.json`.
- **Visual README Previews**: Added real high-DPI UI preview screenshots (`docs/assets/preview-*.png`) across English and Traditional Chinese READMEs.
- **Better-skills-manager Rebrand & CLI Alias**: Renamed package and UI display title to `Better-skills-manager` (`better-skills-manager` CLI bin alongside `skill-docs`).
- **Smart Default Scope**: Automatically shows `All (incl. Built-in)` on initial launch when custom skill directories are still empty.

### Changed
- Rewrote `README.md`, `README.zh-TW.md`, and UI strings for natural tone and strict Taiwan Traditional Chinese terminology.

## [1.0.0] - 2026-11-25

### Added
- **Single-Document Skill Editor**: Encapsulates `<skill>/SKILL.md` plus `scripts/`, `references/`, `examples/`, and `resources/` into a unified document + attachments view with 400ms auto-save and lossless YAML frontmatter preservation.
- **Live Linter & 1-Click Quick Fixes**: Validates YAML frontmatter, `name` kebab-case & duplicates, `description` completeness, and broken relative Markdown links with 1-click attachment stub generation.
- **Finder-Style Category Folders & Safe Archiving**: Supports nested category folders with automatic `skills.json` `entries` synchronization (preserving user `inherits` and external `entries`), plus non-destructive `_disabled/` archiving that remembers original category paths.
- **Lifecycle Dates & Update Checking**: Tracks `publishedAt` / `installedAt`, supports Git/GitHub and local upstream directory fingerprint update checks with automatic pre-update backups, and real-time 2-way `fs.watch` sync.
- **Usage Frequency & 365-Day Timeline**: Scans conversation transcripts incrementally with 5-minute deduplication control to display total/30-day counts, 365-day calendar heatmaps, idle diagnostics, and exact activation timestamps.
- **Multi-Skill Collaboration Graph**: Detects explicit cross-references, historical conversation co-usage, shared tool/domain overlap, and trigger-description overlap warnings.
- **Cross-Platform CLI**: Added `install | uninstall | status | mcp` CLI.
