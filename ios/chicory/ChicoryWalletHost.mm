#include <atomic>

#import <React/CoreModulesPlugins.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#import <React/RCTUtils.h>
#import <React/RCTJavaScriptLoader.h>
#import <CoreModules/RCTDevMenu.h>
#import <CoreModules/RCTExceptionsManager.h>
#import <FBReactNativeSpec/FBReactNativeSpec.h>
#import <React_RCTAppDelegate/RCTAppSetupUtils.h>
#import <React_RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

#if RCT_DEV_MENU
// RN's menu registers process-wide shortcuts in init and removes the UI's
// shortcuts when decorated as disabled. A headless host owns neither.
@interface WalletDevMenu : RCTDevMenu
@end
@implementation WalletDevMenu
+ (void)initialize {} // The superclass installs the UIWindow shake hook once.
- (void)registerHotkeys {}
- (void)setKeyboardShortcutsEnabled:(BOOL)enabled {}
@end
#endif

@class WalletRuntimeDelegate;

@interface ChicoryWalletHost : NSObject <RCTBridgeModule, RCTInvalidating>
- (void)workerFailed:(WalletRuntimeDelegate *)worker;
@end

// Register a distinct native endpoint in each engine. Only that endpoint can
// reply to the UI instance that owns it, even across a development reload.
@interface WalletRuntimeDelegate : RCTDefaultReactNativeFactoryDelegate
@property (nonatomic, weak) ChicoryWalletHost *owner;
@property (nonatomic, strong) ChicoryWalletHost *endpoint;
@end

// ErrorUtils can report directly through ExceptionsManager, bypassing the
// RCTHost delegate. A failed engine must reject its calls and leave the UI alive.
@interface RCTExceptionsManager (WalletExceptionSpec) <NativeExceptionsManagerSpec>
@end

@interface WalletExceptionsManager : RCTExceptionsManager
@property (nonatomic, weak) WalletRuntimeDelegate *worker;
@end
@implementation WalletExceptionsManager
- (void)reportException:(JS::NativeExceptionsManager::ExceptionData &)data
{
  if (data.isFatal()) {
    [self reportFatalException:nil stack:nil exceptionId:data.id_()];
  } else {
    [super reportException:data];
  }
}

- (void)reportFatalException:(NSString *)message stack:(NSArray *)stack exceptionId:(double)exceptionId
{
  WalletRuntimeDelegate *worker = self.worker;
  dispatch_async(dispatch_get_main_queue(), ^{ [worker.owner workerFailed:worker]; });
}
@end

@interface WalletRequest : NSObject
@property (nonatomic, copy) NSString *payload;
@property (nonatomic, copy) RCTPromiseResolveBlock resolve;
@property (nonatomic, copy) RCTPromiseRejectBlock reject;
@end
@implementation WalletRequest
@end

// RN retains each endpoint in its TurboModule registry through destruction
// of that Hermes instance. A replacement wallet must wait for this ownership
// to end before it can open the device vault or start native transports.
static dispatch_group_t walletRuntimeLifetime;

@implementation ChicoryWalletHost {
  BOOL _engine;
  __weak ChicoryWalletHost *_owner;
  dispatch_group_t _lifetime;
  NSObject *_generation;
  BOOL _closed;
  BOOL _ready;
  RCTRootViewFactory *_factory;
  WalletRuntimeDelegate *_worker;
  NSMutableDictionary<NSString *, WalletRequest *> *_pending;
  NSMutableArray<NSString *> *_waiting;
}

RCT_EXPORT_MODULE()
@synthesize bundleManager = _bundleManager;
@synthesize callableJSModules = _callableJSModules;

+ (BOOL)requiresMainQueueSetup { return NO; }

// Only lightweight routing and native host lifecycle run on main. React
// executes receive() on the engine's own Hermes thread.
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (instancetype)initWithOwner:(ChicoryWalletHost *)owner lifetime:(dispatch_group_t)lifetime
{
  if ((self = [super init])) {
    _engine = YES;
    _owner = owner;
    _lifetime = lifetime;
    if (_lifetime) dispatch_group_enter(_lifetime);
  }
  return self;
}

