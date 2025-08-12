#!/usr/bin/env bash
set -euo pipefail

# Script to create a new release
# Usage: ./scripts/release.sh [version]
# Example: ./scripts/release.sh v0.2.0

VERSION=${1:-}

if [ -z "$VERSION" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 v0.2.0"
    exit 1
fi

# Ensure version starts with 'v'
if [[ ! "$VERSION" =~ ^v ]]; then
    VERSION="v$VERSION"
fi

echo "Creating release $VERSION..."

# Run tests first
echo "Running tests..."
deno task verify

# Update version in deno.json if it exists
if [ -f "deno.json" ]; then
    echo "Updating version in deno.json..."
    # This is a simple replacement, might need adjustment based on your deno.json structure
    sed -i.bak "s/\"version\": \".*\"/\"version\": \"${VERSION#v}\"/" deno.json
    rm deno.json.bak
fi

# Commit version update if files changed
if ! git diff --quiet; then
    git add -A
    git commit -m "chore: bump version to $VERSION"
fi

# Create and push tag
echo "Creating git tag $VERSION..."
git tag -a "$VERSION" -m "Release $VERSION"

echo "Pushing to origin..."
git push origin main
git push origin "$VERSION"

echo ""
echo "✅ Release $VERSION created successfully!"
echo ""
echo "GitHub Actions will now:"
echo "1. Run CI tests"
echo "2. Build binaries for all platforms"
echo "3. Create a GitHub release with the binaries"
echo ""
echo "You can monitor the progress at:"
echo "https://github.com/tommymorgan/jj-tools/actions"