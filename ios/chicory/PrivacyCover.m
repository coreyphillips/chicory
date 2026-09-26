#import "PrivacyCover.h"

#import <stdatomic.h>

#import <React/RCTBridgeModule.h>

// Written on the JavaScript thread, read on the main thread.
static atomic_bool promptFlag = false;
static atomic_bool lockFlag = false;

// A legacy module: under the bridgeless new architecture React Native reaches
// it through its TurboModule interop, which runs a method that returns a value
// on the JavaScript thread, before the call returns.
@interface PrivacyCover () <RCTBridgeModule>
@end

@implementation PrivacyCover

RCT_EXPORT_MODULE(PrivacyCover)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

+ (BOOL)systemPromptOpen
{
  return atomic_load(&promptFlag);
}

+ (BOOL)lockShown
{
  return atomic_load(&lockFlag);
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(setSystemPromptOpen : (BOOL)open)
{
  atomic_store(&promptFlag, open);
  return nil;
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(setLockShown : (BOOL)shown)
{
  atomic_store(&lockFlag, shown);
  return nil;
}

@end
