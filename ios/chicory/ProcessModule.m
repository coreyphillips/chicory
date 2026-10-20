#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ChicoryProcess, NSObject)
RCT_EXTERN_METHOD(threadCount:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
