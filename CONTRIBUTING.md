# Contributing to StegoClip

Thank you for your interest in contributing to StegoClip! We welcome bug fixes, documentation improvements, and feature contributions.

## Development Setup

### Prerequisites

- Node.js >= 20.0.0
- [pnpm](https://pnpm.io/) >= 9.0.0
- Google Chrome or Chromium-based browser

### Getting Started

1. Fork the repository on GitHub and clone your fork:

   ```bash
   git clone https://github.com/YOUR_USERNAME/stego-clip-extension.git
   cd stego-clip-extension
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Load the unpacked extension into Chrome:
   - Navigate to `chrome://extensions` in Google Chrome.
   - Enable **Developer mode** in the top right corner.
   - Click **Load unpacked** and select the repository root directory.

## Testing & Code Quality

StegoClip enforces strict code quality and formatting. Before submitting any changes, verify that the complete check pipeline passes:

```bash
# Run unit tests
pnpm test

# Check code formatting
pnpm run format:check

# Run ESLint linter
pnpm run lint

# Run all checks at once
pnpm run check
```

Automatically format code with:

```bash
pnpm run format
```

## Pull Request Guidelines

1. Create a focused feature branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Ensure all existing and new unit tests pass (`pnpm run check`).
3. Write clear, imperative commit messages (e.g. `feat(scope): short description` or `fix(scope): short description`).
4. Push to your fork and open a Pull Request against the `main` branch.

## Building for Release

To verify that the release package builds cleanly:

```bash
pnpm run build
```

This produces a distribution archive in `dist/stego-clip-extension-v*.zip` ready for installation or Chrome Web Store deployment.
