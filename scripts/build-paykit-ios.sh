#!/bin/sh
# Builds native/paykit-lookup for iOS devices and Apple silicon simulators and
# packs both into ios/PaykitLookup.xcframework, which the Xcode project links.
# Run it before the first iOS build and after any change to the crate.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
crate="$root/native/paykit-lookup"
output="$root/ios/PaykitLookup.xcframework"

# The iOS SDKs ship with Xcode only, so the Command Line Tools cannot build this.
if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode.app/Contents/Developer ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
# The app's deployment target. Rust's own default is far older.
export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.5}"

for target in aarch64-apple-ios aarch64-apple-ios-sim; do
  cargo build --manifest-path "$crate/Cargo.toml" --release --locked --target "$target"
done

rm -rf "$output"
xcodebuild -create-xcframework \
  -library "$crate/target/aarch64-apple-ios/release/libpaykit_lookup.a" -headers "$crate/include" \
  -library "$crate/target/aarch64-apple-ios-sim/release/libpaykit_lookup.a" -headers "$crate/include" \
  -output "$output"
