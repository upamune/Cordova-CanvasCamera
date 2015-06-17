/**
 * @license
 * Copyright 2015 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
function loadURLasArrayBuffer(path, callback) {
  if (path.indexOf("data:") === 0) {
    var offset = path.indexOf("base64,") + 7;
    var data = atob(path.substring(offset));
    var arr = new Uint8Array(data.length);
    for (var i = data.length - 1; i >= 0; i--) {
      arr[i] = data.charCodeAt(i);
    }
    callback(arr.buffer);
    return;
  }
  var xhr = new XMLHttpRequest();
  xhr.open("GET", path, true);
  xhr.responseType = "arraybuffer";
  xhr.onload = function() {
    callback(xhr.response);
  };
  xhr.send(null);
}

var JpegImage = function jpegImage() {
  function JpegImage() {
    this._src = null;
    this._parser = new PDFJS.JpegImage();
    this.onload = null;
  }
  JpegImage.prototype = {
    get src() {
      return this._src;
    },
    set src(value) {
      this.load(value);
    },
    get width() {
      return this._parser.width;
    },
    get height() {
      return this._parser.height;
    },
    load: function load(path) {
      this._src = path;
      loadURLasArrayBuffer(path, function(buffer) {
        this.parse(new Uint8Array(buffer));
        if (this.onload) {
          this.onload();
        }
      }.bind(this));
    },
    parse: function(data) {
      this._parser.parse(data);
    },
    getData: function(width, height) {
      return this._parser.getData(width, height, false);
    },
    copyToImageData: function copyToImageData(imageData) {
      if (this._parser.numComponents === 2 || this._parser.numComponents > 4) {
        throw new Error("Unsupported amount of components");
      }
      var width = imageData.width, height = imageData.height;
      var imageDataBytes = width * height * 4;
      var imageDataArray = imageData.data;
      var i, j;
      if (this._parser.numComponents === 1) {
        var values = this._parser.getData(width, height, false);
        for (i = 0, j = 0; i < imageDataBytes; ) {
          var value = values[j++];
          imageDataArray[i++] = value;
          imageDataArray[i++] = value;
          imageDataArray[i++] = value;
          imageDataArray[i++] = 255;
        }
        return;
      }
      var rgb = this._parser.getData(width, height, true);
      for (i = 0, j = 0; i < imageDataBytes; ) {
        imageDataArray[i++] = rgb[j++];
        imageDataArray[i++] = rgb[j++];
        imageDataArray[i++] = rgb[j++];
        imageDataArray[i++] = 255;
      }
    }
  };
  return JpegImage;
}();

if (typeof exports === "function") {
  module.exports = {
    JpegImage: JpegImage,
    JpegDecoder: JpegDecoder,
    JpxDecoder: JpxDecoder,
    Jbig2Decoder: Jbig2Decoder
  };
}

var PDFJS;

(function(PDFJS) {
  "use strict";
  var JpegImage = function jpegImage() {
    var dctZigZag = new Uint8Array([ 0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63 ]);
    var dctCos1 = 4017;
    var dctSin1 = 799;
    var dctCos3 = 3406;
    var dctSin3 = 2276;
    var dctCos6 = 1567;
    var dctSin6 = 3784;
    var dctSqrt2 = 5793;
    var dctSqrt1d2 = 2896;
    function constructor() {}
    function buildHuffmanTable(codeLengths, values) {
      var k = 0, code = [], i, j, length = 16;
      while (length > 0 && !codeLengths[length - 1]) {
        length--;
      }
      code.push({
        children: [],
        index: 0
      });
      var p = code[0], q;
      for (i = 0; i < length; i++) {
        for (j = 0; j < codeLengths[i]; j++) {
          p = code.pop();
          p.children[p.index] = values[k];
          while (p.index > 0) {
            p = code.pop();
          }
          p.index++;
          code.push(p);
          while (code.length <= i) {
            code.push(q = {
              children: [],
              index: 0
            });
            p.children[p.index] = q.children;
            p = q;
          }
          k++;
        }
        if (i + 1 < length) {
          code.push(q = {
            children: [],
            index: 0
          });
          p.children[p.index] = q.children;
          p = q;
        }
      }
      return code[0].children;
    }
    function getBlockBufferOffset(component, row, col) {
      return 64 * ((component.blocksPerLine + 1) * row + col);
    }
    function decodeScan(data, offset, frame, components, resetInterval, spectralStart, spectralEnd, successivePrev, successive) {
      var precision = frame.precision;
      var samplesPerLine = frame.samplesPerLine;
      var scanLines = frame.scanLines;
      var mcusPerLine = frame.mcusPerLine;
      var progressive = frame.progressive;
      var maxH = frame.maxH, maxV = frame.maxV;
      var startOffset = offset, bitsData = 0, bitsCount = 0;
      function readBit() {
        if (bitsCount > 0) {
          bitsCount--;
          return bitsData >> bitsCount & 1;
        }
        bitsData = data[offset++];
        if (bitsData === 255) {
          var nextByte = data[offset++];
          if (nextByte) {
            throw "unexpected marker: " + (bitsData << 8 | nextByte).toString(16);
          }
        }
        bitsCount = 7;
        return bitsData >>> 7;
      }
      function decodeHuffman(tree) {
        var node = tree;
        while (true) {
          node = node[readBit()];
          if (typeof node === "number") {
            return node;
          }
          if (typeof node !== "object") {
            throw "invalid huffman sequence";
          }
        }
      }
      function receive(length) {
        var n = 0;
        while (length > 0) {
          n = n << 1 | readBit();
          length--;
        }
        return n;
      }
      function receiveAndExtend(length) {
        if (length === 1) {
          return readBit() === 1 ? 1 : -1;
        }
        var n = receive(length);
        if (n >= 1 << length - 1) {
          return n;
        }
        return n + (-1 << length) + 1;
      }
      function decodeBaseline(component, offset) {
        var t = decodeHuffman(component.huffmanTableDC);
        var diff = t === 0 ? 0 : receiveAndExtend(t);
        component.blockData[offset] = component.pred += diff;
        var k = 1;
        while (k < 64) {
          var rs = decodeHuffman(component.huffmanTableAC);
          var s = rs & 15, r = rs >> 4;
          if (s === 0) {
            if (r < 15) {
              break;
            }
            k += 16;
            continue;
          }
          k += r;
          var z = dctZigZag[k];
          component.blockData[offset + z] = receiveAndExtend(s);
          k++;
        }
      }
      function decodeDCFirst(component, offset) {
        var t = decodeHuffman(component.huffmanTableDC);
        var diff = t === 0 ? 0 : receiveAndExtend(t) << successive;
        component.blockData[offset] = component.pred += diff;
      }
      function decodeDCSuccessive(component, offset) {
        component.blockData[offset] |= readBit() << successive;
      }
      var eobrun = 0;
      function decodeACFirst(component, offset) {
        if (eobrun > 0) {
          eobrun--;
          return;
        }
        var k = spectralStart, e = spectralEnd;
        while (k <= e) {
          var rs = decodeHuffman(component.huffmanTableAC);
          var s = rs & 15, r = rs >> 4;
          if (s === 0) {
            if (r < 15) {
              eobrun = receive(r) + (1 << r) - 1;
              break;
            }
            k += 16;
            continue;
          }
          k += r;
          var z = dctZigZag[k];
          component.blockData[offset + z] = receiveAndExtend(s) * (1 << successive);
          k++;
        }
      }
      var successiveACState = 0, successiveACNextValue;
      function decodeACSuccessive(component, offset) {
        var k = spectralStart;
        var e = spectralEnd;
        var r = 0;
        var s;
        var rs;
        while (k <= e) {
          var z = dctZigZag[k];
          switch (successiveACState) {
            case 0:
              rs = decodeHuffman(component.huffmanTableAC);
              s = rs & 15;
              r = rs >> 4;
              if (s === 0) {
                if (r < 15) {
                  eobrun = receive(r) + (1 << r);
                  successiveACState = 4;
                } else {
                  r = 16;
                  successiveACState = 1;
                }
              } else {
                if (s !== 1) {
                  throw "invalid ACn encoding";
                }
                successiveACNextValue = receiveAndExtend(s);
                successiveACState = r ? 2 : 3;
              }
              continue;

            case 1:
            case 2:
              if (component.blockData[offset + z]) {
                component.blockData[offset + z] += readBit() << successive;
              } else {
                r--;
                if (r === 0) {
                  successiveACState = successiveACState === 2 ? 3 : 0;
                }
              }
              break;

            case 3:
              if (component.blockData[offset + z]) {
                component.blockData[offset + z] += readBit() << successive;
              } else {
                component.blockData[offset + z] = successiveACNextValue << successive;
                successiveACState = 0;
              }
              break;

            case 4:
              if (component.blockData[offset + z]) {
                component.blockData[offset + z] += readBit() << successive;
              }
              break;
          }
          k++;
        }
        if (successiveACState === 4) {
          eobrun--;
          if (eobrun === 0) {
            successiveACState = 0;
          }
        }
      }
      function decodeMcu(component, decode, mcu, row, col) {
        var mcuRow = mcu / mcusPerLine | 0;
        var mcuCol = mcu % mcusPerLine;
        var blockRow = mcuRow * component.v + row;
        var blockCol = mcuCol * component.h + col;
        var offset = getBlockBufferOffset(component, blockRow, blockCol);
        decode(component, offset);
      }
      function decodeBlock(component, decode, mcu) {
        var blockRow = mcu / component.blocksPerLine | 0;
        var blockCol = mcu % component.blocksPerLine;
        var offset = getBlockBufferOffset(component, blockRow, blockCol);
        decode(component, offset);
      }
      var componentsLength = components.length;
      var component, i, j, k, n;
      var decodeFn;
      if (progressive) {
        if (spectralStart === 0) {
          decodeFn = successivePrev === 0 ? decodeDCFirst : decodeDCSuccessive;
        } else {
          decodeFn = successivePrev === 0 ? decodeACFirst : decodeACSuccessive;
        }
      } else {
        decodeFn = decodeBaseline;
      }
      var mcu = 0, marker;
      var mcuExpected;
      if (componentsLength === 1) {
        mcuExpected = components[0].blocksPerLine * components[0].blocksPerColumn;
      } else {
        mcuExpected = mcusPerLine * frame.mcusPerColumn;
      }
      if (!resetInterval) {
        resetInterval = mcuExpected;
      }
      var h, v;
      while (mcu < mcuExpected) {
        for (i = 0; i < componentsLength; i++) {
          components[i].pred = 0;
        }
        eobrun = 0;
        if (componentsLength === 1) {
          component = components[0];
          for (n = 0; n < resetInterval; n++) {
            decodeBlock(component, decodeFn, mcu);
            mcu++;
          }
        } else {
          for (n = 0; n < resetInterval; n++) {
            for (i = 0; i < componentsLength; i++) {
              component = components[i];
              h = component.h;
              v = component.v;
              for (j = 0; j < v; j++) {
                for (k = 0; k < h; k++) {
                  decodeMcu(component, decodeFn, mcu, j, k);
                }
              }
            }
            mcu++;
          }
        }
        bitsCount = 0;
        marker = data[offset] << 8 | data[offset + 1];
        if (marker <= 65280) {
          throw "marker was not found";
        }
        if (marker >= 65488 && marker <= 65495) {
          offset += 2;
        } else {
          break;
        }
      }
      return offset - startOffset;
    }
    function quantizeAndInverse(component, blockBufferOffset, p) {
      var qt = component.quantizationTable, blockData = component.blockData;
      var v0, v1, v2, v3, v4, v5, v6, v7;
      var p0, p1, p2, p3, p4, p5, p6, p7;
      var t;
      for (var row = 0; row < 64; row += 8) {
        p0 = blockData[blockBufferOffset + row];
        p1 = blockData[blockBufferOffset + row + 1];
        p2 = blockData[blockBufferOffset + row + 2];
        p3 = blockData[blockBufferOffset + row + 3];
        p4 = blockData[blockBufferOffset + row + 4];
        p5 = blockData[blockBufferOffset + row + 5];
        p6 = blockData[blockBufferOffset + row + 6];
        p7 = blockData[blockBufferOffset + row + 7];
        p0 *= qt[row];
        if ((p1 | p2 | p3 | p4 | p5 | p6 | p7) === 0) {
          t = dctSqrt2 * p0 + 512 >> 10;
          p[row] = t;
          p[row + 1] = t;
          p[row + 2] = t;
          p[row + 3] = t;
          p[row + 4] = t;
          p[row + 5] = t;
          p[row + 6] = t;
          p[row + 7] = t;
          continue;
        }
        p1 *= qt[row + 1];
        p2 *= qt[row + 2];
        p3 *= qt[row + 3];
        p4 *= qt[row + 4];
        p5 *= qt[row + 5];
        p6 *= qt[row + 6];
        p7 *= qt[row + 7];
        v0 = dctSqrt2 * p0 + 128 >> 8;
        v1 = dctSqrt2 * p4 + 128 >> 8;
        v2 = p2;
        v3 = p6;
        v4 = dctSqrt1d2 * (p1 - p7) + 128 >> 8;
        v7 = dctSqrt1d2 * (p1 + p7) + 128 >> 8;
        v5 = p3 << 4;
        v6 = p5 << 4;
        v0 = v0 + v1 + 1 >> 1;
        v1 = v0 - v1;
        t = v2 * dctSin6 + v3 * dctCos6 + 128 >> 8;
        v2 = v2 * dctCos6 - v3 * dctSin6 + 128 >> 8;
        v3 = t;
        v4 = v4 + v6 + 1 >> 1;
        v6 = v4 - v6;
        v7 = v7 + v5 + 1 >> 1;
        v5 = v7 - v5;
        v0 = v0 + v3 + 1 >> 1;
        v3 = v0 - v3;
        v1 = v1 + v2 + 1 >> 1;
        v2 = v1 - v2;
        t = v4 * dctSin3 + v7 * dctCos3 + 2048 >> 12;
        v4 = v4 * dctCos3 - v7 * dctSin3 + 2048 >> 12;
        v7 = t;
        t = v5 * dctSin1 + v6 * dctCos1 + 2048 >> 12;
        v5 = v5 * dctCos1 - v6 * dctSin1 + 2048 >> 12;
        v6 = t;
        p[row] = v0 + v7;
        p[row + 7] = v0 - v7;
        p[row + 1] = v1 + v6;
        p[row + 6] = v1 - v6;
        p[row + 2] = v2 + v5;
        p[row + 5] = v2 - v5;
        p[row + 3] = v3 + v4;
        p[row + 4] = v3 - v4;
      }
      for (var col = 0; col < 8; ++col) {
        p0 = p[col];
        p1 = p[col + 8];
        p2 = p[col + 16];
        p3 = p[col + 24];
        p4 = p[col + 32];
        p5 = p[col + 40];
        p6 = p[col + 48];
        p7 = p[col + 56];
        if ((p1 | p2 | p3 | p4 | p5 | p6 | p7) === 0) {
          t = dctSqrt2 * p0 + 8192 >> 14;
          t = t < -2040 ? 0 : t >= 2024 ? 255 : t + 2056 >> 4;
          blockData[blockBufferOffset + col] = t;
          blockData[blockBufferOffset + col + 8] = t;
          blockData[blockBufferOffset + col + 16] = t;
          blockData[blockBufferOffset + col + 24] = t;
          blockData[blockBufferOffset + col + 32] = t;
          blockData[blockBufferOffset + col + 40] = t;
          blockData[blockBufferOffset + col + 48] = t;
          blockData[blockBufferOffset + col + 56] = t;
          continue;
        }
        v0 = dctSqrt2 * p0 + 2048 >> 12;
        v1 = dctSqrt2 * p4 + 2048 >> 12;
        v2 = p2;
        v3 = p6;
        v4 = dctSqrt1d2 * (p1 - p7) + 2048 >> 12;
        v7 = dctSqrt1d2 * (p1 + p7) + 2048 >> 12;
        v5 = p3;
        v6 = p5;
        v0 = (v0 + v1 + 1 >> 1) + 4112;
        v1 = v0 - v1;
        t = v2 * dctSin6 + v3 * dctCos6 + 2048 >> 12;
        v2 = v2 * dctCos6 - v3 * dctSin6 + 2048 >> 12;
        v3 = t;
        v4 = v4 + v6 + 1 >> 1;
        v6 = v4 - v6;
        v7 = v7 + v5 + 1 >> 1;
        v5 = v7 - v5;
        v0 = v0 + v3 + 1 >> 1;
        v3 = v0 - v3;
        v1 = v1 + v2 + 1 >> 1;
        v2 = v1 - v2;
        t = v4 * dctSin3 + v7 * dctCos3 + 2048 >> 12;
        v4 = v4 * dctCos3 - v7 * dctSin3 + 2048 >> 12;
        v7 = t;
        t = v5 * dctSin1 + v6 * dctCos1 + 2048 >> 12;
        v5 = v5 * dctCos1 - v6 * dctSin1 + 2048 >> 12;
        v6 = t;
        p0 = v0 + v7;
        p7 = v0 - v7;
        p1 = v1 + v6;
        p6 = v1 - v6;
        p2 = v2 + v5;
        p5 = v2 - v5;
        p3 = v3 + v4;
        p4 = v3 - v4;
        p0 = p0 < 16 ? 0 : p0 >= 4080 ? 255 : p0 >> 4;
        p1 = p1 < 16 ? 0 : p1 >= 4080 ? 255 : p1 >> 4;
        p2 = p2 < 16 ? 0 : p2 >= 4080 ? 255 : p2 >> 4;
        p3 = p3 < 16 ? 0 : p3 >= 4080 ? 255 : p3 >> 4;
        p4 = p4 < 16 ? 0 : p4 >= 4080 ? 255 : p4 >> 4;
        p5 = p5 < 16 ? 0 : p5 >= 4080 ? 255 : p5 >> 4;
        p6 = p6 < 16 ? 0 : p6 >= 4080 ? 255 : p6 >> 4;
        p7 = p7 < 16 ? 0 : p7 >= 4080 ? 255 : p7 >> 4;
        blockData[blockBufferOffset + col] = p0;
        blockData[blockBufferOffset + col + 8] = p1;
        blockData[blockBufferOffset + col + 16] = p2;
        blockData[blockBufferOffset + col + 24] = p3;
        blockData[blockBufferOffset + col + 32] = p4;
        blockData[blockBufferOffset + col + 40] = p5;
        blockData[blockBufferOffset + col + 48] = p6;
        blockData[blockBufferOffset + col + 56] = p7;
      }
    }
    function buildComponentData(frame, component) {
      var blocksPerLine = component.blocksPerLine;
      var blocksPerColumn = component.blocksPerColumn;
      var computationBuffer = new Int16Array(64);
      for (var blockRow = 0; blockRow < blocksPerColumn; blockRow++) {
        for (var blockCol = 0; blockCol < blocksPerLine; blockCol++) {
          var offset = getBlockBufferOffset(component, blockRow, blockCol);
          quantizeAndInverse(component, offset, computationBuffer);
        }
      }
      return component.blockData;
    }
    function clamp0to255(a) {
      return a <= 0 ? 0 : a >= 255 ? 255 : a;
    }
    constructor.prototype = {
      parse: function parse(data) {
        function readUint16() {
          var value = data[offset] << 8 | data[offset + 1];
          offset += 2;
          return value;
        }
        function readDataBlock() {
          var length = readUint16();
          var array = data.subarray(offset, offset + length - 2);
          offset += array.length;
          return array;
        }
        function prepareComponents(frame) {
          var mcusPerLine = Math.ceil(frame.samplesPerLine / 8 / frame.maxH);
          var mcusPerColumn = Math.ceil(frame.scanLines / 8 / frame.maxV);
          for (var i = 0; i < frame.components.length; i++) {
            component = frame.components[i];
            var blocksPerLine = Math.ceil(Math.ceil(frame.samplesPerLine / 8) * component.h / frame.maxH);
            var blocksPerColumn = Math.ceil(Math.ceil(frame.scanLines / 8) * component.v / frame.maxV);
            var blocksPerLineForMcu = mcusPerLine * component.h;
            var blocksPerColumnForMcu = mcusPerColumn * component.v;
            var blocksBufferSize = 64 * blocksPerColumnForMcu * (blocksPerLineForMcu + 1);
            component.blockData = new Int16Array(blocksBufferSize);
            component.blocksPerLine = blocksPerLine;
            component.blocksPerColumn = blocksPerColumn;
          }
          frame.mcusPerLine = mcusPerLine;
          frame.mcusPerColumn = mcusPerColumn;
        }
        var offset = 0, length = data.length;
        var jfif = null;
        var adobe = null;
        var pixels = null;
        var frame, resetInterval;
        var quantizationTables = [];
        var huffmanTablesAC = [], huffmanTablesDC = [];
        var fileMarker = readUint16();
        if (fileMarker !== 65496) {
          throw "SOI not found";
        }
        fileMarker = readUint16();
        while (fileMarker !== 65497) {
          var i, j, l;
          switch (fileMarker) {
            case 65504:
            case 65505:
            case 65506:
            case 65507:
            case 65508:
            case 65509:
            case 65510:
            case 65511:
            case 65512:
            case 65513:
            case 65514:
            case 65515:
            case 65516:
            case 65517:
            case 65518:
            case 65519:
            case 65534:
              var appData = readDataBlock();
              if (fileMarker === 65504) {
                if (appData[0] === 74 && appData[1] === 70 && appData[2] === 73 && appData[3] === 70 && appData[4] === 0) {
                  jfif = {
                    version: {
                      major: appData[5],
                      minor: appData[6]
                    },
                    densityUnits: appData[7],
                    xDensity: appData[8] << 8 | appData[9],
                    yDensity: appData[10] << 8 | appData[11],
                    thumbWidth: appData[12],
                    thumbHeight: appData[13],
                    thumbData: appData.subarray(14, 14 + 3 * appData[12] * appData[13])
                  };
                }
              }
              if (fileMarker === 65518) {
                if (appData[0] === 65 && appData[1] === 100 && appData[2] === 111 && appData[3] === 98 && appData[4] === 101 && appData[5] === 0) {
                  adobe = {
                    version: appData[6],
                    flags0: appData[7] << 8 | appData[8],
                    flags1: appData[9] << 8 | appData[10],
                    transformCode: appData[11]
                  };
                }
              }
              break;

            case 65499:
              var quantizationTablesLength = readUint16();
              var quantizationTablesEnd = quantizationTablesLength + offset - 2;
              var z;
              while (offset < quantizationTablesEnd) {
                var quantizationTableSpec = data[offset++];
                var tableData = new Uint16Array(64);
                if (quantizationTableSpec >> 4 === 0) {
                  for (j = 0; j < 64; j++) {
                    z = dctZigZag[j];
                    tableData[z] = data[offset++];
                  }
                } else if (quantizationTableSpec >> 4 === 1) {
                  for (j = 0; j < 64; j++) {
                    z = dctZigZag[j];
                    tableData[z] = readUint16();
                  }
                } else {
                  throw "DQT: invalid table spec";
                }
                quantizationTables[quantizationTableSpec & 15] = tableData;
              }
              break;

            case 65472:
            case 65473:
            case 65474:
              if (frame) {
                throw "Only single frame JPEGs supported";
              }
              readUint16();
              frame = {};
              frame.extended = fileMarker === 65473;
              frame.progressive = fileMarker === 65474;
              frame.precision = data[offset++];
              frame.scanLines = readUint16();
              frame.samplesPerLine = readUint16();
              frame.components = [];
              frame.componentIds = {};
              var componentsCount = data[offset++], componentId;
              var maxH = 0, maxV = 0;
              for (i = 0; i < componentsCount; i++) {
                componentId = data[offset];
                var h = data[offset + 1] >> 4;
                var v = data[offset + 1] & 15;
                if (maxH < h) {
                  maxH = h;
                }
                if (maxV < v) {
                  maxV = v;
                }
                var qId = data[offset + 2];
                l = frame.components.push({
                  h: h,
                  v: v,
                  quantizationTable: quantizationTables[qId]
                });
                frame.componentIds[componentId] = l - 1;
                offset += 3;
              }
              frame.maxH = maxH;
              frame.maxV = maxV;
              prepareComponents(frame);
              break;

            case 65476:
              var huffmanLength = readUint16();
              for (i = 2; i < huffmanLength; ) {
                var huffmanTableSpec = data[offset++];
                var codeLengths = new Uint8Array(16);
                var codeLengthSum = 0;
                for (j = 0; j < 16; j++, offset++) {
                  codeLengthSum += codeLengths[j] = data[offset];
                }
                var huffmanValues = new Uint8Array(codeLengthSum);
                for (j = 0; j < codeLengthSum; j++, offset++) {
                  huffmanValues[j] = data[offset];
                }
                i += 17 + codeLengthSum;
                (huffmanTableSpec >> 4 === 0 ? huffmanTablesDC : huffmanTablesAC)[huffmanTableSpec & 15] = buildHuffmanTable(codeLengths, huffmanValues);
              }
              break;

            case 65501:
              readUint16();
              resetInterval = readUint16();
              break;

            case 65498:
              var scanLength = readUint16();
              var selectorsCount = data[offset++];
              var components = [], component;
              for (i = 0; i < selectorsCount; i++) {
                var componentIndex = frame.componentIds[data[offset++]];
                component = frame.components[componentIndex];
                var tableSpec = data[offset++];
                component.huffmanTableDC = huffmanTablesDC[tableSpec >> 4];
                component.huffmanTableAC = huffmanTablesAC[tableSpec & 15];
                components.push(component);
              }
              var spectralStart = data[offset++];
              var spectralEnd = data[offset++];
              var successiveApproximation = data[offset++];
              var processed = decodeScan(data, offset, frame, components, resetInterval, spectralStart, spectralEnd, successiveApproximation >> 4, successiveApproximation & 15);
              offset += processed;
              break;

            case 65535:
              if (data[offset] !== 255) {
                offset--;
              }
              break;

            default:
              if (data[offset - 3] === 255 && data[offset - 2] >= 192 && data[offset - 2] <= 254) {
                offset -= 3;
                break;
              }
              throw "unknown JPEG marker " + fileMarker.toString(16);
          }
          fileMarker = readUint16();
        }
        this.width = frame.samplesPerLine;
        this.height = frame.scanLines;
        this.jfif = jfif;
        this.adobe = adobe;
        this.components = [];
        for (i = 0; i < frame.components.length; i++) {
          component = frame.components[i];
          this.components.push({
            output: buildComponentData(frame, component),
            scaleX: component.h / frame.maxH,
            scaleY: component.v / frame.maxV,
            blocksPerLine: component.blocksPerLine,
            blocksPerColumn: component.blocksPerColumn
          });
        }
        this.numComponents = this.components.length;
      },
      _getLinearizedBlockData: function getLinearizedBlockData(width, height) {
        var scaleX = this.width / width, scaleY = this.height / height;
        var component, componentScaleX, componentScaleY, blocksPerScanline;
        var x, y, i, j, k;
        var index;
        var offset = 0;
        var output;
        var numComponents = this.components.length;
        var dataLength = width * height * numComponents;
        var data = new Uint8Array(dataLength);
        var xScaleBlockOffset = new Uint32Array(width);
        var mask3LSB = 4294967288;
        for (i = 0; i < numComponents; i++) {
          component = this.components[i];
          componentScaleX = component.scaleX * scaleX;
          componentScaleY = component.scaleY * scaleY;
          offset = i;
          output = component.output;
          blocksPerScanline = component.blocksPerLine + 1 << 3;
          for (x = 0; x < width; x++) {
            j = 0 | x * componentScaleX;
            xScaleBlockOffset[x] = (j & mask3LSB) << 3 | j & 7;
          }
          for (y = 0; y < height; y++) {
            j = 0 | y * componentScaleY;
            index = blocksPerScanline * (j & mask3LSB) | (j & 7) << 3;
            for (x = 0; x < width; x++) {
              data[offset] = output[index + xScaleBlockOffset[x]];
              offset += numComponents;
            }
          }
        }
        var transform = this.decodeTransform;
        if (transform) {
          for (i = 0; i < dataLength; ) {
            for (j = 0, k = 0; j < numComponents; j++, i++, k += 2) {
              data[i] = (data[i] * transform[k] >> 8) + transform[k + 1];
            }
          }
        }
        return data;
      },
      _isColorConversionNeeded: function isColorConversionNeeded() {
        if (this.adobe && this.adobe.transformCode) {
          return true;
        } else if (this.numComponents === 3) {
          return true;
        } else {
          return false;
        }
      },
      _convertYccToRgb: function convertYccToRgb(data) {
        var Y, Cb, Cr;
        for (var i = 0, length = data.length; i < length; i += 3) {
          Y = data[i];
          Cb = data[i + 1];
          Cr = data[i + 2];
          data[i] = clamp0to255(Y - 179.456 + 1.402 * Cr);
          data[i + 1] = clamp0to255(Y + 135.459 - .344 * Cb - .714 * Cr);
          data[i + 2] = clamp0to255(Y - 226.816 + 1.772 * Cb);
        }
        return data;
      },
      _convertYcckToRgb: function convertYcckToRgb(data) {
        var Y, Cb, Cr, k;
        var offset = 0;
        for (var i = 0, length = data.length; i < length; i += 4) {
          Y = data[i];
          Cb = data[i + 1];
          Cr = data[i + 2];
          k = data[i + 3];
          var r = -122.67195406894 + Cb * (-660635669420364e-19 * Cb + .000437130475926232 * Cr - 54080610064599e-18 * Y + .00048449797120281 * k - .154362151871126) + Cr * (-.000957964378445773 * Cr + .000817076911346625 * Y - .00477271405408747 * k + 1.53380253221734) + Y * (.000961250184130688 * Y - .00266257332283933 * k + .48357088451265) + k * (-.000336197177618394 * k + .484791561490776);
          var g = 107.268039397724 + Cb * (219927104525741e-19 * Cb - .000640992018297945 * Cr + .000659397001245577 * Y + .000426105652938837 * k - .176491792462875) + Cr * (-.000778269941513683 * Cr + .00130872261408275 * Y + .000770482631801132 * k - .151051492775562) + Y * (.00126935368114843 * Y - .00265090189010898 * k + .25802910206845) + k * (-.000318913117588328 * k - .213742400323665);
          var b = -20.810012546947 + Cb * (-.000570115196973677 * Cb - 263409051004589e-19 * Cr + .0020741088115012 * Y - .00288260236853442 * k + .814272968359295) + Cr * (-153496057440975e-19 * Cr - .000132689043961446 * Y + .000560833691242812 * k - .195152027534049) + Y * (.00174418132927582 * Y - .00255243321439347 * k + .116935020465145) + k * (-.000343531996510555 * k + .24165260232407);
          data[offset++] = clamp0to255(r);
          data[offset++] = clamp0to255(g);
          data[offset++] = clamp0to255(b);
        }
        return data;
      },
      _convertYcckToCmyk: function convertYcckToCmyk(data) {
        var Y, Cb, Cr;
        for (var i = 0, length = data.length; i < length; i += 4) {
          Y = data[i];
          Cb = data[i + 1];
          Cr = data[i + 2];
          data[i] = clamp0to255(434.456 - Y - 1.402 * Cr);
          data[i + 1] = clamp0to255(119.541 - Y + .344 * Cb + .714 * Cr);
          data[i + 2] = clamp0to255(481.816 - Y - 1.772 * Cb);
        }
        return data;
      },
      _convertCmykToRgb: function convertCmykToRgb(data) {
        var c, m, y, k;
        var offset = 0;
        var min = -255 * 255 * 255;
        var scale = 1 / 255 / 255;
        for (var i = 0, length = data.length; i < length; i += 4) {
          c = data[i];
          m = data[i + 1];
          y = data[i + 2];
          k = data[i + 3];
          var r = c * (-4.387332384609988 * c + 54.48615194189176 * m + 18.82290502165302 * y + 212.25662451639585 * k - 72734.4411664936) + m * (1.7149763477362134 * m - 5.6096736904047315 * y - 17.873870861415444 * k - 1401.7366389350734) + y * (-2.5217340131683033 * y - 21.248923337353073 * k + 4465.541406466231) - k * (21.86122147463605 * k + 48317.86113160301);
          var g = c * (8.841041422036149 * c + 60.118027045597366 * m + 6.871425592049007 * y + 31.159100130055922 * k - 20220.756542821975) + m * (-15.310361306967817 * m + 17.575251261109482 * y + 131.35250912493976 * k - 48691.05921601825) + y * (4.444339102852739 * y + 9.8632861493405 * k - 6341.191035517494) - k * (20.737325471181034 * k + 47890.15695978492);
          var b = c * (.8842522430003296 * c + 8.078677503112928 * m + 30.89978309703729 * y - .23883238689178934 * k - 3616.812083916688) + m * (10.49593273432072 * m + 63.02378494754052 * y + 50.606957656360734 * k - 28620.90484698408) + y * (.03296041114873217 * y + 115.60384449646641 * k - 49363.43385999684) - k * (22.33816807309886 * k + 45932.16563550634);
          data[offset++] = r >= 0 ? 255 : r <= min ? 0 : 255 + r * scale | 0;
          data[offset++] = g >= 0 ? 255 : g <= min ? 0 : 255 + g * scale | 0;
          data[offset++] = b >= 0 ? 255 : b <= min ? 0 : 255 + b * scale | 0;
        }
        return data;
      },
      getData: function getData(width, height, forceRGBoutput) {
        if (this.numComponents > 4) {
          throw "Unsupported color mode";
        }
        var data = this._getLinearizedBlockData(width, height);
        if (this.numComponents === 3) {
          return this._convertYccToRgb(data);
        } else if (this.numComponents === 4) {
          if (this._isColorConversionNeeded()) {
            if (forceRGBoutput) {
              return this._convertYcckToRgb(data);
            } else {
              return this._convertYcckToCmyk(data);
            }
          } else if (forceRGBoutput) {
            return this._convertCmykToRgb(data);
          }
        }
        return data;
      }
    };
    return constructor;
  }();
  "use strict";
  var ArithmeticDecoder = function ArithmeticDecoderClosure() {
    var QeTable = [ {
      qe: 22017,
      nmps: 1,
      nlps: 1,
      switchFlag: 1
    }, {
      qe: 13313,
      nmps: 2,
      nlps: 6,
      switchFlag: 0
    }, {
      qe: 6145,
      nmps: 3,
      nlps: 9,
      switchFlag: 0
    }, {
      qe: 2753,
      nmps: 4,
      nlps: 12,
      switchFlag: 0
    }, {
      qe: 1313,
      nmps: 5,
      nlps: 29,
      switchFlag: 0
    }, {
      qe: 545,
      nmps: 38,
      nlps: 33,
      switchFlag: 0
    }, {
      qe: 22017,
      nmps: 7,
      nlps: 6,
      switchFlag: 1
    }, {
      qe: 21505,
      nmps: 8,
      nlps: 14,
      switchFlag: 0
    }, {
      qe: 18433,
      nmps: 9,
      nlps: 14,
      switchFlag: 0
    }, {
      qe: 14337,
      nmps: 10,
      nlps: 14,
      switchFlag: 0
    }, {
      qe: 12289,
      nmps: 11,
      nlps: 17,
      switchFlag: 0
    }, {
      qe: 9217,
      nmps: 12,
      nlps: 18,
      switchFlag: 0
    }, {
      qe: 7169,
      nmps: 13,
      nlps: 20,
      switchFlag: 0
    }, {
      qe: 5633,
      nmps: 29,
      nlps: 21,
      switchFlag: 0
    }, {
      qe: 22017,
      nmps: 15,
      nlps: 14,
      switchFlag: 1
    }, {
      qe: 21505,
      nmps: 16,
      nlps: 14,
      switchFlag: 0
    }, {
      qe: 20737,
      nmps: 17,
      nlps: 15,
      switchFlag: 0
    }, {
      qe: 18433,
      nmps: 18,
      nlps: 16,
      switchFlag: 0
    }, {
      qe: 14337,
      nmps: 19,
      nlps: 17,
      switchFlag: 0
    }, {
      qe: 13313,
      nmps: 20,
      nlps: 18,
      switchFlag: 0
    }, {
      qe: 12289,
      nmps: 21,
      nlps: 19,
      switchFlag: 0
    }, {
      qe: 10241,
      nmps: 22,
      nlps: 19,
      switchFlag: 0
    }, {
      qe: 9217,
      nmps: 23,
      nlps: 20,
      switchFlag: 0
    }, {
      qe: 8705,
      nmps: 24,
      nlps: 21,
      switchFlag: 0
    }, {
      qe: 7169,
      nmps: 25,
      nlps: 22,
      switchFlag: 0
    }, {
      qe: 6145,
      nmps: 26,
      nlps: 23,
      switchFlag: 0
    }, {
      qe: 5633,
      nmps: 27,
      nlps: 24,
      switchFlag: 0
    }, {
      qe: 5121,
      nmps: 28,
      nlps: 25,
      switchFlag: 0
    }, {
      qe: 4609,
      nmps: 29,
      nlps: 26,
      switchFlag: 0
    }, {
      qe: 4353,
      nmps: 30,
      nlps: 27,
      switchFlag: 0
    }, {
      qe: 2753,
      nmps: 31,
      nlps: 28,
      switchFlag: 0
    }, {
      qe: 2497,
      nmps: 32,
      nlps: 29,
      switchFlag: 0
    }, {
      qe: 2209,
      nmps: 33,
      nlps: 30,
      switchFlag: 0
    }, {
      qe: 1313,
      nmps: 34,
      nlps: 31,
      switchFlag: 0
    }, {
      qe: 1089,
      nmps: 35,
      nlps: 32,
      switchFlag: 0
    }, {
      qe: 673,
      nmps: 36,
      nlps: 33,
      switchFlag: 0
    }, {
      qe: 545,
      nmps: 37,
      nlps: 34,
      switchFlag: 0
    }, {
      qe: 321,
      nmps: 38,
      nlps: 35,
      switchFlag: 0
    }, {
      qe: 273,
      nmps: 39,
      nlps: 36,
      switchFlag: 0
    }, {
      qe: 133,
      nmps: 40,
      nlps: 37,
      switchFlag: 0
    }, {
      qe: 73,
      nmps: 41,
      nlps: 38,
      switchFlag: 0
    }, {
      qe: 37,
      nmps: 42,
      nlps: 39,
      switchFlag: 0
    }, {
      qe: 21,
      nmps: 43,
      nlps: 40,
      switchFlag: 0
    }, {
      qe: 9,
      nmps: 44,
      nlps: 41,
      switchFlag: 0
    }, {
      qe: 5,
      nmps: 45,
      nlps: 42,
      switchFlag: 0
    }, {
      qe: 1,
      nmps: 45,
      nlps: 43,
      switchFlag: 0
    }, {
      qe: 22017,
      nmps: 46,
      nlps: 46,
      switchFlag: 0
    } ];
    function ArithmeticDecoder(data, start, end) {
      this.data = data;
      this.bp = start;
      this.dataEnd = end;
      this.chigh = data[start];
      this.clow = 0;
      this.byteIn();
      this.chigh = this.chigh << 7 & 65535 | this.clow >> 9 & 127;
      this.clow = this.clow << 7 & 65535;
      this.ct -= 7;
      this.a = 32768;
    }
    ArithmeticDecoder.prototype = {
      byteIn: function ArithmeticDecoder_byteIn() {
        var data = this.data;
        var bp = this.bp;
        if (data[bp] === 255) {
          var b1 = data[bp + 1];
          if (b1 > 143) {
            this.clow += 65280;
            this.ct = 8;
          } else {
            bp++;
            this.clow += data[bp] << 9;
            this.ct = 7;
            this.bp = bp;
          }
        } else {
          bp++;
          this.clow += bp < this.dataEnd ? data[bp] << 8 : 65280;
          this.ct = 8;
          this.bp = bp;
        }
        if (this.clow > 65535) {
          this.chigh += this.clow >> 16;
          this.clow &= 65535;
        }
      },
      readBit: function ArithmeticDecoder_readBit(contexts, pos) {
        var cx_index = contexts[pos] >> 1, cx_mps = contexts[pos] & 1;
        var qeTableIcx = QeTable[cx_index];
        var qeIcx = qeTableIcx.qe;
        var d;
        var a = this.a - qeIcx;
        if (this.chigh < qeIcx) {
          if (a < qeIcx) {
            a = qeIcx;
            d = cx_mps;
            cx_index = qeTableIcx.nmps;
          } else {
            a = qeIcx;
            d = 1 ^ cx_mps;
            if (qeTableIcx.switchFlag === 1) {
              cx_mps = d;
            }
            cx_index = qeTableIcx.nlps;
          }
        } else {
          this.chigh -= qeIcx;
          if ((a & 32768) !== 0) {
            this.a = a;
            return cx_mps;
          }
          if (a < qeIcx) {
            d = 1 ^ cx_mps;
            if (qeTableIcx.switchFlag === 1) {
              cx_mps = d;
            }
            cx_index = qeTableIcx.nlps;
          } else {
            d = cx_mps;
            cx_index = qeTableIcx.nmps;
          }
        }
        do {
          if (this.ct === 0) {
            this.byteIn();
          }
          a <<= 1;
          this.chigh = this.chigh << 1 & 65535 | this.clow >> 15 & 1;
          this.clow = this.clow << 1 & 65535;
          this.ct--;
        } while ((a & 32768) === 0);
        this.a = a;
        contexts[pos] = cx_index << 1 | cx_mps;
        return d;
      }
    };
    return ArithmeticDecoder;
  }();
  "use strict";
  var JpxImage = function JpxImageClosure() {
    var SubbandsGainLog2 = {
      LL: 0,
      LH: 1,
      HL: 1,
      HH: 2
    };
    function JpxImage() {
      this.failOnCorruptedImage = false;
    }
    JpxImage.prototype = {
      parse: function JpxImage_parse(data) {
        var head = readUint16(data, 0);
        if (head === 65359) {
          this.parseCodestream(data, 0, data.length);
          return;
        }
        var position = 0, length = data.length;
        while (position < length) {
          var headerSize = 8;
          var lbox = readUint32(data, position);
          var tbox = readUint32(data, position + 4);
          position += headerSize;
          if (lbox === 1) {
            lbox = readUint32(data, position) * 4294967296 + readUint32(data, position + 4);
            position += 8;
            headerSize += 8;
          }
          if (lbox === 0) {
            lbox = length - position + headerSize;
          }
          if (lbox < headerSize) {
            throw new Error("JPX Error: Invalid box field size");
          }
          var dataLength = lbox - headerSize;
          var jumpDataLength = true;
          switch (tbox) {
            case 1785737832:
              jumpDataLength = false;
              break;

            case 1668246642:
              var method = data[position];
              var precedence = data[position + 1];
              var approximation = data[position + 2];
              if (method === 1) {
                var colorspace = readUint32(data, position + 3);
                switch (colorspace) {
                  case 16:
                  case 17:
                  case 18:
                    break;

                  default:
                    warn("Unknown colorspace " + colorspace);
                    break;
                }
              } else if (method === 2) {
                info("ICC profile not supported");
              }
              break;

            case 1785737827:
              this.parseCodestream(data, position, position + dataLength);
              break;

            case 1783636e3:
              if (218793738 !== readUint32(data, position)) {
                warn("Invalid JP2 signature");
              }
              break;

            case 1783634458:
            case 1718909296:
            case 1920099697:
            case 1919251232:
            case 1768449138:
              break;

            default:
              var headerType = String.fromCharCode(tbox >> 24 & 255, tbox >> 16 & 255, tbox >> 8 & 255, tbox & 255);
              warn("Unsupported header type " + tbox + " (" + headerType + ")");
              break;
          }
          if (jumpDataLength) {
            position += dataLength;
          }
        }
      },
      parseImageProperties: function JpxImage_parseImageProperties(stream) {
        var newByte = stream.getByte();
        while (newByte >= 0) {
          var oldByte = newByte;
          newByte = stream.getByte();
          var code = oldByte << 8 | newByte;
          if (code === 65361) {
            stream.skip(4);
            var Xsiz = stream.getInt32() >>> 0;
            var Ysiz = stream.getInt32() >>> 0;
            var XOsiz = stream.getInt32() >>> 0;
            var YOsiz = stream.getInt32() >>> 0;
            stream.skip(16);
            var Csiz = stream.getUint16();
            this.width = Xsiz - XOsiz;
            this.height = Ysiz - YOsiz;
            this.componentsCount = Csiz;
            this.bitsPerComponent = 8;
            return;
          }
        }
        throw new Error("JPX Error: No size marker found in JPX stream");
      },
      parseCodestream: function JpxImage_parseCodestream(data, start, end) {
        var context = {};
        try {
          var doNotRecover = false;
          var position = start;
          while (position + 1 < end) {
            var code = readUint16(data, position);
            position += 2;
            var length = 0, j, sqcd, spqcds, spqcdSize, scalarExpounded, tile;
            switch (code) {
              case 65359:
                context.mainHeader = true;
                break;

              case 65497:
                break;

              case 65361:
                length = readUint16(data, position);
                var siz = {};
                siz.Xsiz = readUint32(data, position + 4);
                siz.Ysiz = readUint32(data, position + 8);
                siz.XOsiz = readUint32(data, position + 12);
                siz.YOsiz = readUint32(data, position + 16);
                siz.XTsiz = readUint32(data, position + 20);
                siz.YTsiz = readUint32(data, position + 24);
                siz.XTOsiz = readUint32(data, position + 28);
                siz.YTOsiz = readUint32(data, position + 32);
                var componentsCount = readUint16(data, position + 36);
                siz.Csiz = componentsCount;
                var components = [];
                j = position + 38;
                for (var i = 0; i < componentsCount; i++) {
                  var component = {
                    precision: (data[j] & 127) + 1,
                    isSigned: !!(data[j] & 128),
                    XRsiz: data[j + 1],
                    YRsiz: data[j + 1]
                  };
                  calculateComponentDimensions(component, siz);
                  components.push(component);
                }
                context.SIZ = siz;
                context.components = components;
                calculateTileGrids(context, components);
                context.QCC = [];
                context.COC = [];
                break;

              case 65372:
                length = readUint16(data, position);
                var qcd = {};
                j = position + 2;
                sqcd = data[j++];
                switch (sqcd & 31) {
                  case 0:
                    spqcdSize = 8;
                    scalarExpounded = true;
                    break;

                  case 1:
                    spqcdSize = 16;
                    scalarExpounded = false;
                    break;

                  case 2:
                    spqcdSize = 16;
                    scalarExpounded = true;
                    break;

                  default:
                    throw new Error("JPX Error: Invalid SQcd value " + sqcd);
                }
                qcd.noQuantization = spqcdSize === 8;
                qcd.scalarExpounded = scalarExpounded;
                qcd.guardBits = sqcd >> 5;
                spqcds = [];
                while (j < length + position) {
                  var spqcd = {};
                  if (spqcdSize === 8) {
                    spqcd.epsilon = data[j++] >> 3;
                    spqcd.mu = 0;
                  } else {
                    spqcd.epsilon = data[j] >> 3;
                    spqcd.mu = (data[j] & 7) << 8 | data[j + 1];
                    j += 2;
                  }
                  spqcds.push(spqcd);
                }
                qcd.SPqcds = spqcds;
                if (context.mainHeader) {
                  context.QCD = qcd;
                } else {
                  context.currentTile.QCD = qcd;
                  context.currentTile.QCC = [];
                }
                break;

              case 65373:
                length = readUint16(data, position);
                var qcc = {};
                j = position + 2;
                var cqcc;
                if (context.SIZ.Csiz < 257) {
                  cqcc = data[j++];
                } else {
                  cqcc = readUint16(data, j);
                  j += 2;
                }
                sqcd = data[j++];
                switch (sqcd & 31) {
                  case 0:
                    spqcdSize = 8;
                    scalarExpounded = true;
                    break;

                  case 1:
                    spqcdSize = 16;
                    scalarExpounded = false;
                    break;

                  case 2:
                    spqcdSize = 16;
                    scalarExpounded = true;
                    break;

                  default:
                    throw new Error("JPX Error: Invalid SQcd value " + sqcd);
                }
                qcc.noQuantization = spqcdSize === 8;
                qcc.scalarExpounded = scalarExpounded;
                qcc.guardBits = sqcd >> 5;
                spqcds = [];
                while (j < length + position) {
                  spqcd = {};
                  if (spqcdSize === 8) {
                    spqcd.epsilon = data[j++] >> 3;
                    spqcd.mu = 0;
                  } else {
                    spqcd.epsilon = data[j] >> 3;
                    spqcd.mu = (data[j] & 7) << 8 | data[j + 1];
                    j += 2;
                  }
                  spqcds.push(spqcd);
                }
                qcc.SPqcds = spqcds;
                if (context.mainHeader) {
                  context.QCC[cqcc] = qcc;
                } else {
                  context.currentTile.QCC[cqcc] = qcc;
                }
                break;

              case 65362:
                length = readUint16(data, position);
                var cod = {};
                j = position + 2;
                var scod = data[j++];
                cod.entropyCoderWithCustomPrecincts = !!(scod & 1);
                cod.sopMarkerUsed = !!(scod & 2);
                cod.ephMarkerUsed = !!(scod & 4);
                cod.progressionOrder = data[j++];
                cod.layersCount = readUint16(data, j);
                j += 2;
                cod.multipleComponentTransform = data[j++];
                cod.decompositionLevelsCount = data[j++];
                cod.xcb = (data[j++] & 15) + 2;
                cod.ycb = (data[j++] & 15) + 2;
                var blockStyle = data[j++];
                cod.selectiveArithmeticCodingBypass = !!(blockStyle & 1);
                cod.resetContextProbabilities = !!(blockStyle & 2);
                cod.terminationOnEachCodingPass = !!(blockStyle & 4);
                cod.verticalyStripe = !!(blockStyle & 8);
                cod.predictableTermination = !!(blockStyle & 16);
                cod.segmentationSymbolUsed = !!(blockStyle & 32);
                cod.reversibleTransformation = data[j++];
                if (cod.entropyCoderWithCustomPrecincts) {
                  var precinctsSizes = [];
                  while (j < length + position) {
                    var precinctsSize = data[j++];
                    precinctsSizes.push({
                      PPx: precinctsSize & 15,
                      PPy: precinctsSize >> 4
                    });
                  }
                  cod.precinctsSizes = precinctsSizes;
                }
                var unsupported = [];
                if (cod.selectiveArithmeticCodingBypass) {
                  unsupported.push("selectiveArithmeticCodingBypass");
                }
                if (cod.resetContextProbabilities) {
                  unsupported.push("resetContextProbabilities");
                }
                if (cod.terminationOnEachCodingPass) {
                  unsupported.push("terminationOnEachCodingPass");
                }
                if (cod.verticalyStripe) {
                  unsupported.push("verticalyStripe");
                }
                if (cod.predictableTermination) {
                  unsupported.push("predictableTermination");
                }
                if (unsupported.length > 0) {
                  doNotRecover = true;
                  throw new Error("JPX Error: Unsupported COD options (" + unsupported.join(", ") + ")");
                }
                if (context.mainHeader) {
                  context.COD = cod;
                } else {
                  context.currentTile.COD = cod;
                  context.currentTile.COC = [];
                }
                break;

              case 65424:
                length = readUint16(data, position);
                tile = {};
                tile.index = readUint16(data, position + 2);
                tile.length = readUint32(data, position + 4);
                tile.dataEnd = tile.length + position - 2;
                tile.partIndex = data[position + 8];
                tile.partsCount = data[position + 9];
                context.mainHeader = false;
                if (tile.partIndex === 0) {
                  tile.COD = context.COD;
                  tile.COC = context.COC.slice(0);
                  tile.QCD = context.QCD;
                  tile.QCC = context.QCC.slice(0);
                }
                context.currentTile = tile;
                break;

              case 65427:
                tile = context.currentTile;
                if (tile.partIndex === 0) {
                  initializeTile(context, tile.index);
                  buildPackets(context);
                }
                length = tile.dataEnd - position;
                parseTilePackets(context, data, position, length);
                break;

              case 65365:
              case 65367:
              case 65368:
              case 65380:
                length = readUint16(data, position);
                break;

              case 65363:
                throw new Error("JPX Error: Codestream code 0xFF53 (COC) is " + "not implemented");

              default:
                throw new Error("JPX Error: Unknown codestream code: " + code.toString(16));
            }
            position += length;
          }
        } catch (e) {
          if (doNotRecover || this.failOnCorruptedImage) {
            throw e;
          } else {
            warn("Trying to recover from " + e.message);
          }
        }
        this.tiles = transformComponents(context);
        this.width = context.SIZ.Xsiz - context.SIZ.XOsiz;
        this.height = context.SIZ.Ysiz - context.SIZ.YOsiz;
        this.componentsCount = context.SIZ.Csiz;
      }
    };
    function calculateComponentDimensions(component, siz) {
      component.x0 = Math.ceil(siz.XOsiz / component.XRsiz);
      component.x1 = Math.ceil(siz.Xsiz / component.XRsiz);
      component.y0 = Math.ceil(siz.YOsiz / component.YRsiz);
      component.y1 = Math.ceil(siz.Ysiz / component.YRsiz);
      component.width = component.x1 - component.x0;
      component.height = component.y1 - component.y0;
    }
    function calculateTileGrids(context, components) {
      var siz = context.SIZ;
      var tile, tiles = [];
      var numXtiles = Math.ceil((siz.Xsiz - siz.XTOsiz) / siz.XTsiz);
      var numYtiles = Math.ceil((siz.Ysiz - siz.YTOsiz) / siz.YTsiz);
      for (var q = 0; q < numYtiles; q++) {
        for (var p = 0; p < numXtiles; p++) {
          tile = {};
          tile.tx0 = Math.max(siz.XTOsiz + p * siz.XTsiz, siz.XOsiz);
          tile.ty0 = Math.max(siz.YTOsiz + q * siz.YTsiz, siz.YOsiz);
          tile.tx1 = Math.min(siz.XTOsiz + (p + 1) * siz.XTsiz, siz.Xsiz);
          tile.ty1 = Math.min(siz.YTOsiz + (q + 1) * siz.YTsiz, siz.Ysiz);
          tile.width = tile.tx1 - tile.tx0;
          tile.height = tile.ty1 - tile.ty0;
          tile.components = [];
          tiles.push(tile);
        }
      }
      context.tiles = tiles;
      var componentsCount = siz.Csiz;
      for (var i = 0, ii = componentsCount; i < ii; i++) {
        var component = components[i];
        for (var j = 0, jj = tiles.length; j < jj; j++) {
          var tileComponent = {};
          tile = tiles[j];
          tileComponent.tcx0 = Math.ceil(tile.tx0 / component.XRsiz);
          tileComponent.tcy0 = Math.ceil(tile.ty0 / component.YRsiz);
          tileComponent.tcx1 = Math.ceil(tile.tx1 / component.XRsiz);
          tileComponent.tcy1 = Math.ceil(tile.ty1 / component.YRsiz);
          tileComponent.width = tileComponent.tcx1 - tileComponent.tcx0;
          tileComponent.height = tileComponent.tcy1 - tileComponent.tcy0;
          tile.components[i] = tileComponent;
        }
      }
    }
    function getBlocksDimensions(context, component, r) {
      var codOrCoc = component.codingStyleParameters;
      var result = {};
      if (!codOrCoc.entropyCoderWithCustomPrecincts) {
        result.PPx = 15;
        result.PPy = 15;
      } else {
        result.PPx = codOrCoc.precinctsSizes[r].PPx;
        result.PPy = codOrCoc.precinctsSizes[r].PPy;
      }
      result.xcb_ = r > 0 ? Math.min(codOrCoc.xcb, result.PPx - 1) : Math.min(codOrCoc.xcb, result.PPx);
      result.ycb_ = r > 0 ? Math.min(codOrCoc.ycb, result.PPy - 1) : Math.min(codOrCoc.ycb, result.PPy);
      return result;
    }
    function buildPrecincts(context, resolution, dimensions) {
      var precinctWidth = 1 << dimensions.PPx;
      var precinctHeight = 1 << dimensions.PPy;
      var isZeroRes = resolution.resLevel === 0;
      var precinctWidthInSubband = 1 << dimensions.PPx + (isZeroRes ? 0 : -1);
      var precinctHeightInSubband = 1 << dimensions.PPy + (isZeroRes ? 0 : -1);
      var numprecinctswide = resolution.trx1 > resolution.trx0 ? Math.ceil(resolution.trx1 / precinctWidth) - Math.floor(resolution.trx0 / precinctWidth) : 0;
      var numprecinctshigh = resolution.try1 > resolution.try0 ? Math.ceil(resolution.try1 / precinctHeight) - Math.floor(resolution.try0 / precinctHeight) : 0;
      var numprecincts = numprecinctswide * numprecinctshigh;
      resolution.precinctParameters = {
        precinctWidth: precinctWidth,
        precinctHeight: precinctHeight,
        numprecinctswide: numprecinctswide,
        numprecinctshigh: numprecinctshigh,
        numprecincts: numprecincts,
        precinctWidthInSubband: precinctWidthInSubband,
        precinctHeightInSubband: precinctHeightInSubband
      };
    }
    function buildCodeblocks(context, subband, dimensions) {
      var xcb_ = dimensions.xcb_;
      var ycb_ = dimensions.ycb_;
      var codeblockWidth = 1 << xcb_;
      var codeblockHeight = 1 << ycb_;
      var cbx0 = subband.tbx0 >> xcb_;
      var cby0 = subband.tby0 >> ycb_;
      var cbx1 = subband.tbx1 + codeblockWidth - 1 >> xcb_;
      var cby1 = subband.tby1 + codeblockHeight - 1 >> ycb_;
      var precinctParameters = subband.resolution.precinctParameters;
      var codeblocks = [];
      var precincts = [];
      var i, j, codeblock, precinctNumber;
      for (j = cby0; j < cby1; j++) {
        for (i = cbx0; i < cbx1; i++) {
          codeblock = {
            cbx: i,
            cby: j,
            tbx0: codeblockWidth * i,
            tby0: codeblockHeight * j,
            tbx1: codeblockWidth * (i + 1),
            tby1: codeblockHeight * (j + 1)
          };
          codeblock.tbx0_ = Math.max(subband.tbx0, codeblock.tbx0);
          codeblock.tby0_ = Math.max(subband.tby0, codeblock.tby0);
          codeblock.tbx1_ = Math.min(subband.tbx1, codeblock.tbx1);
          codeblock.tby1_ = Math.min(subband.tby1, codeblock.tby1);
          var pi = Math.floor((codeblock.tbx0_ - subband.tbx0) / precinctParameters.precinctWidthInSubband);
          var pj = Math.floor((codeblock.tby0_ - subband.tby0) / precinctParameters.precinctHeightInSubband);
          precinctNumber = pi + pj * precinctParameters.numprecinctswide;
          codeblock.precinctNumber = precinctNumber;
          codeblock.subbandType = subband.type;
          codeblock.Lblock = 3;
          if (codeblock.tbx1_ <= codeblock.tbx0_ || codeblock.tby1_ <= codeblock.tby0_) {
            continue;
          }
          codeblocks.push(codeblock);
          var precinct = precincts[precinctNumber];
          if (precinct !== undefined) {
            if (i < precinct.cbxMin) {
              precinct.cbxMin = i;
            } else if (i > precinct.cbxMax) {
              precinct.cbxMax = i;
            }
            if (j < precinct.cbyMin) {
              precinct.cbxMin = j;
            } else if (j > precinct.cbyMax) {
              precinct.cbyMax = j;
            }
          } else {
            precincts[precinctNumber] = precinct = {
              cbxMin: i,
              cbyMin: j,
              cbxMax: i,
              cbyMax: j
            };
          }
          codeblock.precinct = precinct;
        }
      }
      subband.codeblockParameters = {
        codeblockWidth: xcb_,
        codeblockHeight: ycb_,
        numcodeblockwide: cbx1 - cbx0 + 1,
        numcodeblockhigh: cby1 - cby0 + 1
      };
      subband.codeblocks = codeblocks;
      subband.precincts = precincts;
    }
    function createPacket(resolution, precinctNumber, layerNumber) {
      var precinctCodeblocks = [];
      var subbands = resolution.subbands;
      for (var i = 0, ii = subbands.length; i < ii; i++) {
        var subband = subbands[i];
        var codeblocks = subband.codeblocks;
        for (var j = 0, jj = codeblocks.length; j < jj; j++) {
          var codeblock = codeblocks[j];
          if (codeblock.precinctNumber !== precinctNumber) {
            continue;
          }
          precinctCodeblocks.push(codeblock);
        }
      }
      return {
        layerNumber: layerNumber,
        codeblocks: precinctCodeblocks
      };
    }
    function LayerResolutionComponentPositionIterator(context) {
      var siz = context.SIZ;
      var tileIndex = context.currentTile.index;
      var tile = context.tiles[tileIndex];
      var layersCount = tile.codingStyleDefaultParameters.layersCount;
      var componentsCount = siz.Csiz;
      var maxDecompositionLevelsCount = 0;
      for (var q = 0; q < componentsCount; q++) {
        maxDecompositionLevelsCount = Math.max(maxDecompositionLevelsCount, tile.components[q].codingStyleParameters.decompositionLevelsCount);
      }
      var l = 0, r = 0, i = 0, k = 0;
      this.nextPacket = function JpxImage_nextPacket() {
        for (;l < layersCount; l++) {
          for (;r <= maxDecompositionLevelsCount; r++) {
            for (;i < componentsCount; i++) {
              var component = tile.components[i];
              if (r > component.codingStyleParameters.decompositionLevelsCount) {
                continue;
              }
              var resolution = component.resolutions[r];
              var numprecincts = resolution.precinctParameters.numprecincts;
              for (;k < numprecincts; ) {
                var packet = createPacket(resolution, k, l);
                k++;
                return packet;
              }
              k = 0;
            }
            i = 0;
          }
          r = 0;
        }
        throw new Error("JPX Error: Out of packets");
      };
    }
    function ResolutionLayerComponentPositionIterator(context) {
      var siz = context.SIZ;
      var tileIndex = context.currentTile.index;
      var tile = context.tiles[tileIndex];
      var layersCount = tile.codingStyleDefaultParameters.layersCount;
      var componentsCount = siz.Csiz;
      var maxDecompositionLevelsCount = 0;
      for (var q = 0; q < componentsCount; q++) {
        maxDecompositionLevelsCount = Math.max(maxDecompositionLevelsCount, tile.components[q].codingStyleParameters.decompositionLevelsCount);
      }
      var r = 0, l = 0, i = 0, k = 0;
      this.nextPacket = function JpxImage_nextPacket() {
        for (;r <= maxDecompositionLevelsCount; r++) {
          for (;l < layersCount; l++) {
            for (;i < componentsCount; i++) {
              var component = tile.components[i];
              if (r > component.codingStyleParameters.decompositionLevelsCount) {
                continue;
              }
              var resolution = component.resolutions[r];
              var numprecincts = resolution.precinctParameters.numprecincts;
              for (;k < numprecincts; ) {
                var packet = createPacket(resolution, k, l);
                k++;
                return packet;
              }
              k = 0;
            }
            i = 0;
          }
          l = 0;
        }
        throw new Error("JPX Error: Out of packets");
      };
    }
    function ResolutionPositionComponentLayerIterator(context) {
      var siz = context.SIZ;
      var tileIndex = context.currentTile.index;
      var tile = context.tiles[tileIndex];
      var layersCount = tile.codingStyleDefaultParameters.layersCount;
      var componentsCount = siz.Csiz;
      var l, r, c, p;
      var maxDecompositionLevelsCount = 0;
      for (c = 0; c < componentsCount; c++) {
        var component = tile.components[c];
        maxDecompositionLevelsCount = Math.max(maxDecompositionLevelsCount, component.codingStyleParameters.decompositionLevelsCount);
      }
      var maxNumPrecinctsInLevel = new Int32Array(maxDecompositionLevelsCount + 1);
      for (r = 0; r <= maxDecompositionLevelsCount; ++r) {
        var maxNumPrecincts = 0;
        for (c = 0; c < componentsCount; ++c) {
          var resolutions = tile.components[c].resolutions;
          if (r < resolutions.length) {
            maxNumPrecincts = Math.max(maxNumPrecincts, resolutions[r].precinctParameters.numprecincts);
          }
        }
        maxNumPrecinctsInLevel[r] = maxNumPrecincts;
      }
      l = 0;
      r = 0;
      c = 0;
      p = 0;
      this.nextPacket = function JpxImage_nextPacket() {
        for (;r <= maxDecompositionLevelsCount; r++) {
          for (;p < maxNumPrecinctsInLevel[r]; p++) {
            for (;c < componentsCount; c++) {
              var component = tile.components[c];
              if (r > component.codingStyleParameters.decompositionLevelsCount) {
                continue;
              }
              var resolution = component.resolutions[r];
              var numprecincts = resolution.precinctParameters.numprecincts;
              if (p >= numprecincts) {
                continue;
              }
              for (;l < layersCount; ) {
                var packet = createPacket(resolution, p, l);
                l++;
                return packet;
              }
              l = 0;
            }
            c = 0;
          }
          p = 0;
        }
        throw new Error("JPX Error: Out of packets");
      };
    }
    function PositionComponentResolutionLayerIterator(context) {
      var siz = context.SIZ;
      var tileIndex = context.currentTile.index;
      var tile = context.tiles[tileIndex];
      var layersCount = tile.codingStyleDefaultParameters.layersCount;
      var componentsCount = siz.Csiz;
      var precinctsSizes = getPrecinctSizesInImageScale(tile);
      var precinctsIterationSizes = precinctsSizes;
      var l = 0, r = 0, c = 0, px = 0, py = 0;
      this.nextPacket = function JpxImage_nextPacket() {
        for (;py < precinctsIterationSizes.maxNumHigh; py++) {
          for (;px < precinctsIterationSizes.maxNumWide; px++) {
            for (;c < componentsCount; c++) {
              var component = tile.components[c];
              var decompositionLevelsCount = component.codingStyleParameters.decompositionLevelsCount;
              for (;r <= decompositionLevelsCount; r++) {
                var resolution = component.resolutions[r];
                var sizeInImageScale = precinctsSizes.components[c].resolutions[r];
                var k = getPrecinctIndexIfExist(px, py, sizeInImageScale, precinctsIterationSizes, resolution);
                if (k === null) {
                  continue;
                }
                for (;l < layersCount; ) {
                  var packet = createPacket(resolution, k, l);
                  l++;
                  return packet;
                }
                l = 0;
              }
              r = 0;
            }
            c = 0;
          }
          px = 0;
        }
        throw new Error("JPX Error: Out of packets");
      };
    }
    function ComponentPositionResolutionLayerIterator(context) {
      var siz = context.SIZ;
      var tileIndex = context.currentTile.index;
      var tile = context.tiles[tileIndex];
      var layersCount = tile.codingStyleDefaultParameters.layersCount;
      var componentsCount = siz.Csiz;
      var precinctsSizes = getPrecinctSizesInImageScale(tile);
      var l = 0, r = 0, c = 0, px = 0, py = 0;
      this.nextPacket = function JpxImage_nextPacket() {
        for (;c < componentsCount; ++c) {
          var component = tile.components[c];
          var precinctsIterationSizes = precinctsSizes.components[c];
          var decompositionLevelsCount = component.codingStyleParameters.decompositionLevelsCount;
          for (;py < precinctsIterationSizes.maxNumHigh; py++) {
            for (;px < precinctsIterationSizes.maxNumWide; px++) {
              for (;r <= decompositionLevelsCount; r++) {
                var resolution = component.resolutions[r];
                var sizeInImageScale = precinctsIterationSizes.resolutions[r];
                var k = getPrecinctIndexIfExist(px, py, sizeInImageScale, precinctsIterationSizes, resolution);
                if (k === null) {
                  continue;
                }
                for (;l < layersCount; ) {
                  var packet = createPacket(resolution, k, l);
                  l++;
                  return packet;
                }
                l = 0;
              }
              r = 0;
            }
            px = 0;
          }
          py = 0;
        }
        throw new Error("JPX Error: Out of packets");
      };
    }
    function getPrecinctIndexIfExist(pxIndex, pyIndex, sizeInImageScale, precinctIterationSizes, resolution) {
      var posX = pxIndex * precinctIterationSizes.minWidth;
      var posY = pyIndex * precinctIterationSizes.minHeight;
      if (posX % sizeInImageScale.width !== 0 || posY % sizeInImageScale.height !== 0) {
        return null;
      }
      var startPrecinctRowIndex = posY / sizeInImageScale.width * resolution.precinctParameters.numprecinctswide;
      return posX / sizeInImageScale.height + startPrecinctRowIndex;
    }
    function getPrecinctSizesInImageScale(tile) {
      var componentsCount = tile.components.length;
      var minWidth = Number.MAX_VALUE;
      var minHeight = Number.MAX_VALUE;
      var maxNumWide = 0;
      var maxNumHigh = 0;
      var sizePerComponent = new Array(componentsCount);
      for (var c = 0; c < componentsCount; c++) {
        var component = tile.components[c];
        var decompositionLevelsCount = component.codingStyleParameters.decompositionLevelsCount;
        var sizePerResolution = new Array(decompositionLevelsCount + 1);
        var minWidthCurrentComponent = Number.MAX_VALUE;
        var minHeightCurrentComponent = Number.MAX_VALUE;
        var maxNumWideCurrentComponent = 0;
        var maxNumHighCurrentComponent = 0;
        var scale = 1;
        for (var r = decompositionLevelsCount; r >= 0; --r) {
          var resolution = component.resolutions[r];
          var widthCurrentResolution = scale * resolution.precinctParameters.precinctWidth;
          var heightCurrentResolution = scale * resolution.precinctParameters.precinctHeight;
          minWidthCurrentComponent = Math.min(minWidthCurrentComponent, widthCurrentResolution);
          minHeightCurrentComponent = Math.min(minHeightCurrentComponent, heightCurrentResolution);
          maxNumWideCurrentComponent = Math.max(maxNumWideCurrentComponent, resolution.precinctParameters.numprecinctswide);
          maxNumHighCurrentComponent = Math.max(maxNumHighCurrentComponent, resolution.precinctParameters.numprecinctshigh);
          sizePerResolution[r] = {
            width: widthCurrentResolution,
            height: heightCurrentResolution
          };
          scale <<= 1;
        }
        minWidth = Math.min(minWidth, minWidthCurrentComponent);
        minHeight = Math.min(minHeight, minHeightCurrentComponent);
        maxNumWide = Math.max(maxNumWide, maxNumWideCurrentComponent);
        maxNumHigh = Math.max(maxNumHigh, maxNumHighCurrentComponent);
        sizePerComponent[c] = {
          resolutions: sizePerResolution,
          minWidth: minWidthCurrentComponent,
          minHeight: minHeightCurrentComponent,
          maxNumWide: maxNumWideCurrentComponent,
          maxNumHigh: maxNumHighCurrentComponent
        };
      }
      return {
        components: sizePerComponent,
        minWidth: minWidth,
        minHeight: minHeight,
        maxNumWide: maxNumWide,
        maxNumHigh: maxNumHigh
      };
    }
    function buildPackets(context) {
      var siz = context.SIZ;
      var tileIndex = context.currentTile.index;
      var tile = context.tiles[tileIndex];
      var componentsCount = siz.Csiz;
      for (var c = 0; c < componentsCount; c++) {
        var component = tile.components[c];
        var decompositionLevelsCount = component.codingStyleParameters.decompositionLevelsCount;
        var resolutions = [];
        var subbands = [];
        for (var r = 0; r <= decompositionLevelsCount; r++) {
          var blocksDimensions = getBlocksDimensions(context, component, r);
          var resolution = {};
          var scale = 1 << decompositionLevelsCount - r;
          resolution.trx0 = Math.ceil(component.tcx0 / scale);
          resolution.try0 = Math.ceil(component.tcy0 / scale);
          resolution.trx1 = Math.ceil(component.tcx1 / scale);
          resolution.try1 = Math.ceil(component.tcy1 / scale);
          resolution.resLevel = r;
          buildPrecincts(context, resolution, blocksDimensions);
          resolutions.push(resolution);
          var subband;
          if (r === 0) {
            subband = {};
            subband.type = "LL";
            subband.tbx0 = Math.ceil(component.tcx0 / scale);
            subband.tby0 = Math.ceil(component.tcy0 / scale);
            subband.tbx1 = Math.ceil(component.tcx1 / scale);
            subband.tby1 = Math.ceil(component.tcy1 / scale);
            subband.resolution = resolution;
            buildCodeblocks(context, subband, blocksDimensions);
            subbands.push(subband);
            resolution.subbands = [ subband ];
          } else {
            var bscale = 1 << decompositionLevelsCount - r + 1;
            var resolutionSubbands = [];
            subband = {};
            subband.type = "HL";
            subband.tbx0 = Math.ceil(component.tcx0 / bscale - .5);
            subband.tby0 = Math.ceil(component.tcy0 / bscale);
            subband.tbx1 = Math.ceil(component.tcx1 / bscale - .5);
            subband.tby1 = Math.ceil(component.tcy1 / bscale);
            subband.resolution = resolution;
            buildCodeblocks(context, subband, blocksDimensions);
            subbands.push(subband);
            resolutionSubbands.push(subband);
            subband = {};
            subband.type = "LH";
            subband.tbx0 = Math.ceil(component.tcx0 / bscale);
            subband.tby0 = Math.ceil(component.tcy0 / bscale - .5);
            subband.tbx1 = Math.ceil(component.tcx1 / bscale);
            subband.tby1 = Math.ceil(component.tcy1 / bscale - .5);
            subband.resolution = resolution;
            buildCodeblocks(context, subband, blocksDimensions);
            subbands.push(subband);
            resolutionSubbands.push(subband);
            subband = {};
            subband.type = "HH";
            subband.tbx0 = Math.ceil(component.tcx0 / bscale - .5);
            subband.tby0 = Math.ceil(component.tcy0 / bscale - .5);
            subband.tbx1 = Math.ceil(component.tcx1 / bscale - .5);
            subband.tby1 = Math.ceil(component.tcy1 / bscale - .5);
            subband.resolution = resolution;
            buildCodeblocks(context, subband, blocksDimensions);
            subbands.push(subband);
            resolutionSubbands.push(subband);
            resolution.subbands = resolutionSubbands;
          }
        }
        component.resolutions = resolutions;
        component.subbands = subbands;
      }
      var progressionOrder = tile.codingStyleDefaultParameters.progressionOrder;
      switch (progressionOrder) {
        case 0:
          tile.packetsIterator = new LayerResolutionComponentPositionIterator(context);
          break;

        case 1:
          tile.packetsIterator = new ResolutionLayerComponentPositionIterator(context);
          break;

        case 2:
          tile.packetsIterator = new ResolutionPositionComponentLayerIterator(context);
          break;

        case 3:
          tile.packetsIterator = new PositionComponentResolutionLayerIterator(context);
          break;

        case 4:
          tile.packetsIterator = new ComponentPositionResolutionLayerIterator(context);
          break;

        default:
          throw new Error("JPX Error: Unsupported progression order " + progressionOrder);
      }
    }
    function parseTilePackets(context, data, offset, dataLength) {
      var position = 0;
      var buffer, bufferSize = 0, skipNextBit = false;
      function readBits(count) {
        while (bufferSize < count) {
          var b = data[offset + position];
          position++;
          if (skipNextBit) {
            buffer = buffer << 7 | b;
            bufferSize += 7;
            skipNextBit = false;
          } else {
            buffer = buffer << 8 | b;
            bufferSize += 8;
          }
          if (b === 255) {
            skipNextBit = true;
          }
        }
        bufferSize -= count;
        return buffer >>> bufferSize & (1 << count) - 1;
      }
      function skipMarkerIfEqual(value) {
        if (data[offset + position - 1] === 255 && data[offset + position] === value) {
          skipBytes(1);
          return true;
        } else if (data[offset + position] === 255 && data[offset + position + 1] === value) {
          skipBytes(2);
          return true;
        }
        return false;
      }
      function skipBytes(count) {
        position += count;
      }
      function alignToByte() {
        bufferSize = 0;
        if (skipNextBit) {
          position++;
          skipNextBit = false;
        }
      }
      function readCodingpasses() {
        if (readBits(1) === 0) {
          return 1;
        }
        if (readBits(1) === 0) {
          return 2;
        }
        var value = readBits(2);
        if (value < 3) {
          return value + 3;
        }
        value = readBits(5);
        if (value < 31) {
          return value + 6;
        }
        value = readBits(7);
        return value + 37;
      }
      var tileIndex = context.currentTile.index;
      var tile = context.tiles[tileIndex];
      var sopMarkerUsed = context.COD.sopMarkerUsed;
      var ephMarkerUsed = context.COD.ephMarkerUsed;
      var packetsIterator = tile.packetsIterator;
      while (position < dataLength) {
        alignToByte();
        if (sopMarkerUsed && skipMarkerIfEqual(145)) {
          skipBytes(4);
        }
        var packet = packetsIterator.nextPacket();
        if (!readBits(1)) {
          continue;
        }
        var layerNumber = packet.layerNumber;
        var queue = [], codeblock;
        for (var i = 0, ii = packet.codeblocks.length; i < ii; i++) {
          codeblock = packet.codeblocks[i];
          var precinct = codeblock.precinct;
          var codeblockColumn = codeblock.cbx - precinct.cbxMin;
          var codeblockRow = codeblock.cby - precinct.cbyMin;
          var codeblockIncluded = false;
          var firstTimeInclusion = false;
          var valueReady;
          if (codeblock["included"] !== undefined) {
            codeblockIncluded = !!readBits(1);
          } else {
            precinct = codeblock.precinct;
            var inclusionTree, zeroBitPlanesTree;
            if (precinct["inclusionTree"] !== undefined) {
              inclusionTree = precinct.inclusionTree;
            } else {
              var width = precinct.cbxMax - precinct.cbxMin + 1;
              var height = precinct.cbyMax - precinct.cbyMin + 1;
              inclusionTree = new InclusionTree(width, height, layerNumber);
              zeroBitPlanesTree = new TagTree(width, height);
              precinct.inclusionTree = inclusionTree;
              precinct.zeroBitPlanesTree = zeroBitPlanesTree;
            }
            if (inclusionTree.reset(codeblockColumn, codeblockRow, layerNumber)) {
              while (true) {
                if (readBits(1)) {
                  valueReady = !inclusionTree.nextLevel();
                  if (valueReady) {
                    codeblock.included = true;
                    codeblockIncluded = firstTimeInclusion = true;
                    break;
                  }
                } else {
                  inclusionTree.incrementValue(layerNumber);
                  break;
                }
              }
            }
          }
          if (!codeblockIncluded) {
            continue;
          }
          if (firstTimeInclusion) {
            zeroBitPlanesTree = precinct.zeroBitPlanesTree;
            zeroBitPlanesTree.reset(codeblockColumn, codeblockRow);
            while (true) {
              if (readBits(1)) {
                valueReady = !zeroBitPlanesTree.nextLevel();
                if (valueReady) {
                  break;
                }
              } else {
                zeroBitPlanesTree.incrementValue();
              }
            }
            codeblock.zeroBitPlanes = zeroBitPlanesTree.value;
          }
          var codingpasses = readCodingpasses();
          while (readBits(1)) {
            codeblock.Lblock++;
          }
          var codingpassesLog2 = log2(codingpasses);
          var bits = (codingpasses < 1 << codingpassesLog2 ? codingpassesLog2 - 1 : codingpassesLog2) + codeblock.Lblock;
          var codedDataLength = readBits(bits);
          queue.push({
            codeblock: codeblock,
            codingpasses: codingpasses,
            dataLength: codedDataLength
          });
        }
        alignToByte();
        if (ephMarkerUsed) {
          skipMarkerIfEqual(146);
        }
        while (queue.length > 0) {
          var packetItem = queue.shift();
          codeblock = packetItem.codeblock;
          if (codeblock["data"] === undefined) {
            codeblock.data = [];
          }
          codeblock.data.push({
            data: data,
            start: offset + position,
            end: offset + position + packetItem.dataLength,
            codingpasses: packetItem.codingpasses
          });
          position += packetItem.dataLength;
        }
      }
      return position;
    }
    function copyCoefficients(coefficients, levelWidth, levelHeight, subband, delta, mb, reversible, segmentationSymbolUsed) {
      var x0 = subband.tbx0;
      var y0 = subband.tby0;
      var width = subband.tbx1 - subband.tbx0;
      var codeblocks = subband.codeblocks;
      var right = subband.type.charAt(0) === "H" ? 1 : 0;
      var bottom = subband.type.charAt(1) === "H" ? levelWidth : 0;
      for (var i = 0, ii = codeblocks.length; i < ii; ++i) {
        var codeblock = codeblocks[i];
        var blockWidth = codeblock.tbx1_ - codeblock.tbx0_;
        var blockHeight = codeblock.tby1_ - codeblock.tby0_;
        if (blockWidth === 0 || blockHeight === 0) {
          continue;
        }
        if (codeblock["data"] === undefined) {
          continue;
        }
        var bitModel, currentCodingpassType;
        bitModel = new BitModel(blockWidth, blockHeight, codeblock.subbandType, codeblock.zeroBitPlanes, mb);
        currentCodingpassType = 2;
        var data = codeblock.data, totalLength = 0, codingpasses = 0;
        var j, jj, dataItem;
        for (j = 0, jj = data.length; j < jj; j++) {
          dataItem = data[j];
          totalLength += dataItem.end - dataItem.start;
          codingpasses += dataItem.codingpasses;
        }
        var encodedData = new Uint8Array(totalLength);
        var position = 0;
        for (j = 0, jj = data.length; j < jj; j++) {
          dataItem = data[j];
          var chunk = dataItem.data.subarray(dataItem.start, dataItem.end);
          encodedData.set(chunk, position);
          position += chunk.length;
        }
        var decoder = new ArithmeticDecoder(encodedData, 0, totalLength);
        bitModel.setDecoder(decoder);
        for (j = 0; j < codingpasses; j++) {
          switch (currentCodingpassType) {
            case 0:
              bitModel.runSignificancePropogationPass();
              break;

            case 1:
              bitModel.runMagnitudeRefinementPass();
              break;

            case 2:
              bitModel.runCleanupPass();
              if (segmentationSymbolUsed) {
                bitModel.checkSegmentationSymbol();
              }
              break;
          }
          currentCodingpassType = (currentCodingpassType + 1) % 3;
        }
        var offset = codeblock.tbx0_ - x0 + (codeblock.tby0_ - y0) * width;
        var sign = bitModel.coefficentsSign;
        var magnitude = bitModel.coefficentsMagnitude;
        var bitsDecoded = bitModel.bitsDecoded;
        var magnitudeCorrection = reversible ? 0 : .5;
        var k, n, nb;
        position = 0;
        var interleave = subband.type !== "LL";
        for (j = 0; j < blockHeight; j++) {
          var row = offset / width | 0;
          var levelOffset = 2 * row * (levelWidth - width) + right + bottom;
          for (k = 0; k < blockWidth; k++) {
            n = magnitude[position];
            if (n !== 0) {
              n = (n + magnitudeCorrection) * delta;
              if (sign[position] !== 0) {
                n = -n;
              }
              nb = bitsDecoded[position];
              var pos = interleave ? levelOffset + (offset << 1) : offset;
              if (reversible && nb >= mb) {
                coefficients[pos] = n;
              } else {
                coefficients[pos] = n * (1 << mb - nb);
              }
            }
            offset++;
            position++;
          }
          offset += width - blockWidth;
        }
      }
    }
    function transformTile(context, tile, c) {
      var component = tile.components[c];
      var codingStyleParameters = component.codingStyleParameters;
      var quantizationParameters = component.quantizationParameters;
      var decompositionLevelsCount = codingStyleParameters.decompositionLevelsCount;
      var spqcds = quantizationParameters.SPqcds;
      var scalarExpounded = quantizationParameters.scalarExpounded;
      var guardBits = quantizationParameters.guardBits;
      var segmentationSymbolUsed = codingStyleParameters.segmentationSymbolUsed;
      var precision = context.components[c].precision;
      var reversible = codingStyleParameters.reversibleTransformation;
      var transform = reversible ? new ReversibleTransform() : new IrreversibleTransform();
      var subbandCoefficients = [];
      var b = 0;
      for (var i = 0; i <= decompositionLevelsCount; i++) {
        var resolution = component.resolutions[i];
        var width = resolution.trx1 - resolution.trx0;
        var height = resolution.try1 - resolution.try0;
        var coefficients = new Float32Array(width * height);
        for (var j = 0, jj = resolution.subbands.length; j < jj; j++) {
          var mu, epsilon;
          if (!scalarExpounded) {
            mu = spqcds[0].mu;
            epsilon = spqcds[0].epsilon + (i > 0 ? 1 - i : 0);
          } else {
            mu = spqcds[b].mu;
            epsilon = spqcds[b].epsilon;
            b++;
          }
          var subband = resolution.subbands[j];
          var gainLog2 = SubbandsGainLog2[subband.type];
          var delta = reversible ? 1 : Math.pow(2, precision + gainLog2 - epsilon) * (1 + mu / 2048);
          var mb = guardBits + epsilon - 1;
          copyCoefficients(coefficients, width, height, subband, delta, mb, reversible, segmentationSymbolUsed);
        }
        subbandCoefficients.push({
          width: width,
          height: height,
          items: coefficients
        });
      }
      var result = transform.calculate(subbandCoefficients, component.tcx0, component.tcy0);
      return {
        left: component.tcx0,
        top: component.tcy0,
        width: result.width,
        height: result.height,
        items: result.items
      };
    }
    function transformComponents(context) {
      var siz = context.SIZ;
      var components = context.components;
      var componentsCount = siz.Csiz;
      var resultImages = [];
      for (var i = 0, ii = context.tiles.length; i < ii; i++) {
        var tile = context.tiles[i];
        var transformedTiles = [];
        var c;
        for (c = 0; c < componentsCount; c++) {
          transformedTiles[c] = transformTile(context, tile, c);
        }
        var tile0 = transformedTiles[0];
        var out = new Uint8Array(tile0.items.length * componentsCount);
        var result = {
          left: tile0.left,
          top: tile0.top,
          width: tile0.width,
          height: tile0.height,
          items: out
        };
        var shift, offset, max, min, maxK;
        var pos = 0, j, jj, y0, y1, y2, r, g, b, k, val;
        if (tile.codingStyleDefaultParameters.multipleComponentTransform) {
          var fourComponents = componentsCount === 4;
          var y0items = transformedTiles[0].items;
          var y1items = transformedTiles[1].items;
          var y2items = transformedTiles[2].items;
          var y3items = fourComponents ? transformedTiles[3].items : null;
          shift = components[0].precision - 8;
          offset = (128 << shift) + .5;
          max = 255 * (1 << shift);
          maxK = max * .5;
          min = -maxK;
          var component0 = tile.components[0];
          var alpha01 = componentsCount - 3;
          jj = y0items.length;
          if (!component0.codingStyleParameters.reversibleTransformation) {
            for (j = 0; j < jj; j++, pos += alpha01) {
              y0 = y0items[j] + offset;
              y1 = y1items[j];
              y2 = y2items[j];
              r = y0 + 1.402 * y2;
              g = y0 - .34413 * y1 - .71414 * y2;
              b = y0 + 1.772 * y1;
              out[pos++] = r <= 0 ? 0 : r >= max ? 255 : r >> shift;
              out[pos++] = g <= 0 ? 0 : g >= max ? 255 : g >> shift;
              out[pos++] = b <= 0 ? 0 : b >= max ? 255 : b >> shift;
            }
          } else {
            for (j = 0; j < jj; j++, pos += alpha01) {
              y0 = y0items[j] + offset;
              y1 = y1items[j];
              y2 = y2items[j];
              g = y0 - (y2 + y1 >> 2);
              r = g + y2;
              b = g + y1;
              out[pos++] = r <= 0 ? 0 : r >= max ? 255 : r >> shift;
              out[pos++] = g <= 0 ? 0 : g >= max ? 255 : g >> shift;
              out[pos++] = b <= 0 ? 0 : b >= max ? 255 : b >> shift;
            }
          }
          if (fourComponents) {
            for (j = 0, pos = 3; j < jj; j++, pos += 4) {
              k = y3items[j];
              out[pos] = k <= min ? 0 : k >= maxK ? 255 : k + offset >> shift;
            }
          }
        } else {
          for (c = 0; c < componentsCount; c++) {
            var items = transformedTiles[c].items;
            shift = components[c].precision - 8;
            offset = (128 << shift) + .5;
            max = 127.5 * (1 << shift);
            min = -max;
            for (pos = c, j = 0, jj = items.length; j < jj; j++) {
              val = items[j];
              out[pos] = val <= min ? 0 : val >= max ? 255 : val + offset >> shift;
              pos += componentsCount;
            }
          }
        }
        resultImages.push(result);
      }
      return resultImages;
    }
    function initializeTile(context, tileIndex) {
      var siz = context.SIZ;
      var componentsCount = siz.Csiz;
      var tile = context.tiles[tileIndex];
      for (var c = 0; c < componentsCount; c++) {
        var component = tile.components[c];
        var qcdOrQcc = context.currentTile.QCC[c] !== undefined ? context.currentTile.QCC[c] : context.currentTile.QCD;
        component.quantizationParameters = qcdOrQcc;
        var codOrCoc = context.currentTile.COC[c] !== undefined ? context.currentTile.COC[c] : context.currentTile.COD;
        component.codingStyleParameters = codOrCoc;
      }
      tile.codingStyleDefaultParameters = context.currentTile.COD;
    }
    var TagTree = function TagTreeClosure() {
      function TagTree(width, height) {
        var levelsLength = log2(Math.max(width, height)) + 1;
        this.levels = [];
        for (var i = 0; i < levelsLength; i++) {
          var level = {
            width: width,
            height: height,
            items: []
          };
          this.levels.push(level);
          width = Math.ceil(width / 2);
          height = Math.ceil(height / 2);
        }
      }
      TagTree.prototype = {
        reset: function TagTree_reset(i, j) {
          var currentLevel = 0, value = 0, level;
          while (currentLevel < this.levels.length) {
            level = this.levels[currentLevel];
            var index = i + j * level.width;
            if (level.items[index] !== undefined) {
              value = level.items[index];
              break;
            }
            level.index = index;
            i >>= 1;
            j >>= 1;
            currentLevel++;
          }
          currentLevel--;
          level = this.levels[currentLevel];
          level.items[level.index] = value;
          this.currentLevel = currentLevel;
          delete this.value;
        },
        incrementValue: function TagTree_incrementValue() {
          var level = this.levels[this.currentLevel];
          level.items[level.index]++;
        },
        nextLevel: function TagTree_nextLevel() {
          var currentLevel = this.currentLevel;
          var level = this.levels[currentLevel];
          var value = level.items[level.index];
          currentLevel--;
          if (currentLevel < 0) {
            this.value = value;
            return false;
          }
          this.currentLevel = currentLevel;
          level = this.levels[currentLevel];
          level.items[level.index] = value;
          return true;
        }
      };
      return TagTree;
    }();
    var InclusionTree = function InclusionTreeClosure() {
      function InclusionTree(width, height, defaultValue) {
        var levelsLength = log2(Math.max(width, height)) + 1;
        this.levels = [];
        for (var i = 0; i < levelsLength; i++) {
          var items = new Uint8Array(width * height);
          for (var j = 0, jj = items.length; j < jj; j++) {
            items[j] = defaultValue;
          }
          var level = {
            width: width,
            height: height,
            items: items
          };
          this.levels.push(level);
          width = Math.ceil(width / 2);
          height = Math.ceil(height / 2);
        }
      }
      InclusionTree.prototype = {
        reset: function InclusionTree_reset(i, j, stopValue) {
          var currentLevel = 0;
          while (currentLevel < this.levels.length) {
            var level = this.levels[currentLevel];
            var index = i + j * level.width;
            level.index = index;
            var value = level.items[index];
            if (value === 255) {
              break;
            }
            if (value > stopValue) {
              this.currentLevel = currentLevel;
              this.propagateValues();
              return false;
            }
            i >>= 1;
            j >>= 1;
            currentLevel++;
          }
          this.currentLevel = currentLevel - 1;
          return true;
        },
        incrementValue: function InclusionTree_incrementValue(stopValue) {
          var level = this.levels[this.currentLevel];
          level.items[level.index] = stopValue + 1;
          this.propagateValues();
        },
        propagateValues: function InclusionTree_propagateValues() {
          var levelIndex = this.currentLevel;
          var level = this.levels[levelIndex];
          var currentValue = level.items[level.index];
          while (--levelIndex >= 0) {
            level = this.levels[levelIndex];
            level.items[level.index] = currentValue;
          }
        },
        nextLevel: function InclusionTree_nextLevel() {
          var currentLevel = this.currentLevel;
          var level = this.levels[currentLevel];
          var value = level.items[level.index];
          level.items[level.index] = 255;
          currentLevel--;
          if (currentLevel < 0) {
            return false;
          }
          this.currentLevel = currentLevel;
          level = this.levels[currentLevel];
          level.items[level.index] = value;
          return true;
        }
      };
      return InclusionTree;
    }();
    var BitModel = function BitModelClosure() {
      var UNIFORM_CONTEXT = 17;
      var RUNLENGTH_CONTEXT = 18;
      var LLAndLHContextsLabel = new Uint8Array([ 0, 5, 8, 0, 3, 7, 8, 0, 4, 7, 8, 0, 0, 0, 0, 0, 1, 6, 8, 0, 3, 7, 8, 0, 4, 7, 8, 0, 0, 0, 0, 0, 2, 6, 8, 0, 3, 7, 8, 0, 4, 7, 8, 0, 0, 0, 0, 0, 2, 6, 8, 0, 3, 7, 8, 0, 4, 7, 8, 0, 0, 0, 0, 0, 2, 6, 8, 0, 3, 7, 8, 0, 4, 7, 8 ]);
      var HLContextLabel = new Uint8Array([ 0, 3, 4, 0, 5, 7, 7, 0, 8, 8, 8, 0, 0, 0, 0, 0, 1, 3, 4, 0, 6, 7, 7, 0, 8, 8, 8, 0, 0, 0, 0, 0, 2, 3, 4, 0, 6, 7, 7, 0, 8, 8, 8, 0, 0, 0, 0, 0, 2, 3, 4, 0, 6, 7, 7, 0, 8, 8, 8, 0, 0, 0, 0, 0, 2, 3, 4, 0, 6, 7, 7, 0, 8, 8, 8 ]);
      var HHContextLabel = new Uint8Array([ 0, 1, 2, 0, 1, 2, 2, 0, 2, 2, 2, 0, 0, 0, 0, 0, 3, 4, 5, 0, 4, 5, 5, 0, 5, 5, 5, 0, 0, 0, 0, 0, 6, 7, 7, 0, 7, 7, 7, 0, 7, 7, 7, 0, 0, 0, 0, 0, 8, 8, 8, 0, 8, 8, 8, 0, 8, 8, 8, 0, 0, 0, 0, 0, 8, 8, 8, 0, 8, 8, 8, 0, 8, 8, 8 ]);
      function BitModel(width, height, subband, zeroBitPlanes, mb) {
        this.width = width;
        this.height = height;
        this.contextLabelTable = subband === "HH" ? HHContextLabel : subband === "HL" ? HLContextLabel : LLAndLHContextsLabel;
        var coefficientCount = width * height;
        this.neighborsSignificance = new Uint8Array(coefficientCount);
        this.coefficentsSign = new Uint8Array(coefficientCount);
        this.coefficentsMagnitude = mb > 14 ? new Uint32Array(coefficientCount) : mb > 6 ? new Uint16Array(coefficientCount) : new Uint8Array(coefficientCount);
        this.processingFlags = new Uint8Array(coefficientCount);
        var bitsDecoded = new Uint8Array(coefficientCount);
        if (zeroBitPlanes !== 0) {
          for (var i = 0; i < coefficientCount; i++) {
            bitsDecoded[i] = zeroBitPlanes;
          }
        }
        this.bitsDecoded = bitsDecoded;
        this.reset();
      }
      BitModel.prototype = {
        setDecoder: function BitModel_setDecoder(decoder) {
          this.decoder = decoder;
        },
        reset: function BitModel_reset() {
          this.contexts = new Int8Array(19);
          this.contexts[0] = 4 << 1 | 0;
          this.contexts[UNIFORM_CONTEXT] = 46 << 1 | 0;
          this.contexts[RUNLENGTH_CONTEXT] = 3 << 1 | 0;
        },
        setNeighborsSignificance: function BitModel_setNeighborsSignificance(row, column, index) {
          var neighborsSignificance = this.neighborsSignificance;
          var width = this.width, height = this.height;
          var left = column > 0;
          var right = column + 1 < width;
          var i;
          if (row > 0) {
            i = index - width;
            if (left) {
              neighborsSignificance[i - 1] += 16;
            }
            if (right) {
              neighborsSignificance[i + 1] += 16;
            }
            neighborsSignificance[i] += 4;
          }
          if (row + 1 < height) {
            i = index + width;
            if (left) {
              neighborsSignificance[i - 1] += 16;
            }
            if (right) {
              neighborsSignificance[i + 1] += 16;
            }
            neighborsSignificance[i] += 4;
          }
          if (left) {
            neighborsSignificance[index - 1] += 1;
          }
          if (right) {
            neighborsSignificance[index + 1] += 1;
          }
          neighborsSignificance[index] |= 128;
        },
        runSignificancePropogationPass: function BitModel_runSignificancePropogationPass() {
          var decoder = this.decoder;
          var width = this.width, height = this.height;
          var coefficentsMagnitude = this.coefficentsMagnitude;
          var coefficentsSign = this.coefficentsSign;
          var neighborsSignificance = this.neighborsSignificance;
          var processingFlags = this.processingFlags;
          var contexts = this.contexts;
          var labels = this.contextLabelTable;
          var bitsDecoded = this.bitsDecoded;
          var processedInverseMask = ~1;
          var processedMask = 1;
          var firstMagnitudeBitMask = 2;
          for (var i0 = 0; i0 < height; i0 += 4) {
            for (var j = 0; j < width; j++) {
              var index = i0 * width + j;
              for (var i1 = 0; i1 < 4; i1++, index += width) {
                var i = i0 + i1;
                if (i >= height) {
                  break;
                }
                processingFlags[index] &= processedInverseMask;
                if (coefficentsMagnitude[index] || !neighborsSignificance[index]) {
                  continue;
                }
                var contextLabel = labels[neighborsSignificance[index]];
                var decision = decoder.readBit(contexts, contextLabel);
                if (decision) {
                  var sign = this.decodeSignBit(i, j, index);
                  coefficentsSign[index] = sign;
                  coefficentsMagnitude[index] = 1;
                  this.setNeighborsSignificance(i, j, index);
                  processingFlags[index] |= firstMagnitudeBitMask;
                }
                bitsDecoded[index]++;
                processingFlags[index] |= processedMask;
              }
            }
          }
        },
        decodeSignBit: function BitModel_decodeSignBit(row, column, index) {
          var width = this.width, height = this.height;
          var coefficentsMagnitude = this.coefficentsMagnitude;
          var coefficentsSign = this.coefficentsSign;
          var contribution, sign0, sign1, significance1;
          var contextLabel, decoded;
          significance1 = column > 0 && coefficentsMagnitude[index - 1] !== 0;
          if (column + 1 < width && coefficentsMagnitude[index + 1] !== 0) {
            sign1 = coefficentsSign[index + 1];
            if (significance1) {
              sign0 = coefficentsSign[index - 1];
              contribution = 1 - sign1 - sign0;
            } else {
              contribution = 1 - sign1 - sign1;
            }
          } else if (significance1) {
            sign0 = coefficentsSign[index - 1];
            contribution = 1 - sign0 - sign0;
          } else {
            contribution = 0;
          }
          var horizontalContribution = 3 * contribution;
          significance1 = row > 0 && coefficentsMagnitude[index - width] !== 0;
          if (row + 1 < height && coefficentsMagnitude[index + width] !== 0) {
            sign1 = coefficentsSign[index + width];
            if (significance1) {
              sign0 = coefficentsSign[index - width];
              contribution = 1 - sign1 - sign0 + horizontalContribution;
            } else {
              contribution = 1 - sign1 - sign1 + horizontalContribution;
            }
          } else if (significance1) {
            sign0 = coefficentsSign[index - width];
            contribution = 1 - sign0 - sign0 + horizontalContribution;
          } else {
            contribution = horizontalContribution;
          }
          if (contribution >= 0) {
            contextLabel = 9 + contribution;
            decoded = this.decoder.readBit(this.contexts, contextLabel);
          } else {
            contextLabel = 9 - contribution;
            decoded = this.decoder.readBit(this.contexts, contextLabel) ^ 1;
          }
          return decoded;
        },
        runMagnitudeRefinementPass: function BitModel_runMagnitudeRefinementPass() {
          var decoder = this.decoder;
          var width = this.width, height = this.height;
          var coefficentsMagnitude = this.coefficentsMagnitude;
          var neighborsSignificance = this.neighborsSignificance;
          var contexts = this.contexts;
          var bitsDecoded = this.bitsDecoded;
          var processingFlags = this.processingFlags;
          var processedMask = 1;
          var firstMagnitudeBitMask = 2;
          var length = width * height;
          var width4 = width * 4;
          for (var index0 = 0, indexNext; index0 < length; index0 = indexNext) {
            indexNext = Math.min(length, index0 + width4);
            for (var j = 0; j < width; j++) {
              for (var index = index0 + j; index < indexNext; index += width) {
                if (!coefficentsMagnitude[index] || (processingFlags[index] & processedMask) !== 0) {
                  continue;
                }
                var contextLabel = 16;
                if ((processingFlags[index] & firstMagnitudeBitMask) !== 0) {
                  processingFlags[index] ^= firstMagnitudeBitMask;
                  var significance = neighborsSignificance[index] & 127;
                  contextLabel = significance === 0 ? 15 : 14;
                }
                var bit = decoder.readBit(contexts, contextLabel);
                coefficentsMagnitude[index] = coefficentsMagnitude[index] << 1 | bit;
                bitsDecoded[index]++;
                processingFlags[index] |= processedMask;
              }
            }
          }
        },
        runCleanupPass: function BitModel_runCleanupPass() {
          var decoder = this.decoder;
          var width = this.width, height = this.height;
          var neighborsSignificance = this.neighborsSignificance;
          var coefficentsMagnitude = this.coefficentsMagnitude;
          var coefficentsSign = this.coefficentsSign;
          var contexts = this.contexts;
          var labels = this.contextLabelTable;
          var bitsDecoded = this.bitsDecoded;
          var processingFlags = this.processingFlags;
          var processedMask = 1;
          var firstMagnitudeBitMask = 2;
          var oneRowDown = width;
          var twoRowsDown = width * 2;
          var threeRowsDown = width * 3;
          var iNext;
          for (var i0 = 0; i0 < height; i0 = iNext) {
            iNext = Math.min(i0 + 4, height);
            var indexBase = i0 * width;
            var checkAllEmpty = i0 + 3 < height;
            for (var j = 0; j < width; j++) {
              var index0 = indexBase + j;
              var allEmpty = checkAllEmpty && processingFlags[index0] === 0 && processingFlags[index0 + oneRowDown] === 0 && processingFlags[index0 + twoRowsDown] === 0 && processingFlags[index0 + threeRowsDown] === 0 && neighborsSignificance[index0] === 0 && neighborsSignificance[index0 + oneRowDown] === 0 && neighborsSignificance[index0 + twoRowsDown] === 0 && neighborsSignificance[index0 + threeRowsDown] === 0;
              var i1 = 0, index = index0;
              var i = i0, sign;
              if (allEmpty) {
                var hasSignificantCoefficent = decoder.readBit(contexts, RUNLENGTH_CONTEXT);
                if (!hasSignificantCoefficent) {
                  bitsDecoded[index0]++;
                  bitsDecoded[index0 + oneRowDown]++;
                  bitsDecoded[index0 + twoRowsDown]++;
                  bitsDecoded[index0 + threeRowsDown]++;
                  continue;
                }
                i1 = decoder.readBit(contexts, UNIFORM_CONTEXT) << 1 | decoder.readBit(contexts, UNIFORM_CONTEXT);
                if (i1 !== 0) {
                  i = i0 + i1;
                  index += i1 * width;
                }
                sign = this.decodeSignBit(i, j, index);
                coefficentsSign[index] = sign;
                coefficentsMagnitude[index] = 1;
                this.setNeighborsSignificance(i, j, index);
                processingFlags[index] |= firstMagnitudeBitMask;
                index = index0;
                for (var i2 = i0; i2 <= i; i2++, index += width) {
                  bitsDecoded[index]++;
                }
                i1++;
              }
              for (i = i0 + i1; i < iNext; i++, index += width) {
                if (coefficentsMagnitude[index] || (processingFlags[index] & processedMask) !== 0) {
                  continue;
                }
                var contextLabel = labels[neighborsSignificance[index]];
                var decision = decoder.readBit(contexts, contextLabel);
                if (decision === 1) {
                  sign = this.decodeSignBit(i, j, index);
                  coefficentsSign[index] = sign;
                  coefficentsMagnitude[index] = 1;
                  this.setNeighborsSignificance(i, j, index);
                  processingFlags[index] |= firstMagnitudeBitMask;
                }
                bitsDecoded[index]++;
              }
            }
          }
        },
        checkSegmentationSymbol: function BitModel_checkSegmentationSymbol() {
          var decoder = this.decoder;
          var contexts = this.contexts;
          var symbol = decoder.readBit(contexts, UNIFORM_CONTEXT) << 3 | decoder.readBit(contexts, UNIFORM_CONTEXT) << 2 | decoder.readBit(contexts, UNIFORM_CONTEXT) << 1 | decoder.readBit(contexts, UNIFORM_CONTEXT);
          if (symbol !== 10) {
            throw new Error("JPX Error: Invalid segmentation symbol");
          }
        }
      };
      return BitModel;
    }();
    var Transform = function TransformClosure() {
      function Transform() {}
      Transform.prototype.calculate = function transformCalculate(subbands, u0, v0) {
        var ll = subbands[0];
        for (var i = 1, ii = subbands.length; i < ii; i++) {
          ll = this.iterate(ll, subbands[i], u0, v0);
        }
        return ll;
      };
      Transform.prototype.extend = function extend(buffer, offset, size) {
        var i1 = offset - 1, j1 = offset + 1;
        var i2 = offset + size - 2, j2 = offset + size;
        buffer[i1--] = buffer[j1++];
        buffer[j2++] = buffer[i2--];
        buffer[i1--] = buffer[j1++];
        buffer[j2++] = buffer[i2--];
        buffer[i1--] = buffer[j1++];
        buffer[j2++] = buffer[i2--];
        buffer[i1] = buffer[j1];
        buffer[j2] = buffer[i2];
      };
      Transform.prototype.iterate = function Transform_iterate(ll, hl_lh_hh, u0, v0) {
        var llWidth = ll.width, llHeight = ll.height, llItems = ll.items;
        var width = hl_lh_hh.width;
        var height = hl_lh_hh.height;
        var items = hl_lh_hh.items;
        var i, j, k, l, u, v;
        for (k = 0, i = 0; i < llHeight; i++) {
          l = i * 2 * width;
          for (j = 0; j < llWidth; j++, k++, l += 2) {
            items[l] = llItems[k];
          }
        }
        llItems = ll.items = null;
        var bufferPadding = 4;
        var rowBuffer = new Float32Array(width + 2 * bufferPadding);
        if (width === 1) {
          if ((u0 & 1) !== 0) {
            for (v = 0, k = 0; v < height; v++, k += width) {
              items[k] *= .5;
            }
          }
        } else {
          for (v = 0, k = 0; v < height; v++, k += width) {
            rowBuffer.set(items.subarray(k, k + width), bufferPadding);
            this.extend(rowBuffer, bufferPadding, width);
            this.filter(rowBuffer, bufferPadding, width);
            items.set(rowBuffer.subarray(bufferPadding, bufferPadding + width), k);
          }
        }
        var numBuffers = 16;
        var colBuffers = [];
        for (i = 0; i < numBuffers; i++) {
          colBuffers.push(new Float32Array(height + 2 * bufferPadding));
        }
        var b, currentBuffer = 0;
        ll = bufferPadding + height;
        if (height === 1) {
          if ((v0 & 1) !== 0) {
            for (u = 0; u < width; u++) {
              items[u] *= .5;
            }
          }
        } else {
          for (u = 0; u < width; u++) {
            if (currentBuffer === 0) {
              numBuffers = Math.min(width - u, numBuffers);
              for (k = u, l = bufferPadding; l < ll; k += width, l++) {
                for (b = 0; b < numBuffers; b++) {
                  colBuffers[b][l] = items[k + b];
                }
              }
              currentBuffer = numBuffers;
            }
            currentBuffer--;
            var buffer = colBuffers[currentBuffer];
            this.extend(buffer, bufferPadding, height);
            this.filter(buffer, bufferPadding, height);
            if (currentBuffer === 0) {
              k = u - numBuffers + 1;
              for (l = bufferPadding; l < ll; k += width, l++) {
                for (b = 0; b < numBuffers; b++) {
                  items[k + b] = colBuffers[b][l];
                }
              }
            }
          }
        }
        return {
          width: width,
          height: height,
          items: items
        };
      };
      return Transform;
    }();
    var IrreversibleTransform = function IrreversibleTransformClosure() {
      function IrreversibleTransform() {
        Transform.call(this);
      }
      IrreversibleTransform.prototype = Object.create(Transform.prototype);
      IrreversibleTransform.prototype.filter = function irreversibleTransformFilter(x, offset, length) {
        var len = length >> 1;
        offset = offset | 0;
        var j, n, current, next;
        var alpha = -1.586134342059924;
        var beta = -.052980118572961;
        var gamma = .882911075530934;
        var delta = .443506852043971;
        var K = 1.230174104914001;
        var K_ = 1 / K;
        j = offset - 3;
        for (n = len + 4; n--; j += 2) {
          x[j] *= K_;
        }
        j = offset - 2;
        current = delta * x[j - 1];
        for (n = len + 3; n--; j += 2) {
          next = delta * x[j + 1];
          x[j] = K * x[j] - current - next;
          if (n--) {
            j += 2;
            current = delta * x[j + 1];
            x[j] = K * x[j] - current - next;
          } else {
            break;
          }
        }
        j = offset - 1;
        current = gamma * x[j - 1];
        for (n = len + 2; n--; j += 2) {
          next = gamma * x[j + 1];
          x[j] -= current + next;
          if (n--) {
            j += 2;
            current = gamma * x[j + 1];
            x[j] -= current + next;
          } else {
            break;
          }
        }
        j = offset;
        current = beta * x[j - 1];
        for (n = len + 1; n--; j += 2) {
          next = beta * x[j + 1];
          x[j] -= current + next;
          if (n--) {
            j += 2;
            current = beta * x[j + 1];
            x[j] -= current + next;
          } else {
            break;
          }
        }
        if (len !== 0) {
          j = offset + 1;
          current = alpha * x[j - 1];
          for (n = len; n--; j += 2) {
            next = alpha * x[j + 1];
            x[j] -= current + next;
            if (n--) {
              j += 2;
              current = alpha * x[j + 1];
              x[j] -= current + next;
            } else {
              break;
            }
          }
        }
      };
      return IrreversibleTransform;
    }();
    var ReversibleTransform = function ReversibleTransformClosure() {
      function ReversibleTransform() {
        Transform.call(this);
      }
      ReversibleTransform.prototype = Object.create(Transform.prototype);
      ReversibleTransform.prototype.filter = function reversibleTransformFilter(x, offset, length) {
        var len = length >> 1;
        offset = offset | 0;
        var j, n;
        for (j = offset, n = len + 1; n--; j += 2) {
          x[j] -= x[j - 1] + x[j + 1] + 2 >> 2;
        }
        for (j = offset + 1, n = len; n--; j += 2) {
          x[j] += x[j - 1] + x[j + 1] >> 1;
        }
      };
      return ReversibleTransform;
    }();
    return JpxImage;
  }();
  "use strict";
  var Jbig2Image = function Jbig2ImageClosure() {
    function ContextCache() {}
    ContextCache.prototype = {
      getContexts: function(id) {
        if (id in this) {
          return this[id];
        }
        return this[id] = new Int8Array(1 << 16);
      }
    };
    function DecodingContext(data, start, end) {
      this.data = data;
      this.start = start;
      this.end = end;
    }
    DecodingContext.prototype = {
      get decoder() {
        var decoder = new ArithmeticDecoder(this.data, this.start, this.end);
        return shadow(this, "decoder", decoder);
      },
      get contextCache() {
        var cache = new ContextCache();
        return shadow(this, "contextCache", cache);
      }
    };
    function decodeInteger(contextCache, procedure, decoder) {
      var contexts = contextCache.getContexts(procedure);
      var prev = 1;
      function readBits(length) {
        var v = 0;
        for (var i = 0; i < length; i++) {
          var bit = decoder.readBit(contexts, prev);
          prev = prev < 256 ? prev << 1 | bit : (prev << 1 | bit) & 511 | 256;
          v = v << 1 | bit;
        }
        return v >>> 0;
      }
      var sign = readBits(1);
      var value = readBits(1) ? readBits(1) ? readBits(1) ? readBits(1) ? readBits(1) ? readBits(32) + 4436 : readBits(12) + 340 : readBits(8) + 84 : readBits(6) + 20 : readBits(4) + 4 : readBits(2);
      return sign === 0 ? value : value > 0 ? -value : null;
    }
    function decodeIAID(contextCache, decoder, codeLength) {
      var contexts = contextCache.getContexts("IAID");
      var prev = 1;
      for (var i = 0; i < codeLength; i++) {
        var bit = decoder.readBit(contexts, prev);
        prev = prev << 1 | bit;
      }
      if (codeLength < 31) {
        return prev & (1 << codeLength) - 1;
      }
      return prev & 2147483647;
    }
    var SegmentTypes = [ "SymbolDictionary", null, null, null, "IntermediateTextRegion", null, "ImmediateTextRegion", "ImmediateLosslessTextRegion", null, null, null, null, null, null, null, null, "patternDictionary", null, null, null, "IntermediateHalftoneRegion", null, "ImmediateHalftoneRegion", "ImmediateLosslessHalftoneRegion", null, null, null, null, null, null, null, null, null, null, null, null, "IntermediateGenericRegion", null, "ImmediateGenericRegion", "ImmediateLosslessGenericRegion", "IntermediateGenericRefinementRegion", null, "ImmediateGenericRefinementRegion", "ImmediateLosslessGenericRefinementRegion", null, null, null, null, "PageInformation", "EndOfPage", "EndOfStripe", "EndOfFile", "Profiles", "Tables", null, null, null, null, null, null, null, null, "Extension" ];
    var CodingTemplates = [ [ {
      x: -1,
      y: -2
    }, {
      x: 0,
      y: -2
    }, {
      x: 1,
      y: -2
    }, {
      x: -2,
      y: -1
    }, {
      x: -1,
      y: -1
    }, {
      x: 0,
      y: -1
    }, {
      x: 1,
      y: -1
    }, {
      x: 2,
      y: -1
    }, {
      x: -4,
      y: 0
    }, {
      x: -3,
      y: 0
    }, {
      x: -2,
      y: 0
    }, {
      x: -1,
      y: 0
    } ], [ {
      x: -1,
      y: -2
    }, {
      x: 0,
      y: -2
    }, {
      x: 1,
      y: -2
    }, {
      x: 2,
      y: -2
    }, {
      x: -2,
      y: -1
    }, {
      x: -1,
      y: -1
    }, {
      x: 0,
      y: -1
    }, {
      x: 1,
      y: -1
    }, {
      x: 2,
      y: -1
    }, {
      x: -3,
      y: 0
    }, {
      x: -2,
      y: 0
    }, {
      x: -1,
      y: 0
    } ], [ {
      x: -1,
      y: -2
    }, {
      x: 0,
      y: -2
    }, {
      x: 1,
      y: -2
    }, {
      x: -2,
      y: -1
    }, {
      x: -1,
      y: -1
    }, {
      x: 0,
      y: -1
    }, {
      x: 1,
      y: -1
    }, {
      x: -2,
      y: 0
    }, {
      x: -1,
      y: 0
    } ], [ {
      x: -3,
      y: -1
    }, {
      x: -2,
      y: -1
    }, {
      x: -1,
      y: -1
    }, {
      x: 0,
      y: -1
    }, {
      x: 1,
      y: -1
    }, {
      x: -4,
      y: 0
    }, {
      x: -3,
      y: 0
    }, {
      x: -2,
      y: 0
    }, {
      x: -1,
      y: 0
    } ] ];
    var RefinementTemplates = [ {
      coding: [ {
        x: 0,
        y: -1
      }, {
        x: 1,
        y: -1
      }, {
        x: -1,
        y: 0
      } ],
      reference: [ {
        x: 0,
        y: -1
      }, {
        x: 1,
        y: -1
      }, {
        x: -1,
        y: 0
      }, {
        x: 0,
        y: 0
      }, {
        x: 1,
        y: 0
      }, {
        x: -1,
        y: 1
      }, {
        x: 0,
        y: 1
      }, {
        x: 1,
        y: 1
      } ]
    }, {
      coding: [ {
        x: -1,
        y: -1
      }, {
        x: 0,
        y: -1
      }, {
        x: 1,
        y: -1
      }, {
        x: -1,
        y: 0
      } ],
      reference: [ {
        x: 0,
        y: -1
      }, {
        x: -1,
        y: 0
      }, {
        x: 0,
        y: 0
      }, {
        x: 1,
        y: 0
      }, {
        x: 0,
        y: 1
      }, {
        x: 1,
        y: 1
      } ]
    } ];
    var ReusedContexts = [ 39717, 1941, 229, 405 ];
    var RefinementReusedContexts = [ 32, 8 ];
    function decodeBitmapTemplate0(width, height, decodingContext) {
      var decoder = decodingContext.decoder;
      var contexts = decodingContext.contextCache.getContexts("GB");
      var contextLabel, i, j, pixel, row, row1, row2, bitmap = [];
      var OLD_PIXEL_MASK = 31735;
      for (i = 0; i < height; i++) {
        row = bitmap[i] = new Uint8Array(width);
        row1 = i < 1 ? row : bitmap[i - 1];
        row2 = i < 2 ? row : bitmap[i - 2];
        contextLabel = row2[0] << 13 | row2[1] << 12 | row2[2] << 11 | row1[0] << 7 | row1[1] << 6 | row1[2] << 5 | row1[3] << 4;
        for (j = 0; j < width; j++) {
          row[j] = pixel = decoder.readBit(contexts, contextLabel);
          contextLabel = (contextLabel & OLD_PIXEL_MASK) << 1 | (j + 3 < width ? row2[j + 3] << 11 : 0) | (j + 4 < width ? row1[j + 4] << 4 : 0) | pixel;
        }
      }
      return bitmap;
    }
    function decodeBitmap(mmr, width, height, templateIndex, prediction, skip, at, decodingContext) {
      if (mmr) {
        error("JBIG2 error: MMR encoding is not supported");
      }
      if (templateIndex === 0 && !skip && !prediction && at.length === 4 && at[0].x === 3 && at[0].y === -1 && at[1].x === -3 && at[1].y === -1 && at[2].x === 2 && at[2].y === -2 && at[3].x === -2 && at[3].y === -2) {
        return decodeBitmapTemplate0(width, height, decodingContext);
      }
      var useskip = !!skip;
      var template = CodingTemplates[templateIndex].concat(at);
      template.sort(function(a, b) {
        return a.y - b.y || a.x - b.x;
      });
      var templateLength = template.length;
      var templateX = new Int8Array(templateLength);
      var templateY = new Int8Array(templateLength);
      var changingTemplateEntries = [];
      var reuseMask = 0, minX = 0, maxX = 0, minY = 0;
      var c, k;
      for (k = 0; k < templateLength; k++) {
        templateX[k] = template[k].x;
        templateY[k] = template[k].y;
        minX = Math.min(minX, template[k].x);
        maxX = Math.max(maxX, template[k].x);
        minY = Math.min(minY, template[k].y);
        if (k < templateLength - 1 && template[k].y === template[k + 1].y && template[k].x === template[k + 1].x - 1) {
          reuseMask |= 1 << templateLength - 1 - k;
        } else {
          changingTemplateEntries.push(k);
        }
      }
      var changingEntriesLength = changingTemplateEntries.length;
      var changingTemplateX = new Int8Array(changingEntriesLength);
      var changingTemplateY = new Int8Array(changingEntriesLength);
      var changingTemplateBit = new Uint16Array(changingEntriesLength);
      for (c = 0; c < changingEntriesLength; c++) {
        k = changingTemplateEntries[c];
        changingTemplateX[c] = template[k].x;
        changingTemplateY[c] = template[k].y;
        changingTemplateBit[c] = 1 << templateLength - 1 - k;
      }
      var sbb_left = -minX;
      var sbb_top = -minY;
      var sbb_right = width - maxX;
      var pseudoPixelContext = ReusedContexts[templateIndex];
      var row = new Uint8Array(width);
      var bitmap = [];
      var decoder = decodingContext.decoder;
      var contexts = decodingContext.contextCache.getContexts("GB");
      var ltp = 0, j, i0, j0, contextLabel = 0, bit, shift;
      for (var i = 0; i < height; i++) {
        if (prediction) {
          var sltp = decoder.readBit(contexts, pseudoPixelContext);
          ltp ^= sltp;
          if (ltp) {
            bitmap.push(row);
            continue;
          }
        }
        row = new Uint8Array(row);
        bitmap.push(row);
        for (j = 0; j < width; j++) {
          if (useskip && skip[i][j]) {
            row[j] = 0;
            continue;
          }
          if (j >= sbb_left && j < sbb_right && i >= sbb_top) {
            contextLabel = contextLabel << 1 & reuseMask;
            for (k = 0; k < changingEntriesLength; k++) {
              i0 = i + changingTemplateY[k];
              j0 = j + changingTemplateX[k];
              bit = bitmap[i0][j0];
              if (bit) {
                bit = changingTemplateBit[k];
                contextLabel |= bit;
              }
            }
          } else {
            contextLabel = 0;
            shift = templateLength - 1;
            for (k = 0; k < templateLength; k++, shift--) {
              j0 = j + templateX[k];
              if (j0 >= 0 && j0 < width) {
                i0 = i + templateY[k];
                if (i0 >= 0) {
                  bit = bitmap[i0][j0];
                  if (bit) {
                    contextLabel |= bit << shift;
                  }
                }
              }
            }
          }
          var pixel = decoder.readBit(contexts, contextLabel);
          row[j] = pixel;
        }
      }
      return bitmap;
    }
    function decodeRefinement(width, height, templateIndex, referenceBitmap, offsetX, offsetY, prediction, at, decodingContext) {
      var codingTemplate = RefinementTemplates[templateIndex].coding;
      if (templateIndex === 0) {
        codingTemplate = codingTemplate.concat([ at[0] ]);
      }
      var codingTemplateLength = codingTemplate.length;
      var codingTemplateX = new Int32Array(codingTemplateLength);
      var codingTemplateY = new Int32Array(codingTemplateLength);
      var k;
      for (k = 0; k < codingTemplateLength; k++) {
        codingTemplateX[k] = codingTemplate[k].x;
        codingTemplateY[k] = codingTemplate[k].y;
      }
      var referenceTemplate = RefinementTemplates[templateIndex].reference;
      if (templateIndex === 0) {
        referenceTemplate = referenceTemplate.concat([ at[1] ]);
      }
      var referenceTemplateLength = referenceTemplate.length;
      var referenceTemplateX = new Int32Array(referenceTemplateLength);
      var referenceTemplateY = new Int32Array(referenceTemplateLength);
      for (k = 0; k < referenceTemplateLength; k++) {
        referenceTemplateX[k] = referenceTemplate[k].x;
        referenceTemplateY[k] = referenceTemplate[k].y;
      }
      var referenceWidth = referenceBitmap[0].length;
      var referenceHeight = referenceBitmap.length;
      var pseudoPixelContext = RefinementReusedContexts[templateIndex];
      var bitmap = [];
      var decoder = decodingContext.decoder;
      var contexts = decodingContext.contextCache.getContexts("GR");
      var ltp = 0;
      for (var i = 0; i < height; i++) {
        if (prediction) {
          var sltp = decoder.readBit(contexts, pseudoPixelContext);
          ltp ^= sltp;
          if (ltp) {
            error("JBIG2 error: prediction is not supported");
          }
        }
        var row = new Uint8Array(width);
        bitmap.push(row);
        for (var j = 0; j < width; j++) {
          var i0, j0;
          var contextLabel = 0;
          for (k = 0; k < codingTemplateLength; k++) {
            i0 = i + codingTemplateY[k];
            j0 = j + codingTemplateX[k];
            if (i0 < 0 || j0 < 0 || j0 >= width) {
              contextLabel <<= 1;
            } else {
              contextLabel = contextLabel << 1 | bitmap[i0][j0];
            }
          }
          for (k = 0; k < referenceTemplateLength; k++) {
            i0 = i + referenceTemplateY[k] + offsetY;
            j0 = j + referenceTemplateX[k] + offsetX;
            if (i0 < 0 || i0 >= referenceHeight || j0 < 0 || j0 >= referenceWidth) {
              contextLabel <<= 1;
            } else {
              contextLabel = contextLabel << 1 | referenceBitmap[i0][j0];
            }
          }
          var pixel = decoder.readBit(contexts, contextLabel);
          row[j] = pixel;
        }
      }
      return bitmap;
    }
    function decodeSymbolDictionary(huffman, refinement, symbols, numberOfNewSymbols, numberOfExportedSymbols, huffmanTables, templateIndex, at, refinementTemplateIndex, refinementAt, decodingContext) {
      if (huffman) {
        error("JBIG2 error: huffman is not supported");
      }
      var newSymbols = [];
      var currentHeight = 0;
      var symbolCodeLength = log2(symbols.length + numberOfNewSymbols);
      var decoder = decodingContext.decoder;
      var contextCache = decodingContext.contextCache;
      while (newSymbols.length < numberOfNewSymbols) {
        var deltaHeight = decodeInteger(contextCache, "IADH", decoder);
        currentHeight += deltaHeight;
        var currentWidth = 0;
        var totalWidth = 0;
        while (true) {
          var deltaWidth = decodeInteger(contextCache, "IADW", decoder);
          if (deltaWidth === null) {
            break;
          }
          currentWidth += deltaWidth;
          totalWidth += currentWidth;
          var bitmap;
          if (refinement) {
            var numberOfInstances = decodeInteger(contextCache, "IAAI", decoder);
            if (numberOfInstances > 1) {
              bitmap = decodeTextRegion(huffman, refinement, currentWidth, currentHeight, 0, numberOfInstances, 1, symbols.concat(newSymbols), symbolCodeLength, 0, 0, 1, 0, huffmanTables, refinementTemplateIndex, refinementAt, decodingContext);
            } else {
              var symbolId = decodeIAID(contextCache, decoder, symbolCodeLength);
              var rdx = decodeInteger(contextCache, "IARDX", decoder);
              var rdy = decodeInteger(contextCache, "IARDY", decoder);
              var symbol = symbolId < symbols.length ? symbols[symbolId] : newSymbols[symbolId - symbols.length];
              bitmap = decodeRefinement(currentWidth, currentHeight, refinementTemplateIndex, symbol, rdx, rdy, false, refinementAt, decodingContext);
            }
          } else {
            bitmap = decodeBitmap(false, currentWidth, currentHeight, templateIndex, false, null, at, decodingContext);
          }
          newSymbols.push(bitmap);
        }
      }
      var exportedSymbols = [];
      var flags = [], currentFlag = false;
      var totalSymbolsLength = symbols.length + numberOfNewSymbols;
      while (flags.length < totalSymbolsLength) {
        var runLength = decodeInteger(contextCache, "IAEX", decoder);
        while (runLength--) {
          flags.push(currentFlag);
        }
        currentFlag = !currentFlag;
      }
      for (var i = 0, ii = symbols.length; i < ii; i++) {
        if (flags[i]) {
          exportedSymbols.push(symbols[i]);
        }
      }
      for (var j = 0; j < numberOfNewSymbols; i++, j++) {
        if (flags[i]) {
          exportedSymbols.push(newSymbols[j]);
        }
      }
      return exportedSymbols;
    }
    function decodeTextRegion(huffman, refinement, width, height, defaultPixelValue, numberOfSymbolInstances, stripSize, inputSymbols, symbolCodeLength, transposed, dsOffset, referenceCorner, combinationOperator, huffmanTables, refinementTemplateIndex, refinementAt, decodingContext) {
      if (huffman) {
        error("JBIG2 error: huffman is not supported");
      }
      var bitmap = [];
      var i, row;
      for (i = 0; i < height; i++) {
        row = new Uint8Array(width);
        if (defaultPixelValue) {
          for (var j = 0; j < width; j++) {
            row[j] = defaultPixelValue;
          }
        }
        bitmap.push(row);
      }
      var decoder = decodingContext.decoder;
      var contextCache = decodingContext.contextCache;
      var stripT = -decodeInteger(contextCache, "IADT", decoder);
      var firstS = 0;
      i = 0;
      while (i < numberOfSymbolInstances) {
        var deltaT = decodeInteger(contextCache, "IADT", decoder);
        stripT += deltaT;
        var deltaFirstS = decodeInteger(contextCache, "IAFS", decoder);
        firstS += deltaFirstS;
        var currentS = firstS;
        do {
          var currentT = stripSize === 1 ? 0 : decodeInteger(contextCache, "IAIT", decoder);
          var t = stripSize * stripT + currentT;
          var symbolId = decodeIAID(contextCache, decoder, symbolCodeLength);
          var applyRefinement = refinement && decodeInteger(contextCache, "IARI", decoder);
          var symbolBitmap = inputSymbols[symbolId];
          var symbolWidth = symbolBitmap[0].length;
          var symbolHeight = symbolBitmap.length;
          if (applyRefinement) {
            var rdw = decodeInteger(contextCache, "IARDW", decoder);
            var rdh = decodeInteger(contextCache, "IARDH", decoder);
            var rdx = decodeInteger(contextCache, "IARDX", decoder);
            var rdy = decodeInteger(contextCache, "IARDY", decoder);
            symbolWidth += rdw;
            symbolHeight += rdh;
            symbolBitmap = decodeRefinement(symbolWidth, symbolHeight, refinementTemplateIndex, symbolBitmap, (rdw >> 1) + rdx, (rdh >> 1) + rdy, false, refinementAt, decodingContext);
          }
          var offsetT = t - (referenceCorner & 1 ? 0 : symbolHeight);
          var offsetS = currentS - (referenceCorner & 2 ? symbolWidth : 0);
          var s2, t2, symbolRow;
          if (transposed) {
            for (s2 = 0; s2 < symbolHeight; s2++) {
              row = bitmap[offsetS + s2];
              if (!row) {
                continue;
              }
              symbolRow = symbolBitmap[s2];
              var maxWidth = Math.min(width - offsetT, symbolWidth);
              switch (combinationOperator) {
                case 0:
                  for (t2 = 0; t2 < maxWidth; t2++) {
                    row[offsetT + t2] |= symbolRow[t2];
                  }
                  break;

                case 2:
                  for (t2 = 0; t2 < maxWidth; t2++) {
                    row[offsetT + t2] ^= symbolRow[t2];
                  }
                  break;

                default:
                  error("JBIG2 error: operator " + combinationOperator + " is not supported");
              }
            }
            currentS += symbolHeight - 1;
          } else {
            for (t2 = 0; t2 < symbolHeight; t2++) {
              row = bitmap[offsetT + t2];
              if (!row) {
                continue;
              }
              symbolRow = symbolBitmap[t2];
              switch (combinationOperator) {
                case 0:
                  for (s2 = 0; s2 < symbolWidth; s2++) {
                    row[offsetS + s2] |= symbolRow[s2];
                  }
                  break;

                case 2:
                  for (s2 = 0; s2 < symbolWidth; s2++) {
                    row[offsetS + s2] ^= symbolRow[s2];
                  }
                  break;

                default:
                  error("JBIG2 error: operator " + combinationOperator + " is not supported");
              }
            }
            currentS += symbolWidth - 1;
          }
          i++;
          var deltaS = decodeInteger(contextCache, "IADS", decoder);
          if (deltaS === null) {
            break;
          }
          currentS += deltaS + dsOffset;
        } while (true);
      }
      return bitmap;
    }
    function readSegmentHeader(data, start) {
      var segmentHeader = {};
      segmentHeader.number = readUint32(data, start);
      var flags = data[start + 4];
      var segmentType = flags & 63;
      if (!SegmentTypes[segmentType]) {
        error("JBIG2 error: invalid segment type: " + segmentType);
      }
      segmentHeader.type = segmentType;
      segmentHeader.typeName = SegmentTypes[segmentType];
      segmentHeader.deferredNonRetain = !!(flags & 128);
      var pageAssociationFieldSize = !!(flags & 64);
      var referredFlags = data[start + 5];
      var referredToCount = referredFlags >> 5 & 7;
      var retainBits = [ referredFlags & 31 ];
      var position = start + 6;
      if (referredFlags === 7) {
        referredToCount = readUint32(data, position - 1) & 536870911;
        position += 3;
        var bytes = referredToCount + 7 >> 3;
        retainBits[0] = data[position++];
        while (--bytes > 0) {
          retainBits.push(data[position++]);
        }
      } else if (referredFlags === 5 || referredFlags === 6) {
        error("JBIG2 error: invalid referred-to flags");
      }
      segmentHeader.retainBits = retainBits;
      var referredToSegmentNumberSize = segmentHeader.number <= 256 ? 1 : segmentHeader.number <= 65536 ? 2 : 4;
      var referredTo = [];
      var i, ii;
      for (i = 0; i < referredToCount; i++) {
        var number = referredToSegmentNumberSize === 1 ? data[position] : referredToSegmentNumberSize === 2 ? readUint16(data, position) : readUint32(data, position);
        referredTo.push(number);
        position += referredToSegmentNumberSize;
      }
      segmentHeader.referredTo = referredTo;
      if (!pageAssociationFieldSize) {
        segmentHeader.pageAssociation = data[position++];
      } else {
        segmentHeader.pageAssociation = readUint32(data, position);
        position += 4;
      }
      segmentHeader.length = readUint32(data, position);
      position += 4;
      if (segmentHeader.length === 4294967295) {
        if (segmentType === 38) {
          var genericRegionInfo = readRegionSegmentInformation(data, position);
          var genericRegionSegmentFlags = data[position + RegionSegmentInformationFieldLength];
          var genericRegionMmr = !!(genericRegionSegmentFlags & 1);
          var searchPatternLength = 6;
          var searchPattern = new Uint8Array(searchPatternLength);
          if (!genericRegionMmr) {
            searchPattern[0] = 255;
            searchPattern[1] = 172;
          }
          searchPattern[2] = genericRegionInfo.height >>> 24 & 255;
          searchPattern[3] = genericRegionInfo.height >> 16 & 255;
          searchPattern[4] = genericRegionInfo.height >> 8 & 255;
          searchPattern[5] = genericRegionInfo.height & 255;
          for (i = position, ii = data.length; i < ii; i++) {
            var j = 0;
            while (j < searchPatternLength && searchPattern[j] === data[i + j]) {
              j++;
            }
            if (j === searchPatternLength) {
              segmentHeader.length = i + searchPatternLength;
              break;
            }
          }
          if (segmentHeader.length === 4294967295) {
            error("JBIG2 error: segment end was not found");
          }
        } else {
          error("JBIG2 error: invalid unknown segment length");
        }
      }
      segmentHeader.headerEnd = position;
      return segmentHeader;
    }
    function readSegments(header, data, start, end) {
      var segments = [];
      var position = start;
      while (position < end) {
        var segmentHeader = readSegmentHeader(data, position);
        position = segmentHeader.headerEnd;
        var segment = {
          header: segmentHeader,
          data: data
        };
        if (!header.randomAccess) {
          segment.start = position;
          position += segmentHeader.length;
          segment.end = position;
        }
        segments.push(segment);
        if (segmentHeader.type === 51) {
          break;
        }
      }
      if (header.randomAccess) {
        for (var i = 0, ii = segments.length; i < ii; i++) {
          segments[i].start = position;
          position += segments[i].header.length;
          segments[i].end = position;
        }
      }
      return segments;
    }
    function readRegionSegmentInformation(data, start) {
      return {
        width: readUint32(data, start),
        height: readUint32(data, start + 4),
        x: readUint32(data, start + 8),
        y: readUint32(data, start + 12),
        combinationOperator: data[start + 16] & 7
      };
    }
    var RegionSegmentInformationFieldLength = 17;
    function processSegment(segment, visitor) {
      var header = segment.header;
      var data = segment.data, position = segment.start, end = segment.end;
      var args, at, i, atLength;
      switch (header.type) {
        case 0:
          var dictionary = {};
          var dictionaryFlags = readUint16(data, position);
          dictionary.huffman = !!(dictionaryFlags & 1);
          dictionary.refinement = !!(dictionaryFlags & 2);
          dictionary.huffmanDHSelector = dictionaryFlags >> 2 & 3;
          dictionary.huffmanDWSelector = dictionaryFlags >> 4 & 3;
          dictionary.bitmapSizeSelector = dictionaryFlags >> 6 & 1;
          dictionary.aggregationInstancesSelector = dictionaryFlags >> 7 & 1;
          dictionary.bitmapCodingContextUsed = !!(dictionaryFlags & 256);
          dictionary.bitmapCodingContextRetained = !!(dictionaryFlags & 512);
          dictionary.template = dictionaryFlags >> 10 & 3;
          dictionary.refinementTemplate = dictionaryFlags >> 12 & 1;
          position += 2;
          if (!dictionary.huffman) {
            atLength = dictionary.template === 0 ? 4 : 1;
            at = [];
            for (i = 0; i < atLength; i++) {
              at.push({
                x: readInt8(data, position),
                y: readInt8(data, position + 1)
              });
              position += 2;
            }
            dictionary.at = at;
          }
          if (dictionary.refinement && !dictionary.refinementTemplate) {
            at = [];
            for (i = 0; i < 2; i++) {
              at.push({
                x: readInt8(data, position),
                y: readInt8(data, position + 1)
              });
              position += 2;
            }
            dictionary.refinementAt = at;
          }
          dictionary.numberOfExportedSymbols = readUint32(data, position);
          position += 4;
          dictionary.numberOfNewSymbols = readUint32(data, position);
          position += 4;
          args = [ dictionary, header.number, header.referredTo, data, position, end ];
          break;

        case 6:
        case 7:
          var textRegion = {};
          textRegion.info = readRegionSegmentInformation(data, position);
          position += RegionSegmentInformationFieldLength;
          var textRegionSegmentFlags = readUint16(data, position);
          position += 2;
          textRegion.huffman = !!(textRegionSegmentFlags & 1);
          textRegion.refinement = !!(textRegionSegmentFlags & 2);
          textRegion.stripSize = 1 << (textRegionSegmentFlags >> 2 & 3);
          textRegion.referenceCorner = textRegionSegmentFlags >> 4 & 3;
          textRegion.transposed = !!(textRegionSegmentFlags & 64);
          textRegion.combinationOperator = textRegionSegmentFlags >> 7 & 3;
          textRegion.defaultPixelValue = textRegionSegmentFlags >> 9 & 1;
          textRegion.dsOffset = textRegionSegmentFlags << 17 >> 27;
          textRegion.refinementTemplate = textRegionSegmentFlags >> 15 & 1;
          if (textRegion.huffman) {
            var textRegionHuffmanFlags = readUint16(data, position);
            position += 2;
            textRegion.huffmanFS = textRegionHuffmanFlags & 3;
            textRegion.huffmanDS = textRegionHuffmanFlags >> 2 & 3;
            textRegion.huffmanDT = textRegionHuffmanFlags >> 4 & 3;
            textRegion.huffmanRefinementDW = textRegionHuffmanFlags >> 6 & 3;
            textRegion.huffmanRefinementDH = textRegionHuffmanFlags >> 8 & 3;
            textRegion.huffmanRefinementDX = textRegionHuffmanFlags >> 10 & 3;
            textRegion.huffmanRefinementDY = textRegionHuffmanFlags >> 12 & 3;
            textRegion.huffmanRefinementSizeSelector = !!(textRegionHuffmanFlags & 14);
          }
          if (textRegion.refinement && !textRegion.refinementTemplate) {
            at = [];
            for (i = 0; i < 2; i++) {
              at.push({
                x: readInt8(data, position),
                y: readInt8(data, position + 1)
              });
              position += 2;
            }
            textRegion.refinementAt = at;
          }
          textRegion.numberOfSymbolInstances = readUint32(data, position);
          position += 4;
          if (textRegion.huffman) {
            error("JBIG2 error: huffman is not supported");
          }
          args = [ textRegion, header.referredTo, data, position, end ];
          break;

        case 38:
        case 39:
          var genericRegion = {};
          genericRegion.info = readRegionSegmentInformation(data, position);
          position += RegionSegmentInformationFieldLength;
          var genericRegionSegmentFlags = data[position++];
          genericRegion.mmr = !!(genericRegionSegmentFlags & 1);
          genericRegion.template = genericRegionSegmentFlags >> 1 & 3;
          genericRegion.prediction = !!(genericRegionSegmentFlags & 8);
          if (!genericRegion.mmr) {
            atLength = genericRegion.template === 0 ? 4 : 1;
            at = [];
            for (i = 0; i < atLength; i++) {
              at.push({
                x: readInt8(data, position),
                y: readInt8(data, position + 1)
              });
              position += 2;
            }
            genericRegion.at = at;
          }
          args = [ genericRegion, data, position, end ];
          break;

        case 48:
          var pageInfo = {
            width: readUint32(data, position),
            height: readUint32(data, position + 4),
            resolutionX: readUint32(data, position + 8),
            resolutionY: readUint32(data, position + 12)
          };
          if (pageInfo.height === 4294967295) {
            delete pageInfo.height;
          }
          var pageSegmentFlags = data[position + 16];
          var pageStripingInformatiom = readUint16(data, position + 17);
          pageInfo.lossless = !!(pageSegmentFlags & 1);
          pageInfo.refinement = !!(pageSegmentFlags & 2);
          pageInfo.defaultPixelValue = pageSegmentFlags >> 2 & 1;
          pageInfo.combinationOperator = pageSegmentFlags >> 3 & 3;
          pageInfo.requiresBuffer = !!(pageSegmentFlags & 32);
          pageInfo.combinationOperatorOverride = !!(pageSegmentFlags & 64);
          args = [ pageInfo ];
          break;

        case 49:
          break;

        case 50:
          break;

        case 51:
          break;

        case 62:
          break;

        default:
          error("JBIG2 error: segment type " + header.typeName + "(" + header.type + ") is not implemented");
      }
      var callbackName = "on" + header.typeName;
      if (callbackName in visitor) {
        visitor[callbackName].apply(visitor, args);
      }
    }
    function processSegments(segments, visitor) {
      for (var i = 0, ii = segments.length; i < ii; i++) {
        processSegment(segments[i], visitor);
      }
    }
    function parseJbig2(data, start, end) {
      var position = start;
      if (data[position] !== 151 || data[position + 1] !== 74 || data[position + 2] !== 66 || data[position + 3] !== 50 || data[position + 4] !== 13 || data[position + 5] !== 10 || data[position + 6] !== 26 || data[position + 7] !== 10) {
        error("JBIG2 error: invalid header");
      }
      var header = {};
      position += 8;
      var flags = data[position++];
      header.randomAccess = !(flags & 1);
      if (!(flags & 2)) {
        header.numberOfPages = readUint32(data, position);
        position += 4;
      }
      var segments = readSegments(header, data, position, end);
      error("Not implemented");
    }
    function parseJbig2Chunks(chunks) {
      var visitor = new SimpleSegmentVisitor();
      for (var i = 0, ii = chunks.length; i < ii; i++) {
        var chunk = chunks[i];
        var segments = readSegments({}, chunk.data, chunk.start, chunk.end);
        processSegments(segments, visitor);
      }
      return visitor;
    }
    function SimpleSegmentVisitor() {}
    SimpleSegmentVisitor.prototype = {
      onPageInformation: function SimpleSegmentVisitor_onPageInformation(info) {
        this.currentPageInfo = info;
        var rowSize = info.width + 7 >> 3;
        var buffer = new Uint8Array(rowSize * info.height);
        if (info.defaultPixelValue) {
          for (var i = 0, ii = buffer.length; i < ii; i++) {
            buffer[i] = 255;
          }
        }
        this.buffer = buffer;
      },
      drawBitmap: function SimpleSegmentVisitor_drawBitmap(regionInfo, bitmap) {
        var pageInfo = this.currentPageInfo;
        var width = regionInfo.width, height = regionInfo.height;
        var rowSize = pageInfo.width + 7 >> 3;
        var combinationOperator = pageInfo.combinationOperatorOverride ? regionInfo.combinationOperator : pageInfo.combinationOperator;
        var buffer = this.buffer;
        var mask0 = 128 >> (regionInfo.x & 7);
        var offset0 = regionInfo.y * rowSize + (regionInfo.x >> 3);
        var i, j, mask, offset;
        switch (combinationOperator) {
          case 0:
            for (i = 0; i < height; i++) {
              mask = mask0;
              offset = offset0;
              for (j = 0; j < width; j++) {
                if (bitmap[i][j]) {
                  buffer[offset] |= mask;
                }
                mask >>= 1;
                if (!mask) {
                  mask = 128;
                  offset++;
                }
              }
              offset0 += rowSize;
            }
            break;

          case 2:
            for (i = 0; i < height; i++) {
              mask = mask0;
              offset = offset0;
              for (j = 0; j < width; j++) {
                if (bitmap[i][j]) {
                  buffer[offset] ^= mask;
                }
                mask >>= 1;
                if (!mask) {
                  mask = 128;
                  offset++;
                }
              }
              offset0 += rowSize;
            }
            break;

          default:
            error("JBIG2 error: operator " + combinationOperator + " is not supported");
        }
      },
      onImmediateGenericRegion: function SimpleSegmentVisitor_onImmediateGenericRegion(region, data, start, end) {
        var regionInfo = region.info;
        var decodingContext = new DecodingContext(data, start, end);
        var bitmap = decodeBitmap(region.mmr, regionInfo.width, regionInfo.height, region.template, region.prediction, null, region.at, decodingContext);
        this.drawBitmap(regionInfo, bitmap);
      },
      onImmediateLosslessGenericRegion: function SimpleSegmentVisitor_onImmediateLosslessGenericRegion() {
        this.onImmediateGenericRegion.apply(this, arguments);
      },
      onSymbolDictionary: function SimpleSegmentVisitor_onSymbolDictionary(dictionary, currentSegment, referredSegments, data, start, end) {
        var huffmanTables;
        if (dictionary.huffman) {
          error("JBIG2 error: huffman is not supported");
        }
        var symbols = this.symbols;
        if (!symbols) {
          this.symbols = symbols = {};
        }
        var inputSymbols = [];
        for (var i = 0, ii = referredSegments.length; i < ii; i++) {
          inputSymbols = inputSymbols.concat(symbols[referredSegments[i]]);
        }
        var decodingContext = new DecodingContext(data, start, end);
        symbols[currentSegment] = decodeSymbolDictionary(dictionary.huffman, dictionary.refinement, inputSymbols, dictionary.numberOfNewSymbols, dictionary.numberOfExportedSymbols, huffmanTables, dictionary.template, dictionary.at, dictionary.refinementTemplate, dictionary.refinementAt, decodingContext);
      },
      onImmediateTextRegion: function SimpleSegmentVisitor_onImmediateTextRegion(region, referredSegments, data, start, end) {
        var regionInfo = region.info;
        var huffmanTables;
        var symbols = this.symbols;
        var inputSymbols = [];
        for (var i = 0, ii = referredSegments.length; i < ii; i++) {
          inputSymbols = inputSymbols.concat(symbols[referredSegments[i]]);
        }
        var symbolCodeLength = log2(inputSymbols.length);
        var decodingContext = new DecodingContext(data, start, end);
        var bitmap = decodeTextRegion(region.huffman, region.refinement, regionInfo.width, regionInfo.height, region.defaultPixelValue, region.numberOfSymbolInstances, region.stripSize, inputSymbols, symbolCodeLength, region.transposed, region.dsOffset, region.referenceCorner, region.combinationOperator, huffmanTables, region.refinementTemplate, region.refinementAt, decodingContext);
        this.drawBitmap(regionInfo, bitmap);
      },
      onImmediateLosslessTextRegion: function SimpleSegmentVisitor_onImmediateLosslessTextRegion() {
        this.onImmediateTextRegion.apply(this, arguments);
      }
    };
    function Jbig2Image() {}
    Jbig2Image.prototype = {
      parseChunks: function Jbig2Image_parseChunks(chunks) {
        return parseJbig2Chunks(chunks);
      }
    };
    return Jbig2Image;
  }();
  function log2(x) {
    var n = 1, i = 0;
    while (x > n) {
      n <<= 1;
      i++;
    }
    return i;
  }
  function readInt8(data, start) {
    return data[start] << 24 >> 24;
  }
  function readUint16(data, offset) {
    return data[offset] << 8 | data[offset + 1];
  }
  function readUint32(data, offset) {
    return (data[offset] << 24 | data[offset + 1] << 16 | data[offset + 2] << 8 | data[offset + 3]) >>> 0;
  }
  function shadow(obj, prop, value) {
    Object.defineProperty(obj, prop, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: false
    });
    return value;
  }
  var error = function() {
    console.error.apply(console, arguments);
    throw new Error("PDFJS error: " + arguments[0]);
  };
  var warn = function() {
    console.warn.apply(console, arguments);
  };
  var info = function() {
    console.info.apply(console, arguments);
  };
  Jbig2Image.prototype.parse = function parseJbig2(data) {
    var position = 0, end = data.length;
    if (data[position] !== 151 || data[position + 1] !== 74 || data[position + 2] !== 66 || data[position + 3] !== 50 || data[position + 4] !== 13 || data[position + 5] !== 10 || data[position + 6] !== 26 || data[position + 7] !== 10) {
      error("JBIG2 error: invalid header");
    }
    var header = {};
    position += 8;
    var flags = data[position++];
    header.randomAccess = !(flags & 1);
    if (!(flags & 2)) {
      header.numberOfPages = readUint32(data, position);
      position += 4;
    }
    var visitor = this.parseChunks([ {
      data: data,
      start: position,
      end: end
    } ]);
    var width = visitor.currentPageInfo.width;
    var height = visitor.currentPageInfo.height;
    var bitPacked = visitor.buffer;
    var data = new Uint8Array(width * height);
    var q = 0, k = 0;
    for (var i = 0; i < height; i++) {
      var mask = 0, buffer;
      for (var j = 0; j < width; j++) {
        if (!mask) {
          mask = 128;
          buffer = bitPacked[k++];
        }
        data[q++] = buffer & mask ? 0 : 255;
        mask >>= 1;
      }
    }
    this.width = width;
    this.height = height;
    this.data = data;
  };
  PDFJS.JpegImage = JpegImage;
  PDFJS.JpxImage = JpxImage;
  PDFJS.Jbig2Image = Jbig2Image;
})(PDFJS || (PDFJS = {}));

var JpegDecoder = PDFJS.JpegImage;

var JpxDecoder = PDFJS.JpxImage;

var Jbig2Decoder = PDFJS.Jbig2Image;

function win (data) {
  cordova.logger.log('won!');
  cordova.logger.log(data);
}

function lose (error) {
  cordova.logger.log('Camera error.');
  cordova.logger.log(error);
}

var c = document.getElementById("camera");
var ctx = c.getContext("2d");
function displayImage(url) {
  var j = new JpegImage();
  j.onload = function() {
    var d = ctx.getImageData(0,0,j.width,j.height);
    c.width = j.width;
    c.height = j.height;
    j.copyToImageData(d);
    ctx.putImageData(d, 0, 0);
  };
  j.load(url);
}

CanvasCamera = {

  start: function(options) {
    // TODO: add support for options (fps, capture quality, capture format, etc.)
    cordova.exec(win, lose, "CanvasCamera", "startCapture", [""]);
  },
  capture: function(data) {
    displayImage('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/4ge4SUNDX1BST0ZJTEUAAQEAAAeoYXBwbAIgAABtbnRyUkdCIFhZWiAH2QACABkACwAaAAthY3NwQVBQTAAAAABhcHBsAAAAAAAAAAAAAAAAAAAAAAAA9tYAAQAAAADTLWFwcGwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAtkZXNjAAABCAAAAG9kc2NtAAABeAAABWxjcHJ0AAAG5AAAADh3dHB0AAAHHAAAABRyWFlaAAAHMAAAABRnWFlaAAAHRAAAABRiWFlaAAAHWAAAABRyVFJDAAAHbAAAAA5jaGFkAAAHfAAAACxiVFJDAAAHbAAAAA5nVFJDAAAHbAAAAA5kZXNjAAAAAAAAABRHZW5lcmljIFJHQiBQcm9maWxlAAAAAAAAAAAAAAAUR2VuZXJpYyBSR0IgUHJvZmlsZQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAbWx1YwAAAAAAAAAeAAAADHNrU0sAAAAoAAABeGhySFIAAAAoAAABoGNhRVMAAAAkAAAByHB0QlIAAAAmAAAB7HVrVUEAAAAqAAACEmZyRlUAAAAoAAACPHpoVFcAAAAWAAACZGl0SVQAAAAoAAACem5iTk8AAAAmAAAComtvS1IAAAAWAAACyGNzQ1oAAAAiAAAC3mhlSUwAAAAeAAADAGRlREUAAAAsAAADHmh1SFUAAAAoAAADSnN2U0UAAAAmAAAConpoQ04AAAAWAAADcmphSlAAAAAaAAADiHJvUk8AAAAkAAADomVsR1IAAAAiAAADxnB0UE8AAAAmAAAD6G5sTkwAAAAoAAAEDmVzRVMAAAAmAAAD6HRoVEgAAAAkAAAENnRyVFIAAAAiAAAEWmZpRkkAAAAoAAAEfHBsUEwAAAAsAAAEpHJ1UlUAAAAiAAAE0GFyRUcAAAAmAAAE8mVuVVMAAAAmAAAFGGRhREsAAAAuAAAFPgBWAWEAZQBvAGIAZQBjAG4A/QAgAFIARwBCACAAcAByAG8AZgBpAGwARwBlAG4AZQByAGkBDQBrAGkAIABSAEcAQgAgAHAAcgBvAGYAaQBsAFAAZQByAGYAaQBsACAAUgBHAEIAIABnAGUAbgDoAHIAaQBjAFAAZQByAGYAaQBsACAAUgBHAEIAIABHAGUAbgDpAHIAaQBjAG8EFwQwBDMEMAQ7BEwEPQQ4BDkAIAQ/BEAEPgREBDAEOQQ7ACAAUgBHAEIAUAByAG8AZgBpAGwAIABnAOkAbgDpAHIAaQBxAHUAZQAgAFIAVgBCkBp1KAAgAFIARwBCACCCcl9pY8+P8ABQAHIAbwBmAGkAbABvACAAUgBHAEIAIABnAGUAbgBlAHIAaQBjAG8ARwBlAG4AZQByAGkAcwBrACAAUgBHAEIALQBwAHIAbwBmAGkAbMd8vBgAIABSAEcAQgAg1QS4XNMMx3wATwBiAGUAYwBuAP0AIABSAEcAQgAgAHAAcgBvAGYAaQBsBeQF6AXVBeQF2QXcACAAUgBHAEIAIAXbBdwF3AXZAEEAbABsAGcAZQBtAGUAaQBuAGUAcwAgAFIARwBCAC0AUAByAG8AZgBpAGwAwQBsAHQAYQBsAOEAbgBvAHMAIABSAEcAQgAgAHAAcgBvAGYAaQBsZm6QGgAgAFIARwBCACBjz4/wZYdO9k4AgiwAIABSAEcAQgAgMNcw7TDVMKEwpDDrAFAAcgBvAGYAaQBsACAAUgBHAEIAIABnAGUAbgBlAHIAaQBjA5MDtQO9A7kDugPMACADwAPBA78DxgOvA7sAIABSAEcAQgBQAGUAcgBmAGkAbAAgAFIARwBCACAAZwBlAG4A6QByAGkAYwBvAEEAbABnAGUAbQBlAGUAbgAgAFIARwBCAC0AcAByAG8AZgBpAGUAbA5CDhsOIw5EDh8OJQ5MACAAUgBHAEIAIA4XDjEOSA4nDkQOGwBHAGUAbgBlAGwAIABSAEcAQgAgAFAAcgBvAGYAaQBsAGkAWQBsAGUAaQBuAGUAbgAgAFIARwBCAC0AcAByAG8AZgBpAGkAbABpAFUAbgBpAHcAZQByAHMAYQBsAG4AeQAgAHAAcgBvAGYAaQBsACAAUgBHAEIEHgQxBEkEOAQ5ACAEPwRABD4ERAQ4BDsETAAgAFIARwBCBkUGRAZBACAGKgY5BjEGSgZBACAAUgBHAEIAIAYnBkQGOQYnBkUARwBlAG4AZQByAGkAYwAgAFIARwBCACAAUAByAG8AZgBpAGwAZQBHAGUAbgBlAHIAZQBsACAAUgBHAEIALQBiAGUAcwBrAHIAaQB2AGUAbABzAGV0ZXh0AAAAAENvcHlyaWdodCAyMDA3IEFwcGxlIEluYy4sIGFsbCByaWdodHMgcmVzZXJ2ZWQuAFhZWiAAAAAAAADzUgABAAAAARbPWFlaIAAAAAAAAHRNAAA97gAAA9BYWVogAAAAAAAAWnUAAKxzAAAXNFhZWiAAAAAAAAAoGgAAFZ8AALg2Y3VydgAAAAAAAAABAc0AAHNmMzIAAAAAAAEMQgAABd7///MmAAAHkgAA/ZH///ui///9owAAA9wAAMBs/+EAgEV4aWYAAE1NACoAAAAIAAUBEgADAAAAAQABAAABGgAFAAAAAQAAAEoBGwAFAAAAAQAAAFIBKAADAAAAAQACAACHaQAEAAAAAQAAAFoAAAAAAAAASAAAAAEAAABIAAAAAQACoAIABAAAAAEAAAAgoAMABAAAAAEAAAAgAAAAAP/bAEMAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/bAEMBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIACAAIAMBEQACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AON+J3xO8cfGLxx4h+IfxD8Q6n4l8UeJdTu9Svr7Urue68n7VPJMlhYJNI6WGlWCOLXTdNtRFZ2FnFDa2sMUESIP98+GuGsl4RyXAZBkGX4bLssy7D0sPQoYalCnz+zgoyr15QipV8VXknVxOIquVavWnOrVnKcpSf8AntmeZ47OMdiMxzHEVMTi8TUnUqVKk5StzSclTpqTfs6VNPlpUo2hTglCCUUkeg+DfgPean8L7v46eP8AXz4A+D9v4vg8Badr0Wiy+JvE/jDxhJYS6td6H4I8KrqGiW+qPo+lQvf6zqut+IvDXh+zUx2KavcaxNFpr+BnHHNHDcTUuCMiwP8Ab3FtTKZ57iMDLGRy7LcoyiNeOFpY3Os0dDGVMKsXipxoYPC4LL8yx9Z3rSwlPCRliV34TI51MsnnmOrvA5RHGRwFOuqLxOJxmMdN1p0MFhfaUY1XRpL2larXxGGw8E1BVpVpRpP6c8f/ALF3wZ8LfsyaJ+1J4Q/aJ8ffEvwPr2q3XhUQaB+z7odhP4S8cRQ74PDHxGOqfH+O+8L/AGqb90mradpPiWxMb2dxB9oi1fQv7V/Nsi8YuMMz8ScZ4ZZt4f5Fw5nWBwtPM+fH8e42vDNcllO1TMuH/q3AkqOZezh77wuIxWXVuZVac/ZywmN+rfTZhwbk2F4ZocUYPiHMMzwWIrTwnLQ4foU3g8fGPNHC5k6vEHtMLzvRVqVHFQs4SXMq1D2vxF8Mfid44+Dvjjw98Q/h54h1Lw14o8NalaalY3+m3c9r5xtZ0mewv0hkRL/Sr9Ea11LTboS2d/ZyzWt1DLDK6N+0cS8NZLxdkuYZBxBl+GzLLMxw9XD16GJpQq8vtIOMa9CU4uVDFUJNVcPiKTjWoVowq0pxnFSXxWWZnjsnx2HzHLsRUw2Lw1SNSnUpzlG/LJSdOok17SlUS5atKd4VIOUJpxbRwNe6cB+sngzxp8G/2if+CeHhv9mDUPH/AIP+Ffx3+BXxF13x14Fj8e6lH4Y8NfE/SPEWo+I9Q1DTY/F18E0LTtbePxVc2Fvbatc2sj3Xh/QI1mGn6hf3enfyxnGT8X+H/j/mPiXQyLN+J+B+NuH8FkmdyyLDyzLMuG8VgMPl9ChiZZTQ5sdiMGp5XTrzqYWlViqWPxzcXiKFGliP1bB47J+IfD3DcMVMdg8rz7Isyr4/ArH1FhsNmlDE1MROrSWMnahSr2xThGNeUG5YfDpS9nUqzpcv8Srnxp+xt+yb8S/2MPinY28Xxa+OXjvwX8RtZ8K2Wqafrmn/AA18E+HJdMvrG+1DW9Iur3Rrjxd421jw1p0cWl6Pd6hHY+GdNF5qt9b3V/YWJ9Phynk/i94qcOeMPDFepLhXgrI844ewmaV8NXwVfiPOcwjiqNehh8HiqdHGQyrJsJmWIlPFYulQlXzLEOjhaNSlQr1zlzKeO4O4VzPgzNacY5tnmOwOY1sJGrTrwy3BYZ06lOdSvRnOi8Zjq2HpJUqM6qp4WlzVZxnVpwPzDr+lD8zCgD9B/jv8Cvhh+xrZfDDwv8QvDWu/Ff45+Ovh3oPxT161uvEt74R+F/gLS/EV1qVtpHhq1tPDkNt4w8XeIra40m+/tfWovFvh3SLVooIbCwvHllnt/wAD4H434m8X63EuZ5BmWC4W4JyTiDHcMYGpTy2jm3Eue4rL6WHqYrMatXMZ1MpynAVIYuj9VwcsqzDFVFKcq9ekoxhU++z7Ist4PhlmFzDD181zvH5dh81rxniJ4XK8BRxMqkaWFUMOo4zGYmLpT9tXji8NRg7Rp06jcpx+zLb40fDT/gqF8I/ir4a+MvgPQvh5+078Cfg/4s+J/wAPPiv4ROpf2V4j8H+BLZbvUPC/iqTXdR1bV3gM13b/AGtdV1bV0Empaj4j0aXSbqDUNO1X8gqcHcSfRo4r4XzHhDPcdxB4bcb8W5Xw3xBwvmqw31rL82zuo6VDMssjgsPhsKp8lKo6TwuFwkrYehl+MjiqVShiMN9ms6y3xPyjNcPnWAoZfxPkOTYvNMuzbB+19lisHgIe0qYTGfWKtas1eUburXrLmq1cTRdGUalKv+Flf22fhx33xO+GPjj4PeOPEPw8+Ifh7U/DXijw1qV3pt/YalaT2pm+yzyQx39g80aLfaVfogutN1K1Mtnf2csN1azSwyo7eFw1xLkvF2S4DP8AIMww2Y5ZmOGpYihXw9WFXl9rBTlQrxjJyoYmhJuliMPVUa1CtGdKrCM4yS78zyzHZPjsRl2Y4ephsXhqk6dSnUjKN+WTSqU3JL2lKolz0qsbwqQanCTi0z7Rv/26fDXxW+HHgr4f/tV/s9aD8dtR+G2hweGfA/xP0Px5rXwo+KFhoNqiR2una34g07RvFOneJ4reKNURdT0TypJPM1G5hn1m5vdUuvx2h4JZjwvxFnOfeF/H+O4Iw/EWNnmWdcNY3I8HxRw1Xx1VylUxGDwOIxmWYjLpTnJybw+M54q1CnOGDp0cLS+ynxxhs1y3A5fxVw/Qz2plmHjhcDmlDHV8qzWnh4WUKVfEU6WKpYqMYrlXtsO1e9SSlXlUqz8T1f8AaK0PQfCXjLwP8BPhZZfBvR/iNpI8O+PfEd34v1n4gfEjxN4TN3b303gt/Fd/a6FpGi+E9QvLS0uNa0/w34S0e+182tta63qmoabEtjX2WE8Psbjs1yfO+OuJ63F+L4exX9oZFl9LKcHkPDuXZr7KdGGcrK6FXHYrG5rQo1atPB4jMc1xdDA+1qVcHhaGJm654lXiGjh8LjcFkWWRyejmNL6vj8RPF1swzLE4TnjUlgni5ww9GjhKlSEJ1qeGwdGpiOSMK9WrSSgeNfDH4Y+OPjF448PfDz4eeHtS8S+KPEupWmm2FhptpPdGH7VPHDJf37wxutjpVgjm61LUroxWdhZxTXV1NFDE7j7DiXiXJeEclzDP8/zDDZdlmXYariK9fE1YU+f2cJTVChGclKvia8kqWHw9JSrV604UqUJTkk/IyzLMdnGOw+XZdh6mJxeJqRp06dOMpW5pJOpUaT9nSpp89WrO0KcFKc5KKbP/2Q==');
    //displayImage('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QBYRXhpZgAATU0AKgAAAAgAAgESAAMAAAABAAEAAIdpAAQAAAABAAAAJgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAACgKADAAQAAAABAAAB4AAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4[1G[J[2m(lldb) [22m [8G[1G[JQklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgB4AKAAwERAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SF[1G[J[2m(lldb) [22m [8G[1G[JhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNU[1G[J[2m(lldb) [22m [8G[1G[JVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/bAEMBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB[1G[J[2m(lldb) [22m [8G[1G[JAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/dAAQAUP/aAAwDAQACEQMRAD8A/gIHbBz2wcgn14xzyemenbAzXQAZz7DoPYenAyR+GO2OooAT9P5fhnP09fcYBoAPf6f4e2ev/wCvpQAf57/5z/nsaAD1/oOf/r0AH+f89f8APp1oAP8AP+cZz0//AFdKAD/P+f8A9f5UAH+fX/P+RQAf5/z/AJ/maAD/AD/nr/n060AB[1G[J[2m(lldb) [22m [8G[1G[JOeaAD/P0/wA/Rvp1oADz19vfp+Xp/wDrxigAoAOaAD/P+f8AP8jQAUAH+f8APX+X50AFAB/n/P8An+dABQAUAFABQAUAFAB/n/P+f5UAFAB7j/Ppj/GgBef6/wCfx/woAT/P+f8AP8qADk/h/L/P+eaAD25/n/n/AD6UAH+T/n6/54oAX9D/AC/wxz/nFACf5z/nI/T656UAFAC9fcn8T/np2/KgBP8AP+f8+9AB9fxoAUnP8h7f5/H+RUAOv4f/[1G[J[2m(lldb) [22m [8G[1G[JAK/88/TPNACf5/KgA6df8/y/z69KAD/P8vr0/wAOnSgA/wA/5/yP5BgAoAX0/wA/1/w69TkbQBP8+nX/AD3/AKmgAoAKACgAoAP8/wCcUAH+f89P5/lQAUAFABQAf5/KgA/z/nr/AJ9OtABQAf5/z1/z6daAD/P+ev8AP86ACgA/z/n/AD/WgA/z/n1/z70AFAB/n/P+f5UAJnnHU9foOnt9ev0znFAC5z+eP8/5/rQAmB7dv/rf/W/+tQAemR1/[1G[J[2m(lldb) [22m [8G[1G[JT65x2/yeBQAED0z36f59qAD9O3X+XHPHt+HUUAHfk8fkPxPr+X8wwAfTGe5/z1/Pj34oAQdRnjt2x26cg+45PTG0ZoABnPIPfkAc+g7dumT1yOKAP//Q/gI54A79M/pj19+V9zxXQAn5/wD6vx/qOOuOaACgA/z/AJ//AFflQAf5/wA9P89c5zQAf5/z/n6UAIfz/wA++P5/lQAtAB/n/P8A9f8ApQAUAH+f89B+Z/LmgA/z/n/PP4UAFAB/n/PX[1G[J[2m(lldb) [22m [8G[1G[J/Pp1oAKAD/J/z9f8KACgAoAKACgAoAP8/wCe35j8uaACgAoAKAD/AD/n/P8AIUAFABQAf5/z/kfyDAC46n0oAP8AP+fp/nvQAn+fw/z/AI0ALnrjof8APH+en1oAT68d+f8A9R/p9aACgA/z/n/P8qACgBf8+v8A+qgAHP1/L8P8lfrQAfX26Y7e/UZHtyfTBoAPbHHvgn8+D/nvgmgBP8/5/wA8fjQAuD/nj2P4fXgfjQAdOfqMe3TPQ+/p/WgA[1G[J[2m(lldb) [22m [8G[1G[J/wA45/xH14P5fdUAB16E+3X/AD/n0oASgBccE+n9f/1en5UAJQAv+ff8T/n9aAEoAX17/wCfw/z64zQAn+f8/wCR/IMAFABQAUAFABQAUAH+f89f8nnHAoAKACgA/wA/5/z/ADoAKAD/AD+VABQAUAJ2PY+v9e/1/wAOlAC0AFAB/n/P+f5UAIO3X6n+vP8AT6Z/hAF/yO/+f8+lACc+ufY//qH6k/higBaAE9evPHfjtx6fh9fWgBCBgnqOTjnH[1G[J[2m(lldb) [22m [8G[1G[J+Hvn3zQAv4+npn8Sf6c9u4oAM8ZHODg46/5+mf6qAGcdjzjOOOvHqcZ9t3TGRjNAH//R/gI7dOp9CPy6ence3HG3oAbz/kZ/TjP4H8sigBf1/wA/Ufp+mcqAH+f8/wD6/wA6AD/P+en+fXrQAf5+n+fw/owAUAH+f89f5fnQAfj/AJ/AY/l9DztACgAoAP8AP+en+fXrQAUAH+f89P8APr1oAKAD/P8An/P8qACgAoAKAD/P+Pr7fn26UAH+f8/5[1G[J[2m(lldb) [22m [8G[1G[J/nQAUAFABQAf5/z1/wA+nWgA/wA/5/z/ACoAP8/5/wD1du+aAD/P+f8AJ/kVAF/z7+uf/wBX9aAE/wA/5/WgBf8AP/1vy91+vFAAB78ev1/D+eB15PFABjHX04/z7/8A16ADP6c9v/1n/PvQAfoP8898/wBOwGcUAJ/n/P8An+dAC9f8/p+nH4elAB/IDjt1OM9vX/8AX0oAB7df/wBffIx+ue/QCgA7+2en+T/X8e9ABnt0HH6euM/yz9cGgA56[1G[J[2m(lldb) [22m [8G[1G[Jfhz2/wAOf89aAE/z/n/P8qAFwT/+r0/+t+dABjjP4fj/APq/zxQAfjj3/wD1Z/l375oAD7f5/wA/h9B0oAPTr7//AFh/SgA9vz9vfoensM9Rxk0AHvnn9f5H9SPxoAPbn37c+4//AFfqSwAlAB/nrnP+fx9fZQAoAKACgA/z/n8qAF/Hn/P+euT7YoASgAoAKACgA/z/AJ9f09ewDABQAUAFACHp1x+tAAMdfp+Ht/8AW/xNAC/5/wA9P8+ucUAF[1G[J[2m(lldb) [22m [8G[1G[JAB/n/PX/AD6daACgBPUf09e/f+WPXPNAB68f/X9PzJPXH65YAOBx/iBz0/w/TvQAen+efb9f60AHHp3+vPr7Z4P8+poAQ8j3Bz3/ADwMZPtwOc8CgBenbuTxz+J6flz7dMUABGeO3r6fqOv4d+eMMAf/0v4B8/5HbPpz9epP4nFdAB+P+R2/PPrjPsAoAf5/z0/U/ligAoAPx/D0/wD1++f6KAH+T9P85Hf8M5oAP8/5/wA/yoAKAD/P+ev8vzoA[1G[J[2m(lldb) [22m [8G[1G[JP8/56fz/ACoAKAD/AD/n/P8AKgA/z/n/ACP5hgA/z/ntQAUAH+f89P5flQAf5/z1/l+dAB/n/P8Ann8KACgA/wA/5zn/AD3HWgAoAP09vSgA/wA/5/I/5FAC849s/r9KADrn/P8Aj/P8+aAEoAP8/wCen+fXpQAUALj3B79sY/Ecn24Psc/KAHH/AOvt/n6H2x0YAO+Tz/n8P5/lQAevp79f8igAH+T2/HAOfy/KgA6evpxwPz4/LH5ZoAD/APr6[1G[J[2m(lldb) [22m [8G[1G[J5+p+v+e7MAHHv7f5/P8ArQAf07j+fXn/AMd/TNACfjn/AD/TpQAv4f59ec89enpxjpQAe3/1ufftxz2785oAT/I//XQAf5/z0/l+VABQAf5H/wBf1/z6UAL79v8APXoR+f0xQAe/6enp1/xb3oAT/P8An/8AV+WaAD/P+f8A9f50AL+P+f5D65PpjGSoAf5/z1I49/rnNACUAHt/n+v+fTrQAUAL+B/l9D/nH64YASgA/wA/5/8A1flQAUAFABQA[1G[J[2m(lldb) [22m [8G[1G[JUAFABQAUAH+f8/5H8iwAUAFABQAf55/yev09+aAD/P8An/I/mGAD/P8An/I/mGAD/P8An0oAP8/5/wAn+QUAP8/59PagBD9f5f8A1uvTv9BjNAC/5/z/AJP8goAgP5E49Ofz5x09/TjNABjGcd+fT/P5fnnLACAdRwQOenPPPTP17L7DnCgBkknjgd++f6e3B+vZQA447noOD6dff1zwOfxYA//T/gH9/wDPP+eOv1PWugAoAP8AP+f8/wAhQAUA[1G[J[2m(lldb) [22m [8G[1G[JFAB/n/P+f50AHp/n8uuP/r9ulABQAf5/z6UAFAB/nJx/n9APr0UAKAD/AD/n/P8AKgAoAP8AP+f8/wA6AD/P+ev8/wA6ACgA/H/P5f1/LA3ABQAf1/z/AJ/+vQAcf54/z/k96ACgBfT/AD+efy7D68GgBKAD/P8Anr/n0zigA+lACjuOfTPbP8jn2xj3xigA45/T/P6de+eaAD8enT3x9cfqOe2MmgA9eOf0Hv6c849M8dRQAuM49f6D/D8+uelA[1G[J[2m(lldb) [22m [8G[1G[JCfyzj/JwRxnqfwBxQAcckdM/j/hzjPf29FADHv34H+OQMY9cY+vFACf5/wA9f8+mM0AL/nrn/D/63vnNACCgA+v+f8//AFqAD8P/AK36/wCJ9xk7gBcZ4HX/AD/n/wDVQAfpz/n1/n+eBQAfzH0/yf5UAHv/AEHH+fU49B0BYAO34/5/+vz6daAE/H/P5H9SPxzQAf5/z6fgfyoAP8/59eKACgA/z/nr/n0xigA/z/nr/P8AOgA/z/n/AD/I0AH+[1G[J[2m(lldb) [22m [8G[1G[Jf8/5H8gwAf5/z+NAB+P+fy7fh7E0AFAB/n/P/wCr8qAD/P8An/8AX+dABQAf5/z/AJ/lQAUAH+f8/wD6/wA6ACgAoAKACgAoAKAD/P8An9Pr+FAB/n/P50AFABQAg46nPf8A+t/+qgBaAE/z+v48HH4jPTGKAF9+f8/59/5lQA/z/wDqoAT2PXnp/ng8/wBRQAdzx07+vfpjt25+g70AHfPr2x0/TPQdz+f8IAc/X9Mf4/065OQFAP/U/gHH0x7V[1G[J[2m(lldb) [22m [8G[1G[J0AFAB/n/AD/n+dABQAUAFABQAUAJjnPb0/r07+n/AKF1UAWgAoAP8/56f5HfrQAUAFAB/n/P/wCr8s0AH+f8/wCR/MMAH+fy/P3/AKY4FAB/n/PX/Pp0oAP8/wCfxz3/ACoAXjHv/n8qADH+P+fegA+n6+w/zigAB7c4/wA9v/1/yKgB/n/P+eOnegABx/nP+f8APoaAD074/Hjrjt06f1wAFAAjGO+e/wCX6joev65UAP8ADHUf/W7+vTpzjNAB[1G[J[2m(lldb) [22m [8G[1G[J/PP4fjQAuMfj6cceg6nB7Ej8D/EAIQenXHUj/wDWcd/1yTxQAcnoP6/4n9frnFAC56cDAHrwOc8d+R2+b3PGKAE69P8A9X+P1OPTtlgBcdMc84OeAeuDx+P8h1NACHn8O+MZOfx5xz19euaADPsP8/5/zk0AH/6uCMfy9O2effPygC8cY9OnHUd+vOckckfhkUAJnk4z7du/r06en9aAA47Z98/54oAQf5z/AJH+fXpQAp7Z/H1P1OTz9QMe+aAD[1G[J[2m(lldb) [22m [8G[1G[J/P4df5fX9QVAD2/zn9Pp/j1oAM9v8nt1+nrj+jABz/X8P6jj+tAB/wDr/p/nr6eoUAPXjP8AT+X+fXGKAEoAMfp+H+f8+tAB/n/PX/Pp1oAP8/57+tABQAf5/wA/rQAf5/z6UAH+f8/5/rQAf5/zyP69OO4oAKACgAoAKACgAoAKACgAoAKACgAoAD9M/wCfwH5n8sigBP5d/wBMf56dc0AHrz9Pb9P8foMfMAL27n+f9P8APQHpQAenH/1v54/P[1G[J[2m(lldb) [22m [8G[1G[J8+KAE/L/AD/9f8vwoAPx/wD1fljt1644z3oAMD/Pf6+vHrQAcdhjnp0B/wAf8+lAB1B/I4659P8AP170Af/V/gHroAP8/wCf/wBf5UAH+f8APT/Pr0oAP8/5zQAf5/z/AJ/lQAf5/wDr9R/X6UAFAB/n/P8An+RoAKACgAoAP8/56/59MYoAKACgA/z/AJ/z/IUAL+n9fb/9eMfjhgBP8/5/z9KAF/Lr15/+tx+Gfp0oASgA/wA/5/yf6KAH+f8A[1G[J[2m(lldb) [22m [8G[1G[JOeP1+maAFPbj6f8A1/rjPfGeO4UAPXPccdDnP+eT14x60AH+e/5+nt1H06lgAHv09cZ59P0oAX3x19eRx6H07YGePrhQBB68HHt+HrnvnJ+gHGaADk8/y7Ae3b/OKADGen/6yemOvp0x+IoAO/zdh/Tgcfh1x/MMAHpx+vX8ecZ+nHoedwAdP6fy98Z6/wAsZAoAPf26Z9hz7569vU55FABn6YHGcf8A1vx6Z9sjFACjtxnkk/T378df6nJCgBnt[1G[J[2m(lldb) [22m [8G[1G[Ju+nQ8jvjsCe4z6EHIKgBjJwOv4849OwB/THbADAB04PqCTkH9O/B6D8xjDACE59wOB9B+Q57nHOO2MUAHY8cf5x/n8O9ABx6fhz6fyP+99McmgBRx6Z6c+/ccEdPU89OM5oAT0HQ85OOn16/oMg9jyaADH59sEH+XXP+e9AC+nBHU5HPH5np/wDrz1YATv8A5/8Arf5656UAGcY5/wDre3+en50AGeo9aAEz3/Hj/PFAC/hj25/Pn1+p/DILAB0P[1G[J[2m(lldb) [22m [8G[1G[J+eh/Lt/9bPBoAOPTP5/n1H8vqpoASgAoAP8AP+f8n+RUACc80AH+fr/+r8OvGedoAZ/w/p/L/PNABQAvTvnP6foPccE++KAEoAKAD/P+f8n+ZUAKACgAoAKAD/P+en8vyoAP8/5/SgA/z/np/kd+lABQAnA5z146n/8AV/n60AL/AJ/z0/z69KAD/Of8/wCH5UAH+f8AP5n6/hQAdP8AP5//AK/xoATPHPv7f5/zjrQAevb17e3uR06gD2PFABz+[1G[J[2m(lldb) [22m [8G[1G[JP0zj8OMnr0PPtxQAHtjnH6/y+vJ/LigD/9b+AcdOn48j9N3H4hvrXQAf5/z/AJ/pQAUAFABQAUAFAB/n/PrQAUAFAB/n/PT+f5UAH+fp+v8APP1HO4AKACgA/wA/56/z/OgBc9v8/wCf5/hQAf5/z9P89qAA9fU+3P8Ann/PNACUAKfyPfnOfb2/HPTtnFAB/nnI/H16exz6cjaAA6HnHT8f59Pp9M4oACMHrk/59Rj9W+vQsAL6Y54/I9/xHXP+[1G[J[2m(lldb) [22m [8G[1G[JFAAR3J4OTkD/APUeo9APTOCWAAdM5APT1OD69MY6DGTx2FABg9eepOfX/D1z3/CgAIOO/Xr29OmB6D8scchQAAPb1659PQHHXI7flQAcD1II56devp6/T6nFACAZ+vYY6/Tp/n1xigBSD7+/sT7ds/r+VAAVx+fUgg/qFH6fXHG4AT8fX/I7+/IHpx1oAPfp9PX9Tyf/AK2MYoAM5Pp+nPr7d/8AOKADJ/yev8u/v+WaAAnPIGO/B4+vbHbnH5Yo[1G[J[2m(lldb) [22m [8G[1G[JAT+fr3Hr789/XFADj+PXp2/pzj2/LGKAEGT0/wA46Y9+v0oAOPfv26e2e/Xvj192AE+nt/8Ar69evr7AUAKcjufXPT8f0/zmgA/z/j+nt+WKAEwf8/5/l9aAFxwTn6D1/wAMfr+FABjByPbkde3Y4J68dM+2KADJ5Hrj9OmP8j+jAB06H8v/AK4H8vzxQAnX268/5zz+H4HncAFAC/5P+f8AD+tAB/nv/T6Y6j8OTQAn8/8AP+ev50AL+f8Akfh6[1G[J[2m(lldb) [22m [8G[1G[J9fTnnpQAY/z/AJ+tACf5/H/P+eKAD/P+ev8An06UAFAB+X4f/XweP85yDQAUAFABQAc/5/z/AJ/GgAoAKACgAoAKAD/P+fSgAoAP8/59PwoAKACgA/z/AJ/z39qAD6f5/CgBO3Hucdz3/mR9OlAB/wDrHUfh+n60AH498c454/Tk+i/TFAH/1/4B/X1/z/n/APVXQAUAH+f8/wD6vzzQAUAHtzn/AB9P8OfXvhQAoAKACgAoAKAD/P8An/P86ACg[1G[J[2m(lldb) [22m [8G[1G[JA/z/AJ/yf5FQA/z/AJ/SgBcfXnp/nv8A59aAD1BBOM8fl19vXpnjkdaAAZOBz/n+X+c0AA9eePQ4/wA8kfT8aAFP3hz6cn+vT9Dz7ZoAG6n8x/nGD6/oTnIoAMDrnP6Y44HPr04zjHuAoAdD6cZ6Yx3x1Ynjjk/nj5QBce4xn2+mR8o/HG38c0AJnn8h1HT6jpx1/XrQAEY7+mO/+TjnnA/QMAJk9cD8h+vbt0Ofb1UAXqOh55Hp79z+mPfoBQAn[1G[J[2m(lldb) [22m [8G[1G[Joee59Bn2xn/63t1oAXOc5BPTjjrj8cfTHPfOKAAY9uQDg8c56c4556Ej8ejABk8nI44A7fgP8570AL/Dx2PPTv8Ah/XtyOhoATrwM/Q+3f8AXp7YyeAoAn06fXn/AOvjt/8AXoAP59c9/wDD34B9c9lADJ7dvQ5/HqcH16Y9ODQAf/qzz6/n+g+nXcAHBzjp/wDX9ct9OT7ck/KAH/6vr6/j64C/SgA5+nfOcfl6/gPbmgBOPTH8vXp83Oe+fzyG[1G[J[2m(lldb) [22m [8G[1G[JUAP6fr/n3x+gLAB2x7/qf8+nvxQAfpzjPPp0HIHT6+/TFAC+g6fl/n88+3XCgBweP/r5Hfrnpj9e2MUAJ/nJ6/0H6fTHSgBcEdcj9Pp69x/+rGaAE4//AFev+ee+fxIUAXP1HoB0Hvkljz/nOQFADH4dBjn8+h69ev0BxQApyc9e38P4YJ7Y/Xv2oAT1znHt6+nt0/r2oAO3+e//ANb/ADxQAfy9D/8AWI/n+dAB/j/nn/PXigAH44/z/n2/CgA/[1G[J[2m(lldb) [22m [8G[1G[Jr/n37+/50AJ/n/P0oAP8n/PH8/y4oAP8/wCf8n+RUAKACgAoAKADpwev5fp/n9aACgAoAKAD+n+f8/8A1qACgA+n5/5z39vzoAKAD+X+f8//AKqAD+f5f4/59M5oATn/AAx/M9B6npj2J4oAX/P+cY/Qce1ACZxj34/OgBfx/wA//X6UAIP0ye3b/P8AnmgD/9D+AeugAoAKAD/P+fSgAoAP8/57UAH+f8/5/lQAUAFAB/n/AD/k/wAwoAv1/wAP[1G[J[2m(lldb) [22m [8G[1G[Jp/n/ABoAPw/z+Y9Pce1ACUAFAB/n/PT+X5UAKPrj+vt/n/CgA/kfQ9D6HPp+P1OM0AL1J4Ofc9PT69hj/GgBOQM49vp36Hrke35UAO6c9umBwCcfhxnPYDjjOcUAHU9Me2PXHHUdz1wPbHG0ACAOuefYcdefX8yTx3/iADb6f4dPrzznjgepxwFAE9OvtnjIzwOuCM98fTGPmADg9uQenX0GOvPHPUdwMUAHqMdcfienGcEHknsOxB4FABgZ+9jr[1G[J[2m(lldb) [22m [8G[1G[J0H/685GfT9cUAJ9R0P8A+se30x1yeKAFXr07dM4P4cc8Z7ggdM4oAXjuDxyOcj8xtHU56dsckYYAQknr2yMc/if/ANZP4/wgCdMZHv8AUdvT/OCc5AoAOPTrzjr36evT/PAoAOO3T36fnx/Pj2oAM5I+vtn8T/U0AKBknBAx6/06Ht17DrnpQAh+hB7/AP6uMf569aADoRyeP5+4/wD1/rhQAxgc45xnHHPuPXAxjsPrQAoHAJIxzjt0/Mf+g+vP[1G[J[2m(lldb) [22m [8G[1G[JIoAMZJPOPz/AnnH6++aAEP4cHHpn6jt+YPPfAKgB/hyP6/j+Hv6sAJ9en58fhgn6Zz24zQAuOM59eOvf8D07D6c4zQAn+f8AH/P+FAB1/wD1/wBTj88c+2RQAv6cfl/jnr264yOtACZ49TnHp7fp2/8Ar0AGf09u/wD+r1+lAC+vX2x/k5/P880AGPU8euc4/LPXGPf2xmgA9Dj9c9Pb8e/X8DQAfT0/+t/9f2/CgA/Hnpj/AD/n8qAAHt69T/n0[1G[J[2m(lldb) [22m [8G[1G[JH55I9aADOe3c/wCHH/1hz74FABj8Py9vX279+3WgA7fnx+H5enf88UAJ/n/PT+f5UAL/APX/AM/geaADr/8ArH+T/n1oAT/P0/mfzP50AFABQAf5/wA5J/n+VABQAUAFAB/n/PH+PsRQAUAFABQAf5/z/wDr/KgAoAP8/wCf88/hQAUAHr/n8e3+fXpQAe/8u/8AIenU/lzQAn+R/XPUf/r7daAP/9H+AfHb09Pb8/5/nXQAv69/X/63T6+/QhQB[1G[J[2m(lldb) [22m [8G[1G[JPr/n+f8AL86ACgAoAKACgAznrn/P+fx/GgA/z+VACj/OP8j14/rnFAB179/x6+gzjrnp9M80AH44H4jP/oRPPt+WPlAD0zxkcYOfxP1/D9MsAAH59McH/D8PfpnpQAflgnp9PruP5nn3/hAHEg5yWOecYx04x/8AqHbq3G0AQ9vTHoc4/H16ccdhQAKcZ649sD8/Qep7UAO7Hk4I9fw5LAZB+vsAOaAEH4Y9+n0/X06jtk0AJ9OxPcAe2Dj+gz2x[1G[J[2m(lldb) [22m [8G[1G[JigA54HA479/fOew59McAc4oAUHPUE+2Dznr645GeMZ6HoBQAAkjqFxwOPX0zntyeenrjNAC9+Rzk9gevYgZyR+PqQAMUABx8ueDkZHboPqOMDPPHfPBoAPx+UHGcDrnOeWPb889B1oAQ9D0PJ5PqSfu/lnq3ueBQA3J6dsY49un69/yoAOvtkdu/f/Dpj07ksABPpwPfH0/M57dKAAn2H0H+Sec/4YxigBRz14Ptjpzk8en156c5NAAM5OPmHPU8[1G[J[2m(lldb) [22m [8G[1G[JfX2Pvj8uaAAHHIAGO3f0wOv54+ucUAIc9z6j/P8Ah/jQAc/l9MntjPp+HtzxQAA//rGM/wBD+vtxmgAGBnAyff09OnsTnJ65PbaAGTx3x0zz/PpQAZ//AF9/8/59aAAHHPfP+Pft29fTB6UAIOxz0Of89Ace/wCuM0ALn1H+fUDgAj8vrjFACf5/z1/z6dKAFGSfTPcn09eoweOoP4YIoAMfjkZGP/r49D2H44ywAen+f8n/AD3NAB/h3zx3x/Ec[1G[J[2m(lldb) [22m [8G[1G[JZ4/i9eOtAB06f5/l/P8AKgBPr39f8/j39fQKAHPtz9DjHp3x+ef0UAX0xxnk/h/+r/CgAPTtjr2469TgfXHOPXigA/yM8j9cdfccZ7ZoAPw/z69f8B7dQwAv4du368/rnjGcdssAHHrjqM4x+gOP1PXocZoAb/n/ADnH6j8qAFAzx+XbP+fw/UBgA/zj/Pt7n3x1YAMHt9f88DJ6+v1oAP8AP+fyoASgAoAKACgA/wA/T+nP4/hj5gAoAKAD/P8A[1G[J[2m(lldb) [22m [8G[1G[Jnp/n160AFABQAUAH+f8AP6/zoAKAD9f8/T8e/wBRxQAf5/z1/wA+nWgBP59M/wD1+e/t+dAC0Af/0v4CP5fl1/8A1f5zXQAn+fwoAP5UAFABQAv+fw/z+vHegA9eR6f/AKsjH69u3G4AP8/56d/8nBNAAOOfT/Pv39vz5oAOp4+vT9OB68env1NABx+P+f5fT8Wx8oAE9vQY9f8AHBPTjGOnqaAFPAx1HB4zxn1PGSR7d8DGMUAB4/EdB25yO3Qj[1G[J[2m(lldb) [22m [8G[1G[J3z64x8wApHXoMnnPJHfI/DkjPHPTigAGCMdD6nH5etACZBxk9MD149hjt7nn3z8oAuPQj8Oc/oO+OpOPxC0AKDg8jtx6c9RjI7+v5jFAAc457kcYz+HPPP8AMfSgA45Oc88jkn04Pc4zjPr7UAHsD14BwO3b73f6rnrjkUAB4zjr14weP6YPOcHsO42gB3zjgd8j04J6nPTnt2weKADA7EdQCOWHPvgdD0z39M4UAM49c45IHUj65/l8uecgigBM[1G[J[2m(lldb) [22m [8G[1G[JY+g5ODwc9O4xwR6g9MYBoACevQZ9uv0zjuOc/hnBFACZ6dvXBHI47ckk9/1xnFAAec9+wwOB05xj/HnnA/iAFIx0Ax6nHfjHbkYJOVGOnqWADOOuc89R7+4BOQBz26jP3aAE+jdO5HTpwOST37Db2zmgBMYPXsenP0/h69u3vnAKgCZ7dv5/Uf8A1vfnNABQAf5/z/8Aq/KgAoAP8/56f59elABQAUAH+f8AP/6/pnmgAoAKACgAoAB9Pw9f5dv8[1G[J[2m(lldb) [22m [8G[1G[JnpQAue/fOf8A63p79B9egYAX0OMe+OM+vvx2FABgDPGehzk47Yz8vU/8BH6bQBD1AOOnbOCPbP8AkfiKAE7DH5g+vrnHT1Hp0PVgB3HH0z9Dnofyxz65oATvj368f/W4z7YA9KAE6/5/yPzx/IMAKBnJ6Acnj9Oo6/j9KADHv/n8u/t+O3ILAB07Z/XH+ff+goAPz9u3/wCvmgA/PPb/AD/n9KAA9c+v+fU/n36knFACf5/x/SgBff6j8f8AJH86[1G[J[2m(lldb) [22m [8G[1G[JAD8PfP8AT06+o/LBoASgAoAP8/54H9frQAf5/wA/5/lQAUAH+f8AP+f5mgAoAP8AP+f/ANX50AFABQAUAH+f8/jQAf5/z0/l+VACdOfx7/57/wCcCgA5Hv8A/XPTkj+f58UAL7ev+ff17j86AP/T/gIwe/v+P0POSfp19a6AE/z/AJ/z/OgA/wA/5/yf6qAH+fp/P+f54oAcecfj1I4x29uPbn3wKAE7/wCSPpxj+f5UAHb19T/T/wCv3/CgBSPT[1G[J[2m(lldb) [22m [8G[1G[J5s+meD68ADv24GecZwoAoUnk8c+mPx9B0/x6BWAEz6DH+e4ye+D1/PpQApGOM5HYc8e/8XA/4FntjpQAmOwOTz7e2O3XvkdB25FACnPB6kck46Y469/oQSPXjCgCe+OOMccZx/8Ar55/XKgDsc54A68dOPfp2PXGD68hgB34nP8A9fgeh/NfTOKAEOfqeD0xt9Dzn8uSPfigAOemMj16Dtk/Xqe3QY7lgBCffI4z1754yByB79+p5IoAU5GcHAGP[1G[J[2m(lldb) [22m [8G[1G[JXIx36HI5IxnHfjFAByCefpkcc+/ygEY6YI7d6AE/Xk/wnj2GemOOMdx0wKAAcY78ke/HXjH67m/U0AJnAHPTI6YJ9xw2AcY6e5zn5QBTk8d+mOef6HjnOFxkemKADoen4ADPOMdcn2x0PQ4PNADT+P4jn2HXjj/DHJNAAPr7kY9B646ckHkAe+KAD34I9uMHJ46+nQ89OpH3gBcgY579cE59yPb6ZPsRQAAcehyDnGSMjOOG5zz3YdyOaAEOPp9R[1G[J[2m(lldb) [22m [8G[1G[J1wev8PX3HGMAr1YAN3bn6+vcfTH44/IKANoAP8/5/wD1flQAUAFABQAf5/zwf1I/GgAoAKACgA/z/np/kd+tABQAf5/z1/n+dABQAf5/z/kfzDAB/n/P+f5UAHT/AD/+ofn+uc0ALk/z/Xt6Y/z2oACOnv09cf5+nt0JYAUgDoQeBx3Geh7f55wMbaAE98cZ7c+3PJI59T78CgAHUZ4Hfj657+hAOMY9DxQAY59OM9yOenbP/oWPwIoAOOvTHbGc[1G[J[2m(lldb) [22m [8G[1G[J++eMc8cH8qAF9cYA45I56n8MnofUfQ0ALzznj2OcEjtnoPTv+gCgDTx6jvj0Pb0/+t3z1oAXJz6fT6fif14PJzQAmfTOc8Y9/fr+H5UALk5+bnsfbn2/pj07YYATpnBPsemT/TjPp+mGAFPQdCT3Pb8dwB/EHH4kUAJ7g/Tse3tjge49cDOKAE/n6UAL6fn/AJ/z796AE6Z9vx/z/X8KACgAoAKACgAoAKACgAoAOv8An/HP/wBb260AHX8D+f8A[1G[J[2m(lldb) [22m [8G[1G[Jn+mDQAf5/wA//r/KgAoA/9T+Af8AzmugBQD2Gehx1+n9aAAe/wDL8/XGO3H0zg0AHr7e3Xj+Rx+vPWgA+v5dPxHBA/A5PTjOaAD0xkc9f89P8+lABk9OSPTOP8cep/pjNAAPxx6jsP8A9fr060AO65Hb1JyBnvkYxnA4IPPfrQABjntnOPTOeMZ+bGPXnP4A0AHqemOg9wB7E/r7kDGVAF64ODjqeRzz06AH16j6DINAAeTwSfw4GT0Pt7cZ/DLA[1G[J[2m(lldb) [22m [8G[1G[JC5z0OMkD6+44BBOMDOemM5oAXB9geMD8sg4+nbPv2CgCH1HB9OMdO549fc46AZBoAPU8DHUdCfxxyCc4557f7IAvGfXOQcHHbofXAz34x3zQAnrjIHpjGc9x0/Dv25yBQAHp83U+nXjrzz2446E9sk0AL64H5dOOwHPXvwTnPTqoAhJAyO+OPT2Hyjt7dsZHG0ATPQ9j3I/DnldxB7enr1oATp65PT6jpkDI+nJx3xQAHrj3/vcDucccemcY65HG[1G[J[2m(lldb) [22m [8G[1G[JKAEz9cZ7gY57/wAQHTgc/wBKADrjOenYdux75+uO3fNAB0P17HjjPTPHT1/PPIoAXn3wPTPIHoT/AJwMkDALADenb8fr2wcA5/UdM4zQAE557855/wD1duOnTsONoAn+f8j/AD+tAB/n/P8A+r8qAF/+v78H/P8AnFACdf8AP8uufz/PmgA/z/n/APX+dABQAUAH8v8AP+f/ANdAB37/AOc/5PP5UAGP1/z/AJz/AFoAD9PwP6+n8vyoAKACgAoA[1G[J[2m(lldb) [22m [8G[1G[JP8/5/wAj+RYAKACgA/z/AJ/yP5hgA/z/AJ/z/KgBQcY6e2f6dfzx+fNACjnAx+RweO57HH/6+tACcZB5z7cdew9MdOOuPegBfU84wQMnvn1GPc4PXrz0oATBH/6v6/170AKecZyM9+2PYD0HUZ/LFAACRx2OM/59xjnPtzmgBcZz1wBnJ5PTsMgDP45xwKAGn/8AVxjPpxyOfrgD15oAX2GQDnuBn6nofp+HegAPHUA+hGfTjH3eh9c59+rABj8M[1G[J[2m(lldb) [22m [8G[1G[J9O/TqeOn0xx6n5jQAnHb17nr/LHvx+WKAFHOBj+fT268Drghuee9ACH6YOf8j/I/PAoAMfh+PPT0x079CfTODQAn8v8AP09PT8sUAL6ck46f4+xPfj35oAT/AD/nGf0H50AL1+tACUAH+f8AP+f50AFABkfj9aACgA/z/np/L8qACgAoAKAD/P8Anr/n06UAf//V/gJx2wSTj2/p0wevAzzk10AG0/kAemevb3+oyP8AdydoAmev+A/yOD29PpQA[1G[J[2m(lldb) [22m [8G[1G[JowO45GMdfzIx/wDW6c4zQAdT1z6HufboeecfhxnChgAHIxnrjjA+nXg5wPX8smgA7de+CMfjnPPfrxn64FAC468euMnngDAwRyD9AfpgUAAx1447Hpk+nPoMDOemSRxuAFwcjnPY4PfnntjGfT24zQApB9yRjnrj8MA9/UngHigAI46dMg9h2OeMY5Hpj1xmgBeQBgZ+hzx+Y7fX6UAA5yPwJ5/r65PrjjttCgCHjnHfGM8HsCevUcdvw6sAKOu3[1G[J[2m(lldb) [22m [8G[1G[J2+nTg9c9eMc8ehzuYABzgnqTwP8ADgdu59e3AUAQH6cHoOBkntxn8AfXrkbQA6nP+zn7x6ev3Dn6cDv3xQAvO4Dnjv0wD65B3Hj169QcfMAGMdOmc/8A1semeeox7YzQA044PGc+vOO2M4x68dPfpQADnPOMdT7jOMAg54+h47YywAncg++TnGfTrkDrjkEgjtQA05JPc9jj0/HHT6+xGfmAAjp9PUfljsRnHcnr3woAfy/Lj69yO3X9MqAAxj3H[1G[J[2m(lldb) [22m [8G[1G[J0x/Q/h09c5IoAPx7emfqMnHP0z6DpmgA/wA/5/DA7dMdiWAE/wA/5/yf5hQAoAXpj8+3+fzoAPX/ADj/AD/h6UAJ/n/P6f5JoAX+fYjj/P8ASgBP8/5/z/SgA+n+f8mgA4/z/OgA/wA9f684/Lj3oAP8/wCen8/yoAXPt/n9P8+oGKAEoAUemP8AP1OcfgPrnpQAf5x/nPr3P580AJQAf5/z/n+dAB/L+v8An8/woAKACgA/z/n/AD/OgAoAXgjp[1G[J[2m(lldb) [22m [8G[1G[Jg+v9cZOT+X64oAXPGMdflzkDkdcnA9vbHds5YATHBxyM4zn/APVjPBzn8sigA79x/wDX/pg/j+NAAR0POCP5e3OB0/pjpQAueucdR7nI79efx47YxxQAp6c+g9eQT168+oHy49Gx8oAbcDOR6/59c+6rjv6qAIUIAP8AT6f7R7+wz+QoAQfkPrj6djn8vfigA4I49vbtyORzk88H0xnJ2gBj6/8A1v69sf8A16ADsT29/wCn557fphgA/n7/AMu/[1G[J[2m(lldb) [22m [8G[1G[JT/OOlAC4zxjB9Dxn36fXjj6nmgBMk5yc56DuPf8Azj07EsAJ/n/PpQAvHv79v1/z+tACf5/z+tABQAf5/wA/5/kaACgAoAKACgAoAKACgD//1v4CuvTAwM49TnPHzZ6dwRwB1xmugBMnuDg8gdie3fJ6ep9eaAADnjnHXOD/AD25469PXuDQAE988jpjoB/ntz6HsFAFGMdPb1Jznn8O34elABnkenuB0HOB17enXrxkbQBeM569+Aen5Y9zwcHu[1G[J[2m(lldb) [22m [8G[1G[JMbWAGgc8/hjHU4xk84B6/wAscCgB5HIHQev58D1PX19cHkUABxjqOPUc+mf84zj2BYAOeTkYx7+nXjGfzWgAyeenH6+h5PHGcZYDnjOc0AO7Dv8A/W69e+eOSOvUYNACH27HHbr6/Ung8r1zgYFACHrg9eowuTx0H8Oenr6DnJ3ACnHH8t2Pz65ycDp/LDAC/kO3+PH0HQN+eAaAE7eh/l9e2P8APegA+mPQng5z1JwO3159Oc0AL16YJA4P179S[1G[J[2m(lldb) [22m [8G[1G[Jcf8A6gTzQAwkk5AwPXp7Zzx69P55+YAaccfToOO/cnOD/wB9DHHIAKgAPXjnpkjPH1Iwffn1xQAnfrz69Pz9/p1/GgBc9enbtkcdMdwev179BQAmf16/Uf49ensMc0AHb07E9+n+9357DHvyKADj1/z+X89v9KAEoAP8/wCP8vw/CgA/z/n/AD/OgAoAX2/wH6nP+eBjOaAE/wA/56/z/OgBfQEY98f59R0696AEoAX/AA78/l/Pt+OMUAJQAUAH[1G[J[2m(lldb) [22m [8G[1G[J+f8AP+R/MsAFABQAUAFAB/n1/TjP5/lQAUAFAB/n/P8An+dABQAf5/z/APWoAKACgAoAUE++D74/PP8AWgBeD7gbuin16djgZ49O+eRQAH2xgjHU8evqQc9OfzxQAhP0/l9OnfnnJPI787gAPQdPfBz/AJ9PwoAUc8Adxz7enOMZI9OfagBe3QYGCeefT2wT6H8CcZoAByM7Tn0yTwPfBHHA4Pbtk0ABHUAD8Tz+HzfievuTwKAEHfAB46nj8ecc[1G[J[2m(lldb) [22m [8G[1G[J54PpjvnNAAR+eOvTjGMdv6g8YIzigAPpgcfr+vJH/wCsdqAE7f0/ke3v3PuOlAByMjqP0/p6dx+AwdoAeoHPuev4f5P8yoAfl2/r9Oeh/nnkUAJ/n/P+f50AFAB/n/P/AOv88GgA/wA/54P+fXkMAFABQAUAH+f85B/l+VABQAUAHvQB/9f+Arbk4xjAz65+v3T6D5R1B4HG7oAQ5OAT9COc/wAz2/oFGKAFAyPTHX/HHsOe/OR3yoAcH3I9uDgZ[1G[J[2m(lldb) [22m [8G[1G[J9RjJzgZA46dSwAucc8c9umPp1PQ+g4xg4oATgjjr7ZAwO2STjj1GO3H3aAFAwDwDz0z09c9uPfvz6UAA7Hg46nHPTpwTz2yV46jOfmAFxg7uwHfH4+vueOvTK9KAEHUYAzj04P0IIxwM+nOOOSoA/AJ6dODkf55PHPPA4xk7gBG454+h79Pp2/PpzjFAC9MHsB6dPTgc8enHfPTDACD2+pPrn9T+Q92JGKADrnPB/wB7jjuBz0xz+uM4oAB6/QHH[1G[J[2m(lldb) [22m [8G[1G[J8ySR06dM+uaAEJHQg+nUAficsAc+x6YPBFACkHkD6c/054wO2D06HpQAZP49ee2MdRj9ePXBx8oAH0zjv/jntjv05z3waAGY7E9B/Xp0Y4GO+QOuRkCgBBj0H4dcYOTk+o9sewz8oAoP8uBwMdzg89PX+XG0ATGcY/PsPY5B79Tnp2OKAADjj+YGB6ZwcE+/5HJoAT/P+e/4/hQAvPoevcZ/T19//r0AJ+Y/r6f55/XKgCUAL6cf/X//AFfT86AD[1G[J[2m(lldb) [22m [8G[1G[J8fr2/wAc/l+eKAA9+x6Y/wDrj/J/GgA9vfr/APrx1HqPpjmgA7/j/npx+VACUAL/AJ/z/n09KAE/z/np/L8qAD/P+f8AP8qACgAoAKACgAoAKACgAoAP8/5//V+dAC9uh+vv+mMjg8n1xxQAf59On6enbJ9V/iAExj8eaAD/AD/n/wDX+VABQAf5/wA/X6/ULxuACgBQeMf5/wDrdPT654oAO2OnPXj/AOuR+XPbNAB6fzz/AE56ew75wcfMAHXu[1G[J[2m(lldb) [22m [8G[1G[JMknj+n48+v6EKAGDx6/55z07nv2wcYNADgRk5P4AdgOvAwMccg9unOaAF6r9Dn04x0HJxgnHT/gIyaAGnoMdP644/L15z37BQBcAd89xn+p2rweOvHYEcmgBufbPpn0/Ag/r69eaAFwfTj1HPT6Zxn/OOtACf/W5/p2/z0zyaAAdev6j+vv/AJ6UAHT6Hvx2PPPfv0x2+rABj/8AWeP05PP068DNACf5FABQAf5/z1/l+dAB+P8An06D+v1oAKAC[1G[J[2m(lldb) [22m [8G[1G[JgAoAKACgA5/D/P8An/8AVQAf5x2/oP0/KgD/0P4CepLZA564H16flwBz7YNdAB69z/PnO7oRj8efbOaAFGcYHHQfUHgcdjyT1Xr+NAC7cjg579OPTtgjoegyehzgNQAYzgYHTp3B7Dsf1OcdOtAC7RjA69Mkf/q6ZPOfTk4zQAY6nt6E46dPy6fr83VQAHbnJx044/EYI/yBn+IAXGMkcdwcdB3A4OOp/h/E9aAAgnHOPwzz6/T8R7/3WADHH4cE[1G[J[2m(lldb) [22m [8G[1G[JY6E9un54H44oAOOOTkc/lwRxnr+fOBt6qAA7ZOPb1PrnjJ6dO/XOc0ALx24z7fz9Ovfr09aAD6dvUcf5wT0xngH0YAPfofw/I/ex+B/E4+UAaM/XkjGOPfnGep4znPTAwdwAvHPHTj8e2Bzjr6c575+YAXpk9e3cAfz/ABP8sYoAjJySeBz6jJx0I4z6f/XHzUANz/j7/wAvx9O+c8UAKOh4J9sfzxjGMevt3JUAT15/Lv8Ap/n/AGhyoAZ9P8n1[1G[J[2m(lldb) [22m [8G[1G[JHTHQf1zkigA/z/j/AJ7/AI0AHpyf8B+Pbv2/qwAH1xwf88dOhP8A+vpQAn+f8/5P8ioAf5/z1/z6dKAF/wD1+n6/n/k0AHH+f/19evr7AUAGemPXqf8APb8foelAB9Tn36/j+g/yKAE9/wAP896ACgAoAKAF4z6fr+H+f6UAJ/n/AD/9b8z0UAP8/wCevf8AyOtABQAv+enp/j/TPagBKAD/AD/nr/n060AH+f8APX/Pp1oAKACgAoAP8/5/z/I0[1G[J[2m(lldb) [22m [8G[1G[JAH+f89f8+nSgAHf9Pf1/L6/nzQAUAFABQAUAKCc4wDnoD29ADnPX3/HvQA7vnOD6dB+B4/nye5zmgAxjPHtyDg+/TjH+8c9gOBQAmB68/wA/p/8AXPTkZ5oAT3Bxjv6/gevpwF4PPWgBwHGR68jvxg8Hr6dx+H8QAnfqRyfXI9fQZ7HqOvsaADoMjnn8vbkKefYgj6c0AHXksD7dh+O0dP19TwKAAYzz+Of/AK3X8MevbDAB79R9MYx1GMnPHU5/[1G[J[2m(lldb) [22m [8G[1G[JLNAB39Mfhn2OMc8gYB49sUAJ29+3rz/+r0H17MAHB5zj29T3559j+OOOtACUAFAB/n/PrQAf5/z/AJ/lQAUAFAB/n/PX/Pp0oAKACgAoAKAP/9H+AsEdBwAxPGSemM5A5/8AHQfTlq6AE79yoJxgevHdQDnH/wCrCigAC4x759cn8wMY9eOPXrQA48dB6AHpk8+5I9Ome+TigAP1OckYz0z052/iBkfplgAXPPqeec8dgD19+/06EsAHf09h1PXk[1G[J[2m(lldb) [22m [8G[1G[JevOfrQAuOnXI78c+3JzjPt+QHzACj6+/59uM8Z9zn26KAJx9e4zg+3Bz9MZx16nnaALk/h79frnj07D8BjNAAOg6+vPp7np0/wA8UAA4x1I/l/I/p+Q+6AGAO/8AQcfh6devsRigA/T/APX7E9vf8uaAEIJ6ZyOQRjr6c9P1z+AKgB056Z4J4GPfnjknpj8yaAF/T/8AX9T198Y7dSKAGc4I9fx6nk8YGPbPHqetADc88/p6Zz39+fU9+tACcc4/[1G[J[2m(lldb) [22m [8G[1G[JX+Y6fkfy5yoAfp/ge/ft6Dkdjn5gA9f/AK4/n9Oh69B/eUAMD1//AF/kf049xwKAAD3wfXnj8hzn2P5ZxQAfgfz/AFxgkc89/QY60AJ/n/P/AOr86AFI9uP1/wDZcZz3H5YO4AOP8n+vI5Hfb+XzGgA44z/gT6eufXJx6c4oAPxzx9Me3I/l16Z5BoAT/P8An9O/50AL+nf/APVwff0HvxQAcf59f8/X+igCUAL/APX5/p3/AMnsDmgA/wA/X+Xv[1G[J[2m(lldb) [22m [8G[1G[J3/LFAB+PTt/P9Pf86AD3PP8Anv0/nz7UAB/lx/8AX/n0x2z1ywAn+f8APpQAv+f89v5Hnv8AwgCf5/z0/wA+vSgA/wA/5/8A1/nQAv8An/P17j8KAEoAKAD/AD/n/J/mFACgAoAP8/5/z/OgA/H/AD6fh/npQAf5/wA//r/OgAoAKAD/AD/n0/P8qAHE5x6j8fTr0znnjHHXJoAPTPr68d8/XOMk5A9cdaAAnHuD9QAenT1Gf9rHryGoATjPQgen[1G[J[2m(lldb) [22m [8G[1G[Jcfn/AFoAUHBwcY6cjj6kDv8AXH6EMAL1wTz07+nscdcH6e5O6gBPXk4x74znj259SB7Y60AJj68dcYP48c4x36Z49aADj6f5PuTwMD+eerAC8dgf/rD1A+vUEfh1YATP5e3H44yQM57HjsB1oAB65Hp+ffHcfTHr7MAHH6/n79sdB25z2xQAn+f8/X6du1AC/wBf8/jyKAA9f8ef8/59KAEoAP1/z+H0459zkmgAoAKACgAoAP8AP+f8/wA6AD/I[1G[J[2m(lldb) [22m [8G[1G[J/wDrdOce/wCXNAH/0v4Csc4HT5hx0H8unGcnnpk5BroAXOOvr1wSAPYcd+OOh7HAFAARj3zngHHpn3OT24Pb1LACgnP0wNvYfjk5I79P0AoAXPTORntznjtx688+nGVyTQAHgcknJ49e2MHjHT8fQ9KADBzu/Q9s+/b1P5ZHIYAMYwM/5749zn1Y9hQAuMdz6euPT06f/rzyaADr1Hv/AIgj1/l+AoAO/Xr27fn/AJz+dAB3/wDrn+XT/PsKAAe3[1G[J[2m(lldb) [22m [8G[1G[JI/XPOeuP5/lQAdfU4PGBj29efQ/dH5k0AA/zng/l70AJ2yRnHQdeRnnPHX6DGO/BYAMnuuf5frn+fbvQAvTI9Prz/n9PxoAjJB5/DH8scAkfh7c8UANz37569M5/l09ec98UAKenGT1ycDr35/DqOxHoaAE7dOOffH0zyOvXJz7YBYAO/wDn+vp3/PvQAAd+319en/6z0x35VgA44/X/ADx/P8uKAA9euaAE/wA/5/zx+NAB/n/P+T/MKAOzngHo[1G[J[2m(lldb) [22m [8G[1G[JPTHrxxnsT1xnn1xQAh/yf89vwBHQ5xhQA9x2x37/AKf/AFu+cZoAD2yD/n06f545xmgBeMDk5P8A+r+X1z07YUAQDJwO/r/kfz/KgA9T/n6e3/1qAAjH/wCsH+X+fyNABn1/Hv8A54/zxQAde/8AT6fU+/HXHuwAf59PxP4fT17ksAA7579OP68n8gc98YoAT/P+f8/yFAC4/wAe3+f6/rQAZ7e/ft/n2/rQAY79un4/5/P8KAE/z/n/ACf6qAFA[1G[J[2m(lldb) [22m [8G[1G[JBQAf5/z/APXoAKACgAoAP8/5/wA/zoAKAD/P+f8AP8jQAUAFAAPzoAd1xxznHJz6Y4zyf09QcgKALgHoGP5AZ9uoGfc8D143ADTjt79e/wBPp259+c4YAUjH9QcccDoepP4cE8ZyKAFzzj88+ozzxnhfwz1xzuQAb1OcgDP0z+HJ/wAO+M/KAOOOecAHBGOCR+PQ4/2j/OgBpPtz69Pywcfj364zzQAoOPxPI59+4x/n15FACfjz2x/j1/AgY685[1G[J[2m(lldb) [22m [8G[1G[JIUAORx6HPXI//WP/AK1AB9f/ANfsDzz/AJ4zmgA6/mOT+vr0PoM9+elACUAH+f8AP+f50AFABQAUAL/nk/5+uP8A69ACUAFABQAf57/0wf8APfkUAf/T/gMx3Ocjqc+nb5Tzz65+o/i6ABsj6AZ9/b8T+OfbPzAAOy856/159Mntnj0bPygC9e+Dwc+x/P685HTgdKAAnI+mRjrnI7dj1HXPqcZxQAc//WHzdx/u9OO3AHBGaADtn+7+HTr6ke+R[1G[J[2m(lldb) [22m [8G[1G[J+efmAFx15/8ArfTAB/n+pNAB14P9Dn3xgjrx0/LFAB+P17Y7+x/P075zQAcHpwPbH5Hr+n03DAoAMenHXj198/r+lAB37f1z/XigBfwx/np+FACccDj1H4f5/Hn3oAM4/HpxQAeg9Qfr/hnnufzzQAmQASO3TsM9OPlP/s3fpQBH/Tvnr1x1x1HHI9uM0AA9Mj+g7/4+vP1yoAD0AOT39s9RwD279MZ45WgA9vTv/icgdemc/kMUAJ7j8R/jn1/E[1G[J[2m(lldb) [22m [8G[1G[JfTpQApz6Y9gPw+o+nvxQAn4dev48/wBPf19CoAdCOv8AX3+h/wA+lAB0PTj+hH68H2+o60AByfX2J44/HP8AP86ADj6+v/1sEZGff6ZyaAF446jPXPTjgEcE+uePYYxQAhBGPfnp/wDXI/l9KAA8/QcDPX/P06dPSgA9Px/z3I/H8MYJoAM/n/T69yfp+VAADyO/49vT/wCtj6Y5oAPw4yeTjPb/ADx/WgA/PGfXB9vb+fTtn5gA/H8fxx9cd/Wg[1G[J[2m(lldb) [22m [8G[1G[JA9OPqR3/AKdP/r0AA/HPoO/PT2P+fSgA/mPw/wAn/PrQAdePyxz+H0/z3oAOn19u3vn1P44z7AqAGOM9Occ8j6fXr/PIwAwAf5/zjH8/yoASgA/z/n/P8qAD/P8An/P9aACgA/z/AJ9KACgAoAP8/wCf8/yNABQAUAFAB/n/AD/+r8qAFH+f898jP+I6MAKATyM8HjP5429QfrgfXgUAL6ZwSR6Y/wACOwHzN7Y60ANPBPf6/wAux9sDGfagBwHr[1G[J[2m(lldb) [22m [8G[1G[J0IwMk8dcZ9Rx/UdDQArHP93j3znP1/H/AAHVgBue/Gce2AR6f078+4oAMHBz/TI57jrz+H8wwAmP6+gB+mc55/Ppx1oAXnOe/v8A/XxjA6f14FABnjGfrnPv6Zz29/TAJNAAcnt19PTn1z9eOPpjFACH/wDV3/DPHT6fTGaAD8Of8/55z/VQBP8APr+oxn8MfhQAvX2/r+ZPP0x7CgBKAD/P+f8AP8jQAUAFABQAUAH+f8//AKvyoA//1P4Deh65[1G[J[2m(lldb) [22m [8G[1G[J/mAP1OeM9Sf1XoAQ9fTrwRwSOSSPf146Z7gMAAx3wT14PUdMZPXJyKAA4zjJxg5x0GMcY6f4d6AF+7j0+vrznt9OrcdhnFAC/wD1uOOMf59W/lQAY+o5zx/n/P4CgA/H6/8A1uRjH4nv14oAB/n+n6fT9QWADv8A0x1//UfT19xQAdc/0/yen8/TkUALQAnY57d/6jr/AC/A8bgBcj/P+ee/+c0AH06+/NACY6Y5wcfn68jnHrn6daADP4ZJA9fc[1G[J[2m(lldb) [22m [8G[1G[Jjn8e3YYJIoAaTkEDHHPrnHt06+pH0ODQAzvk/XgfzHp1P60AB5A6D2Hb3Jz1zxyPyBG4ATjHc/j0/wAeSf5YHVgBR35PbHcH2I4zz/k8GgBD3wP5nH69+nOfqMfMAHXAH6+vTHqeewP1I52gB/T+v+e+MdvRgA9v656fQfX6evU0ALjPTt0HH8+/fPH1zmgBPTjPt+h9eT/gRjpQAev8u/8Ah6d+3egAHc9/T/62COPqPxoAX9eO5x+XXpnA6evf[1G[J[2m(lldb) [22m [8G[1G[JFAB0BBGDjGfp+X49efXGFAE7dT+vHbPQ56Y9uMZ5WgBeP8nGfcZQY9Oe/TGMqAIT7Yzz26e3ft/nmgBcdOeoA4P5ZzjpjkZwPbigBO/4nk/16/oM/XpQAcY6H8+v0GPX37Y5yBQAf4ccfh/k/wCNAByOnT1/z0z3/I9RQAn1oAXj/P8Ake3/ANfOaAD9f88eh7+n1xQAlABQAvHuf07f06f/AK6ADn06f07n/I/TDACUALj9f8/T9fc44oASgAoA[1G[J[2m(lldb) [22m [8G[1G[JP8/5/wAj+QYAKACgAP8AnvQAUAH+f8/5/lQAf59f0PH59fwoAd0OCQOM9PXGeOecH6DoMcGgA/HA9geO/ucd+rdecZLUAGenGeOM9OvPc+nt9OKAAc9DjOBg559/TryOfb5cigABxnoMHBXt2Hqc/r/wHOaAFJJ4B6Y5/wDrYzwRnJP5HigBpGOM5Oe3r3+n5nPTJxQAp69x3x9Og6DB9+fryaAAYx3z9M5P8uc9/THHVgAxj1I9fX07YyB7n065[1G[J[2m(lldb) [22m [8G[1G[J2gBjHcHHb/8AVuyDn2GeuOqgCcep6dP84wO/Bb8M0AHYc9B6foDgk9e4AHZjmgA/X/D+n+fSgBP8/wCf/wBf0zzQAUAH+f8AP/6vzoAKACgAoAKAD/P+ev8An06UAf/V/gNB7DPH8/U/XPGfTOTnC9AB9c9+BznJPB+n+elACkZx3H+cEH2+vths/KAGADn2x+H6/wBMY5J6UALn8vy/D8c/5zQAf5/z/n+dAAP857/5/D+RYATHTqOpI+v4n68H[1G[J[2m(lldb) [22m [8G[1G[J8s0AHr+oGOv4DOfx/DqaAAdv8Mf/AKv8+lAAf8j19vx/D+YYAX9Pbj/6/T2P5/xAB/n/AD/k/wAgoAf5/wA/5P64UAT/AD9P8ST1oACevYfQ8f48854Hb1LACD2OAfz6evrx7n6E5oAYcDkdOgx6HJzk9Dn8R04wCwAEdx06EdSOPryR2GO3XtQAnHTPGPyPr931AGBu4596AA/Tjt/9bDY7dcHP6KAJyP8APoeo7Hv6j+agC4Hr1OBj+fbHrjPt[1G[J[2m(lldb) [22m [8G[1G[JxwaAAHGe/r/tdee+P0+h5NACfnj/AD/U/wCc0AKeuB7dOPYE9ef8nGcUAHY+owev8vXkn6dutACf/WHUdfX/ADx+VAC4xwTx19P/AGX+XH+1QAvXBz+Z5x+JPTtzk9eOKAE9vzJzx+uO+MkZBPXtQA7GB1GSec9B+ec46E478g4BoAZ268/3efpnvz36/TGStABz6Yz7YA5HQnPf8vbOKAFHGevQdhjp364z29e+OtACeuOnHP8An1Oeo/755FAC[1G[J[2m(lldb) [22m [8G[1G[J4I6ds+g4xzwep9Rnj3yKAD6Dv0/LjHX8c59lx8wADg5PGD36/wBM+/H5ZFACc5x1+nOfX0z/AJxnJNAC/hgcZ/3vx5OMkY49fQMAA7HOMfX+mc9u6+gzg0AJ09z07fn/AIYoAM+2f8+xBPHv+fNABj35/wA8fX6Z/mFAEz/h6/5/z6UAFAC9vr/Tt+vp+VACf5/z/n+dAB/n/P178fTGDQAUAH+f89f5/nQAUAFABQAUAFAB/n/P+T+gKgDhgj6Y[1G[J[2m(lldb) [22m [8G[1G[JB+hOfw/EH69lAEz37557E/h1OfYr/I0AKQeAMkD0z7kHGBjr7/WgBO579fY9Ovr9fyPWgByn9OmOOp6Y4yM8n5vbjOaAEx0wc4z24xntxjH1wOvJBoAUHrxx6jI6E4I64P5D8iKADkYPOOg4HXp059/r3xkbQBPqOueef6k5565Le22gAAPbOcZ6Y/LHX069+M80AGd3XsD0/wAjGOPXOPfFACdM9/6/TtgEe345+UAU5+mMfQf564HuaAG/5/z/[1G[J[2m(lldb) [22m [8G[1G[JAJ/lQAUAFABQAf5/z+lABQAUAFAAevU/yz9f8/zoA//W/gNzgc+meo/DGCO35dNxOTXQAcHHUfmPXjucjHPPX1oAd/n/AD1/l+dACdf85yO/r3GP5Y5NAC/5/wA/5/kKACgA/wA//X6Hn65/Dk0AJ/ntxnH/AOvnP48LQAY6dgPTv/n6+xzgUALQAf5/z1/z6ZzQAUAHT/P/AOrp/nPWgA/zj/P+H5YoAPb/AD/kfTv3oAQ9sev+ezfy5HHOflAG[1G[J[2m(lldb) [22m [8G[1G[J9AcDOc8Y/ADtkdPXjuMgUAINpHTHPPX8wfm+uD9Oc5oAQ5HTdzycH/POOuT9M0ABBGMHj8iOgIJ7fp6c4BYAacfX36fnyf8APc5oAd3AYnP4dun19QeOvvlgBPxx/Udx3H4fL+OQaAA9uME+nT1z+R6Z98LxuAAY5AGensfz+YfXp7YxhQBdvqegz9CfXk4/ANn0BwKAEGO/b3x36DPH6L178bQAHOTjPU/j785x75z78ZoACOnPbpz+Xfp+A78c[1G[J[2m(lldb) [22m [8G[1G[JFgBRluce3GB2xz06/p2zjNACY9Menfnpjjjr1HH1xmgBT14znjB6E56nGAfbv655oAMg45wR/M9/TryTjPPegBBzk9uPXueuTz78nr2PSgBT/F06ZPHGQfxP59epxnFABjjPYdueDnp2+hH/AI8MA0ALjqASBz/+r27YyCTntgBgBpzwe/P1OCO46nnqB270AKFzkn159R69T9B1b17fMAIOhwcZ7Yyfb065/wD19KAFOB69iM/XkHoR+BGfU/xA[1G[J[2m(lldb) [22m [8G[1G[JCc4z24Hc9O+C2COvHT0xn5QAwc+3qRx/L054zjrkYoAPyIzz2z1/oe3Qc+tAB8vHPb+X/fXX8O/TgKAIePwyOMj29+vX73TjjOKAE9/88/8A6qAHde+e5HI9zjt+v58UAN/z/n/J/qoAUALz+HX6foPz5+tACf5/z0/l9cUAH+f89f8APp1oAP8AP+en+fXpQAUAH+f8/wD6/wAqACgAoAUHH1/yf6e3t0AYAceeg4OOMj8z2BPQYP55oAQnHPOf[1G[J[2m(lldb) [22m [8G[1G[Jr3PUDgYP4nr36qAKR3weMZz75/w7D34xQAoAyVGfrnj8sc9sfd9Q3ANACdAO4IHT/DucevB7fdoADnoeQO5GB06A46fgCT0xmgAGCeR16Dtj+YznryPXplQBMdcnnnPv3Hqfr6D0wTQAevfp6jPqQTnH1I5680ALjrj0OemAfTJH8s+oIBoAafz9T1/M8ZOfftzuz8wAc/THTt/LPPv9M4zmgA/z9P8AHjn+XegAx9SeMYGfz+n8/pQAH+XH+ff/[1G[J[2m(lldb) [22m [8G[1G[JAD2FAB/n/Pbr9Px/hAE/z/n/AD/OgAoAP8/5/wAn+RUAKACgD//X/gOPUdeOP07/AP6+vXJroAOnv7Z5/XH5ZxxxigBf8/5/M/X8KAD+f+e/SgA/z/nr/n06UAH+fp/nB9f0AUAKACgAoAP8/wCen8/yzQAUAFABQAfX/P8Ak/54oAKAGnnAxnHPUD2565/I/hmgBGPHQj09u+R17AccEdckACgBBgAdevX6j+nTv6+ygC+nfHtng8H6nPXn88mg[1G[J[2m(lldb) [22m [8G[1G[JBmOgIxn6A+nB7+uDgdhjIagB+Qep6nHt9cHp0xkH35wAwAnOO+CAT7H35zjA69PbgGgBOfccYP09fQ+nJ754xQAnBPcjHA4HPQe3brx074xQAuO3III9On1HcfrQAE8nODjjH9egx1xjJ554wKAFxkc9vY/l1XOMHP4AZyTQAhB9+xI9ff8AiwR05Hv82TtAADGT1x0OcD+SnIx6+3BFAChc5PUdugJx9On5+5B6UAAH1Xjnjj6nOR79OOnHBoAM[1G[J[2m(lldb) [22m [8G[1G[JDvyMZz0xx3HzepIxnH6UAJgD72ep+uPU/X6juRnqoAoJz0zx3HY9M+o9hjPTnANACY68jHvycdj/AA4/LjgcDlgBR0GADxgjnn+nU8g9vqKAF9Rg8nsefTn6HtkjnPODuADqcE7vUAY/EnPsPX6dAoAh68fLz7Y449eCeeMgHbg4yaAE7EAYP4fnnt39jnjigAAHQj/HP4e2T909sk4FACYA7djjJ656cdsfhz+AYAXYSM+wx/8AryO3+z+f3qAB[1G[J[2m(lldb) [22m [8G[1G[JhjnOecHt2/w9vzzQAh9vz4GfcDn0xnv3xnFAARg9f/1Y+mDjp1zkdOc0AA6Ht/XpxjGOM9cgjP13AB19OPoM/Tt0/wA9KAEOO3+GP8T6n3z2oAPzx/X/AD3/AMaADnr6fj/nk/jQAdD6j/P60AJQAUAFACnj/DOevIOcAenQ/wDASCaAEoAP8/5xQAf5/wA9f5fnQA7ODyMH6kevoSe/4++MsAHT1Gemef8AgXboOB19QRgigBPzOR9eT7dvxyeM[1G[J[2m(lldb) [22m [8G[1G[J9wFAFAyeOw6dOoweo69PUc9RxQA7/gI7dGxnn8c4Pc49e2KADrwR34yR17Dsefr05GOKAEXuB9AT/hnp1yAD7g9KAAjp83Hvx9QMg4/I/hxtAAAEDjk5x1IH5H+Z9TkYoADkZ/Inrz3AyOM9fw69qAE7dB09ec454yPT07cZzQAce59vQYA5PJ64x/TIFACdfbJ9z+fXJ/ycZ3UAHbP4H+n16Z/D3oAO2fXI/wA/Q4PJ/OgBPbH+f89Ont3LAB/n[1G[J[2m(lldb) [22m [8G[1G[J/P5/h+NABQAUAFABQB//0P4DunJ9Mf8A1+mR+ePbjNdAC/5/z/n+dAB/n6f5+rfXpQAfj/n16ex6Y+h42gB+JH+fo3p/+vIKgBQAUAFABQAUAFABQAfy/wA/T/Pr0oAKAD8eTn9Pwx+HPToMfMAJjr79ePw64/HBzntgAqwAhwc8dD7c+vOfQDI4P05FAAMHPP4HGRg4xjHr+PP8PVgBCemMDBxxj6dOeD7kdOnFADewyAMnrtHA/mfr+p5CgDsk[1G[J[2m(lldb) [22m [8G[1G[J9hjrz1I79x1+gHqR0oAQDPpnnIwOOfUHOOn9706c0ALjoQxyQeT6fiD7cDb9TkGgAxwRnucn36+2cdc7enAzkmgBvTI6gHjpg+vqcgcnnA96AH5znHOeOmAPqecnGB0x6g/xAB6c9znrk/p/ID2xQAnXnAI64z/+rrjGMepO3JWgA7ngYPTpx2PQ8dsnp/ukkMAHbqBjpzwenf25GPxPagA+oHTPQnGck5B9D78/7PFABgcdMjn6g88DPcdicD14[1G[J[2m(lldb) [22m [8G[1G[JJoACo655H064GP7uOncH6DHzABzyMj2PIx2AJwc8gDB/XG2gBeOvPcE8ds9cD29s9wcfKAHQcD19voTjA6Zzjpx16UAA9M8+vQn8Dn9fqAM4oATIOG6+gOOMHrnavHv29s/MAGTnnpj0xz6DJyemOoB6nHFAC8YPcHjcAM8evTI+mePzoAb0H8XB6Z/Hngfy54xnIoAU47A8+h55Oc9MevXHTt1oAQ9uc+vqB6nPTryMc4HK/wAQAAdc5J68dOPy[1G[J[2m(lldb) [22m [8G[1G[J5J+p/JloAMcDA5yCflxz7HA447bfqc0ANx0/P3wf0A6c5bHrxQAEY6565z/XBxnv1POe2c0AB9z6+mRz36nrk8DI980AHT0PUgcH8/oPXjj60AHJ4B6846Z/nj1xn8+DQAY/Hqc5x7c/e78/pzjcoAh6D1/Dp2/yRn68UAHT3/z/AMB+v88fdYAMdfagA/zn+eP8MflQAc/kD/noehOecfWgA5HNACf5/wA+n+fagA/z/n/P8qAH/wD1gfbHr8uO[1G[J[2m(lldb) [22m [8G[1G[JfqcEZOOtAB1GM4xnjj0I569xn2z2yTQAnft64zwenA+U4Prj36DFAACR0H44z17Z5Oeccn88GgB2AOe5GcA/qP8A9fAyecUAAP1HYj5eecDPI+h4X8M/MAGO3Gepz3HY56dW44bsCODQA0jrkA8cEcY59guc57jnHGMfMAO9uPU59R09evJPA+U9aAE49c8dhgc9zjPTPcZ9M0AL1OD05P8Ae/Htjk5yMZz2GKAG9j6/kMdTj8e3PqO5UATByOuT[1G[J[2m(lldb) [22m [8G[1G[Jzxyeeffn/wDXxwKAF3c5PXuPT3HABP1x+PJoACPxHXjGR6Z/E8/pQAgx3z+H+fp9PxoAD/8Aq/lz+A/r6UAJ/n/P+f5UAFABQAUAf//R/gP7dPw/zj+f5V0AH+f8/wCf5mgAoAKACgAoAP8AP+f8j+QYAKACgA/z/n/P8qAD0/8A1/px+WfyzQAf5z/nB/T64oAP8/5/z/KgA/r3/lz179v8KAD/AD/9foP8fYZNACdu+SR36dOmQenuDnOOP4QA[1G[J[2m(lldb) [22m [8G[1G[J9s8jH+f0/wAaAAfjye5H8+noeM5zgeqgDegyP0GeOevPP47ufzoAXHuB9ARx7e4JPQH144DACDGccZ/M4A6cbcce3txjLABwOoOSMdznPUZ4yenOPbjFABjpg+5Gcnn36jPU8fnmgBfb8evXnv3xj1HHQbsUAGMAAZ9iemeuerYx+vv0oAB+nXOc546ep9ifT2FAAeeM4P8Akj9M+mevYFgAxwPb0OevXnr0Oe/oOgKgABj1I6emPp36/wD1y2cq[1G[J[2m(lldb) [22m [8G[1G[JAL+H+fXq3v1PtzkbQAAwTz17e/tx/X88fKAH9e36H1/Q/nQAHvk7eevX/I9Rlfr1oAMD8+px3/TnvwPy4FABjAHc9/b3PCj9Sfqc7gAx+PT8Pfnqc8//AF8UAIR1PBPb+vHHYep6ZxyaADjgjvx+ZHHQ9s8DGMe+aAF4HYY/LHqe3t0/HPAoAQDH0Hbr179Tx37ep9KAF46cdPTt0/pQAg69+R3zx+HTr6Hj2oAOOfcd8j6889evT355oAT8OemD[1G[J[2m(lldb) [22m [8G[1G[J93nJ/HBHYc44KgfMABH8XpjjGcfXBB469/p1NAAeuPXn6duBjnv/ABD1welACe5Gc9RnoTjH06Y7Y/DDAC/eJ9BnnA7445U9MY6Zxxk/xADCMZ9Dx15H+SMe+OozhgBeMDrwfYdPyPI64PHBOMigAHAz3HbPQHHsDz1yCuOhJyDQAAbs+vHp0/8ArcdxnpznKgCcYPBPv/U9D7f49KAE6dR+f8x0/wA+vSgA/wA9f59vT0x37lgA7fj/AD/Ttxz6[1G[J[2m(lldb) [22m [8G[1G[J9aAD9Md/X9Pf/wDZAywAnbP9c/T6fnz7YoAX/wCv/n/6/wDgKAAen9M/57Y/H3oAd14HPsc9u4H64y2fT+GgAx6fXH3uvsAcAdefXjPIYATH0we+Ceh5/u9B1IXtgY5LADhx156n657EdcY5ycdOgHFACH19PcHC9MYGM5+vvxk0AGRz8xP1/wDrHn0I/H5sYUAXAOfvYz06c/yz25x69ThgBcbuDx3OOf03Yzj6Z7ZxhQBu3HQ9cYwOfr24x1wO[1G[J[2m(lldb) [22m [8G[1G[J/U5NAC8Dkde3P3vXPIxj6+5zgUAJnA985zx09j369Bz+ZoAQ5zuOM54weOP8eO3H+1mgBcDnvwDnb+Y4PBxjvx685oAaOD9QOenXrjj8M4PtmgBTyTxk+g7e/G4H/vrr64IUAb/n/P8A9b+goAU9aAE/z/nIH8vzoAP8/wCf8/yoAKAP/9L+BD2/zn3+nTn+ldACf5/z/ke/owAUAFABQAf5/wA5z+p/OgA9P8/5/T+ZYAXrk/5/qT+f580AJQAu[1G[J[2m(lldb) [22m [8G[1G[JPf8Anx/47+HGfw4LAB36+n5/y4PHJ9+eaAD8f8/5+n8gwAdu3qPU/wCffHt0IYAQd8Y578fz/P19+wUAX8h269c9vU9/zoAQg8HII9sc/wD6gc9QfrjFACHGemenOPf8fXPHp260AGM9+Dj3GPy7/j7EUAGPpj6Z+n6f54oAQjPv1HUj88A5wc+n14NAABg56544H5e56DuB3x3YANvOen45yPQjkD/PQ80AG0EYz9cDjP04x+BBx13YFACjOODn[1G[J[2m(lldb) [22m [8G[1G[J9PfrznjA/wAOtAABjA4/P+Xrz+VAB68/r/go6/jn0GCKADA4+vHH1x6dM/4560AH44/z759PT35xQAvv/nj/APX6fnQAf59f5f5/KgAoAP8AP+f8/wAqAE6Y9P5f4/n+VABz69/Tp7fhQAo+uff/ADj/AD69aADn9f0/xoAT/wCtzg//AFs/06nPIoAMe/fJx69cc5Pf2/UCgAx16H0Ht6Z2/wDxX/xQAv8An/P1oAP84/zx/nigBOP8+/8Ann8z[1G[J[2m(lldb) [22m [8G[1G[JQAdz/h19Pyx+tACfKD05A9+nqB07/wBe1AB1ByeD/L8hxj3ORzxmgAyTx75HcY7Z69fz9MfwgCAY6AEjtu9ev+Tn9AFAE4yeQCTxxnBHHr+R/TtQAv8AwHJznPQnv0x/JuvHPJYAMDjjOQeR7cnoOfbG3OOegFACYB68Z6D04x0554x05PrQAccDBzgnHX8D93kge/XpgAsANBxyR1wR26d//r++SGzigBeg2/4DnPB4z27E8YzzmgBv+Hb3/rg4[1G[J[2m(lldb) [22m [8G[1G[J7f0YAPfPOf8APTPTpjH0zg0AKOOvOfX8e/Udj680AN/z/np/kc54FAB+v+evUf1+lAC5/Hn+f+R6479cKAH4+2fb8s9Pb8O1AC8Dv6ds4454yo9P8QchgAHXjj+v6tgn9PbrQAoOc5zzwOQcYHfOPX0PtzzQAnbtx145+p6E8ntx0JzwKAHDqM5J5yPT1OPy+uT6UAOxnkgjrkZ9sfhn8ffjlQBDg4/XIOSOPrnpz+mM5oAaM54PX0HAB4zjtjAz[1G[J[2m(lldb) [22m [8G[1G[J+XONzACjJxnnHXHQex9c9evtgdKADGTjI46Ed/U46DoemOfX7tACA8579R6nPXngcfT8sCgA9SRk9M8jpx146+2M85xxQA365x645Oefft6n35oAU84JPX69uPQ9Pw+jcUAJ+n+fwxn+R78GgAx7/U9vw4zx6jPUcDjcAHPHPqR2xj/HHt+uWAE/z/n/ACf5hQAoA//T/gQ+uc/57V0AJ/n/AD/+v8sUAFABQAUAL+H5ev5n+n0oAPXOc/55PB6f[1G[J[2m(lldb) [22m [8G[1G[Jh/WgAHf/AD/kfrnGKADv7e3+Jz1/X2xigBR7nOOh5x+PQj06flQAntyeuPb6df5c9OPvUAKAe3UZ59Oo6BeCewy3TOOaAFPGcZHTI6HPoOV/M+mec5oARh3JBJ5x1/DBz0H0PfB60AJ7/pj/ACPXoe3bAoATj+vQ9+o5z39z+HAUAQ5yMD659z25H9R6elACn8vf09/85/mVAG84P0PsR9f8aAFzx0/A8f8A1/fufzAUAPxOPryefX9Bz9c0AKOn[1G[J[2m(lldb) [22m [8G[1G[J+f8A6/8AP86AAcdsfT/I/wA8c4zQAnHUd/1/XoPw9geKAFoAP5/rx+X8vwGRtACgA/Ufp9e3X8foOTQAUAH+R35/z/nigAoAPb/P9T/X6daACgA/z9f0/lt/pQAUAHb/AD/9cZ/D86AD9T/n6c/l+FAB/n/P/wCr8sUAHp155B9PcdO/159MGgAoAPxx+XP6H+YoAOP1/X/H/PrQAnX26jH8j3H8x9cGgA59f8/l07+vvjigAx1zj/Pr+Of85oAM[1G[J[2m(lldb) [22m [8G[1G[Je3Tp/wDW6Y/Pn2oATbnPqePXH8vr2xxgnrQAEcHr74xk/p/Lb046YoAXryQR29+eO2SMfXHPfGaAGknsOOuBwfoMD8xyevIzQAYHIyeB+g/PjkDv074FACZJHPU9OMZHcZ649DhfXvtUATPXII4wCCDx0PoPToD6nsaAFPUg9PvHp9Pbkj0K8896AG9e2AO3Q9+/zc/UrnoMcUABHt/iSfp6dccY6c4xQAmPXPuP89Pwznp7KAHPvj3746enb347[1G[J[2m(lldb) [22m [8G[1G[JYoAT/P8An6/T8Vx8wAvT/wCuP89Txnt0oAT/AD6f5/ye9ACg4B5Ocj6fj6/59aAAew5z1/z3/L9CWAFz7cfj+mSQDznv05xnFACj0OQRx78/hxjPHPPTkH5QA5yBnAzwOmcH9Pryc9iRlQBRgZB5Az+nPTOcf99Z79M0AO4PBznOc9M/xYAzkdR3Y8exWgAxgd89B2/ln8MlsfnQAnTjJAPQjrn1b6k45B68jgbQBCOnXgDp19zx1OMZ/A9KAD06[1G[J[2m(lldb) [22m [8G[1G[Jgcc7h0OPoe3QDtnJyaAEY5xgZ569zjjrwDn/ADnk0AIT6+vTOQAfQjGMcY7cc56UAGM8AdPc/wCJHfjgfjzQAYJ9fTpjn0/DHX8+tACEEcf5+v8AknHtjLABjIz6e369f6enTJ3AB/h2z+P6deg/MlgA5PP+HGOPw/z6igD/1P4EeDknPb05PuOOuOx49q6ADsRjPPB/z7D69SelACY6/TI598e38vy5oAPX1/z/AF7+n40AA/zn/PPr/k0AKOnT[1G[J[2m(lldb) [22m [8G[1G[JqRz+frwO/b1zkUAJ0J9c/hz19h/KgBw6fiBkeh+mc/l+dACfQnpz/n06euPwwoA7HAxyPfkn8No6ZP8Ad455waAEx0Jz0z06YHGT26YyNufbGVAFz/F+nXuOfoD0HHPp92gBMdM5zzkZ559B8x6e/wBSf4QBDnk9s475xj36g9c4H0HFACenI6cjvwf6jnHH6gMAJ6c8cke/bP4jnB6UAJ178fz7Yz1GOvT2GeaAFoAT9P6+nY+meCMd85oAWgA/[1G[J[2m(lldb) [22m [8G[1G[Jl+v+eaACgAoAP5/57dKACgAoAP8AP+f0oAP8/wCf/wBf5UAFAB/n/P8Anj8aACgA/wA/5/z/ADFAB/n/AD/n60AFAB/n/P8An+QoAM4/l/n/AD/SgAx/h/n9en9RQAUAFAB+vce3H+f5d6AD/P8An/8AX+VAB/n/AD+H+eaAD/P0/l/X8KAEx/nJ/wA/5+lAARn/AD/WgBf8g9fxoAPxx/n8f5fnQAnX/JB4/X/9fvQAdOv6d/8APtj+jACc5yB6[1G[J[2m(lldb) [22m [8G[1G[J5+vr+OOnc9egoAd/n6f5/wA9KAE79fU/ywD39T9aAGAZAye+eO2Ppjr9eMcZ+7QAYAPJ79x/+sEnnknjHAFAACRyR9ccYA468eg6hvQZoATb82AD2PYY9c53ZwceufxAoAQ5HXP8sjjn0J59ee+KADt7c56DPpx2PB9z177VAEPv1wP/ANZ/Dt/hQAcY9/5+/wDT+XegA/z6fn/kfzLAAB1/zjpzjBJ4/TnnowAD+XPft9MkfX+XWgA4Hc5z6fqO[1G[J[2m(lldb) [22m [8G[1G[Jnbnrz2xQAoGf1Ppke30x2+nTNADwQTnByOnJ64/T+vuRuYAdj9fxz2/lQAYwMfh+fvx25/lnAFACf0JGTwAPz5HHqM9eMigA64OCCOMdufxAGBzwD+FADe4zyeoGfft+A7t1+uaAF4PODkc+pIz/ALwPQnvx74BoAB0OMDoc9v5t9M4564PRQBAO7HkfNjHp69/rwcdgerADRnt0yeffHvgc9OR37dKAADrz+QB6g/y/U9KAEHGM4wfxx+CkH884[1G[J[2m(lldb) [22m [8G[1G[J644oAPw/X155HOeO4x9D1oAPT0/z/wDX/wAigA/l69P8/l+WaAP/1f4EueePqvTBAz90kdBkjqPQDOK6AExx16HnuPTP+c5H5qAOIw3J5PfA6/yGOOec/qoAmDjd17jIIPPfAIHX6g9+mKAAZwOnfHY5xwD069RznnIxmgA5P3s5PHGOh/lz359D1BUAXBORnGeduO+ex+UenTP48BgAx0I7EccHnjHTaDnjnr34yTQAo78j2OOBn0/H652/ioAH[1G[J[2m(lldb) [22m [8G[1G[J125Pfg9P1Hvz+YxmgAxk9fdfx+nQDtwPTPZgBMdgOnc49z3A45x/F65XgsAKeo468fp1+9yOcHhunXpQAHIx3GOnGeOcY6HjA7kdcnk0AMHrnkEH/wCsCRjPX+9nj2FAA3/6sgjj0AOenrn6dMsANoAP8/5/z/MUAFABQAUAFAB/n/OOP0+uaAD/AD/nj/H6igAoAKAA8cen+ff+f50AKBz/AD7frzj8vzzQAnXp64/z7+1AB/n/AD/n+RoAP8/5[1G[J[2m(lldb) [22m [8G[1G[Jxn+X50AFAB/n/P8Ak/yKgBQAUAH+f8/r9PxoAP8AP+f8/wAqAD/P+f8AP86ACgA/z+NABQAf5/z+fp+VACc+2e/P+e35/hQAv+f8/wCf6UAFAB/n/PT+X5UAH+f89B+Z59sGgA/z/nr/AD/OgAx09un+f8/oKAEI/wA/5B/p9aADgcY/w9+n9Rz2zmgA5GfTt3J9B2788nv1GDtAEyfy6n/63sMH/IoATnP+9xkcdD3/AA+nt0wwAje4J44OO5PH[1G[J[2m(lldb) [22m [8G[1G[JfqOnb6HIoAD0PPOB0x1HUcZ6H8vYEmgBoAI4LZBGPx9vw9Pc4xQAZ46DuB6Dv689e/Hpj5loATnjjt9OPf8Ax/8ArUAOwR0yCRk45z2BGD3z/UDjFADev+f/ANeP8g460AL6DAOeR269u2e3Tjjqck0AHtjnt6n6+hHYY598igBMEe3rz0HHUckfrnOMDAFACnj6Ht6evB9yf87aAHDJx7AEd8kdMnPHX2/D71ADx6YA/l78e3rhc56cigAHr09c[1G[J[2m(lldb) [22m [8G[1G[J9fb17/8A1sZIoATucgcc+p/p6Y9RjvkGgAx1yM5OM+ox/wABHXjjHbqRQAv1xx+H44/rx+hDADT0z1zg45J/D0wPRufbGaAD1yRk9c4xj1xxxnjJB6/d7UAJnp0HYg4xwcnB6jH4Dv3BYAM4yMc/z788k/z/AABxQAhPA7Y5A6cf4k+h/wC+eTQAmDxx+QPOfXuenUcDt1oAOvboeTj+ZzkfmM98YFACfh16c9/8fYjvjjNACnjkZ98gdT1wPT/H[1G[J[2m(lldb) [22m [8G[1G[JntQB/9b+BXAGOCCeMbeB7HJz1PUjPGOc5roACOvQ4GMAEAkehzz6jn2543ADRgjHOcA8EdvT7xHPc89vmwBQAoznv689PpnkEfh7gigBAGG3GPr9e348nge2VwNwAoAycZPOM55H4Hrg854OfXrQAgzu6dDjPU9Op+o4yMDPPOAtAC+nfuOeT36fLjrk8845C9GAFxzkHHXjrjn8cfTDKCDQAv4nj179R9ffrj0zzQAHk9OnQ+ufx498/l0NACH1[1G[J[2m(lldb) [22m [8G[1G[JODjOCenPY+uOnT86AEOPoTkDjp/LnJzkD1HON1AAc4HXPTrgnHXqMjJPUDtkjAxQAw8+uQfr9MbQR6DryfQDNAAecDHQAdv5Yyc/Xj33fKAJg/5/zz/kUAH+f8/jQAlABQAv+f8A6/8ATt+hLACUAL/X/wDV7f5654FAB79s/wCfT+f5UAA/z2/x/wDr9OM5oAT/AD/n9e/5cUAL+P8An8Af1/DPRgBemccgnH1wfbH6D8s0AN9/88/5/wAKAFP+[1G[J[2m(lldb) [22m [8G[1G[JeMfpz/nnjOKAFHbp6Y5/A9VH6/gDywAn+eg/Q/Q549BQAfnj/P8An9KAD/I6/l36/T8RQAY6+34duvI7emBnpxxQAvBxj0547/Xnr0HTke+aAG/5/wA//q/OgAP5/T/I/XH4ZFABQAUAFABQAUAH+f8AP/6/yoAPx+uO/wCmePqPxxQAf5/z/n+dAB/n/P8An+ZoAP8AP+f/ANf50AFABQAn1/w/+vmgA59+o4/ySPrz+XFABj8efx/M9x1zg8cc[1G[J[2m(lldb) [22m [8G[1G[JdGAAjvz9ASP/AK3+fpQAnPOBnpgdOvXvgkHng/j3oATqe3TB+U9e/wDEMEDuM59R1oAaecgdePfce5749+effFACHnHXGfQD64HPXHTOAfXNACnj19P+AkfyycDuOvUUAIc8A+vXI68d+2OBnHHuKAAHnpn04A/QZBPYZ+vHIoAU56dc+owc8fj16ckducfMAIPocfnk9h3Gep/w60ALx+AHPPUemPX6YGehHWgBp/DH4Dt6c4/A89DmgB6j6Dgc[1G[J[2m(lldb) [22m [8G[1G[JY/X1P16ZoAfgZz3+n+e+eTj092AD8f8AA/XtQAe/QY4GP14Pp2yPwoAQAH8Dnj1647Zx0/ocYoAMY9evY8ev4c8e546UAB78c9vTnAx1x+vbPPG4AQdyOfQY5x6A9ucjnOcY91AADPOfocd8/XjJ6j89uQGAEJ5zt54yT0+p54x6d85IyAKADuc+g7Zye3rjI98/XFADc/Qdhjn6EHHr1+9kfUCgA+hPOOAOufxH8jz6ZoAT3zzwB/n6dxn9CFAA[1G[J[2m(lldb) [22m [8G[1G[JnPbv16n26k9Pb8c4ywB//9f+BnHoQTzn/E56Zz6fnXQAz8M9fQY+nTtx/iTmgBu05GcYAx6/n+Xb8xjDAC+oznjr0/z0znP5UALn+f07nHr+B7+2QKADvn19TyPYD+fP54NAB+o/p7Y5P6/zCgCen06fh/njPuMYoAXA65x3Pb8/1749c5oABj/I/mP8/wAqAFoAT/PX8vT/AOt79aAA9z0/Xp0469fQjPt1oAaRnjjI56bvfnkdc528/SgBvToQ[1G[J[2m(lldb) [22m [8G[1G[JQcn6e39Pug+mM5oAb26j+v8AInGP5eoAYAU4/wDr+v5cfp+XNACf547/AE/yP5BgBKAD/P8An8KAD/I+n+f880AH4/h6f/r/AMk8hQBfXt7f5/r/AEoAOO+fbHr+nt/TOAaADp2z/T16Ed8nB/MZNAB/Lj/Pf+XPvQApz69Pxzznnt69z05HUqAIfTqP5Z/Hn/PHINACgHn1HOOhGO44wPz9sd6AE7//AK8fyJ6e35UAKPc5x064z1Hp9O3T+HAN[1G[J[2m(lldb) [22m [8G[1G[JAC57ng9RgDPTuMYPt0J6kHPygDfx69f598fnk4P/AAHeAOPXJxyfc4/lyB2z+BxQAAdufTHf3wduB83fI79eTQA05P5dsH8T+fXj9MsAJQAfoR7/AK9vYjHv1HNAC+uef89fT9fpmgA/zzx+Ofr/AId6AD+n0/T8+3170AJ/n6/5/D+QYAKAD/P+f/1/nigA/wA/59P8+9ABjv7/AK9fx/z60AFABQAf5/z/AJP8ioAUAGcf5/zigAoAT39SDycd[1G[J[2m(lldb) [22m [8G[1G[JvX147Y9PUsAIeRjvz+nBxjd1z0/DBOQoAc8g/ryPbHTHPVeeucjGKADpz1J4/wDr8Lnt7D0AzmgAGMfKeO/X0/DBx1Oevpg0AJnHXGMdB/PHQ/0/OgBvPXB9uR/THGPQ8e2TQAhPJxn356/XBwMdvyO7OFAA4xnpk/lxz65x2xn8DhVAAkZ7dOnOCep7/wAyPocblAFPTPb16+2OQp/4Fk+2c/MAN/r1Oc/p8vIP16Z5GAwAuBx7nqc469R04+oP[1G[J[2m(lldb) [22m [8G[1G[J0WgB69/Q5JOentweOPr9Rj5gBw7+n6AD/H8cfjhQA47445oAO5/l/X17euPrigA/Tn88+/XPfp7DOaADnuPwHP8A9cH8eOvOKAEweMcY6ZyfUY/D8e2M/eoAP0OOnfg/iO/HOPrigBMDv6+uecH2Aye4PH04CgCH2yRjr1z2PPQe5PPpQAHv349eBgnj3OMfL+J6mgAOCDyO56/p05Geh7HpuzlQBCMds8Y49Sew/XGB+OcKAIRjvntjHQfjjHPt[1G[J[2m(lldb) [22m [8G[1G[J+WaAD0IAH4+/B5z09uvI+XOFAP/Q/gZIxg+mMehz1x15/nzjAO2ugBuP84/P9KADj/PH+f8APrQAYGf/AK3+e/8Aj60AJj8en+PsPyH5UAL0x79P84HofXpz2NACdj+PUcZ+n+fXvQAY+mO3+e3+fegBf8/5/wA/yoAKACgA/wA/56dee/PtigBpHTnGPYEcZ/3f54HoM5oAXr3I4+p6du/bJ6nHTHRQBnGT3HfOQe3rjnkYxjjg7d2aAExyexxx[1G[J[2m(lldb) [22m [8G[1G[Jz3zjI9Ppn8wKAEH0zjtxz1wRjr78/XOaADGOoyM/5HXt26+xPWgAweuCQefz9+ef/wBfGcUAGMZ5/I/lxz36jP58UAHHbOT6fy6/j1bPTj+EATB9/wAv8/8A16AFGRnOQMc9s+34n6frhgA6j0Pvgcf/AK+OB6HjmgAPfOQfTOcn9PqOfru/iAAYx7+nrx15zg89e3UKeQwAq9wAMdzyf/15AxwFB9uQwAgGccH3wR+B9Rz1zkd+MgUABA4x+IPb[1G[J[2m(lldb) [22m [8G[1G[J6nj+WfoTQAp5xzxz0xkdOTjjr/nk0AGCO2Tx2yPxPb3PuMAAZYAMDPQ+5BAHqcew9z7cZoAT14wM+gyMfrnp+vvQAfUeoHqSOx7+3fHbHWgBR3wCOwAyfr1J5xz26dOBQAg4BJByP0z0yPQ9OT+WaAAevGew/TB69uevPcjrQAY98n2+n05Hbr9f9kADxkfhnP4c9cDHb5j7ngKAJ+o/zjP1x04+owDQAfXn2/PryM/XPfjOKAA+vr/Icf0x1PTn[1G[J[2m(lldb) [22m [8G[1G[JHVgBP1/w/T9R+WaADHf+mP8APv8A/XoAKAD/AD/n/PP4UAFABQAUAH+f8/5H8iwAcen0/wA//X/OgA/z9P5/ofzoAKAExyP58fl0J/lnPXigA9Pf/P1/T644oAOg9f60AM/MZ7jPbgZHbr2H5UAOxjOTyfzx35PJGO+F9ccCgBpJHHXkdz3HTJ6g9uG757CgA7eh9Bx/X3OOM+mONwAmMce2eTgdfT5sHHGccdeMDaAHBHTpn3z+WD79uvYA0AHr[1G[J[2m(lldb) [22m [8G[1G[JkY+ue/5n07DPfdigAIOOvfn0Oe55brkdT+ePlAA9Qufu9/8A6wz0HHU/8BoAcMjgfXr17cH8O4HTr2YAUdOQMYHb+Y9vp+fNAC/z9f8ADr1+nHfNABx6d/zPX25+p7Z4xQAe/Pt689+/Tv8AqD1YAPp16E+3P07jpj6f7IAY98j0x+f1yeex/MhgA7/n0x+R6nP0x059KAEHI6/jjBP6dhjn5c/gRQAgxkdR22+mR+Y9eM+p9FADA9R246d+p9gO[1G[J[2m(lldb) [22m [8G[1G[JxHbqOtACHjoD6ZAPOe+ccYPTB55HIPygBjg4OfoCMH3xzx2zux6d6AEOcHjHTOP6j5uehJzkd85+UAT+XHAz1Hr0P647gjGKAP/R/gaz044PYFefTj6+/wCWBXQAhHI56+2OOnrzwPRfUDnCgCYx6HP5emc5GMH6juemKAE/z/nGf5fnQAf5/wA9f5/nQAUAGP8APH9f8+lAB/n/AD0/n+VAC8cdc9//AK3/ANegBP8AP+ff+XWgBT79ev5+vf06[1G[J[2m(lldb) [22m [8G[1G[J/wCNAAce46/z9fp9P1ywAcdDx+oP/oQyeeuAfYDCgDevOM8EY5Hr14PTvkZ7cUAJg5zjJPUZyPrng9unOO3QGgBo6HkYByc8kH8AQensTng9aADGfYY+vTnI6Hvz0+rcigA5x0IPQdeg46dsA9fm789BQAcgYx0yCc9vXHf2546fNwaAE49sEDI/u+/Tn8uM45/iAF24zzjI79z+Z7cngfzoAMZA4HPfnt05xxn69OucjaAJgDn0HX36jpzz74Ax[1G[J[2m(lldb) [22m [8G[1G[J9SwAYxye3H1z3yG9D6dv+A0AL6578D8D6nOc9QcHpgf3VABsZBxkYJ44z3z9Prg5z7FgA5AJ6Y9Bgnp7cfXGOOQQaADGGz15HfGOepwB29uffmgA4ycEceg6jGc9+h7hRz2NACD2yD7+h4/HnknPoOaAA9B1POD68dgffrnbyeeMYoAXgd8HrwOme3PUDvge/wAuAKADgjtySfTIB9eOnoc8c9sUAJ7sD6YznH0BwegPOe2eOKAAjpnAAzjB6557[1G[J[2m(lldb) [22m [8G[1G[J56gcH19DjaAGM89geD049cfKT+fPt1YAXoM5z06cZHYnOcnt0x25xQAdzn5ffPOPUDjsMdfz6UANxz0xzyP6Y+XOeO3OMjb/ABAAR0PTPv8Amehxg/8A1gRigAyM8jIP+PXt/T8MCgAz19uffPrgknOcZxgdsUAGOeTkY7c/Xgcgd+3rzkigBDgdDnI/L+R6+3txzQAfj3/yemP1/DvQAY/z2+nGf8+nJoAP8/5/z6+tAB1wB1+vX+WPT/HrQAn+[1G[J[2m(lldb) [22m [8G[1G[Jc/5/w/KgA/zn/JI/QfjzQAUAFAB/n/PX+X50AFACfz/z+X+RQAew49Mcf4+vp+eaAEx7d88HnJ/xH5UALjqfXH6fiRz14x+fFACAevX8+D6DAx6E88855oAQ5JHHXggnt/PGe4/HpQADng5HbPrjtjGBx2wffPFADcDJXPfHTn8f5YBOcnJ5G0AXsSe/Gen17HJOOhBPpjHygBjAHzYGT/LOPXgc8gZz0GKAEIHUnrz3yf0wT6k7fXHSgB3fnOOD[1G[J[2m(lldb) [22m [8G[1G[JxnjH8JAB7Hnpn2wSwA4dPxP+fbjtQAv+f8//AF6AD/P+f/1/nQAf5/z/AJ/rQAnT8cYHp+QGPxJ/CgA5/wD1f/X9Ovfp0OcUAL/n/Pfj8B9f4QBMe/ckY9fQ/T9ec96AEznOTgdOMg5/rn9PxoAOpOfTkDnj68nr249RmgAI4x0Jwc9ADwB3PpwB0P4FgBmGGT0wCPTp/wB9HJznngepyCoAu7jHBwAOhHseDjJ/L6HOKAEPbkZPoemOntn35A/I[1G[J[2m(lldb) [22m [8G[1G[JqAf/0v4HcZOecZyOo9eRkZAH+8MnscgV0AMbOTxn3xz/AEBx06d+3FACcn3PTGOR26frkd+vWgBMY57Hv3x0/QcdPbnigA9vTt29+/t6jPbGKADpj25/z/8Aq596ADGB9ef/AK2eR6+n44oAMc9ceuRjAPHIweuccZ9eODQADPPAOOPxz7EZ/X0xigBx555BB7YIHoBjkdB/L1oATk4JGcdT1/DvkcdfU9s5oAXGD689MLnGfw992OmO4wKAEPGB[1G[J[2m(lldb) [22m [8G[1G[J+fH5fzz0498UAJjjnnB9uPp65zn88d6AG+v8uf0/+tQAfhz7d/1A/M9uM4oATaPx+nTBzx+J9On97OKADGMcg8854/Lr35/wzigAK8H6Z69/XkYP1wD34oAMEdMEDseO2M9sfix44yMUANAweQOOw5yPpg4577h7jgigAOfXsevHHr0PUcdMj3B3MADLnGMccev/ALMOnXHf1OCKAFxxyeB7AjH5AdPy65OcUAJzwDg89ffjoOO3B45x2JFADsZ/[1G[J[2m(lldb) [22m [8G[1G[JHkc5P4ggj8Tux0BPVQBMYGAMcEc9zxz1PHPrx0OMigAyTnkduhzj1wOTyM9OfpkigAxk8+nXv6HjOefTt0JHIUAUnsBwOM4z+mQcfgvqAcgUAIRwcDp0z09z6EfXpz6CgA29+mc5zjjvzwT/AJ6jGKADAzkexAOf04GfoCeTnjigA9QDyOcH068EAdcj+WBQAmD0B/TI5H0PByD+eAcDcAHUY7jP8Jx07Z5z35Oc+vFAB6YA5GPw6ZPcemPm9zxi[1G[J[2m(lldb) [22m [8G[1G[JgBDwegxj889f7oPtgfgMfMAGMdQMHJzwRj1GORnPHC9uM0ALzjgZzjn7p4/766jgYz/SgBuOBnA/Hk9OMc889ePQ8fNQApHGO5xjAx/3179eO34UAB4IwOcdiSR356Hp7fligBMZ/Lr1yTjgnt+nqeuGADGckDpjjsevuCOMcYJ+mTQAcH64+uT2H/6hx75oAOenTucjp6Z9P88nJCgCD8cd8UAH8v8AP1/z6ZzQAZ/z/wDrJ/n+VABj8u+B/Xv/[1G[J[2m(lldb) [22m [8G[1G[JAJHagA+v+f5f555xmgBP8/56/wAvzoAKAD/P+f8A9f5UAH6/1oAP85/zgfp+WRQAnpn/ACf6dT/IUAJz9cnHPoM8n6/Xn2yaAAdTnOfXt9B19s4C9OS3FAAcdduecen5e30/xoATHrjGfTO30xwOSe5BHHTnbQAeuCSO/wBPUfrzkYweuMqALgDPUn2HJHTkHIPTrxnrxkhgAOBnPPufc8+nQeg56cYFACcHjGBnvyPp3wc/n7Z+UAf/AJ/z1/z6[1G[J[2m(lldb) [22m [8G[1G[JdKACgA7f0P8AXGR69296AD9P6+3+cY/EhgA/z/n/APX+VAB/n/P+f50AJjHTvnPsf1z+OenQcigAIyP6dM/Xr/L88igAORjHPr/Ln/6w7dqAEPAOAD7dB/np3/LFAB3yRnPY8Hjt6HPUZJ9eMEsANC5Hcc9Mfl6H9f8AvkAtQAuOgIAwOccjjuSR+mGPcngUAIQBzz7/AC9Mj0JA69v1GRQB/9P+B8g88nggZ4554J+9wfoORjkGugBMZBxkA5+X[1G[J[2m(lldb) [22m [8G[1G[JjP5jgfkR3PX5QBgDDPTPAOeeOnTBIwRzzg4xggGgAZT279e3J7ehycYxjHdRlaAEC9RnkH2/X73Udgf++v4QBPbA5/E9OnTnnuAMn0FAABjGfy/L6DvkjPTjjnaAOPbkHHoeg6dO+R1AHHvk0AHQjt9ACeOg785Gev4nAFAC4ABHBHXOOn+PtyTzx12qAA54Oc9yfbHTp9fxzz0oADxg5x9R6/TGTntg9M+u8AQ+o5B5yOO3ryex4OMH1oAbjHb1[1G[J[2m(lldb) [22m [8G[1G[JHrg46de34+xOAKAE6ZB/z/n8f5FQBMf4/wCf8/zNACdBwM+3T/DHrwPyoAOnvk/l/wDqHpnP45UAM/8A1vf6dPT19+KAF/yf8/5/SgBMA56/3f8API/+v3IxQAv+f8frx+X40ANHbjHPuSfTnuD1Oc/plQA69+/A4HT9enXnv0XHzAARnHBHOeg49u49PX33ZIoAMA9wfy6dMDjge/5HvQAfj3PHv1wcE9OmM+/FABxnjtzx0PYDoe2ehGOR3oAM[1G[J[2m(lldb) [22m [8G[1G[JE9yP8jPTqevtx0GSWAGgYOc9SeOfbHXvz0PTPU9FAFzx1yc46nGevHr6A9utACjPTjg+u49e5x/QfhigA7e4474OT79R+HvwQtACdsk4zxjGQO/GMZ6de3qcZoAB39Mdc5/Ikn37DB9cUAHTpk4Pt1/Q5x3JHoSedwAH6D5hgdOOn5jv169CP4gAHUfeOPXHIPf25984HRudoA0dz1PP1xwe3GCTjsDyem4MAOx7knvwPzzgdDzxnnvk0AJn2UY7[1G[J[2m(lldb) [22m [8G[1G[Je/YZ3DHb+R24oAPm5PTP19Mehye+Rux3A6UAHHUnrxgDrk54746+nt1AYATkkcAY/Pjt/CT064498HcABHpzjOT269Bx79u/TGN1AAOASOm7tn3+hx0xzwfTAoACT1GOPQfqc5J59cc4ODwaAG9D7+3+ccjnuD+YUAPw/Lp9On1/+yxlQA4x7/y/xz+n40AGT07f5/P/AD60AJ/n/PTp/wDrz0oAKAD/AD/n/P8AOgA/z/n/AD/KgA/z/np/L8qA[1G[J[2m(lldb) [22m [8G[1G[JA8/5x+oyf8445NACHp3H06/yJ/TP0oAOf8/zzk8fl9KAEzjr/h/NsnH0544b+EADz6j9QRx6bgfTg/XIPygAR3z0zzn7vHXkYPGBjt68g0AGMc9Tx2/PGPxJGfyzQAdeD2I9s8Z47gjOcc/U5woAc446+uOcfjj1PXnr1OTQAgXpnPHIP16jr+vPXoKAH8//AF/T/P0b6daACgA/z/n/ACf5FQAoAKACgAoAP8n/AD/9f86AE/l/PP8An15z3oAM[1G[J[2m(lldb) [22m [8G[1G[J849s59Pr09PX8utABn1I9/1/I/nn9VAEAPUHrjr7ep5zx6BffIoAD+hHXpz7joc56d+9ADSTk5JHpz34x0DYxnkDrx1xmgD/1P4Iwu7Jyeee/wCWNwyB/wABHqp5FdACZ4zzgccjrxwenAIOOCQM57ttAGEDIxkY5yMYBI6Hkg9+eD644DADWXkduPfGAMDnd3OTwv09aAExgHJz0PcdPfsTjGTj+RYAACO+PbB545yO/wCBb9c0AAA9znvt/Tr0[1G[J[2m(lldb) [22m [8G[1G[J4xg8DI44zQA7jp/9br6e/wBPX3oAOhwOOPT+v4/55oAMdcHkdPy9wfT26++aAD/PTqPT9aADAx1zz35/p0B9T+fO0AQjPHbrj16fkfYYyedxyQoAzjqBx9cn8QCNvfB3H8M4oAT8/QZHU+mOO+fp7nigBP8AP+c9vqfzoAT/AD/n/I/kGACgA/z/AJ6/59OtAB9P8KAD/P8An/P8hQAmPyxjGP1oAX/P+ev+eeOlAB/np/n+XGMnORQAfrjn6/oP[1G[J[2m(lldb) [22m [8G[1G[J5demcCgBPfn6dMf598+3XCgCfie/p/LbyDzzj69RtAFx6fLzz/h0I/Efr0YAPbqcdz/9bH6fgaADHJ/A5z1/nj07e3QGgAz14zz7j8vX14/pQAmPTjnP16HPIyD+PHTuNoAhXnOQO4/qT27+/YH1UAXB5+bP0Hf1OMdCPfj6MKADB9ecEfX/AAx1HH1xxQAEcHJyOTj/ACCfyI985FAB6deDwMY46d254+mM45zlQBoBGRuAHPXuPocjpnp19Tjd[1G[J[2m(lldb) [22m [8G[1G[JQA4AYxnnHP4jHtz35PPtmgA68Z+vHXP4Y6exH1NACEHnJ6c/Ue/3e2R6emMk0AJg+4HYd+f5EcdsE9cEmgBR36gen19uTkkk9c8c5ytACDA5zkDJx07+oXP4/gMjO4ABk5OeeMED17Hvx7huxHGRQAmMcfU55+nTsP8Aa5HbJAJoAXHBJPGccenqevY5zjnPfigBMc+hyBwOPXPYevqR0wMA0AN4H1+nT2xx+eTj0oAXOPVfTAz9RyR0/wD14OCo[1G[J[2m(lldb) [22m [8G[1G[JAY46nHPbv+Q6+oJ6dqAE/H8P8/n3/ooAY4z+nt69u/8A9fPSgBKACgAoAKACgAoAQ8d/z6fnxjPvu9sYwwAfj26dPxzyR6dPzoATOeB6H+nPPbnPv6NwKAFHOOvrnPX/APX6YXGCOgoAMdfrz3zx+Y68denHooAc5J5xn16fQY/m2RjOWJxQAoxzgfpx16+x6UAJ2/E9D9PbIOc9D7YyM0AL6c//AF/0/lj3x1oAP8/56fz/ACoAP8/5wR/P86AC[1G[J[2m(lldb) [22m [8G[1G[JgAoAP8/56fy+uKAD/P4d6ACgA/z/AJ9OP89KADH+f8/U9vzoATGfwzj09s9/yP58UAJtwOPbP9exJ9MZ49vvUAGAM9ufpj6fn1/A9BQB/9X+CbHORnnjHOAM849Dj0/8exhegBpUEdDwc88c/wB736dsdfqGAG+4GSCQMYxjPGBxye44/DIoAZjGeh4x9PX0Bx/XjPWgBpGBt7H0wD9PQ8d+cj8lADHTI4Ht37jA49Dx39c5UAXH5fkB/Lqfr+AN[1G[J[2m(lldb) [22m [8G[1G[JAB7dP89uMHH0+o7UALjP4HP6/wBOP6UAHbn8j7/QY/U/U8mgA/Hv24/A8n09B15zkUAGPf8Az/n/AD1oADz+f8ueOnf/ACelAEZz+pJzwPTpjn1yM465BJoAQjvwAexzx/U/UhfbrQAHv6YwOOOnbkYz175645oAaf8AP+e3p1bpQAe3brnnrz7fh0Xt7tQAd+364HH4nj8efWgAx6//AFv5HPY8du4zigBD+n8/5fy9uM0AHfr/AIfy69v/AIrq[1G[J[2m(lldb) [22m [8G[1G[JoAH8vp/k9fw/pQAUAA/zn/P+H8gwAf1/z/n/AOvQAdP8/wCOPr/j0oAP8/54/r+fG0AP5+/+R/L8qAEA6/1/l9KAF79PxoAQ88f55/PGPccjjnJFACY7Z56A9M+3Tjr2A+72wKAF9cD+X68gn16dPUjFACdskkA9fb0x6f5z1oADk9Mjp17/AE6nPY5x9D1oAXnoRj6Ywf5n8OPqeRQAmPfn1xz+fX9enAxg0AJ39eo5xnHPPb3xgdM5U4FABg9C[1G[J[2m(lldb) [22m [8G[1G[Jc5xnj+RxkDIxyAO4xigAOR9CTnt19ATyee24ei54oAMZOOcd89+hHfjt6fTqGAFx0xkYPOBjP1zz+v55FABjHTPJHbpk8gDk9+3p2+7QAz1PJGMD+XHGSM88Ads45oAUHqCOfUD9R1PuDjj3wKAEI9PpxgZ/DAznPbovJAzQApPQgE4OckY6+mf57cZ5ABPzACdTzkHjrx/njvnI6jNAAewPGPx4P0H9efTjNACdsDtnOPTjJ44xkev580AIT169[1G[J[2m(lldb) [22m [8G[1G[JeMn+fvj/ADxQAZJ6k/Trn29vyb6UAGO/uOMevT8/xz7fxACf5/yf8/rQAv6/nz/I/wAvwoATHt+X6n8M5P8A9egAoAKAEwOmfy49+2P8+uWNAAPx59f5UAH/ANf/APV27e/btQAnTGPYHHtx6c/gBj2oAXGfzz6cjj8aADHPcnp9M/gPb1/M5oAXP+BzjHtj+Xr+dAAR2PXP/wBf0/z1z3oAX8/b6f8A1h/nigBP8/55/p+XO4AKAF7Yz36c/wD1[1G[J[2m(lldb) [22m [8G[1G[Jhx0/xAzQAlAB/n/P+f50AH+f8/5H8wwAf5/z/Pt+PSgAoAP5d/f/AD+H8wwAc/59f1/n+dACY54/l+vQgnP/ANcHigBMH17+2cY/3R3Hp9c0Af/W/gnJHp7eo/H2x6/U966AG/ng85Hb8sZB7ZDe+OKAA5IIwR9ehz688D3zj1PegCPA5I5wfXjn0Pyk4+nOMjbk7gBMdT/n8Mgd+Dx+eKAE/wA+n+c9enuMZNAB/X1GMen+f8TQAf59f14z+X5U[1G[J[2m(lldb) [22m [8G[1G[JAFAC9Pf9f8P1GfpigBKAD/P+f8/zoAOg7c+/6dcdfUH/AOJAG7c8dgTnOf69Qcc8duM5oAaRjuMdsDdjHUDPU+vI6HOQQVAFx245wenryTngDP4/d6LwFAGsB9eo64wOMc/Nx78denBFAB35yp/PPP8AT3J4HXgbQBAcAgDtnPTHbj8/r2+bOFAE65AHU/4/X/Pp0oAT/Pp/n8P6igBenP5Z59uaAE/z/n/I/kGACgA/z/n/ACP5hgA/A/z/AM/p[1G[J[2m(lldb) [22m [8G[1G[J6dgWADGP8/iPXsfx9sYoAKAD/P8An/P9aAD/AD/nH+e9AB/n/P6UAIR1IHPbj29f8+nagA/P047+p47g+w9s8hQAPI4/w/X0PTjP65UAO/8A9c/l0P14IzwD1NAAR6E57+/8hn6Y444oAPr25z09v89ev4qAJ39CD9cg4+g5x68Y6jJ2gBz+p9R7845I7enc9aADGc9Rznj6Y9T/APX6EDBNACnjoOeB/k89AeuPzyaAD8Px64/POO46Y475FACc[1G[J[2m(lldb) [22m [8G[1G[JjtxuB46jpngdfwLfXigAxnIyD/npjPXj/Z9RjooAduhHPAz1/D39Oo7dKAEPHRc4HXOQOxB6f555xigA69u3rkAfTtkccHoe1AB6Ag+mPTGOpB+bjBGB7cZzQA3GOoz2yDnGBzxzjtgZPTqP4QAB/DGe+QAfxGeTnt6DOMUAIfU8jGB29umM4GCffue1ABj2zkkDkDHTvjBz06Dp2zQAmeAO3U89f8Pz/LFACUAL9c5/z3oAQ/rQAf5/z/n+QoAP[1G[J[2m(lldb) [22m [8G[1G[J8+n8v6dPxoAKACgAH6dsf5+vSgAH+fX+v+fTpQAgOex/l/jg/Ue4zkigBOvXI/EkfQgjA+nzH17CgB38v85oAXP+P0Pt/njtQAn+fx/w+uOnvlgBfT19f8+hoAPy/wAen65PY9u3NACUAH9P8/5//VQAUAH4f59eT/LP06BQA/z/AJ/z/M0AH+f8/wCR+hDABQAUAIR6/hjP649P896AF/z/AI+nb/J6UAIewxn07D/P0B/DrQB//9f+Cgg49Pb0[1G[J[2m(lldb) [22m [8G[1G[J6d+efYjjHfIroAT1wTz6Y9fy9zweexzQA0jjHHYDOMfjn069e3OcigBn3eDxnjsT356E4PHGc+7YBoATn0PHOenB/X9cA8c5oAQj35754+nUD9c/rmgA9f58/n9OnZfp1oAMZ6D/ACPTJJP0z+WRQAo5xx9Mj0JJx6/Qhv1oATHTv+R/zk/54FAC4Oeo/Xrn88/T69TQAmOvPoTn354+nuec9sgKABHr3Hcfh7/0445oATr7dOPzx1/+t79wwAh+[1G[J[2m(lldb) [22m [8G[1G[JhBJ7c4yeQT7ZJ6H3xnDACc98Ad+3rgfxY6jtgdBuz8oAwg46k59OeB0GOpwe/SgAI6EE4xjnp9CR69PT3OCFAEweo/lkfh688dcn3oAMFcd+M/5IPbrwR+FACHnk/l0z3z2OCPf8sigA/wA/4Y6n9effFACHn2+n/wBfP+c9M5oAP8/5/wA89+1AB/n/AD/n+VABQAUAGMf1/wA9PxH+FABz/wDr4z/L+X5ZoAP8/wCev+fTpQAf56Y//X9eP0yw[1G[J[2m(lldb) [22m [8G[1G[JAg/H9OPb72fccN160AHH+f8APBJ79/woAQeoOT0J+n5jt+Oe2QaAF5yOeP1+nfPvwO3NAB+OCe/9e/8AnjjrQAgz3x2H19zxx2I6d8A5O0AXGevY/wCT+WM89RxjBoAOD/n/ABz69COOnNADfTPQHnnOc8jB46degGOBuxQAoP8ALp1xj0IPJ/Ak57YNAARn02+/BHtnnH0/DjOaADkEDgAnPA7emPx654Azhv4QAGfbPOMnqPU464OeOMfqwAmS[1G[J[2m(lldb) [22m [8G[1G[JecDqOpI/I4645zjIA5ByKAE467ehJ7cDp2PPPfa2PwoAP9rgDrnk+v0yeQMY7cdcKAGeOPpk9Pw6Zxjnjpk8UAIB75A54bp7+w//AF96AEx0/EEAcjH888c0AKScDofbt65z0z6/n3oAb+XXp2H4fl0JH1z8oAevPT8PyHOPwPHvkUABOevP+f8APr/IqAIf8/8A1uuc46/ljrQAf5/z+tABQAUAFAB/n/PT/Pr0oAPX+X+cfqfyydoAnYccd/Qf[1G[J[2m(lldb) [22m [8G[1G[J0/zx3ZQBcfpxQAgH+1nn/IPB6cdAPXHJWgBRz/8Aq5x1578c/T8aAF64/L8Pbk9+3HXjuKADtnHsfT2xgjP459SOaAD3GTjqeRj0HT9fy3AgqAB/X/Prn+fp1zQAn+f8/wCf50AL39v6f4/5FACf5/z/APr/ACoAKACgA/z/AJ6/59OtABQAUAFACY9ev+fp79vyoAOuPz9f6H+n14oA/9D+Cogkc88Z4zz0GSCfTvj88jb0ANx0H4Z5P/68fh+O[1G[J[2m(lldb) [22m [8G[1G[Jc0ABB6EjOOc9MDnvt7f985IIOMsAMK4zzj5Qc/iMAccZ74wOOQAQKAGgZI4wOTn69jx29MEHqMjNACHp3GTnJOfpzhRz9OPb+IACOOMcHH+1npnqevbuMd8AsAA57HHuenqec56dsZ79cUAIB9eB1yTjPpjp1z1x9cigAxweemDj69O/Xn3+goAU89vw3e3J+vvznp15UAOvOdpH4jHr0x6jGcdsnqwADn+E56Y+nbJ9BjtkY6rn5gBCMDuexJGP[1G[J[2m(lldb) [22m [8G[1G[JwHLdOnHXnrjCgDTjg8k/49B6c+mTj14+UAQ9Tx3/AFxj0OP/AK3fOGAE9CMDuQf17HnHc4PvQAhycjnr1GM9sE9M5Iz049gKAE9sDB6HgA+/XjAPufTPBUAToMHgnnOCTz6cgDjr19OeQoA3Hvn0/Dr+Yye36EMAH9emP5d/1P55oAP8/wCf8B0oAT6j+n4/5x79cMAH+f8AP+f6UAFAB2J+n+ew6epHHTOKAD0/zz29enX/AA60AB7c/wD1/b8/[1G[J[2m(lldb) [22m [8G[1G[J88mgAoAP8/5/Pvj+RYAP8/57fn/U0AJnpx+Pv/hz+GOaAD6fj+P5fn9cZ5FAB/j/AJzz6c/0yQKADnI9Of8AJ5xz1Hf/AHejAAOAeD3/AMfXt05wPQnO6gA/Xntxj9e3fr9Bk0AH+f8APXr06DocetACc4J79uO3+7n3PUt+hWgBevtz7c/+hfoc/TnaAIfcHnoOM8dR34PGeW99oBKgCdT7Z44/A+hGCOvqec8CgA4Ge2Ow4zjODnr9T0/IUAKD[1G[J[2m(lldb) [22m [8G[1G[J78n5iOufxwOnHb88GgBO+MZPPOMc9Rj9efbPrQAZ6HsOO49sjqP0H15FADTjjkjtk9MD09c+mceyj7wAn6gd8YJHpxn8z9ePu0ALkk8fh6jqcduvfIxg8bc7aAEIxnIPH9c857fj6YoAOOg5zx9P5fnjn2oAT9fT2zyf8OvPXnFACfp/npwD/Qe/WgBfr2/zx2/X6ZzQAlAB+tAB+n+evf8Al+eaAD/P+en8vyoAP8/5/wD1flQAf5/z+n1/CgA/[1G[J[2m(lldb) [22m [8G[1G[JH/P5fj/XtQAnPP8Anp2/x6Y9RnNADl56ZHTnOOP1PX6Y6EHINACf5/z/AJ/rQAUALjOTjB68+n1xj+XXgH+EAXA459ffp06AkZ56/UZzhgBP6dv/ANX+IPPfkqAJ/n/P+f5UAH+f8/5P8ioAUAFABQAUAH+f8/Uf54oAKACgBP8AP+P/ANbnHfnigBfx/wA/5BoA/9H+Cwjp7cY5IxgcfdPXnk/XnGK6AE7kck89c8Y/MEexxjOP4iaAG498fXOD[1G[J[2m(lldb) [22m [8G[1G[Jk49sAjJ49f4uRQAxhnpwOoHOOD68Z4HHynH4lKAE4/ukA8c5xx0wO575I6ZIAydoA0bcjJwPxOPRv4iewGVx7nGFAD1+Y/iMg+vy8dOO/txgmgBuB1x+H4HnscdD79iOQoA4DA7kcH0Hr9Dk475PouPmAFznqAcc8c/jtPHfoW+mCCFAE5575OOO+MdD2B5zk8cgBf4gBMdWx0J49fXByP5H8c4UAXOO/H47jznngY4bHXGeQe6gAeuT2znBJ+mM[1G[J[2m(lldb) [22m [8G[1G[J9PYZ4JyM4oAZjoPxKg8HuCG4x2Jyn58UANHT1/H/ADn2/PtQAhyDnnB4478/j/u54Ix34oATpgYz357nvgdScenTqSMYYAax5HfqOcfmeT37EDGOc0AJ1xnA6c+vH9OnpnPvQAmPy6+vGcevX147d8/KAH09O+Bz/n1/rQAlAB+P/wBb9P8A4r+QoAKAD/P+fpz0H50AH+fzoAO/f/Pp/wDW/pQAmcf/AFsn/OCD/k0AHOT0x+vPt9eO36ZYAPx/[1G[J[2m(lldb) [22m [8G[1G[JE/8A1tvT8P1zQAA9u/PQds9e+M/X6ZoAM/8A1+eenAx7/Vemc8GgAx17HPHf+nGRx/F69yKAE7ZHI5/HP8uaAF/Dn+fsD3/D8aAEzgAdT3A65/Dpj9fwoACSDzj2x19MfXngj0NAC+/Tv74/n169cdT2CgCc5AyAPryeOvOenuPzoAQkjoPyzjB4HbnPUZ+g25ywAYIOc9cA+306A+3A5OOSaADg85yO/Xn8OMH8OeSMc0AB9zgenPPb39/u/jjg[1G[J[2m(lldb) [22m [8G[1G[J0AGewGMdPoe57gdD7+pwVoATOOpzx0Hf0I44zjnB6+vG0AM8NznPXgjBPHYH+Xbtk0AJng9Ovb5SB1xwTkHnufwz8oAh5OTx06c9ehP4fT1wM4oADj0x7c5/H6fpn+LBCgBnP1PfoR0wfT9M/TJoAT9fr/Lg59Mcj8OaAF9cHg+2OnTHX0//AFZxQA3/AD/nr/P86AD/AD/n/I/kGACgA/z/AJ9KAD/PX/P/ANfp2oAT0/znj/P+SKAFoATn/Dkj[1G[J[2m(lldb) [22m [8G[1G[JP5Zxz6jp60AA68cdvT+fQenTv6YYAXHoMAdOvHbn7xxn6+o64oAP8/l2/n2z6YzQAvTvnk8Ht/L3z27HPSgBR3GOfy6c4wCPp+QGMZUATj6cH3z7d+/0+pwBQAn+f8//AK/zxQAUAH+f89P5/lmgAoAP8/56fz/KgA/z/n/9X50AFABQAf5/z/n+VAB/n/PT/Pr1oAPr+P8A+v6UAHX/AD/jz/L+QYATn1z/AJ/D+X5UAf/S/gs6Z6ZHPXsPXpgn[1G[J[2m(lldb) [22m [8G[1G[JOM7Rxx0GW6AA9R/CMe/Hr/sjGO457ZoAaw7g+w4wRk9vXvxg9e3RgBrDIHOO2R39OuCQeP4kxyOMgKAJjoDnIz6nb75wc9+MDOM7jxQA3B9e/foPXGevsT0wKAEPygjPTjkd/rjtngDII69dygB3Pr0xx/30R9c9uh6E/eAEPGeRyewxg4/DgZ5/rnFABjPI5x67cnsD+XPPXjAPJUAMgA4B47/Tuevb36dhxQAcZ5OfYc9v6HPr26Y+YAMYx9e3[1G[J[2m(lldb) [22m [8G[1G[JRuh6ngZ6d+mPQqAKeecEc9euOe2M5x0we57YJoAjb05//X/L6DPXjuVAGnAzkc9jgDBwOefpnrn3H8IAHnn6859eufy9Gx6UAMxxktzyR3/EdeO/GCPwBoAQ5IzxzgEn36HrjIHtkD1z8oAmfXPHHTr9emOOxP4jHygCH9O3I/XHGen8vWgA9+g/z35579vb0oAT8P8APp1/lj6njaAH4fl2/wA/560AFAAc9vXv6f40AJ+P+Hf/AD7Y96AFHT/P[1G[J[2m(lldb) [22m [8G[1G[J/wBf+f50AHr1/wA+n+Pbv0oAT6YI7/54zgevOPXGKAAnA5B54x3PtwT1+v5UAA6dDxxz7fj/AFHPXFADTg56jv8Aw9MdeNxPv17H1FABk8YywPf3/Tp7jr/EvRQBc5H8Qx1AHJzg9sY9Tg98HHFABgY6EegGARnjtj2PJP8ASgBuPzOOeTz9eQR1J44688CgAPOOuexHc846cDH1J9MclgA4xg7snA9T9eckZPseg6ZAoAXoGwPpgc/z6Z6Djjsa[1G[J[2m(lldb) [22m [8G[1G[JADJHXPP4Yz25yM+vGPccUAAGc+3Qgfe9/wDHBUHv1FAB+Z5PbBxxnjjPP4eucAUAITn0x056jPUdunrj6E4NACAkEZ6dee3Ud8Y/DPXHoKAHH/dPoMHpj1POD09cY75NADMdc578njHfng9fr+ByKAA98g59PTgfXP8Anp0oAM/iDzjt9O/A/wDrjHSgADY7Z9Oenr2P8vyoAb/n+X19Pw7YyRQAvHvigBP5f5/z/wDroAKACgA/z/n/ADx+NABx[1G[J[2m(lldb) [22m [8G[1G[J0/zj6UAH+fX/AD/nHSgA/wA/56fz/KgA/wA9P84oATI9ev4e3+T/AI0AGc+/XGOvX+9z/n06UAL69On+fT/Oeuc0AL/P0A79vz/pQAnb/Ofp6e/8PuegoAX6HIwOn05Pr698d+MUAHbPof5+/wBenH5ZoAQ/lz/kUAFABQAUAFABQAf5/wA9f5/nQAfy/wA/5/8A1UAH+f8AP+T/ACCgBQAnH09O309c/T88cCgBaAEBz2P4/wD18f59elAH/9P+[1G[J[2m(lldb) [22m [8G[1G[JC/1P6f4dT+v55NdADDnnPt0PT09ep9Bx6DO6gAOMgdxwOhyPUgA/+ydegwaAGkAfiOQQ2BnOP7wz16j6A87QBvTpwAM4HH4ZAB3HHQE9c8ZoBfh/Xr+X3iMCPQnOc+p9OnXHBz+fINALrfTt57b7/p8xpGBkq2T6Z7fiPw5bj1oAPQdD342/h1B/T+E8DG2gBv4nqOcEhsc8Yz06cen8OAVAHY6Z6jH0z69OfXGB+GaAEIODx6Z56gYPXjkdzjn9[1G[J[2m(lldb) [22m [8G[1G[JFAAAY9OhHHA59eM/99dDxtBxQAY6eoBwOmB0znLdOMc8e/8ACAHUk5Bx8o7Z9h755zz7dcqAIeAeCSO+APTg9QR2xnjvnigBh6de+OpPHHIxnGPXj0wetADfb29SMjP45+n54yDQAw4Ax1Hb2z6Ht04yPfmgBD1HfkD0OR159/XDevpQAg/lnnAIyf59OpI9OMZYATjnn8/5d/8APcdaADHbPt/9Y5x9D/X+IAPrn2/z3oAT8P8A6/6/y2/1oAD/[1G[J[2m(lldb) [22m [8G[1G[JAJxx0/z/AI96AE9/68f5/wAntQAY7/T/AOvj6gDt+XNABxnHXOfwHuO/Xrx6HON1ABkdOh4HHOM/h/T8O1ACHnGeDz6Z98D5vbv3zkEUAGCOnPtyPf6fljr0HSgA9ec/hkD24xnA6gn8smgAByOfqOuePYdPT3/OgBDwPu4yfXjnI56npzjH4jFABt7D6bsDtgjuMY6d/wDgWM0AAPpge4HH4jIx/wDrxjOVAEPJAwCfUH068ZOP89eCwAZ5z2Xn[1G[J[2m(lldb) [22m [8G[1G[JB4Pt1yevXls9MHgqAIT6/UD0weufU89mzmgAI9RxjPXGMnochs4Pvx15ztUADxg8fp0457E5APOc89RxtAFz6Dv+OOhweM/XHTnigBo4z79MEHH4jHTr07c4oAXOTk46evcd8Y/DGD+NACZHTGPfqOfxz+ZOOozgUAB7E9PbtnsM9cY/CgAIIPpkZ/8ArcE/Tt64oAQnPPt+f/6unvjPrQAfr68f/q/PP5UAHv07/wD6v8/yoATj/wCt/n/H8sCg[1G[J[2m(lldb) [22m [8G[1G[JAoAKACgA/wA/5xQAf5/z/wDX/rQAn8/y47Zz+NAB3/z/AJ6f09BQAZ68cD1/n34GDjnPcAYFAAT/AJx/QEZ6dB+g5UAOmccDOf8AHkk8YwPXjIz1YAOe/XH4ZH045+vPtg0ALnv3z/noe/X2x/D8wYAX8/b8f8njt+NACe3+f6jn/wDVjrQAp49/89O2fw9eM9aAE/z/AJ/z/OgAoAP8/wCf8/0oAP8AP+en+RzngUAB/wD1f/X9f8+goAKACgAo[1G[J[2m(lldb) [22m [8G[1G[JAP8AP+f/ANX5UAGcUAH+f84oAT35/UdfUfj3/rQAnfPUH0/w7kYx15z0Xb8wAE+2eRjP0PTGc4/xwR1oA//U/gv+vf179efc/j27YNdADcfhgAnp+GM+mOuAPXPRQBGPQjk9PXbnuMdfxK88D+8oAnHOfxGCuT1Hcnr/AI84ywAh+9jByD1B6jtz82D3zj2OTyoAjY54weOPcEnA7Z6HjsMEjowA09wPrgcc5544GRkg88cA4wKAE5OOo/8ArduM[1G[J[2m(lldb) [22m [8G[1G[J8kHsT68UAJ7DgDOR1z+Hv17Z/VgAxnnvnj29xnOcj2498UAHTk5PTGe3H4c+vXjGf4jQA3JxkE8EDB7856k9s4+8cgZJGcUAKT16nB64HTqR2yD3IH5UAGDxyOp9ufQYyPpkZ5PUg0ANHv7c9u/LZIzgn8+4zQAhHIHP4c5HtkA49Pp1OAKAGntjj1z1B9P4v5d+/wDCANxx0HPHHAOenOAfYYz6nOcqANI/vcEeg5x7cHj6456mgBnPXnI569j/[1G[J[2m(lldb) [22m [8G[1G[JAPr/AFz2oAPQ5/P1/XPTP49uBQAhP5D/AD2/z+VABx+P+fzoAP8AOf6fy78+2KAD/P8Anr/n0xigBM9s89+/6cY7c9uvPSgBCevoPpnp1GT1A7cewOaADnI9D29OM/jyPb17YYAM4Byc46n8enGOR3wPfigBGHTvg98n8OAP159znFAB6c8k8jnHP+1yQfw49+KADPp7Z5OB7dMD06Dv0NACZxnjB479u2eQePcjt1H3gAz2ONvAJz36n8zntz13[1G[J[2m(lldb) [22m [8G[1G[Jc7aAEJIJzgkY5PB7fUnH09z0AYAMj6dTwf8ADocdOcZ4Oc0AKSCeOucfh069xjJzxjpzjNADc8dB/nnjJYfrz3zxtAFwSBj298ds9sZ6nn8Rj5QA654zwOpA6fqPUgE9OpBoATIGeBnsfX179/oMf3hgUAJ39cdP6en8/wAqAHD1BHuD3x27dRjqfpjmgBAevb73A6HI9j2PTORjuMfMAJzjpx06fzPHQ/5PSgA/UD/Ptjp68+2KADg5OP8ADH+e[1G[J[2m(lldb) [22m [8G[1G[JOqnn1oASgA/z/n/9X50AH4f5/p+bfWgAoAKAA/17/wCetAB/n/P/AOr86AE/X/PsB+g9M54oAPw6c/X2/wA/XsKAD29O/v8A59vzzQAD+v0/lnP5n8OigBnPTpyPcH8f89u1ABxxnB46n279/fvx75NAB+HGD6EHPf6n3HvzQAo6D+XoOwz347jigA/TPHp/nqP8mgA55H+fY+/6fqCwAf5+n8/1P50AH+f8/wD6vz4oAXjnn6e/+FACf5/z/n+Z[1G[J[2m(lldb) [22m [8G[1G[JoAP8/wCf8n+ZUAKAD/P+f8/1oAKAA0AH+f8APT/Pr0oAP89vy7/y/EUAJn8B+X68j8c47c5oAOmfTA//AFD8vc/oFAD9e3oOT6ZH9T7c0AJxjjgYPGPUdvfr0PPvkUAG72GAMjn+XB6Y9+nbGaAP/9X+DHB5GfT/ACevHQAnj6da6A6Lv1X9fPq/lvJvvz9P84H6/lQA3+I+vX0/wB+uPYkkCgBBnPXIxx0PTjnABPXruPTpkkUANAB579cE55B/[1G[J[2m(lldb) [22m [8G[1G[JFjnrjOOO/FAAcgHufQeh5zjnp6YHqV4AoAbnopOO59T3Ax9TnPH4/wAIAgGBjv1GfftgZGc+hxj0+7QA0Y/HqfQ+/H17nHpjbQAEDp6jPpz3zyc9u30x0oAM+xxjBHJz09QMDjr356Z20AHoc4yOSOOnfnr17jgdM5NACd+nIPT1/LpzzyBkdM4zQAhOeM/xcYHTHAzx05x07fxZ+UAMgcY7/nk/gSDgHI3Z6ccBgBCMnjGRk8dfx77v5/gaAGnP[1G[J[2m(lldb) [22m [8G[1G[JfIxxkg8j8zjv/d79cAUAN68dfoeozjrg59wMZ9aAG9SQADxyegJ7dDxk+p9eRigCPn05H07eo/qTz7YoAD+Xt/PnnIz7jrwOtACf5/z/AJ/lQAfhn/PuR/P86AE698dx2OO3XPoe31zQAfiOOvH5cdv8mgAJx6kfl+PfHuMenXNACdSQf1465yB7AD1OcE8YywAhznrzn8lx3HT8/wAKAEOMDJwc59z26j165xxnv1YATPJycgj+nHHBx179fTBo[1G[J[2m(lldb) [22m [8G[1G[JAARj6YBB5BHX0GMn1J/DIoAPQ44688gdeOuOv45/u8BgA9MdPQng8e57E/7I/LNACe/HXpnIPr0GB9MnHqaAFPU5wTnGOfxPHPoep7jAP3QBuc9sdTxk+vvjHrwPXjG2gAHHPbn0z0/H/D6ZzQADHqO/4fXKjOfT/wBByKADIH8j1/Mcr164I/AZIYAM5wM9OnHT8f8AP6UALwM87v8AHPfOP8nHOc0AJ9eO/wBf598+nHrxQAf5/wA9T69/rmgA[1G[J[2m(lldb) [22m [8G[1G[J/wA88/4dvf8ALFAB/n/9R/Hv+Y6MAJQAUAH+fp/L9C3vigAoAKACgA/z/n/I/kWAE/p+OR6eufw/OgBf8/8A6/T9f5lQBOR0GePX9PX8x+fNAB09/T/DPr9f8aAD8Prx39evt23dj0GaAD3P0x9eB/nDZ/vL0YAP1P0/QdAOh7/UjjaAHXnHtg++OCAeeMHGR+BJoABkHrxjjjP+H5knuccGgBefbt+H9D6fnQAfj9PoP8++PyCgB/n/AD/+v88m[1G[J[2m(lldb) [22m [8G[1G[JgAoAX/Of859+3PvmgBKACgAoAKACgAoAKAD/AD/ngf1+tABQAnscc9+mf/1DH+RQADHqevXr+HPPPTp+WBQAmeM59wcf0z3Hr9ccEUAHXDZ6YPGemOeM/wCRwR3oAMA4yOcevPHvzn/PTOKAP//W/gxPPVuR+YBHbpg8+/B7ZFdADSOT154H9D07j2/DkCgAI9j1Ptz3/E9P59aAG8/qR2PHfgdSSCeh+n90ATjHIwCc8gY9sDIP+PJJGTQAxsct[1G[J[2m(lldb) [22m [8G[1G[Jjgjk985zgH5SSegOOOnH8QAAA4OeRgZHJA5wO2cEcgDtu4zigBM9OfU4x3H/AALofwwTxjNADO5BPv06Z9M5P0BPHbOc0AGATu9unX3xwfoeM+uRj5gAP4nOB+Hrnac8Ejgj+tACEdQD3PBHJ9e3OOxHT14JoAOuM4z6YPf6/wD1ueecYoACPfGMdBjAzyevHbHXOMgDIoARsdue5zn8B6cjjPcCgBOpPPQcE8d+OcAEnk4647nGKAGke/19fqeA[1G[J[2m(lldb) [22m [8G[1G[Jfw5x60AIfcdP8/h746jjvQA3155zj8+gHQDtnA5xyB/CARnt29z3B6ce3fGfXnlaAE68d+v+e3bseenGBQAH8j6Y6f4/p/VgBPbqP89eQefofw5oATp6k/4fjgZ9yPwxQA0nI6EcjrnHXv1+n+HWgBcj64Gcjocdf73t16eh60AN4wee+QePy7AkD3xz2oAB3z3A4GQfoB3xjryPXrhQBCT9B0weuPTGWx9cDgZ77aAAn2IPfPXHXAJJxj6D154o[1G[J[2m(lldb) [22m [8G[1G[JAQE889B64/mOT9MfXgFgA6nvjoO/X16d/wD9Z60AHTjqPfoe55yMY46deORxQAmevb29h0AP5nt6nqAwAp/MHnkYBJ69CvTj8+3RgBASOn+f69/pnn0oAB9M88ev+frkH9VAD6en/wCv/P8AhQAZx+Iwe/8A+rigBKAFx05569uP/r/r+RoAT/P+f8/yoAP8/wCcgfy/OgAoAP8AP+fT8aACgA/z/n/9X5UAFABQAf5/z+NABQAmQP8APrk+35/X[1G[J[2m(lldb) [22m [8G[1G[JOeTQAmefbnPoMe/PX9PbpQAvPBHPHHYc+vf8s+h9VAG4yME5+g4/A4PT29xg8UALj257Z5HtyQM/pjpz1oAAT1/DgH0x6HIznuMA5OeaADPfoc4weM/n7+n4daAAnkZHTk9cD0J/L1GOevBUAXr/AIjufbr/AFHY5waAF9uvf8s8/h/nrQAfh/L/ABx7/wBO1ABjH+f5+/Hf+tABQAf5z/n/ADz7UAH+f8//AFj+fFAB/n8/1/z70AFABQAf5/z9[1G[J[2m(lldb) [22m [8G[1G[JeO/5UAH+f8/r9fwoAKAD/P8Anp/P8s0AH6f56d/89CMZoAb+BJHfHc9ux/RRge5oAU/X/wCt+n+OOxFACceuDnHPOcnvweDj2z68UAL3/H09P65z39+MmgBhPb5sgg4yOvse2evQ47YzhgA78A9ee/PrnIPJ7nGR2GCKAP/X/gyGCOuOpwOuQcDkgZ5z0OPQ/eK7p3Sf5/0v677h/X9bfl9wjHk4AJ7cnJB464bqO3tzjKimAhH+fp+X15HuMcig[1G[J[2m(lldb) [22m [8G[1G[JBuPf17A8f3fzz259VI+YAZgZLZ7DAA5HbjBYHIwuB6Zyc5VJNN6t3f3eS/r8h9tLfr+L/T7rIcPw44Ppg857YPrxz7ZIViEGDyPlGMjjrxwemcjn+7nOe5FADSO/XpgA/mecrzwu0YA/WgCM9uM+/H5DpyOvQ/XNAB6+uQPTHbBHGDnn6HjPAoDv/Vvz/L7wx+XHGemPTgf/AF/bACgLZLr3+70/rvuIRyDnv6fgMe+fZueSKAEyOBwOvI5GD7du[1G[J[2m(lldb) [22m [8G[1G[JT3GM+tABwB7nOCOvfJOCB17ZOPXq1ACEjODyOMnP+Hb+p/4EoAmdvAOePTpgnqMcn/vn6H+EATPfHXPXjj6grn/x38c4UATpgenpkY/PIH4bvxAAUAYewzz23c/0wCD0wD3POTQBH25/Ejk+nqAMjuc9eBgUAHTPqOOn5EdcdOue/cmgBvr19D/U+uR1xn24waAE+h4+oOf0Jx1B57DGOKAEbp3Prj/J+nP4460ABOMDJ5zg/wCPpn1wT6EZoAQ4[1G[J[2m(lldb) [22m [8G[1G[JySP59u5B/TnjP0oAbnr1G488YOMZHbGT35754/iAAcnuMjA9c+xyc+nGPTHBoACeSSO+OPUYxnnH4AjpyTgNQAbvYYOM4z2x68dOO3vnIagBpx2/XH+RQAZ7ZyDz759/x5xk/U4NAAB9f89M56D3/wAaAE/z/np/nrnkUAFAC9Onpz/nA/rz0PSgA/PP9f8APegA9evPXnqc/r+nr6BgBP8AP+f8/wAqACgA/wA/56fXv/SgA/z/AJ/z/IUAH+f/[1G[J[2m(lldb) [22m [8G[1G[JAK/r+ePoMAUAH+f89P5flQAUAH8/8/4/5zQAev8An/6/5f40AH8/8/8A16AD6f48/wCf88UAID7Y6enHr3Ax0PQn06GgBf59/wDPagBox0GAc8j1+gzx69/QgZoACee3Hvz07DjHB65/EYO0AXr69c/xDH9e2OPXJ4NABng/n6fnnGOfU+/FABwec8Y9+/tz/LPbmgBPfHHIx9OOQSvp9BnHPBoAME9+Oo78/rwOf7pGeM4BUAXg+/Y9+f5/mfy5[1G[J[2m(lldb) [22m [8G[1G[JoAWgAoAP8/5/z/KgAoAP8/56/wAvzoAPwz/n8P5/lQAf5/z2oAKAAfj+PH6ds/56UAH+f8//AKvyoAKACgA/z/n/AD/KgA9/8/0/+t79KAEP0z+X+I/kf0oATt1984/H1xwB6nHfNABzkZx39gOnuTkAZ5AyDnnBoAPcEf0B/I9vcY96AE5wOBwc+gHHfv19vy5oAO5OO3qMZBHfoe38QPGCBkGgBPbIweuTgZBPGAD0z7e3Y0Af/9D+DXAzwTwc[1G[J[2m(lldb) [22m [8G[1G[J9uM9gSD09B6c5zhui6D+v6/r8iM5yScjg9cn2x+vXgd/ZgBPwxjtnnk9zj3/ALoA6kHBNABg4Jxn8SPxBB46dg3qRxhgBhxweSfTPrz68Edhn6EYWgBT6dvzP68cj1/HrQAnOfXI4PbqcDt27kH2NADMYDD0xk9/rxuHHcfmT1UATg5Bz1wWI6k+oPHueR6c9VAGYJ75HcfT0I/X2+lAC4xkHI/H/wDaPtweB65BUATuf97v2Pt7Y6dcfooAnTGf[1G[J[2m(lldb) [22m [8G[1G[Jp9OOpOMA8Z/UHgigBDgj14PQk44zzz6jvnOM4GaAGnoMduD/AEPXgcY5HT0x8wApz6cYHU9Pc54J9uM9+gLADDj1P5enA+nb19fZQA+v5f59c/4UAIefqP8APPrznr/QUAMx1wAOhPPY57Y46dDkdsD+IAYACMc5zwcZx04PT/PcZIUAGP58/Un0POM456gduMUAMOfp25/Dkdeew6emDnNAC9/b+v8An/PBoAbzjnnHUDqT7+gIPtnuBjFACHAP[1G[J[2m(lldb) [22m [8G[1G[JtjgZAwcn6H8ecZ7UANJzjGCBxzx2646D9c456gKAB46gZx1Oec+20c+579ck0ANz79evsfXuPbA647ZzQAfnkDkcf59z3FAB0/l+H/1/Y/lQAn+f88H+X5UALjp6fln9PfGSD+IAoASgAoAP/wBf+c0ABPf8aAD/AD/n/P8AOgAoAKAD/P8An/PH40AFABQAUAFAB/n1/wA/59KADv8A5z/9f+n40AIT2HX3BPt7Hr39DnnGKAD/AD6fj+v+PWgA[1G[J[2m(lldb) [22m [8G[1G[JznIGRjvgnp/M/wA/wNACHr1P07Yz3/qQeBz2wwAvf24/D+pycZ6/rhQA/DHHY/ljI5788AdwcjaAGfx59e3qOuMe/f060ABz9Me4wf8AgXP8lNACHoe31Ax27dMEnkgflhaAAHOPfOBnuOuTk/gM478ZFADvT/OfrwTn8R75oAOn+e3f+VABQAUAFABQAUAFABQAf5/z0/n+VABQAf5/z/n+VAB/ke/+f89DQAf5/wA/5/kaAD8fp/j+H9aAE9x+[1G[J[2m(lldb) [22m [8G[1G[JWOTj3/z+tACZODxj0569fywKAD6evqQM446Z7Ht1xjjrQAnTlvbA5/MnjJ464zjselAC4I5HOff05wOx9PwzznKgCHnB68849D0yOD+f65IoATqRjOAOMDGe3oQPqOB15IwwArdRgkdgAM9OvHp+I/HOVAP/0f4Njhcsq46dOfU554B6jI/HrWztC7tu9bd/uf8AXe1pPV6dv68/+At7JXEOMhRnJzyMHJ9gcHJwQeBkclhwtO6uo63evl+Xl3+6[1G[J[2m(lldb) [22m [8G[1G[J3vFtL/1/Xz9L2Ywjtkg5OSBnOe4xn2GMdeOaYhmCM9R75Ocnnpjp+PHp3oAQkc+344/z/nrQAZGSAPrjnGR2yfQdAW9Md2AGnrnsOMYz9fx56HH6ZYACM/mM4zj+Y7YyeR3PcUABHGR1BPoee+Ov9D65zQBHjA79fTp7Z459cgn3oAQ/TH9fw59xx+nBoAPX/Of/AK3+e1ACfXjjGOo9vT+XPTjFADSeRkdRz3/4DjOBnA6c57dRQAZB6ZPpjPJP[1G[J[2m(lldb) [22m [8G[1G[JPICjpn1OPXJoAYfXGBxgfUeuRwMe/wDSgAPH9eO/XnoAM8Dsffk0AJnj/P8Anr09fyoAQ/gD9PT/ADnv+uVAGnqOh9OT/wDXBxnv+GM5oAafrz17g89M9CMYyCS3PoKAGk9M89c5Pr6YOcAemOeMnPygDTwPrg/5/r9PegBOnXnJxjgZ9z6jjB4X26CgBP5jBHPv0yRzz0JA9BigBPXnGPlHQE/mBjHt+nAUATjk9fQAA9egPcn8++SeDQA3nHTP[1G[J[2m(lldb) [22m [8G[1G[JTA9ev/1/fnPYUAB9eCSeg59PQL9OffgfeYAMknqRnnn1/DGe4yB+VACdxj8jz/ntQAlAB/X9P8/j/MKAH+eP/rcfl/WgA/z/AJ/z/MUAFAB/L/P+f/10AB56/rzQAf5/z/kfoSwAUAH+f889v/1buQoAfnj09f5nj8PqeRQAf5/z0/n+VAB/+ugBPTnHt6/56+/4UAL/AJ/zwD+ef60AH+f8/wCR/MMAJ3HOP6/j+PTHPtg0AHPH+Sf8OmfyFAB2[1G[J[2m(lldb) [22m [8G[1G[JPPf6fzU/QYHbgnPzAAPc5PXnggfTn+f54oATjnpjjt+HIOAM4GPzGcYoAD1HHfA6Y/DnP4fKfZsfKAHTOMZ/+t1PoMj6d+poAQnPTBx36YOB069c9z19cUALjBJ5P/1+g69v8ckYwoAo/wAgdv5evp27UAL/AJ/z/wDWH50AH+f8/l6/nQAD659//wBWP8+uM0AJjp7Y/wD19vyx+VAC0AH+f8/5/nQAUAH8v8/5/wD1UAFABQAf5/z/AJ/maAD6[1G[J[2m(lldb) [22m [8G[1G[Jn+n+Tz6/lmgA/wA/5+n0/OgBPf8AA/0HbnJ7n8qAE7+uOOAR+Q5z29AOvoKAAn8R3HX8f55z9B0oAaSeOw6A/j3GR17jj6DGKADefTjI9sdxzjnPXoMfiQwAA/l2wBz9eT7jpjPPy5oAM89fbBHPzdf4T3ORn6YAOaAEPPOM4zk8HP8ALI/DA6+ygDhnHPI7e/Hb1z04HqcrgbgBM4IwTnoCD6nnPXsfT0JzxQB//9L+DkYPPG3HVeCCe3GOhHB7[1G[J[2m(lldb) [22m [8G[1G[JdDnOa6AGkZBwO4PUf4ZAz7/nkbQBhXg4HXgewzyc8AfiVxngtmgBhBHUj8+4+m4ZxgEA8bucY+UAQ8kn+eM//X4x06UANzyMYx9Mn15z0znGDn2x1UADxz1Gec8Yz/n3/DO6gBOg7AnHcfTrg59OnsMZFADSO2ee/wBMZx1yR9R+XO4Aad3PPX+EgjIJ9fm/Djr680AJjGeefcex/rgc/X1oAb07nrjnk56H8Cen9MBVADByPb1OPz4Oc4xzjrwe[1G[J[2m(lldb) [22m [8G[1G[JKAE9+evTr69eWxgn9O/AUAaQAcn1z14PsRyT3ycDrz1zQAn3u3A754AHrxn8O3bd1UAToOmc9x/nPUZ5C9MAfeoAT/OP85Pp1P54JoASgBO3JA9T/wDr6UAMORnJBHJIx16Y5yMHg44PTPegBCD16c4Bz1A4544PHt7E5FADeOnuT/8AW+97dv8Ax7OKAE9PTjP4fTbyT7Y9cZ+YATHHBI6jHU/gf15z6DoQoA3HBJz0zxk49Rng/XntnjFAABnv[1G[J[2m(lldb) [22m [8G[1G[J17Hv2+916YzwpHfqBQAzqeeMfQZP4556Z44685FAAfwznnjGP6evTPrxnFACdBj0J/P6/lmgA9uPXP8An656A/XkKAB7859/X/P/AOugBP8AP1/n/T8aAF/z9f8A9XHb35oAT/P+f8/yoAP8/wCf880AH+f8/wCf50AJ/knpQAv9fp/9f0z649M4oAKACgA/z+X+fx/CgBPUfr9fxyPyH8twAv8An/P+fpQAdcdMY/z6f59RxQAn4+nftn8fp/LG[1G[J[2m(lldb) [22m [8G[1G[JSaAFH4/j/nP6fnk0ANHt3PPqOOhOc57jr6ZGfmAHf5/znGPxP5UAJ+XsegJ/M/y59TQAh75JGMd+oz7HAJwefl49MEKAGfyHr6c/zA6/j3oAXr6HHXP9Bg+ueo6Y9KADDevPUYA6+nIOf/HevU5G0ABxj3/IfhwRn23fh1oAAMdPXPp/n9fwyBQAtABQAf5/z1/l+dAB/L/P+fagA/z/AJ6fz/KgA/z/AJ/z/KgA/wA/56f59elAB/n/AD/n+VAB[1G[J[2m(lldb) [22m [8G[1G[JQAme2Mnrgfz5I/n784oAX/P+f8/0oAOn+f8AHH8/yoAT07f56d+n4fU8igAzntk/Xjn1+929vpu/hADufXjvx+Xbp07+p5CgCZ+vIOeenXj68ds47+qgCY7Y6Hr6g5z279MADr2oAMDqfl+bgdj+gA+vJHryKAG4Bx9cEHI/LIyMgZ5z7EEYYACM9sc4JHt1zx78kDqOBzigAOB0wR06cn8fX/d9s9aAAYz7dTgdB3z3x0yMsPQ5oAUngADpx+IH[1G[J[2m(lldb) [22m [8G[1G[JPYA9eme/fmgBCeM8ccepJxjP6ZH3R2+bkqAf/9P+DwgYwO+TnkjnrzyM8kjjH5kNukkrLZAMZc5G4nnjo3TH0B554CjHZsGmAw9ssQCD09uuD164OOn50ARkZJ5ySOhP8j9QfTg9B0oAaR2PHHBwPy9yD649+ThgBBke349fwOD17dhzzgCgA7d/y9fXg5wMcY47lskUAhMdefpxjH8/r0+uc0AuvW+3lttov1/UMY7Z5JH5dTjHX2HpwMfKANx7[1G[J[2m(lldb) [22m [8G[1G[J89Rknjr2I6Y4zyfUDA3ADcBuntz0+pIOcnPoe/UYzQA3ofxBB/z1698dPoWAE/DH+e3r6c+lACdcZ6/1/wA/T+YYAbwcN68gDrke5X2z/CBxkHksANIJ7+3XP16kDnHCj8xQAh7cce/8+Mcdu/tigBvPqf8AP5/59MZoAP8AP+fy/H8KAGkZH8uOfyOQMn8PpjNACHqcZzgdvx68jtjrj60ANORnn8O35EDjPTGfQnkUAIcdRnOc9vyB5JI+vvzm[1G[J[2m(lldb) [22m [8G[1G[JgBPXnnof16Y4Oe//AOugBpHzDoDnH1/kPx6Ac89KAGnuR1yAceo9eCMD2HOccUABX3xj8cfj1xjp1PfB6qANPJHOM8YHAxzgfgeOcfjyaAFxnP8A+vI9c5bnj0Gf/HaAE4z976557dM8H26c98YAoAaRz/T/AABwf84560AJ/n/Hn8qAD/P+f8/yoAUfz/8A1/5zkfllQBP1/wA/Qf1+tABQAf5/yaACgA/z/nr/AJ9OlABQAUAJ/j/9b2+n4cZ6[1G[J[2m(lldb) [22m [8G[1G[JUAHPPf2oAX/P+OfT9c/gSoAf5xx/XH8x+PFACHH+P/1/wBHX254oAP5fl9P1Hr7c0AH5ZPA4/H8c+nGM98AUAHr/AJ/EZ75P8j6UAJkDsB24OM49QQvpgc8Z6jPzAAOg/wA9v55znr79MqABA74A579c9wMcHr6+nPWgAxz+HX346/KOR24I4JA60AOH6/l/+qgAoAP8/wCen8vyoAMdfT68/wCP5f0oAP6/55/+vn+igBQAUAH+f8/j/h2oAP8A[1G[J[2m(lldb) [22m [8G[1G[JP+f8/wAxQAmf0+p+n+R/Q0AL/n/Oc/59OtABQAnp9PwP/wBf29/agBfx/wA/5688+2aAD+v+f88/lmgA/wA/5/8A18+2KAEHGTz178AfT7v1PX15zhgAzgZP1x0PH1zn6/oOlACZyeB2z1x+HTnt/d9e2KABs8Yzn2/r/L8c9qAE754zzgH8Pc+nQfgTmgBCcZOMdwPU8c8bs+uc/wDfWDtADGckjH/1jknBPIPTnkdfm6KAKCPpz93jr1HZe+O/[1G[J[2m(lldb) [22m [8G[1G[J128hgBvXgDB+ud3t29PX/wCxADODyQRxwQeMen8uvPU5waADHXrjjvgH36Dp29euTnFAH//U/g/wQB36fy7Zweucnn09BXQBGRjOe+Tn0Hr1PbjBxnGfagBrDO7JPTuAfz9AM8/XJByCoBGBg5I9cdDgfQ56e3XdxgjFADeQD2B68YxnGOh6cg8Zz6DOGAG9hnOOmfQ5ycfgeuG/QUAJwPrk4554/DBx1P8A7LnLADRjnB69+vP9fz9uOaADHr+O[1G[J[2m(lldb) [22m [8G[1G[JR2z07/oeOvPNADSOp56e2R7ZwMY789OOaAA8g8H6EdQMde2T0BGew4xmgBnbjJznjoT+mOwPGfcjigBv+eh6/qfw/LGQKAEPpjqccjP5j8D/ADyMYYATjg+2eOoweR0wPfAOenJFADSOgBHP8+4/h9RgZ7c4yCwAhwcAds9eMe/bIPOeM8dqAGk5OcYzz/np1Oe35YxQAmTzznvgnOT3/wA+/tQAnXoe/wBfTjgnGOn+OcsANPfB4Pcdh0PPqfxx[1G[J[2m(lldb) [22m [8G[1G[J1PAIUAYTkY574Pfn6DIzkc5PPpzQAreg9OmD8vrzwfocflQAz8P/AKx//V+h96ABsHHXPrnvjk9e/frnPQYoAaRzjPbGDgnjpnk56kjp7jrQAEk4x35yT046difX7rfh0oARgT0PUnryck59v/1c5H3qAGEHOBxjjPA/Hvjpzznsc80AHQHjk9CCD35GO3B9/wBcKAB7cZPtkZ7+x/UjHbBoAT8un0x1xgckk98nPTOeKAFxnOMev8+B90/p29sM[1G[J[2m(lldb) [22m [8G[1G[JAN9Qeo7Y9c4/zn86AD/P+cEfz/OgAoAP8/56fy/KgAoAPX64oAKACgA+g+n+ecfl+eaAD6fr/n9f/r0AJ0ycZPpj8ccevf8APJzhQA+mP1wfbPb68+nGc0ALz6gD6denHbnn+XXgUAHTtzn6fXjjn6njvjNADcnPA5x6+/sTjGOoPtxigAGOo/E8c/iODz+tAAe3TPpx19T16DHQ8478UAL169Of5/yOBxznv6qAL3Jzx+P59v5Z+mKADnHtzx19[1G[J[2m(lldb) [22m [8G[1G[J+Pw64/qKAD07+g759B79f85oAP5nn0/Dt0yB0/LNAB/n/P8Anj8aACgA/n/n6fQfqT1oAP8AP+fWgAoAP8/5/wA/yoAP8/5/z/KgBMDtx9BigA6cc+uTk/5/z70ALn8+/P8An/69ACZH9PXr6/jx3/QlQBef8+n+f88UAJwODj8Tnj8cZ/yOcZoAOvvjj1+vbOce/wCXO4AQA+pHJ9PqMHDdjj+L0GOrAAe5wM49eMen1oAXg8dPp2/zjoOPzNAD[1G[J[2m(lldb) [22m [8G[1G[JODx8v07g56enQ8e/TjNADj2Hv1Pt3xk/r0PYcGgBuccZ6jqfU+3JHXqSPpigADZ9OOcY4J56ZAwT/TIxnCgAex+7nqec/wA88keg6e/zACHBAA68+ue2B1wSfpjnjH8QAEc4xjoPvZwf045z19uKAAduBgHk5wGH5HjP198daAP/1f4QMEDnBIOODngfyyMZ5bBwM8Gt1eyurPql/T/rtsPv+D/Xb9Pl0GEcc8nkY7f8CyFHX3GQcd6Ylsl17/d6[1G[J[2m(lldb) [22m [8G[1G[Jf133GEYOOhJGP5ZHAAz6Y6jvxQA0gsSDxxgY9cYGQAc/TOBnqeGoAYcZyeM4B3dRgcdepGeTjjGMNnaoAwjHUcEg9MfgBnIyOxI6cYyaAGnJyf8AJ9v0zg0ABH8uoOOc4zyB64xj3OQaAEHI5zjPU/yxjqOvX8WyKAEI44+vXoO/Uen1x1yMGgBO/r7Z68fgPXjHvxztAGkY4zt9Ow/E5bkf5zkBQBpA5I9s/j0/uk/l9MY+YAbjPA757cflnJ54[1G[J[2m(lldb) [22m [8G[1G[J6nPcjlqAGnqDn8NuOD6nnPPuu3qc0ANPBxjtwB2zjPPfoeef1IUAaTn1yQBjHQ56fez/ADzntglgBp+v49v6f59etAB/n/P+f50ANxnPGM9+ufyIPr29sjFAB19vocg5POOmfqCOTjnBDADOTx7YyR19uvTvnIzjtmgBvc+vf+pOM5x16du9AATnrn/63p3P6/nzQAn+f8/5789TQAe3bnpx1/yM+tADTnIAYjOe2f6A9PU+3PWgA6Z9M/Q/U8g9[1G[J[2m(lldb) [22m [8G[1G[JuDkZzyDjNACNg/TGf585/D0bPpzQAhXHc7fXHT/0LHPvznHH8IA3HGc4wPTuPQ+/Bzx7ZH3QAI4z2PU46k56YPbHTHtxn5gAHJBPHOOOME9Dxxk8dPx60AOPQZ6jIPXsM47ZzxznOemOKAGEcZ6gHBxk/pwf0/KgAxyeeO3+PAJ9R+uB1oATGc9fc/y55/ljsc80AGOAT+Hv25Hb6H+lABx+P+f8/wD66AE9z19B/kfz/LFACn8j78/h/nP6ZUAT[1G[J[2m(lldb) [22m [8G[1G[J8M/1/Mj+f50AHJAznp27f5znH1HegA78jjP8u/1PTpxjtQAcn+g4GD3GSO/bdux26gUAGPfvnqef5Y5I7Y+mflAF9e/p/hzjJyO5/KgBMDJ5xnr/AE6Akeg6e/rQAEZ+h5/H/Pb8fSgBf/r/AI49ueeOP0xnNAAPXjnHOARjPYcD9fbjBoAOhyO/+en0P+cUAFABj/P+f6/0oAP8/wCen+euetABj/P+eKAD/P8Anr/P86AD/P8An1oAT/Pr+H4f[1G[J[2m(lldb) [22m [8G[1G[J56UALQAf5/znOen/AOrrQAnPb07/AI/j6f5FAC8/5/z+lACdPp+HH8uPzP1xhQBc/rQAnXpx+PP49egOenX1oAOfz/ED2/Ed/wAewoAD0P6devb1PX2/OgBM9BjBJ/yckEHH+c4AYADnI68bvofY9fzIGex60AJz1xwTjBHQngHpk59PwJ70AK3OOvPp0/Hg57dvrigBAOB29hzn6tzjJH5emM0AHIwMY5GD1/nj9OmeM9aAGnufXsORn3zj9fqM[1G[J[2m(lldb) [22m [8G[1G[J4xQAoGM9u2c5wfX+D8ssR+OaAEyAD3ySMeo45zg5P1PfjFACD8ee+M/gOnOO+T6AcGgAxnJ79eMAY/rj8z35FAAO/wCP06HHrnv/ADGOTQB//9b+EM4AxnJ65PHXHPfIx1BPPPTBWugCNgMY4J75PHPA5H6ce2Wx8oA3GOCOvX8s5yQSevHBHGPl43AEZ7+h5ztBJ7Z6g57deeTx0oAjk59B9APrgnd0yOMrxnGRg7pk5JrlSa63/wCH/wAvV/Za[1G[J[2m(lldb) [22m [8G[1G[Jtr/X6P8ANCc4znPGf06ccf8AAgVwM+tUIQfd5IHUdMk4HY5GeCB079+lADcY5HPtgn9cdPoT+nygDef8+v45znv6e2V2gB3xn+vTHf8AH8evegBDzjrxx16/7PPrx1HcYzzQAh69MjGBzx6/QegGcHjrigCM56D646dB155H4jLY4wKAGc56AgD+vJBHU44xzx0x/EAB9ec8/Ljpz2zz047dQeelADOcjOOh9cLn1x9MDn34JNADSeo4PGP5Hjv1[1G[J[2m(lldb) [22m [8G[1G[JHTgD36UANoATnjj6+36/1PtmgBB1xjH8v/rD3woJoATAz24yD0H1IIHXnP6YXmgBh6YHqfTPbjHB6j+7+XSgBBj8fpnPt+HUcc8jnFAB7d8+np/Lr0oAT/P+ev8An060AH+f8/5/nQAn4df8/wCc/wBaADv6Hv0/U4Pp6j9KAE/DnGe/fsTwfoPXjnrQAc9RwfQ+nboMj8+vGOpoAQ46dCBz2B46Z6+nZuOo5oAaQBnrnnjHHYfy5znnqcUAHrjD[1G[J[2m(lldb) [22m [8G[1G[JdOmMDLdMd/Xr+fFACHGeh/z0PT/DtycCgBPrx6YHH8z+PPHfGaAHHpnOMj8+2D1JPv8AN7nugA3tnoeAAPbv14+uPY5wNoAdRnkYxk9f8/jj07AMAL0HXoRnjj8cdQfpz1GaAD8M/h6dMYweT6fjnOKAEPQg4+hXPHueMnv938icUAGM/r+nPrzgdvl/UmgAJJx0P69ecDH4+uM8dMqAA/Efp+HPv/nigBPf/P8Ann2/TDAB79T07Z/9lH6/gKAF[1G[J[2m(lldb) [22m [8G[1G[Jz9eev/1+mf1+g60AJ/n+o+v9e/SgA5/z7dOuf06dOODQAfh/nOPX+Yx9cfKAH+emf07/AKfUYzQAdcf17fzA/P8AOgA/z/n/AD/OgAoAP8/5/wAn+QUAOKAD/P8An/I/kWACgA+v+f8AP+e1AB3/AM/pQAf5H+f8/rQAn4f/AK/8Pf8AOgBaAEH6duxPrx+Hp780AB4H+R/Mj+f55oAD2+vsf546jjOe/bIoATPIx7jb78fQDHfk+w5oAM9f9njP[1G[J[2m(lldb) [22m [8G[1G[JXp07A/nn69aAFzx05GOpAzn8Tj8hQA3GR79hwePUdPTscY57jaAGOmOP1PPT16Aeoz+OKAE6L6E8/wB38hzzjgj+XSgAyRx1B4B+vt8wOOn3R3560AJ6D34JPTpyO4B7c9u2KAAnH0DA9OOnB4x2+meuDkigA49c9PX+XXdx6jOe/BUATtjn6YHOO46HODzxk98YNAAR7569Pw7Y9fXGecYzhgAxgkfeHqRj19Og6568D1BKgCZ9v5d/X1/yRQB/[1G[J[2m(lldb) [22m [8G[1G[J/9f+ERiFBz83TB4AJxyACO+3pkHPHdd27airu+9tP+Gf9a62tJpX/r/h/wCtXZJsYfpjtgcD+ZzyenHTJHNMQwjr6kd+QP5DvxzyeRigBpB56d/qc9cE44JPOB2xxxQBGQRjoQCcHqO5z+GTjOBx3xhgBuACTjsRkDGO4GB68KDj245oAbgcnJ9eowMnOfxA9OuMFcfMAIQRg475PbGeo5yRj8snnHAoAYM54x9OuD69+vGP6daAEI559xgZx7+u[1G[J[2m(lldb) [22m [8G[1G[JfbP4Y6UAIee+P8jHX8qAEOM5OAcY4789Md+ep4z1JGAaAGkZ4PuRwBjH4kccdjjqd2MUARkY59TjA7jnkdh3xjnjPOSVADrn2HXj9OSePoMdecUARsRk4HPByM9+MdD1HIOQPrmgBn4Dp16n8unfv6epoAQ/5/zx/P64oATP/wBcYJ+oHT6e3fPSgBDwD75PXH9D1z7e3UmgBpPfg59j6eh4yMdMrnqT0oAYeg9ieR3P/wCrHb86AD8f5/8AxI/l[1G[J[2m(lldb) [22m [8G[1G[J+I52gCf1/wA/z/zxQAf5+vt3/kB70AJ09+/+f/rZ/qoAZ9/T65/+v6Y7d6AAY/8Ar/X8T6nqB+OaAEzz7c5PT1/LGDz3OOwoAU59cfhz+fPU/j9CMUAN7njHqQcj8iDk9jgH684UAXg9+/HQ/lwfp26ZzxQAwjnkZI56/e46jJBGO/XgH5eQaAE69B6/gPQnpx/e6EHFAC4544z6ZGCe3OOuPRvQYzQAmPT88dQeM45wAQegyByQcjcALjHv6f7X[1G[J[2m(lldb) [22m [8G[1G[J4ZPY9sHvigBPpg+/T8COB2PGcYPU4zQAh+g6dRkfyPUfTn3z8oAenX649+vqevPHHTjNACevp2/+v/n+VAB+Z/x/r/n0oAAQM/zH6dh+fP8AwHBFAATk/wD6z+p5x/k0AH4fh6//AK6ADPb8cf17f59elAB+H4+p/wDre2P6sAH1/wA/y7f5OM0AH5+3+P6H/IoAP58c+v8Ann6UAH+cf54/U/h1YAP8/wCf8/yFABQAf5/z/kfzDABQAUAHt6/5[1G[J[2m(lldb) [22m [8G[1G[J/wA//WoAP85/z/h+eaAD8f8AP6/554zigBOepI/LHHf+Xb8j1UAAc/5/z657fplgAz7d8f5/Hjt1yPVgBfT9O36fSgBP0+uOfQ9/5j+lACE9gemSTnp9Rj+X1JGBuAEBycY9z/iMFueeo69PdQBO34+gXr6ZyOfqCAMZbIoAD0zu456559R/D+GP0zmgB3Xpjkc9jg9+MZHOMHrjqOWoATGCSeQMdyce/wB3PpkZGB1zjNAAeMn8/Xntnnp14OOc[1G[J[2m(lldb) [22m [8G[1G[Jc4zQAnYcd88kdc9Oc8/TA56nOKAEzz29z+GOAQfXJBx0980AN9AD37fz6ZPftkenIFAC9gcZ9v4QfoP/AK3rz8woAMZ/Idx1PQ+45HuPwoAMYwfUkYHOPXrwevt2Izn5QAJ69/f6fnycDn9RjNACf07jPT34GPT7vbvnFAB16ceg6/5JI4HvQB//0P4SDk5GccnGCOmePYYB4yT/ALwOTW6vZXVn1S/p/wBdtg/r+tvy+4j29B7kDPt1x0wR16nP[1G[J[2m(lldb) [22m [8G[1G[JQtxmmBER1xz36Y59MBjgdO4z06ZND/H+vT8/uAbjI5O32HoD1GDwfxIHfNJXsrqz6pf0/wCu2wP+v60/L7huMgnbx0HOOT1/vZIJyBjH1yArAa2RyvBycjnPIJOeMgZ9Dj5c89KAIyD1yoHRvl4GeeMkZ59APfdxQAn4ZHPXGeP7xHHBBA45HpigBrH047Y68D8scgjqfyxvAGHoSeCP8Dz3/lznvQHf+rfn+X3h/X2/r0GMnGc59DnKgLZLr3+7[1G[J[2m(lldb) [22m [8G[1G[J0/rvuJ9Dxnpj8OPQdzz27UANzzjBwffOO+e474xyM/3sE0AJweeBgZ7njPI6YHtkNj8moAi6gkH6d+RwccAHnnnp6nOKAGH15HPOOOnA9RkevHsW6sANP88dDxx9GOc+pz36daAG/Tn8wPwJxn8h6c4BYATIzjOOfTHPU/XOf19qAGMeDzg+g5xj37c4zQAhGec8/Tgd8Z+Ynrx/M8CgBoPtkf5/z3/kVADI9M/XIP5Bxj079PcmgBPT8/x/z9f1[1G[J[2m(lldb) [22m [8G[1G[JIUAP8/5/z/KgA/z/AJ6fy/KgAoATuP1/z/nr9KAE6DsP5Z9TwMZ6fyxnCgAfr05xjOPQ9PY9/wAVoAQHsuD6+x7ntnqOgYdRxxQAHjrk/X1/MYGMjkHvnGBQAcEc+uM7cEYx9ec8YGc9s4NACHgdTn8f5cA5HOM7h145oAQdeOB1Az7ng9eScYOeB60AJ0xjGB1OM/Uegz0B6c89TQAEZzz09+v4nODj26/T5gBQfr7c8gdhwDyef7vpyATQAhOe[1G[J[2m(lldb) [22m [8G[1G[JOnJzlfUeo6HPs3pQAh69uOM9ufzx64AznnnFACdh6Zxn/HA7YPbvgDtQAv8A9b29vfPPf2ycdKADr1/+t+Q/A9/oeRQAh/z3/P8Az/SgA5/z/n/P4UAHf+nH+GR+Z/ltAF79fx/znr9fzoASgBf8/wCf0oATp/n159/8+nSgA/z+XT/P+FAB/n/P+eO/UUAH+f8APT+f5ZoAP5/57UAH+f6+/wDnnjGaAEzjr19s/wCen584oAP89P8APOf88UAL[1G[J[2m(lldb) [22m [8G[1G[JQAh+vX2/w56en9aAA5/z29/8efpjmgAz0+vY5/zxn/IFACdOB3OeffsOT3+nGTjigAx1H69c9z78+mPzoAMDGMdf/rn15P4/j3oAPwPHXByT7e/OR2I79QWAEP05wD7Z5HPX37j1Lc0ANOOOenOOfXt6fhj6jrQA7I5B6Ag8k9+R+Oc5/UDksAIcHOMgg4J69OnJ6dPb3zwaAD8uOeOQexyc9sjrjvweqgBz25IOOOeDz97twepye/GcUAJyOnI7[1G[J[2m(lldb) [22m [8G[1G[JkdeW7deT9ecY5xQAvAyQM55A9Pfg56jttx0PrQA0HBBGTnr+fPp2Hr75GMUALnHTGQDgjkdOnqMk9cE+xzQAZ6ckHoTwRz+RPoc/XnGaAEHfBOc4HX8/w/3e/Q8bQA9++enr/X/PvQAHqR25P+Awenpxjp7ZYAQdvy7nr+f6Y9gcE0Af/9H+Enr0yQCRj3B528n3zw3rW6akrrb+vT+u+4DCD/Ic8Yx34Aye+D+mStMCMj1zn6cE889F6ngcfw9v[1G[J[2m(lldb) [22m [8G[1G[J4gCLoSSPpznv27gYxx7dWxmpipXlfa+noN26f1ovN9b9t/kBHyn1znoV59upz+PPTnmqERsBnsSTj34z168nHuQecL1oAYRj8s9fTJ4IJ4HtgnGAM5oATIIBzjI2+pPQHsvcZB/MDqwA1vQ5IA7jJGOmMDnJ4GN2efm4zQAzrxngnp78jt/Q85xzQAhz6+vp/Lbn8+T224xQAnoO/wDh7fj68e9ADe55JHIYfTnHuO3tnqeVoAaTz0z35zkZypzz[1G[J[2m(lldb) [22m [8G[1G[JnnG3rxxz3oAj5JzyO2Cefxzn0A6g88f7AAzOeD0JA4OSPbryM85yPQY4oAaec+xwPp6dM/meenGPmAGHtz7/AOf8/wBKAGn16c9wB26Z75PqQcZzjGKAG54xzn0x1z368YP0+nJDACE447ZycdPoBgHHTvjvz96gBPxyB0OP098UAJ/n/P8A+r8s0AFACe2ecf5PYfp9MUAB68g8d+mPXvnH4du/8IAnP8uMdv09OmeB6cUAJx14z279ye34DIzz[1G[J[2m(lldb) [22m [8G[1G[JwScg0AGeD689O59vxPr7nOKAFOcdvfOR/n+h5HWgBnvgc+uenrwfXvgc4IUZoAU846gHtjPTucde3bHfjJoAaD36Z6njjGcYxt9M4z6DnncAOH4/Unqw7Dn1zjjJ9eooAQnAHTnsMY/D7w5I9ev5qAB4GNpGeeTn+nHYkkcehxQAnoOT0Hsc56Z4GMkAjjv2FAB2yAOPrnr3wR049B6ZzigBe3Tp3GfTp0GOvU9TnOBwoA3kcHoDn8/y6/h74zQA[1G[J[2m(lldb) [22m [8G[1G[Jvc8e/Gcf44Pbp9R1oAT+X5f55/z0oAOvboM/5+n0/OgA/Djt/nI56ev05oAT/P8Anp/L8s0AFABQAf5x/n0/r7UAFAB/n/P/AOv8qACgAoAKAEPp3PT8Of8AP/16AF/l/n/PX8qAE446ZH4nH6H8f59KAAcfnxj0/T/PXOM0AH8+e3vyfX9cHjpigBPfPXvnGPzyDx34+hzmgAPQdumDycfXqP1+uQDQAepz9B26dvf6Z/mFAE4OAMDvwOfcjnHb[1G[J[2m(lldb) [22m [8G[1G[J64yPl6MAKOnQY/pz2I69uvOc8Y+YARSD7dvw6DHTj+R454NABxxnpk49COvOQc88duefegBue444HI4HocDjI7Dv8uecE0AKCCeeT06Ag479AeR9cd+5oABznOcHnOPfJBxjOOQD+QH3aAE5I4Jx6YPB/DIx6D+WM0AKSD0O3OB19MdePQdsDtk5FACA+hOc9Dkkjp/X1/LAoAU9+SOefbrxjgsenOcfSgBpJH4jnnj/AOv0wcN6/N2oATtj1OT/[1G[J[2m(lldb) [22m [8G[1G[JACHGCeOfpnoc0AGe3v0655PQY/Q7c+mRhQA68/nz6e59fr+C/LuAFGcjjgH/APVzz6fj7ZzQAnrx68c9O/5cjn8j1UABwCf5Hnn6EdOOpx65IoAMe3HGeRk+g9ucnHHvng0Af//S/hMwwyCQSflBBIxjPPuT749ueG1hBQuk738rf19333AiIyegPO3AxnIBIHXgDHX5gRyTkEM5SUVd7f1/XT8LSP6/rf8AL7yM8+oGcE9du30IyOoPrjpkDmmm[1G[J[2m(lldb) [22m [8G[1G[JpJNbP+vL+u+4DO3Pv+HY/Q45yD3xxgUwGHuecY9T268dwfqPbANADMfkcHP15PqQMZ4J4xnmgBrY4XJGB909/p2IyCD3oAj68kBfw/izjOenUZ9Ox6UANYnPHJ9cDHPOMd+o6lj79KAEO3Py5Oec+/ptxn2Gev8As4zQA3/Dp/XnJz+P4DigBOeP68H68dOOn5d6AG85PT3OOvfB54HrkdOOc5oAZnk9vTIzt9+MDHt1B55yVoATIAx+ZHrzg4Pv[1G[J[2m(lldb) [22m [8G[1G[J0yPUZbPygEeM4JXoce36Yzt4yPmHXGMMaAIyMEj+ufzxQA0nPUnnjPv9fftxjjBxmgBmDg87u349/wDDjnk4oAQ/hgnOB+fU4yecYO32HegBue3p0PX+gPJPfp7ZIUASgAoAT1/z/n8/wX+IAO3pQAHPb8/85HH0/PmgBp6dSeo9zn8Dt459h2NABzjt14znk+45PXI5x64OAaAF98YxyenPrjqRxz05756MAM47nB4GRn069c8gY/HkdDQAEYOc[1G[J[2m(lldb) [22m [8G[1G[JYzx0xjtnjd15IHzccYGQzABwc5ODznHTGfQ9eSfU8+wCgCYA74PpnP8A7KOvHBPfnGCKADnv17Ywff8AAY/+t0NACcE8A889D+nJzjryefagBcZ45Pv0A7kdx7Z49cHBDACZ9D/T/OP68dTQAZ7ZyPb9M5AOB6fiMdFAF7exx/n2OM/17UAJ+XHT398+34D69KAD+fr/AJOOnt06Y/iAEoAOn8v8/wCf50AH+f8APr+n8ywAUAH+f8/5/lQAUAH+[1G[J[2m(lldb) [22m [8G[1G[Jf8/X6fXHFABQAf5/z+v1/CgA+nv7dP8A6/8Aj3oAKAExgdM9sf5Iz+p9BzQAcjpz9SST+e3HHJ447Zx8wAvr/n/P4f4UANHPfIHGBz+vfigBR3+vv6f59qAEGcdOMcYJOfzIP06Ecj5vlNACNgjOc8598enbtz/PPJoACT1HbHH885I6evTn2BUAQj2B56D3+i8ADvjn0b+EAUnHOevYg9uuPvYz+OPyNACDAyc4z6jnB6eucHJ4PPU54oAB0xtP[1G[J[2m(lldb) [22m [8G[1G[Jr16479s9uOMf7WaAA4OB3OM+3QdD17dCuepPAoATaMfxZxnp+Hv1+nI9MbqAAY6dOOT0xj278+nTt0oAAPTnoDge/T7y5BIxz29P4gA4B9fp1zjHXGec9OcevUqAIBnJJ6fr+ZyM++evQUAAyOeOORn19vyPZucccUAH4YzxyBx64Jx7dj7ngUAJ6dsDqM9D65+v456kFQoAvTHPf8sd+vfqPfgbQcUAHv8AUdev19evTHT1oATjnrn/ADz1+vrn[1G[J[2m(lldb) [22m [8G[1G[J0FABnoMdPTr7/oPp6gclgBe3YemQe3GM7cHPU545+9yaAE4+n06f1x+f1zQAucYxk+oOCM+2f8PxbI2gH//Z')
    //cordova.logger.log(data);
    //displayImage(data);
  }
};
