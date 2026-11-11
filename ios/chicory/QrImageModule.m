#import <PhotosUI/PhotosUI.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <Vision/Vision.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>

// The picker grants access to the chosen image only. Decode its temporary
// representation inside the provider callback, while the URL is valid.
@interface ChicoryQrImage : NSObject <RCTBridgeModule, PHPickerViewControllerDelegate>
@end

@implementation ChicoryQrImage {
  RCTPromiseResolveBlock _resolve;
  RCTPromiseRejectBlock _reject;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

RCT_EXPORT_METHOD(pick:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  UIViewController *presenter = RCTPresentedViewController();
  if (!presenter.view.window || _resolve || presenter.isBeingDismissed) {
    reject(@"PICKER_UNAVAILABLE", @"Could not open the image picker.", nil);
    return;
  }
  PHPickerConfiguration *config = [[PHPickerConfiguration alloc] init];
  config.selectionLimit = 1;
  config.filter = PHPickerFilter.imagesFilter;
  PHPickerViewController *picker = [[PHPickerViewController alloc] initWithConfiguration:config];
  picker.delegate = self;
  _resolve = resolve;
  _reject = reject;
  [presenter presentViewController:picker animated:YES completion:nil];
}

- (void)picker:(PHPickerViewController *)picker didFinishPicking:(NSArray<PHPickerResult *> *)results
{
  RCTPromiseResolveBlock resolve = _resolve;
  if (!resolve) return;
  RCTPromiseRejectBlock reject = _reject;
  _resolve = nil;
  _reject = nil;
  NSItemProvider *provider = results.firstObject.itemProvider;
  [picker dismissViewControllerAnimated:YES completion:^{
    if (!provider) {
      resolve(nil);
      return;
    }
    [provider loadFileRepresentationForTypeIdentifier:UTTypeImage.identifier
                                    completionHandler:^(NSURL *url, NSError *error) {
      @autoreleasepool {
        CGImageSourceRef source = url ? CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL) : NULL;
        NSDictionary *options = @{
          (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
          (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
          (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize: @4096
        };
        CGImageRef frame = source ? CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options) : NULL;
        if (source) CFRelease(source);
        if (!frame) {
          reject(@"IMAGE_UNREADABLE", @"Could not read the QR image.", nil);
          return;
        }
        VNDetectBarcodesRequest *scan = [VNDetectBarcodesRequest new];
        scan.symbologies = @[VNBarcodeSymbologyQR];
        VNImageRequestHandler *reader = [[VNImageRequestHandler alloc] initWithCGImage:frame options:@{}];
        CGImageRelease(frame);
        if (![reader performRequests:@[scan] error:NULL]) {
          reject(@"IMAGE_UNREADABLE", @"Could not read the QR image.", nil);
          return;
        }
        NSMutableArray<NSString *> *codes = [NSMutableArray array];
        for (VNBarcodeObservation *code in scan.results) {
          if (code.payloadStringValue.length) [codes addObject:code.payloadStringValue];
        }
        resolve(codes);
      }
    }];
  }];
}
@end
