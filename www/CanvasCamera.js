//
//  CanvasCamera.js
//  PhoneGap iOS Cordova Plugin to capture Camera streaming into a HTML5 Canvas or an IMG tag.
//
//  Created by Diego Araos <d@wehack.it> on 12/29/12.
//
//  MIT License

function win (data) {
  cordova.logger.log('won!')
  cordova.logger.log(data)
}

function lose (error) {
  cordova.logger.log('Camera error.');
  cordova.logger.log(error);
}

CanvasCamera = {
  start: function(options) {
    // TODO: add support for options (fps, capture quality, capture format, etc.)
    cordova.exec(win, lose, "CanvasCamera", "startCapture", [""]);
  },
  capture: function(data) {
    var canvas =  document.getElementById('camera');
    var context = canvas.getContext("2d");
    var camImage = new Image();

    camImage.onload = function() {
      var imageh = 640, imagew = 480;
      var canvash = canvas.height, canvasw = canvas.width;

      var image_height_more = imageh > imagew;

      var image_new_h = 0, image_new_w = 0;
      if ( !image_height_more ){
        image_new_w = canvasw;
        image_new_h = imageh / imagew * image_new_w;
      } else {
        image_new_h = canvash;
        image_new_w = imagew / imageh * image_new_h;
      }

      context.drawImage(camImage, 0, 0, image_new_w, image_new_h);
    };
    CanvasCamera.capture = function(data) {
      camImage.src = data;
    };

     /*CanvasCamera.capture = function(data) {
       document.getElementById('camera').src = data;
     }
    */
  }
};