- (void)dealloc
{
  if (_lifetime) dispatch_group_leave(_lifetime);
}

- (NSDictionary *)constantsToExport { return @{@"isEngineRuntime": @(_engine)}; }

// The native Tor library can start once per process, including across reloads.
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(claimTorStart)
{
  static std::atomic<bool> started{false};
  return @(!started.exchange(true));
}

- (void)startWorker
{
  NSObject *generation = [NSObject new];
  _generation = generation;
  [self startGeneration:generation];

  // This deadline only covers startup. In-flight payments have no timer or
  // automatic replay, as a broadcast may already have reached its peer.
  __weak ChicoryWalletHost *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    ChicoryWalletHost *owner = weakSelf;
    if (owner && owner->_generation == generation && !owner->_ready) {
      [owner closeWithMessage:@"The wallet engine did not finish starting."];
    }
  });
}

- (void)startGeneration:(NSObject *)generation
{
  if (_generation != generation) return;
  if (walletRuntimeLifetime && dispatch_group_wait(walletRuntimeLifetime, DISPATCH_TIME_NOW) != 0) {
    __weak ChicoryWalletHost *weakSelf = self;
    dispatch_group_notify(walletRuntimeLifetime, dispatch_get_main_queue(), ^{
      [weakSelf startGeneration:generation];
    });
    return;
  }
  NSURL *url = self.bundleManager.bundleURL;
  if (!url) {
    [self closeWithMessage:@"The wallet engine bundle is unavailable."];
    return;
  }

  _worker = [WalletRuntimeDelegate new];
  _worker.dependencyProvider = [RCTAppDependencyProvider new];
  _worker.owner = self;
  walletRuntimeLifetime = dispatch_group_create();
  _worker.endpoint = [[ChicoryWalletHost alloc] initWithOwner:self lifetime:walletRuntimeLifetime];

  RCTRootViewFactoryConfiguration *config =
      [[RCTRootViewFactoryConfiguration alloc] initWithBundleURL:url newArchEnabled:YES];
  config.jsRuntimeConfiguratorDelegate = _worker;
  _factory = [[RCTRootViewFactory alloc] initWithTurboModuleDelegate:_worker
                                                       hostDelegate:_worker
                                                      configuration:config];
#if RCT_DEV_MENU
  RCTDevMenuConfiguration *devMenu = [[RCTDevMenuConfiguration alloc] initWithDevMenuEnabled:NO
                                                                         shakeGestureEnabled:NO
                                                                    keyboardShortcutsEnabled:NO];
#else
  RCTDevMenuConfiguration *devMenu = [RCTDevMenuConfiguration defaultConfiguration];
#endif
  [_factory initializeReactHostWithLaunchOptions:nil
                             bundleConfiguration:self.bundleManager.bundleConfig
                            devMenuConfiguration:devMenu];
}

RCT_EXPORT_METHOD(dispatch:(NSString *)request resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  if (_engine || _closed) {
    reject(@"WALLET_ENGINE_CLOSED", @"The wallet engine is unavailable.", nil);
    return;
  }
  if (!_pending) {
    _pending = [NSMutableDictionary new];
    _waiting = [NSMutableArray new];
  }
  NSString *key = NSUUID.UUID.UUIDString;
  WalletRequest *call = [WalletRequest new];
  call.payload = request;
  call.resolve = resolve;
  call.reject = reject;
  _pending[key] = call;
  if (_ready) {
    [self deliver:key];
  } else {
    [_waiting addObject:key];
    if (!_generation) {
      [self startWorker];
    }
  }
}

- (void)deliver:(NSString *)key
{
  WalletRequest *call = _pending[key];
  [_factory.reactHost callFunctionOnJSModule:@"ChicoryWalletEngine" method:@"receive" args:@[key, call.payload]];
  call.payload = nil;
}

RCT_EXPORT_METHOD(ready)
{
  ChicoryWalletHost *owner = _owner;
  if (owner && owner->_worker.endpoint == self && !owner->_closed && !owner->_ready) {
    owner->_ready = YES;
    for (NSString *key in owner->_waiting) {
      [owner deliver:key];
    }
    [owner->_waiting removeAllObjects];
  }
}

