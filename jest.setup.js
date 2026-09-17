/* eslint-env jest */
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  getAllGenericPasswordServices: jest.fn().mockResolvedValue([]),
  setGenericPassword: jest.fn().mockResolvedValue({ service: 'test' }),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  getSupportedBiometryType: jest.fn().mockResolvedValue(null),
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly' },
  ACCESS_CONTROL: {
    BIOMETRY_ANY: 'BiometryAny',
    BIOMETRY_CURRENT_SET: 'BiometryCurrentSet',
    BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BiometryAnyOrDevicePasscode',
    BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE:
      'BiometryCurrentSetOrDevicePasscode',
    DEVICE_PASSCODE: 'DevicePasscode',
  },
  BIOMETRY_TYPE: {
    FACE_ID: 'FaceID',
    TOUCH_ID: 'TouchID',
    FINGERPRINT: 'Fingerprint',
    FACE: 'Face',
    IRIS: 'Iris',
  },
}));
// The network form reads the device's saved profiles, which pulls in the
// encrypted storage module. Suites that exercise storage for real replace this
// with their own mock, and a local mock wins.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => {
    throw new Error('No encrypted storage in this test.');
  }),
  isSQLCipher: () => true,
  IOS_LIBRARY_PATH: '/tmp/ios',
  ANDROID_FILES_PATH: '/tmp/android',
}));
jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: jest.fn().mockResolvedValue('demo'),
  setString: jest.fn(),
}));
jest.mock('react-native-qrcode-svg', () => 'QRCode');
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('react-native-haptic-feedback', () => ({
  __esModule: true,
  default: { trigger: jest.fn() },
  trigger: jest.fn(),
}));
jest.mock('react-native-camera-kit', () => ({
  Camera: 'Camera',
  CameraType: { Back: 'back', Front: 'front' },
}));
jest.mock('react-native-nitro-tor', () => ({
  RnTor: {
    startTorIfNotRunning: jest.fn().mockResolvedValue({
      is_success: true,
      onion_address: 'testonionaddress.onion:9050',
      control: '127.0.0.1:9051',
      error_message: '',
    }),
    getServiceStatus: jest.fn().mockResolvedValue(1),
    deleteHiddenService: jest.fn().mockResolvedValue(true),
    shutdownService: jest.fn().mockResolvedValue(true),
  },
}));
