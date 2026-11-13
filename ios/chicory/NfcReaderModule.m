#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ChicoryNfc, NSObject)
RCT_EXTERN_METHOD(status:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(read:(NSString *)prompt resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancel:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
