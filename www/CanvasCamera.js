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
    var context = document.getElementById('camera').getContext("2d");
    var camImage = new Image();
    camImage.onload = function() {
      context.drawImage(camImage, 0, 0);
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
