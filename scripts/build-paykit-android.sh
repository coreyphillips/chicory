#!/bin/sh
# Builds native/paykit-lookup for Android and puts libpaykit_lookup.so for each
# ABI into android/app/src/main/jniLibs, where Gradle packages it.
# Needs cargo-ndk. Run it before the first Android build and after any change to the crate.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
crate="$root/native/paykit-lookup"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ -z "${ANDROID_NDK_HOME:-}" ]; then
  # Use the NDK the app itself builds with.
  ndk="$(sed -n 's/.*ndkVersion = "\(.*\)".*/\1/p' "$root/android/build.gradle")"
  export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$ndk"
fi
min_sdk="$(sed -n 's/.*minSdkVersion = \([0-9]*\).*/\1/p' "$root/android/build.gradle")"

# Devices with 16 KB pages refuse a library aligned to 4 KB, which this NDK still defaults to.
export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=-Wl,-z,max-page-size=16384"

# cargo-ndk reads the Cargo.toml of the directory it runs in.
cd "$crate"
cargo ndk --platform "$min_sdk" \
  -t arm64-v8a -t armeabi-v7a -t x86_64 \
  -o "$root/android/app/src/main/jniLibs" build --release --locked
