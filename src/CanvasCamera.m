//
//  CanvasCamera.js
//  PhoneGap iOS Cordova Plugin to capture Camera streaming into a HTML5 Canvas or an IMG tag.
//
//  Created by Diego Araos <d@wehack.it> on 12/29/12.
//
//  MIT License

#import "CanvasCamera.h"

@implementation CanvasCamera

- (void)startCapture:(CDVInvokedUrlCommand*)command
{
    // TODO: add support for options (fps, capture quality, capture format, etc.)
    self.session = [[AVCaptureSession alloc] init];
    self.session.sessionPreset = AVCaptureSessionPreset640x480;

    self.device = [self getCamera];
    //self.device = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
    self.input = [AVCaptureDeviceInput deviceInputWithDevice:self.device error:nil];

    self.output = [[AVCaptureVideoDataOutput alloc] init];
    self.output.videoSettings = [NSDictionary dictionaryWithObject:[NSNumber numberWithInt:kCVPixelFormatType_32BGRA] forKey:(id)kCVPixelBufferPixelFormatTypeKey];

    dispatch_queue_t queue;
    queue = dispatch_queue_create("canvas_camera_queue", NULL);

    [self.output setSampleBufferDelegate:(id)self queue:queue];

    [self.session addInput:self.input];
    [self.session addOutput:self.output];

    [self.session startRunning];
    NSLog(@"starting canvas camera");
}

- (void)captureOutput:(AVCaptureOutput *)captureOutput didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer fromConnection:(AVCaptureConnection *)connection
{
    @autoreleasepool {

      [connection setVideoOrientation:AVCaptureVideoOrientationPortrait];

        CVImageBufferRef imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
        CVPixelBufferLockBaseAddress(imageBuffer,0);
        uint8_t *baseAddress = (uint8_t *)CVPixelBufferGetBaseAddress(imageBuffer);
        size_t bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer);
        size_t width = CVPixelBufferGetWidth(imageBuffer);
        size_t height = CVPixelBufferGetHeight(imageBuffer);

        CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
        CGContextRef newContext = CGBitmapContextCreate(baseAddress, width, height, 8, bytesPerRow, colorSpace, kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst);

        CGImageRef newImage = CGBitmapContextCreateImage(newContext);

        CGContextRelease(newContext);
        CGColorSpaceRelease(colorSpace);

        UIImage *image= [UIImage imageWithCGImage:newImage scale:1.0 orientation:UIImageOrientationUp];

        // UIImage => NSData
        NSData* binaryImageData = [[[NSData alloc] initWithData:UIImageJPEGRepresentation(image, 1.0)];
        
        
        // NSData => NSString
        NSString *binaryImageString = [[NSString alloc] initWithData:binaryImageData encoding:NSUTF8StringEncoding];
        
        NSLog(@"binaryImageString => %@", binaryImageString);
        
        // NSString => javascript
        NSString *javascript = @"CanvasCamera.capture('";
        //javascript = [javascript stringByAppendingString:binaryImageString];
        javascript = [javascript stringByAppendingString:@"');"];
        
        NSLog(@"javascript => %@", javascript);

        
        [self.webView performSelectorOnMainThread:@selector(stringByEvaluatingJavaScriptFromString:) withObject:javascript waitUntilDone:YES];
        CGImageRelease(newImage);
        CVPixelBufferUnlockBaseAddress(imageBuffer,0);
    }
}

-(AVCaptureDevice *)getCamera{
  AVCaptureDevice *captureDevice = nil;
  captureDevice = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
  return captureDevice;
}

-(AVCaptureDevice *)frontFacingCameraIfAvailable
{
    NSArray *videoDevices = [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo];
    AVCaptureDevice *captureDevice = nil;
    for (AVCaptureDevice *device in videoDevices)
    {
        if (device.position == AVCaptureDevicePositionFront)
        {
            captureDevice = device;
            break;
        }
    }

    //  couldn't find one on the front, so just get the default video device.
    if ( ! captureDevice)
    {
        captureDevice = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
    }

    return captureDevice;
}
@end