RCT_EXPORT_METHOD(reply:(NSString *)key response:(NSString *)response)
{
  ChicoryWalletHost *owner = _owner;
  if (owner && owner->_worker.endpoint == self) {
    WalletRequest *call = owner->_pending[key];
    if (call) {
      [owner->_pending removeObjectForKey:key];
      call.resolve(response);
    }
  }
}

RCT_EXPORT_METHOD(notify:(NSString *)session event:(NSString *)event)
{
  ChicoryWalletHost *owner = _owner;
  if (owner && owner->_worker.endpoint == self && owner->_ready) {
    [owner.callableJSModules invokeModule:@"ChicoryWalletEvents" method:@"receive" withArgs:@[session, event]];
  }
}

- (void)workerFailed:(WalletRuntimeDelegate *)worker
{
  if (worker == _worker) {
    [self closeWithMessage:@"The wallet engine stopped. Check payment history before trying again."];
  }
}

- (void)closeWithMessage:(NSString *)message
{
  _generation = nil;
  _ready = NO;
  for (WalletRequest *call in _pending.allValues) {
    call.reject(@"WALLET_ENGINE_CLOSED", message, nil);
  }
  [_pending removeAllObjects];
  [_waiting removeAllObjects];
  _factory.reactHost = nil;
  _factory = nil;
  _worker = nil;
}

- (void)invalidate
{
  RCTExecuteOnMainQueue(^{
    self->_closed = YES;
    ChicoryWalletHost *owner = self->_owner;
    if (owner && owner->_worker.endpoint == self) {
      [owner workerFailed:owner->_worker];
    }
    [self closeWithMessage:@"The wallet engine session closed."];
  });
}
@end

@implementation WalletRuntimeDelegate {
  BOOL _issuedEndpoint;
}

- (NSArray<id<RCTBridgeModule>> *)extraModulesForBridge:(RCTBridge *)bridge
{
  // RN requests this list once for each new Hermes instance. A reload of
  // the worker alone must never pick up callbacks belonging to its predecessor.
  @synchronized (self) {
    if (_endpoint && !_issuedEndpoint) {
      _issuedEndpoint = YES;
      return @[_endpoint];
    }
  }
  dispatch_async(dispatch_get_main_queue(), ^{ [self.owner workerFailed:self]; });
  return @[[[ChicoryWalletHost alloc] initWithOwner:nil lifetime:nil]];
}

- (Class)getModuleClassFromName:(const char *)name { return RCTCoreModulesClassProvider(name); }

- (id<RCTTurboModule>)getModuleInstanceFromClass:(Class)moduleClass
{
  if (moduleClass == [RCTExceptionsManager class]) {
    WalletExceptionsManager *manager = [WalletExceptionsManager new];
    manager.worker = self;
    return manager;
  }
#if RCT_DEV_MENU
  if (moduleClass == [RCTDevMenu class]) return (id<RCTTurboModule>)[WalletDevMenu new];
#endif
  return RCTAppSetupDefaultModuleFromClass(moduleClass, self.dependencyProvider);
}

- (void)loadBundleAtURL:(NSURL *)url onProgress:(RCTSourceLoadProgressBlock)progress onComplete:(RCTSourceLoadBlock)complete
{
  [RCTJavaScriptLoader loadBundleAtURL:url onProgress:progress onComplete:^(NSError *error, RCTSource *source) {
    if (error) {
      dispatch_async(dispatch_get_main_queue(), ^{ [self.owner workerFailed:self]; });
      return;
    }
    complete(nil, source);
  }];
}

- (void)host:(RCTHost *)host didReceiveJSErrorStack:(NSArray *)stack message:(NSString *)message
    originalMessage:(NSString *)originalMessage name:(NSString *)name componentStack:(NSString *)componentStack
        exceptionId:(NSUInteger)exceptionId isFatal:(BOOL)isFatal extraData:(NSDictionary *)extraData
{
  if (isFatal) {
    dispatch_async(dispatch_get_main_queue(), ^{ [self.owner workerFailed:self]; });
  }
}
@end
