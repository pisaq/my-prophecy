#ifndef MY_PHOPHECY_MULTITOUCH_SUPPORT_H
#define MY_PHOPHECY_MULTITOUCH_SUPPORT_H

#include <CoreFoundation/CoreFoundation.h>

typedef struct { float x, y; } MTPoint;
typedef struct { MTPoint position, velocity; } MTVector;

enum {
  MTTouchStateNotTracking = 0,
  MTTouchStateStartInRange = 1,
  MTTouchStateHoverInRange = 2,
  MTTouchStateMakeTouch = 3,
  MTTouchStateTouching = 4,
  MTTouchStateBreakTouch = 5,
  MTTouchStateLingerInRange = 6,
  MTTouchStateOutOfRange = 7
};

typedef struct {
  int32_t frame;
  double timestamp;
  int32_t pathIndex;
  int32_t state;
  int32_t fingerID;
  int32_t handID;
  MTVector normalizedVector;
  float zTotal;
  int32_t field9;
  float angle;
  float majorAxis;
  float minorAxis;
  MTVector absoluteVector;
  int32_t field14;
  int32_t field15;
  float zDensity;
} MTTouch;

typedef void *MTDeviceRef;
typedef void (*MTFrameCallbackFunction)(
  MTDeviceRef device,
  MTTouch *touches,
  size_t numTouches,
  double timestamp,
  size_t frame
);

CFArrayRef MTDeviceCreateList(void);
MTDeviceRef MTDeviceCreateDefault(void);
void MTDeviceRelease(MTDeviceRef device);
bool MTDeviceIsRunning(MTDeviceRef device);
OSStatus MTDeviceStart(MTDeviceRef device, int mode);
OSStatus MTDeviceStop(MTDeviceRef device);
void MTRegisterContactFrameCallback(MTDeviceRef device, MTFrameCallbackFunction callback);
void MTUnregisterContactFrameCallback(MTDeviceRef device, MTFrameCallbackFunction callback);

#endif
