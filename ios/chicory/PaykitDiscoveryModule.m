#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PaykitDiscovery, NSObject)
RCT_EXTERN_METHOD(getPaymentList:(NSString *)pubky resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
