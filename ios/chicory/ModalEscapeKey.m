#import <React/RCTViewManager.h>

// A full-screen UIKit modal has no default hardware Escape command. This
// responder belongs to the chooser's window only while the chooser is shown.
@interface ChicoryEscapeResponder : UIView
@property (nonatomic, copy) RCTDirectEventBlock onEscape;
@end

@implementation ChicoryEscapeResponder
- (BOOL)canBecomeFirstResponder { return YES; }

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (self.window) [self becomeFirstResponder];
}

- (NSArray<UIKeyCommand *> *)keyCommands
{
  UIKeyCommand *escape = [UIKeyCommand keyCommandWithInput:UIKeyInputEscape
                                             modifierFlags:0
                                                    action:@selector(closeChooser:)];
  escape.wantsPriorityOverSystemBehavior = YES;
  return @[escape];
}

- (void)closeChooser:(UIKeyCommand *)sender
{
  if (self.onEscape) self.onEscape(@{});
}
@end

@interface ChicoryModalEscapeKeyManager : RCTViewManager
@end

@implementation ChicoryModalEscapeKeyManager
RCT_EXPORT_MODULE(ChicoryModalEscapeKey)
RCT_EXPORT_VIEW_PROPERTY(onEscape, RCTDirectEventBlock)
- (UIView *)view { return [ChicoryEscapeResponder new]; }
@end
