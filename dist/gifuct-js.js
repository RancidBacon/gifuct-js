(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

// Stream object for reading off bytes from a byte array

function ByteStream(data){
	this.data = data;
	this.pos = 0;
}

// read the next byte off the stream
ByteStream.prototype.readByte = function(){
	return this.data[this.pos++];
};

// look at the next byte in the stream without updating the stream position
ByteStream.prototype.peekByte = function(){
	return this.data[this.pos];
};

// read an array of bytes
ByteStream.prototype.readBytes = function(n){
	var bytes = new Array(n);
	for(var i=0; i<n; i++){
		bytes[i] = this.readByte();
	}
	return bytes;
};

// peek at an array of bytes without updating the stream position
ByteStream.prototype.peekBytes = function(n){
	var bytes = new Array(n);
	for(var i=0; i<n; i++){
		bytes[i] = this.data[this.pos + i];
	}
	return bytes;
};

// read a string from a byte set
ByteStream.prototype.readString = function(len){
	var str = '';
	for(var i=0; i<len; i++){
		str += String.fromCharCode(this.readByte());
	}
	return str;
};

// read a single byte and return an array of bit booleans
ByteStream.prototype.readBitArray = function(){
	var arr = [];
	var bite = this.readByte();
	for (var i = 7; i >= 0; i--) {
		arr.push(!!(bite & (1 << i)));
	}
	return arr;
};

// read an unsigned int with endian option
ByteStream.prototype.readUnsigned = function(littleEndian){
	var a = this.readBytes(2);
	if(littleEndian){
		return (a[1] << 8) + a[0];	
	}else{
		return (a[0] << 8) + a[1];
	}	
};

module.exports = ByteStream;
},{}],2:[function(require,module,exports){

// Primary data parsing object used to parse byte arrays

var ByteStream = require('./bytestream');

function DataParser(data){
	this.stream = new ByteStream(data);
	// the final parsed object from the data
	this.output = {};
}

DataParser.prototype.parse = function(schema){
	// the top level schema is just the top level parts array
	this.parseParts(this.output, schema);	
	return this.output;
};

// parse a set of hierarchy parts providing the parent object, and the subschema
DataParser.prototype.parseParts = function(obj, schema){
	for(var i=0; i<schema.length; i++){
		var part = schema[i];
		this.parsePart(obj, part); 
	}
};

DataParser.prototype.parsePart = function(obj, part){
	var name = part.label;
	var value;

	// make sure the part meets any parse requirements
	if(part.requires && ! part.requires(this.stream, this.output, obj)){
		return;
	}
	
	if(part.loop){
		// create a parse loop over the parts
		var items = [];
		while(part.loop(this.stream)){
			var item = {};
			this.parseParts(item, part.parts);
			items.push(item);
		}
		obj[name] = items;
	}else if(part.parts){
		// process any child parts
		value = {};
		this.parseParts(value, part.parts);
		obj[name] = value;
	}else if(part.parser){
		// parse the value using a parser
		value = part.parser(this.stream, this.output, obj);
		if(!part.skip){
			obj[name] = value;
		}
	}else if(part.bits){
		// convert the next byte to a set of bit fields
		obj[name] = this.parseBits(part.bits);
	}
};

// combine bits to calculate value
function bitsToNum(bitArray){
	return bitArray.reduce(function(s, n) { return s * 2 + n; }, 0);
}

// parse a byte as a bit set (flags and values)
DataParser.prototype.parseBits = function(details){
	var out = {};
	var bits = this.stream.readBitArray();
	for(var key in details){
		var item = details[key];
		if(item.length){
			// convert the bit set to value
			out[key] = bitsToNum(bits.slice(item.index, item.index + item.length));
		}else{
			out[key] = bits[item.index];
		}
	}
	return out;
};

module.exports = DataParser;
},{"./bytestream":1}],3:[function(require,module,exports){

// a set of common parsers used with DataParser

var Parsers = {
	// read a byte
	readByte: function(){
		return function(stream){
			return stream.readByte();
		};
	},
	// read an array of bytes
	readBytes: function(length){
		return function(stream){
			return stream.readBytes(length);
		};
	},
	// read a string from bytes
	readString: function(length){
		return function(stream){
			return stream.readString(length);
		};
	},
	// read an unsigned int (with endian)
	readUnsigned: function(littleEndian){
		return function(stream){
			return stream.readUnsigned(littleEndian);
		};
	},
	// read an array of byte sets
	readArray: function(size, countFunc){
		return function(stream, obj, parent){
			var count = countFunc(stream, obj, parent);
			var arr = new Array(count);
			for(var i=0; i<count; i++){
				arr[i] = stream.readBytes(size);
			}
			return arr;
		};
	}
};

module.exports = Parsers;
},{}],4:[function(require,module,exports){
// export wrapper for exposing library

var GIF = window.GIF || {};

GIF = require('./gif');

window.GIF = GIF;
},{"./gif":5}],5:[function(require,module,exports){

// object used to represent array buffer data for a gif file

var DataParser = require('../bower_components/js-binary-schema-parser/src/dataparser');
var gifSchema = require('./schema');

function GIF(arrayBuffer){
	// convert to byte array
	var byteData = new Uint8Array(arrayBuffer);
	var parser = new DataParser(byteData);
	// parse the data
	this.raw = parser.parse(gifSchema);

	// set a flag to make sure the gif contains at least one image
	this.raw.hasImages = false;
	for(var f=0; f<this.raw.frames.length; f++){
		if(this.raw.frames[f].image){
			this.raw.hasImages = true;
			break;
		}
	}
}

// process a single gif image frames data, decompressing it using LZW 
// if buildPatch is true, the returned image will be a clamped 8 bit image patch
// for use directly with a canvas.
GIF.prototype.decompressFrame = function(index, buildPatch){

	// make sure a valid frame is requested
	if(index >= this.raw.frames.length){ return null; }

	var frame = this.raw.frames[index];
	if(frame.image){
		// get the number of pixels
		var totalPixels = frame.image.descriptor.width * frame.image.descriptor.height;

		// do lzw decompression
		var pixels = lzw(frame.image.data.minCodeSize, frame.image.data.blocks, totalPixels);

		// deal with interlacing if necessary
		if(frame.image.descriptor.lct.interlaced){
			pixels = deinterlace(pixels, frame.image.descriptor.width);
		}

		// setup usable image object
		var image = {
			pixels: pixels,
			dims: {
				top: frame.image.descriptor.top,
				left: frame.image.descriptor.left,
				width: frame.image.descriptor.width,
				height: frame.image.descriptor.height
			}
		};

		// color table
		if(frame.image.descriptor.lct && frame.image.descriptor.lct.exists){
			image.colorTable = frame.image.lct;
		}else{
			image.colorTable = this.raw.gct;
		}

		// add per frame relevant gce information
		if(frame.gce){
			image.delay = (frame.gce.delay || 10) * 10; // convert to ms
			image.disposalType = frame.gce.extras.disposal;
			// transparency
			if(frame.gce.extras.transparentColorGiven){
				image.transparentIndex = frame.gce.transparentColorIndex;
			}
		}

		// create canvas usable imagedata if desired
		if(buildPatch){
			image.patch = generatePatch(image);
		}

		return image;		
	}

	// frame does not contains image
	return null;


	/**
	 * javascript port of java LZW decompression
	 * Original java author url: https://gist.github.com/devunwired/4479231
	 */	
	function lzw(minCodeSize, data, pixelCount) {
 		
 		var MAX_STACK_SIZE = 4096;
		var nullCode = -1;

		var npix = pixelCount;
		var available, clear, code_mask, code_size, end_of_information, in_code, old_code, bits, code, i, datum, data_size, first, top, bi, pi;
 
 		var dstPixels = new Array(pixelCount);
		var prefix = new Array(MAX_STACK_SIZE);
		var suffix = new Array(MAX_STACK_SIZE);
		var pixelStack = new Array(MAX_STACK_SIZE + 1);
 
		// Initialize GIF data stream decoder.
		data_size = minCodeSize;
		clear = 1 << data_size;
		end_of_information = clear + 1;
		available = clear + 2;
		old_code = nullCode;
		code_size = data_size + 1;
		code_mask = (1 << code_size) - 1;
		for (code = 0; code < clear; code++) {
			prefix[code] = 0;
			suffix[code] = code;
		}
 
		// Decode GIF pixel stream.
		datum = bits = count = first = top = pi = bi = 0;
		for (i = 0; i < npix; ) {
			if (top === 0) {
				if (bits < code_size) {
					
					// get the next byte			
					datum += data[bi] << bits;

					bits += 8;
					bi++;
					continue;
				}
				// Get the next code.
				code = datum & code_mask;
				datum >>= code_size;
				bits -= code_size;
				// Interpret the code
				if ((code > available) || (code == end_of_information)) {
					break;
				}
				if (code == clear) {
					// Reset decoder.
					code_size = data_size + 1;
					code_mask = (1 << code_size) - 1;
					available = clear + 2;
					old_code = nullCode;
					continue;
				}
				if (old_code == nullCode) {
					pixelStack[top++] = suffix[code];
					old_code = code;
					first = code;
					continue;
				}
				in_code = code;
				if (code == available) {
					pixelStack[top++] = first;
					code = old_code;
				}
				while (code > clear) {
					pixelStack[top++] = suffix[code];
					code = prefix[code];
				}
				
				first = suffix[code] & 0xff;
				pixelStack[top++] = first;

				// add a new string to the table, but only if space is available
				// if not, just continue with current table until a clear code is found
				// (deferred clear code implementation as per GIF spec)
				if(available < MAX_STACK_SIZE){
					prefix[available] = old_code;
					suffix[available] = first;
					available++;
					if (((available & code_mask) === 0) && (available < MAX_STACK_SIZE)) {
						code_size++;
						code_mask += available;
					}
				}
				old_code = in_code;
			}
			// Pop a pixel off the pixel stack.
			top--;
			dstPixels[pi++] = pixelStack[top];
			i++;
		}

		for (i = pi; i < npix; i++) {
			dstPixels[i] = 0; // clear missing pixels
		}

		return dstPixels;
	}

	// deinterlace function from https://github.com/shachaf/jsgif
	function deinterlace(pixels, width) {
		
		var newPixels = new Array(pixels.length);
		var rows = pixels.length / width;
		var cpRow = function(toRow, fromRow) {
			var fromPixels = pixels.slice(fromRow * width, (fromRow + 1) * width);
			newPixels.splice.apply(newPixels, [toRow * width, width].concat(fromPixels));
		};

		// See appendix E.
		var offsets = [0,4,2,1];
		var steps   = [8,8,4,2];

		var fromRow = 0;
		for (var pass = 0; pass < 4; pass++) {
			for (var toRow = offsets[pass]; toRow < rows; toRow += steps[pass]) {
				cpRow(toRow, fromRow);
				fromRow++;
			}
		}

		return newPixels;
	}

	// create a clamped byte array patch for the frame image to be used directly with a canvas
	// TODO: could potentially squeeze some performance by doing a direct 32bit write per iteration
	function generatePatch(image){

		var totalPixels = image.pixels.length;
		var patchData = new Uint8ClampedArray(totalPixels * 4);
		for(var i=0; i<totalPixels; i++){
			var pos = i * 4;
			var colorIndex = image.pixels[i];
			var color = image.colorTable[colorIndex];
			patchData[pos] = color[0];
			patchData[pos + 1] = color[1];
			patchData[pos + 2] = color[2];
			patchData[pos + 3] = colorIndex !== image.transparentIndex ? 255 : 0;
		}

		return patchData;
	}
};

// returns all frames decompressed
GIF.prototype.decompressFrames = function(buildPatch, startFrame, endFrame){
	if (startFrame === undefined) {
		startFrame = 0;
	}
	if (endFrame === undefined) {
		endFrame = this.raw.frames.length;
	} else {
		endFrame = Math.min(endFrame, this.raw.frames.length);
	}
	var frames = [];
	for (var i = startFrame; i < endFrame; i++) {
		var frame = this.raw.frames[i];
		if (frame.image) {
			frames.push(this.decompressFrame(i, buildPatch));
		}
	}
	return frames;
};

module.exports = GIF;
},{"../bower_components/js-binary-schema-parser/src/dataparser":2,"./schema":6}],6:[function(require,module,exports){

// Schema for the js file parser to use to parse gif files
// For js object convenience (re-use), the schema objects are approximately reverse ordered

// common parsers available
var Parsers = require('../bower_components/js-binary-schema-parser/src/parsers');

// a set of 0x00 terminated subblocks
var subBlocks = {
	label: 'blocks',
	parser: function(stream){
		var views = [];
		var total = 0;
		var terminator = 0x00;		
		for(var size=stream.readByte(); size!==terminator; size=stream.readByte()){
			views.push(stream.readBytes(size));
			total += size;
		}
		var out = new Uint8Array(total);
		total = 0;
		for (var i = 0; i < views.length; i++) {
			out.set(views[i], total);
			total += views[i].length;
		}
		return out;
	}
};

// global control extension
var gce = {
	label: 'gce',
	requires: function(stream){
		// just peek at the top two bytes, and if true do this
		var codes = stream.peekBytes(2);
		return codes[0] === 0x21 && codes[1] === 0xF9;
	},
	parts: [
		{ label: 'codes', parser: Parsers.readBytes(2), skip: true },
		{ label: 'byteSize', parser: Parsers.readByte() },
		{ label: 'extras', bits: {
			future: { index: 0, length: 3 },
			disposal: { index: 3, length: 3 },
			userInput: { index: 6 },
			transparentColorGiven: { index: 7 }
		}},
		{ label: 'delay', parser: Parsers.readUnsigned(true) },
		{ label: 'transparentColorIndex', parser: Parsers.readByte() },
		{ label: 'terminator', parser: Parsers.readByte(), skip: true }
	]
};

// image pipeline block
var image = {
	label: 'image',
	requires: function(stream){
		// peek at the next byte
		var code = stream.peekByte();
		return code === 0x2C;
	},
	parts: [
		{ label: 'code', parser: Parsers.readByte(), skip: true },
		{
			label: 'descriptor', // image descriptor
			parts: [
				{ label: 'left', parser: Parsers.readUnsigned(true) },
				{ label: 'top', parser: Parsers.readUnsigned(true) },
				{ label: 'width', parser: Parsers.readUnsigned(true) },
				{ label: 'height', parser: Parsers.readUnsigned(true) },
				{ label: 'lct', bits: {
					exists: { index: 0 },
					interlaced: { index: 1 },
					sort: { index: 2 },
					future: { index: 3, length: 2 },
					size: { index: 5, length: 3 }
				}}
			]
		},{
			label: 'lct', // optional local color table
			requires: function(stream, obj, parent){
				return parent.descriptor.lct.exists;
			},
			parser: Parsers.readArray(3, function(stream, obj, parent){
				return Math.pow(2, parent.descriptor.lct.size + 1);
			})
		},{
			label: 'data', // the image data blocks
			parts: [
				{ label: 'minCodeSize', parser: Parsers.readByte() },
				subBlocks
			]
		}
	]
};

// plain text block
var text = {
	label: 'text',
	requires: function(stream){
		// just peek at the top two bytes, and if true do this
		var codes = stream.peekBytes(2);
		return codes[0] === 0x21 && codes[1] === 0x01;
	},
	parts: [
		{ label: 'codes', parser: Parsers.readBytes(2), skip: true },
		{ label: 'blockSize', parser: Parsers.readByte() },
		{ 
			label: 'preData', 
			parser: function(stream, obj, parent){
				return stream.readBytes(parent.text.blockSize);
			}
		},
		subBlocks
	]
};

// application block
var application = {
	label: 'application',
	requires: function(stream, obj, parent){
		// make sure this frame doesn't already have a gce, text, comment, or image
		// as that means this block should be attached to the next frame
		//if(parent.gce || parent.text || parent.image || parent.comment){ return false; }

		// peek at the top two bytes
		var codes = stream.peekBytes(2);
		return codes[0] === 0x21 && codes[1] === 0xFF;
	},
	parts: [
		{ label: 'codes', parser: Parsers.readBytes(2), skip: true },
		{ label: 'blockSize', parser: Parsers.readByte() },
		{ 
			label: 'id', 
			parser: function(stream, obj, parent){
				return stream.readString(parent.blockSize);
			}
		},
		subBlocks
	]
};

// comment block
var comment = {
	label: 'comment',
	requires: function(stream, obj, parent){
		// make sure this frame doesn't already have a gce, text, comment, or image
		// as that means this block should be attached to the next frame
		//if(parent.gce || parent.text || parent.image || parent.comment){ return false; }

		// peek at the top two bytes
		var codes = stream.peekBytes(2);
		return codes[0] === 0x21 && codes[1] === 0xFE;
	},
	parts: [
		{ label: 'codes', parser: Parsers.readBytes(2), skip: true },
		subBlocks
	]
};

// frames of ext and image data
var frames = {
	label: 'frames',
	parts: [
		gce,
		application,
		comment,
		image,
		text
	],
	loop: function(stream){
		var nextCode = stream.peekByte();
		// rather than check for a terminator, we should check for the existence
		// of an ext or image block to avoid infinite loops
		//var terminator = 0x3B;
		//return nextCode !== terminator;
		return nextCode === 0x21 || nextCode === 0x2C;
	}
};

// main GIF schema
var schemaGIF = [
	{
		label: 'header', // gif header
		parts: [
			{ label: 'signature', parser: Parsers.readString(3) },
			{ label: 'version', parser: Parsers.readString(3) }
		]
	},{
		label: 'lsd', // local screen descriptor
		parts: [
			{ label: 'width', parser: Parsers.readUnsigned(true) },
			{ label: 'height', parser: Parsers.readUnsigned(true) },
			{ label: 'gct', bits: {
				exists: { index: 0 },
				resolution: { index: 1, length: 3 },
				sort: { index: 4 },
				size: { index: 5, length: 3 }
			}},
			{ label: 'backgroundColorIndex', parser: Parsers.readByte() },
			{ label: 'pixelAspectRatio', parser: Parsers.readByte() }
		]
	},{
		label: 'gct', // global color table
		requires: function(stream, obj){
			return obj.lsd.gct.exists;
		},
		parser: Parsers.readArray(3, function(stream, obj){
			return Math.pow(2, obj.lsd.gct.size + 1);
		})
	},
	frames // content frames
];

module.exports = schemaGIF;
},{"../bower_components/js-binary-schema-parser/src/parsers":3}]},{},[4])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJib3dlcl9jb21wb25lbnRzL2pzLWJpbmFyeS1zY2hlbWEtcGFyc2VyL3NyYy9ieXRlc3RyZWFtLmpzIiwiYm93ZXJfY29tcG9uZW50cy9qcy1iaW5hcnktc2NoZW1hLXBhcnNlci9zcmMvZGF0YXBhcnNlci5qcyIsImJvd2VyX2NvbXBvbmVudHMvanMtYmluYXJ5LXNjaGVtYS1wYXJzZXIvc3JjL3BhcnNlcnMuanMiLCJzcmMvZXhwb3J0cy5qcyIsInNyYy9naWYuanMiLCJzcmMvc2NoZW1hLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJcbi8vIFN0cmVhbSBvYmplY3QgZm9yIHJlYWRpbmcgb2ZmIGJ5dGVzIGZyb20gYSBieXRlIGFycmF5XG5cbmZ1bmN0aW9uIEJ5dGVTdHJlYW0oZGF0YSl7XG5cdHRoaXMuZGF0YSA9IGRhdGE7XG5cdHRoaXMucG9zID0gMDtcbn1cblxuLy8gcmVhZCB0aGUgbmV4dCBieXRlIG9mZiB0aGUgc3RyZWFtXG5CeXRlU3RyZWFtLnByb3RvdHlwZS5yZWFkQnl0ZSA9IGZ1bmN0aW9uKCl7XG5cdHJldHVybiB0aGlzLmRhdGFbdGhpcy5wb3MrK107XG59O1xuXG4vLyBsb29rIGF0IHRoZSBuZXh0IGJ5dGUgaW4gdGhlIHN0cmVhbSB3aXRob3V0IHVwZGF0aW5nIHRoZSBzdHJlYW0gcG9zaXRpb25cbkJ5dGVTdHJlYW0ucHJvdG90eXBlLnBlZWtCeXRlID0gZnVuY3Rpb24oKXtcblx0cmV0dXJuIHRoaXMuZGF0YVt0aGlzLnBvc107XG59O1xuXG4vLyByZWFkIGFuIGFycmF5IG9mIGJ5dGVzXG5CeXRlU3RyZWFtLnByb3RvdHlwZS5yZWFkQnl0ZXMgPSBmdW5jdGlvbihuKXtcblx0dmFyIGJ5dGVzID0gbmV3IEFycmF5KG4pO1xuXHRmb3IodmFyIGk9MDsgaTxuOyBpKyspe1xuXHRcdGJ5dGVzW2ldID0gdGhpcy5yZWFkQnl0ZSgpO1xuXHR9XG5cdHJldHVybiBieXRlcztcbn07XG5cbi8vIHBlZWsgYXQgYW4gYXJyYXkgb2YgYnl0ZXMgd2l0aG91dCB1cGRhdGluZyB0aGUgc3RyZWFtIHBvc2l0aW9uXG5CeXRlU3RyZWFtLnByb3RvdHlwZS5wZWVrQnl0ZXMgPSBmdW5jdGlvbihuKXtcblx0dmFyIGJ5dGVzID0gbmV3IEFycmF5KG4pO1xuXHRmb3IodmFyIGk9MDsgaTxuOyBpKyspe1xuXHRcdGJ5dGVzW2ldID0gdGhpcy5kYXRhW3RoaXMucG9zICsgaV07XG5cdH1cblx0cmV0dXJuIGJ5dGVzO1xufTtcblxuLy8gcmVhZCBhIHN0cmluZyBmcm9tIGEgYnl0ZSBzZXRcbkJ5dGVTdHJlYW0ucHJvdG90eXBlLnJlYWRTdHJpbmcgPSBmdW5jdGlvbihsZW4pe1xuXHR2YXIgc3RyID0gJyc7XG5cdGZvcih2YXIgaT0wOyBpPGxlbjsgaSsrKXtcblx0XHRzdHIgKz0gU3RyaW5nLmZyb21DaGFyQ29kZSh0aGlzLnJlYWRCeXRlKCkpO1xuXHR9XG5cdHJldHVybiBzdHI7XG59O1xuXG4vLyByZWFkIGEgc2luZ2xlIGJ5dGUgYW5kIHJldHVybiBhbiBhcnJheSBvZiBiaXQgYm9vbGVhbnNcbkJ5dGVTdHJlYW0ucHJvdG90eXBlLnJlYWRCaXRBcnJheSA9IGZ1bmN0aW9uKCl7XG5cdHZhciBhcnIgPSBbXTtcblx0dmFyIGJpdGUgPSB0aGlzLnJlYWRCeXRlKCk7XG5cdGZvciAodmFyIGkgPSA3OyBpID49IDA7IGktLSkge1xuXHRcdGFyci5wdXNoKCEhKGJpdGUgJiAoMSA8PCBpKSkpO1xuXHR9XG5cdHJldHVybiBhcnI7XG59O1xuXG4vLyByZWFkIGFuIHVuc2lnbmVkIGludCB3aXRoIGVuZGlhbiBvcHRpb25cbkJ5dGVTdHJlYW0ucHJvdG90eXBlLnJlYWRVbnNpZ25lZCA9IGZ1bmN0aW9uKGxpdHRsZUVuZGlhbil7XG5cdHZhciBhID0gdGhpcy5yZWFkQnl0ZXMoMik7XG5cdGlmKGxpdHRsZUVuZGlhbil7XG5cdFx0cmV0dXJuIChhWzFdIDw8IDgpICsgYVswXTtcdFxuXHR9ZWxzZXtcblx0XHRyZXR1cm4gKGFbMF0gPDwgOCkgKyBhWzFdO1xuXHR9XHRcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQnl0ZVN0cmVhbTsiLCJcbi8vIFByaW1hcnkgZGF0YSBwYXJzaW5nIG9iamVjdCB1c2VkIHRvIHBhcnNlIGJ5dGUgYXJyYXlzXG5cbnZhciBCeXRlU3RyZWFtID0gcmVxdWlyZSgnLi9ieXRlc3RyZWFtJyk7XG5cbmZ1bmN0aW9uIERhdGFQYXJzZXIoZGF0YSl7XG5cdHRoaXMuc3RyZWFtID0gbmV3IEJ5dGVTdHJlYW0oZGF0YSk7XG5cdC8vIHRoZSBmaW5hbCBwYXJzZWQgb2JqZWN0IGZyb20gdGhlIGRhdGFcblx0dGhpcy5vdXRwdXQgPSB7fTtcbn1cblxuRGF0YVBhcnNlci5wcm90b3R5cGUucGFyc2UgPSBmdW5jdGlvbihzY2hlbWEpe1xuXHQvLyB0aGUgdG9wIGxldmVsIHNjaGVtYSBpcyBqdXN0IHRoZSB0b3AgbGV2ZWwgcGFydHMgYXJyYXlcblx0dGhpcy5wYXJzZVBhcnRzKHRoaXMub3V0cHV0LCBzY2hlbWEpO1x0XG5cdHJldHVybiB0aGlzLm91dHB1dDtcbn07XG5cbi8vIHBhcnNlIGEgc2V0IG9mIGhpZXJhcmNoeSBwYXJ0cyBwcm92aWRpbmcgdGhlIHBhcmVudCBvYmplY3QsIGFuZCB0aGUgc3Vic2NoZW1hXG5EYXRhUGFyc2VyLnByb3RvdHlwZS5wYXJzZVBhcnRzID0gZnVuY3Rpb24ob2JqLCBzY2hlbWEpe1xuXHRmb3IodmFyIGk9MDsgaTxzY2hlbWEubGVuZ3RoOyBpKyspe1xuXHRcdHZhciBwYXJ0ID0gc2NoZW1hW2ldO1xuXHRcdHRoaXMucGFyc2VQYXJ0KG9iaiwgcGFydCk7IFxuXHR9XG59O1xuXG5EYXRhUGFyc2VyLnByb3RvdHlwZS5wYXJzZVBhcnQgPSBmdW5jdGlvbihvYmosIHBhcnQpe1xuXHR2YXIgbmFtZSA9IHBhcnQubGFiZWw7XG5cdHZhciB2YWx1ZTtcblxuXHQvLyBtYWtlIHN1cmUgdGhlIHBhcnQgbWVldHMgYW55IHBhcnNlIHJlcXVpcmVtZW50c1xuXHRpZihwYXJ0LnJlcXVpcmVzICYmICEgcGFydC5yZXF1aXJlcyh0aGlzLnN0cmVhbSwgdGhpcy5vdXRwdXQsIG9iaikpe1xuXHRcdHJldHVybjtcblx0fVxuXHRcblx0aWYocGFydC5sb29wKXtcblx0XHQvLyBjcmVhdGUgYSBwYXJzZSBsb29wIG92ZXIgdGhlIHBhcnRzXG5cdFx0dmFyIGl0ZW1zID0gW107XG5cdFx0d2hpbGUocGFydC5sb29wKHRoaXMuc3RyZWFtKSl7XG5cdFx0XHR2YXIgaXRlbSA9IHt9O1xuXHRcdFx0dGhpcy5wYXJzZVBhcnRzKGl0ZW0sIHBhcnQucGFydHMpO1xuXHRcdFx0aXRlbXMucHVzaChpdGVtKTtcblx0XHR9XG5cdFx0b2JqW25hbWVdID0gaXRlbXM7XG5cdH1lbHNlIGlmKHBhcnQucGFydHMpe1xuXHRcdC8vIHByb2Nlc3MgYW55IGNoaWxkIHBhcnRzXG5cdFx0dmFsdWUgPSB7fTtcblx0XHR0aGlzLnBhcnNlUGFydHModmFsdWUsIHBhcnQucGFydHMpO1xuXHRcdG9ialtuYW1lXSA9IHZhbHVlO1xuXHR9ZWxzZSBpZihwYXJ0LnBhcnNlcil7XG5cdFx0Ly8gcGFyc2UgdGhlIHZhbHVlIHVzaW5nIGEgcGFyc2VyXG5cdFx0dmFsdWUgPSBwYXJ0LnBhcnNlcih0aGlzLnN0cmVhbSwgdGhpcy5vdXRwdXQsIG9iaik7XG5cdFx0aWYoIXBhcnQuc2tpcCl7XG5cdFx0XHRvYmpbbmFtZV0gPSB2YWx1ZTtcblx0XHR9XG5cdH1lbHNlIGlmKHBhcnQuYml0cyl7XG5cdFx0Ly8gY29udmVydCB0aGUgbmV4dCBieXRlIHRvIGEgc2V0IG9mIGJpdCBmaWVsZHNcblx0XHRvYmpbbmFtZV0gPSB0aGlzLnBhcnNlQml0cyhwYXJ0LmJpdHMpO1xuXHR9XG59O1xuXG4vLyBjb21iaW5lIGJpdHMgdG8gY2FsY3VsYXRlIHZhbHVlXG5mdW5jdGlvbiBiaXRzVG9OdW0oYml0QXJyYXkpe1xuXHRyZXR1cm4gYml0QXJyYXkucmVkdWNlKGZ1bmN0aW9uKHMsIG4pIHsgcmV0dXJuIHMgKiAyICsgbjsgfSwgMCk7XG59XG5cbi8vIHBhcnNlIGEgYnl0ZSBhcyBhIGJpdCBzZXQgKGZsYWdzIGFuZCB2YWx1ZXMpXG5EYXRhUGFyc2VyLnByb3RvdHlwZS5wYXJzZUJpdHMgPSBmdW5jdGlvbihkZXRhaWxzKXtcblx0dmFyIG91dCA9IHt9O1xuXHR2YXIgYml0cyA9IHRoaXMuc3RyZWFtLnJlYWRCaXRBcnJheSgpO1xuXHRmb3IodmFyIGtleSBpbiBkZXRhaWxzKXtcblx0XHR2YXIgaXRlbSA9IGRldGFpbHNba2V5XTtcblx0XHRpZihpdGVtLmxlbmd0aCl7XG5cdFx0XHQvLyBjb252ZXJ0IHRoZSBiaXQgc2V0IHRvIHZhbHVlXG5cdFx0XHRvdXRba2V5XSA9IGJpdHNUb051bShiaXRzLnNsaWNlKGl0ZW0uaW5kZXgsIGl0ZW0uaW5kZXggKyBpdGVtLmxlbmd0aCkpO1xuXHRcdH1lbHNle1xuXHRcdFx0b3V0W2tleV0gPSBiaXRzW2l0ZW0uaW5kZXhdO1xuXHRcdH1cblx0fVxuXHRyZXR1cm4gb3V0O1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBEYXRhUGFyc2VyOyIsIlxuLy8gYSBzZXQgb2YgY29tbW9uIHBhcnNlcnMgdXNlZCB3aXRoIERhdGFQYXJzZXJcblxudmFyIFBhcnNlcnMgPSB7XG5cdC8vIHJlYWQgYSBieXRlXG5cdHJlYWRCeXRlOiBmdW5jdGlvbigpe1xuXHRcdHJldHVybiBmdW5jdGlvbihzdHJlYW0pe1xuXHRcdFx0cmV0dXJuIHN0cmVhbS5yZWFkQnl0ZSgpO1xuXHRcdH07XG5cdH0sXG5cdC8vIHJlYWQgYW4gYXJyYXkgb2YgYnl0ZXNcblx0cmVhZEJ5dGVzOiBmdW5jdGlvbihsZW5ndGgpe1xuXHRcdHJldHVybiBmdW5jdGlvbihzdHJlYW0pe1xuXHRcdFx0cmV0dXJuIHN0cmVhbS5yZWFkQnl0ZXMobGVuZ3RoKTtcblx0XHR9O1xuXHR9LFxuXHQvLyByZWFkIGEgc3RyaW5nIGZyb20gYnl0ZXNcblx0cmVhZFN0cmluZzogZnVuY3Rpb24obGVuZ3RoKXtcblx0XHRyZXR1cm4gZnVuY3Rpb24oc3RyZWFtKXtcblx0XHRcdHJldHVybiBzdHJlYW0ucmVhZFN0cmluZyhsZW5ndGgpO1xuXHRcdH07XG5cdH0sXG5cdC8vIHJlYWQgYW4gdW5zaWduZWQgaW50ICh3aXRoIGVuZGlhbilcblx0cmVhZFVuc2lnbmVkOiBmdW5jdGlvbihsaXR0bGVFbmRpYW4pe1xuXHRcdHJldHVybiBmdW5jdGlvbihzdHJlYW0pe1xuXHRcdFx0cmV0dXJuIHN0cmVhbS5yZWFkVW5zaWduZWQobGl0dGxlRW5kaWFuKTtcblx0XHR9O1xuXHR9LFxuXHQvLyByZWFkIGFuIGFycmF5IG9mIGJ5dGUgc2V0c1xuXHRyZWFkQXJyYXk6IGZ1bmN0aW9uKHNpemUsIGNvdW50RnVuYyl7XG5cdFx0cmV0dXJuIGZ1bmN0aW9uKHN0cmVhbSwgb2JqLCBwYXJlbnQpe1xuXHRcdFx0dmFyIGNvdW50ID0gY291bnRGdW5jKHN0cmVhbSwgb2JqLCBwYXJlbnQpO1xuXHRcdFx0dmFyIGFyciA9IG5ldyBBcnJheShjb3VudCk7XG5cdFx0XHRmb3IodmFyIGk9MDsgaTxjb3VudDsgaSsrKXtcblx0XHRcdFx0YXJyW2ldID0gc3RyZWFtLnJlYWRCeXRlcyhzaXplKTtcblx0XHRcdH1cblx0XHRcdHJldHVybiBhcnI7XG5cdFx0fTtcblx0fVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBQYXJzZXJzOyIsIi8vIGV4cG9ydCB3cmFwcGVyIGZvciBleHBvc2luZyBsaWJyYXJ5XG5cbnZhciBHSUYgPSB3aW5kb3cuR0lGIHx8IHt9O1xuXG5HSUYgPSByZXF1aXJlKCcuL2dpZicpO1xuXG53aW5kb3cuR0lGID0gR0lGOyIsIlxuLy8gb2JqZWN0IHVzZWQgdG8gcmVwcmVzZW50IGFycmF5IGJ1ZmZlciBkYXRhIGZvciBhIGdpZiBmaWxlXG5cbnZhciBEYXRhUGFyc2VyID0gcmVxdWlyZSgnLi4vYm93ZXJfY29tcG9uZW50cy9qcy1iaW5hcnktc2NoZW1hLXBhcnNlci9zcmMvZGF0YXBhcnNlcicpO1xudmFyIGdpZlNjaGVtYSA9IHJlcXVpcmUoJy4vc2NoZW1hJyk7XG5cbmZ1bmN0aW9uIEdJRihhcnJheUJ1ZmZlcil7XG5cdC8vIGNvbnZlcnQgdG8gYnl0ZSBhcnJheVxuXHR2YXIgYnl0ZURhdGEgPSBuZXcgVWludDhBcnJheShhcnJheUJ1ZmZlcik7XG5cdHZhciBwYXJzZXIgPSBuZXcgRGF0YVBhcnNlcihieXRlRGF0YSk7XG5cdC8vIHBhcnNlIHRoZSBkYXRhXG5cdHRoaXMucmF3ID0gcGFyc2VyLnBhcnNlKGdpZlNjaGVtYSk7XG5cblx0Ly8gc2V0IGEgZmxhZyB0byBtYWtlIHN1cmUgdGhlIGdpZiBjb250YWlucyBhdCBsZWFzdCBvbmUgaW1hZ2Vcblx0dGhpcy5yYXcuaGFzSW1hZ2VzID0gZmFsc2U7XG5cdGZvcih2YXIgZj0wOyBmPHRoaXMucmF3LmZyYW1lcy5sZW5ndGg7IGYrKyl7XG5cdFx0aWYodGhpcy5yYXcuZnJhbWVzW2ZdLmltYWdlKXtcblx0XHRcdHRoaXMucmF3Lmhhc0ltYWdlcyA9IHRydWU7XG5cdFx0XHRicmVhaztcblx0XHR9XG5cdH1cbn1cblxuLy8gcHJvY2VzcyBhIHNpbmdsZSBnaWYgaW1hZ2UgZnJhbWVzIGRhdGEsIGRlY29tcHJlc3NpbmcgaXQgdXNpbmcgTFpXIFxuLy8gaWYgYnVpbGRQYXRjaCBpcyB0cnVlLCB0aGUgcmV0dXJuZWQgaW1hZ2Ugd2lsbCBiZSBhIGNsYW1wZWQgOCBiaXQgaW1hZ2UgcGF0Y2hcbi8vIGZvciB1c2UgZGlyZWN0bHkgd2l0aCBhIGNhbnZhcy5cbkdJRi5wcm90b3R5cGUuZGVjb21wcmVzc0ZyYW1lID0gZnVuY3Rpb24oaW5kZXgsIGJ1aWxkUGF0Y2gpe1xuXG5cdC8vIG1ha2Ugc3VyZSBhIHZhbGlkIGZyYW1lIGlzIHJlcXVlc3RlZFxuXHRpZihpbmRleCA+PSB0aGlzLnJhdy5mcmFtZXMubGVuZ3RoKXsgcmV0dXJuIG51bGw7IH1cblxuXHR2YXIgZnJhbWUgPSB0aGlzLnJhdy5mcmFtZXNbaW5kZXhdO1xuXHRpZihmcmFtZS5pbWFnZSl7XG5cdFx0Ly8gZ2V0IHRoZSBudW1iZXIgb2YgcGl4ZWxzXG5cdFx0dmFyIHRvdGFsUGl4ZWxzID0gZnJhbWUuaW1hZ2UuZGVzY3JpcHRvci53aWR0aCAqIGZyYW1lLmltYWdlLmRlc2NyaXB0b3IuaGVpZ2h0O1xuXG5cdFx0Ly8gZG8gbHp3IGRlY29tcHJlc3Npb25cblx0XHR2YXIgcGl4ZWxzID0gbHp3KGZyYW1lLmltYWdlLmRhdGEubWluQ29kZVNpemUsIGZyYW1lLmltYWdlLmRhdGEuYmxvY2tzLCB0b3RhbFBpeGVscyk7XG5cblx0XHQvLyBkZWFsIHdpdGggaW50ZXJsYWNpbmcgaWYgbmVjZXNzYXJ5XG5cdFx0aWYoZnJhbWUuaW1hZ2UuZGVzY3JpcHRvci5sY3QuaW50ZXJsYWNlZCl7XG5cdFx0XHRwaXhlbHMgPSBkZWludGVybGFjZShwaXhlbHMsIGZyYW1lLmltYWdlLmRlc2NyaXB0b3Iud2lkdGgpO1xuXHRcdH1cblxuXHRcdC8vIHNldHVwIHVzYWJsZSBpbWFnZSBvYmplY3Rcblx0XHR2YXIgaW1hZ2UgPSB7XG5cdFx0XHRwaXhlbHM6IHBpeGVscyxcblx0XHRcdGRpbXM6IHtcblx0XHRcdFx0dG9wOiBmcmFtZS5pbWFnZS5kZXNjcmlwdG9yLnRvcCxcblx0XHRcdFx0bGVmdDogZnJhbWUuaW1hZ2UuZGVzY3JpcHRvci5sZWZ0LFxuXHRcdFx0XHR3aWR0aDogZnJhbWUuaW1hZ2UuZGVzY3JpcHRvci53aWR0aCxcblx0XHRcdFx0aGVpZ2h0OiBmcmFtZS5pbWFnZS5kZXNjcmlwdG9yLmhlaWdodFxuXHRcdFx0fVxuXHRcdH07XG5cblx0XHQvLyBjb2xvciB0YWJsZVxuXHRcdGlmKGZyYW1lLmltYWdlLmRlc2NyaXB0b3IubGN0ICYmIGZyYW1lLmltYWdlLmRlc2NyaXB0b3IubGN0LmV4aXN0cyl7XG5cdFx0XHRpbWFnZS5jb2xvclRhYmxlID0gZnJhbWUuaW1hZ2UubGN0O1xuXHRcdH1lbHNle1xuXHRcdFx0aW1hZ2UuY29sb3JUYWJsZSA9IHRoaXMucmF3LmdjdDtcblx0XHR9XG5cblx0XHQvLyBhZGQgcGVyIGZyYW1lIHJlbGV2YW50IGdjZSBpbmZvcm1hdGlvblxuXHRcdGlmKGZyYW1lLmdjZSl7XG5cdFx0XHRpbWFnZS5kZWxheSA9IChmcmFtZS5nY2UuZGVsYXkgfHwgMTApICogMTA7IC8vIGNvbnZlcnQgdG8gbXNcblx0XHRcdGltYWdlLmRpc3Bvc2FsVHlwZSA9IGZyYW1lLmdjZS5leHRyYXMuZGlzcG9zYWw7XG5cdFx0XHQvLyB0cmFuc3BhcmVuY3lcblx0XHRcdGlmKGZyYW1lLmdjZS5leHRyYXMudHJhbnNwYXJlbnRDb2xvckdpdmVuKXtcblx0XHRcdFx0aW1hZ2UudHJhbnNwYXJlbnRJbmRleCA9IGZyYW1lLmdjZS50cmFuc3BhcmVudENvbG9ySW5kZXg7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0Ly8gY3JlYXRlIGNhbnZhcyB1c2FibGUgaW1hZ2VkYXRhIGlmIGRlc2lyZWRcblx0XHRpZihidWlsZFBhdGNoKXtcblx0XHRcdGltYWdlLnBhdGNoID0gZ2VuZXJhdGVQYXRjaChpbWFnZSk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGltYWdlO1x0XHRcblx0fVxuXG5cdC8vIGZyYW1lIGRvZXMgbm90IGNvbnRhaW5zIGltYWdlXG5cdHJldHVybiBudWxsO1xuXG5cblx0LyoqXG5cdCAqIGphdmFzY3JpcHQgcG9ydCBvZiBqYXZhIExaVyBkZWNvbXByZXNzaW9uXG5cdCAqIE9yaWdpbmFsIGphdmEgYXV0aG9yIHVybDogaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vZGV2dW53aXJlZC80NDc5MjMxXG5cdCAqL1x0XG5cdGZ1bmN0aW9uIGx6dyhtaW5Db2RlU2l6ZSwgZGF0YSwgcGl4ZWxDb3VudCkge1xuIFx0XHRcbiBcdFx0dmFyIE1BWF9TVEFDS19TSVpFID0gNDA5Njtcblx0XHR2YXIgbnVsbENvZGUgPSAtMTtcblxuXHRcdHZhciBucGl4ID0gcGl4ZWxDb3VudDtcblx0XHR2YXIgYXZhaWxhYmxlLCBjbGVhciwgY29kZV9tYXNrLCBjb2RlX3NpemUsIGVuZF9vZl9pbmZvcm1hdGlvbiwgaW5fY29kZSwgb2xkX2NvZGUsIGJpdHMsIGNvZGUsIGksIGRhdHVtLCBkYXRhX3NpemUsIGZpcnN0LCB0b3AsIGJpLCBwaTtcbiBcbiBcdFx0dmFyIGRzdFBpeGVscyA9IG5ldyBBcnJheShwaXhlbENvdW50KTtcblx0XHR2YXIgcHJlZml4ID0gbmV3IEFycmF5KE1BWF9TVEFDS19TSVpFKTtcblx0XHR2YXIgc3VmZml4ID0gbmV3IEFycmF5KE1BWF9TVEFDS19TSVpFKTtcblx0XHR2YXIgcGl4ZWxTdGFjayA9IG5ldyBBcnJheShNQVhfU1RBQ0tfU0laRSArIDEpO1xuIFxuXHRcdC8vIEluaXRpYWxpemUgR0lGIGRhdGEgc3RyZWFtIGRlY29kZXIuXG5cdFx0ZGF0YV9zaXplID0gbWluQ29kZVNpemU7XG5cdFx0Y2xlYXIgPSAxIDw8IGRhdGFfc2l6ZTtcblx0XHRlbmRfb2ZfaW5mb3JtYXRpb24gPSBjbGVhciArIDE7XG5cdFx0YXZhaWxhYmxlID0gY2xlYXIgKyAyO1xuXHRcdG9sZF9jb2RlID0gbnVsbENvZGU7XG5cdFx0Y29kZV9zaXplID0gZGF0YV9zaXplICsgMTtcblx0XHRjb2RlX21hc2sgPSAoMSA8PCBjb2RlX3NpemUpIC0gMTtcblx0XHRmb3IgKGNvZGUgPSAwOyBjb2RlIDwgY2xlYXI7IGNvZGUrKykge1xuXHRcdFx0cHJlZml4W2NvZGVdID0gMDtcblx0XHRcdHN1ZmZpeFtjb2RlXSA9IGNvZGU7XG5cdFx0fVxuIFxuXHRcdC8vIERlY29kZSBHSUYgcGl4ZWwgc3RyZWFtLlxuXHRcdGRhdHVtID0gYml0cyA9IGNvdW50ID0gZmlyc3QgPSB0b3AgPSBwaSA9IGJpID0gMDtcblx0XHRmb3IgKGkgPSAwOyBpIDwgbnBpeDsgKSB7XG5cdFx0XHRpZiAodG9wID09PSAwKSB7XG5cdFx0XHRcdGlmIChiaXRzIDwgY29kZV9zaXplKSB7XG5cdFx0XHRcdFx0XG5cdFx0XHRcdFx0Ly8gZ2V0IHRoZSBuZXh0IGJ5dGVcdFx0XHRcblx0XHRcdFx0XHRkYXR1bSArPSBkYXRhW2JpXSA8PCBiaXRzO1xuXG5cdFx0XHRcdFx0Yml0cyArPSA4O1xuXHRcdFx0XHRcdGJpKys7XG5cdFx0XHRcdFx0Y29udGludWU7XG5cdFx0XHRcdH1cblx0XHRcdFx0Ly8gR2V0IHRoZSBuZXh0IGNvZGUuXG5cdFx0XHRcdGNvZGUgPSBkYXR1bSAmIGNvZGVfbWFzaztcblx0XHRcdFx0ZGF0dW0gPj49IGNvZGVfc2l6ZTtcblx0XHRcdFx0Yml0cyAtPSBjb2RlX3NpemU7XG5cdFx0XHRcdC8vIEludGVycHJldCB0aGUgY29kZVxuXHRcdFx0XHRpZiAoKGNvZGUgPiBhdmFpbGFibGUpIHx8IChjb2RlID09IGVuZF9vZl9pbmZvcm1hdGlvbikpIHtcblx0XHRcdFx0XHRicmVhaztcblx0XHRcdFx0fVxuXHRcdFx0XHRpZiAoY29kZSA9PSBjbGVhcikge1xuXHRcdFx0XHRcdC8vIFJlc2V0IGRlY29kZXIuXG5cdFx0XHRcdFx0Y29kZV9zaXplID0gZGF0YV9zaXplICsgMTtcblx0XHRcdFx0XHRjb2RlX21hc2sgPSAoMSA8PCBjb2RlX3NpemUpIC0gMTtcblx0XHRcdFx0XHRhdmFpbGFibGUgPSBjbGVhciArIDI7XG5cdFx0XHRcdFx0b2xkX2NvZGUgPSBudWxsQ29kZTtcblx0XHRcdFx0XHRjb250aW51ZTtcblx0XHRcdFx0fVxuXHRcdFx0XHRpZiAob2xkX2NvZGUgPT0gbnVsbENvZGUpIHtcblx0XHRcdFx0XHRwaXhlbFN0YWNrW3RvcCsrXSA9IHN1ZmZpeFtjb2RlXTtcblx0XHRcdFx0XHRvbGRfY29kZSA9IGNvZGU7XG5cdFx0XHRcdFx0Zmlyc3QgPSBjb2RlO1xuXHRcdFx0XHRcdGNvbnRpbnVlO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGluX2NvZGUgPSBjb2RlO1xuXHRcdFx0XHRpZiAoY29kZSA9PSBhdmFpbGFibGUpIHtcblx0XHRcdFx0XHRwaXhlbFN0YWNrW3RvcCsrXSA9IGZpcnN0O1xuXHRcdFx0XHRcdGNvZGUgPSBvbGRfY29kZTtcblx0XHRcdFx0fVxuXHRcdFx0XHR3aGlsZSAoY29kZSA+IGNsZWFyKSB7XG5cdFx0XHRcdFx0cGl4ZWxTdGFja1t0b3ArK10gPSBzdWZmaXhbY29kZV07XG5cdFx0XHRcdFx0Y29kZSA9IHByZWZpeFtjb2RlXTtcblx0XHRcdFx0fVxuXHRcdFx0XHRcblx0XHRcdFx0Zmlyc3QgPSBzdWZmaXhbY29kZV0gJiAweGZmO1xuXHRcdFx0XHRwaXhlbFN0YWNrW3RvcCsrXSA9IGZpcnN0O1xuXG5cdFx0XHRcdC8vIGFkZCBhIG5ldyBzdHJpbmcgdG8gdGhlIHRhYmxlLCBidXQgb25seSBpZiBzcGFjZSBpcyBhdmFpbGFibGVcblx0XHRcdFx0Ly8gaWYgbm90LCBqdXN0IGNvbnRpbnVlIHdpdGggY3VycmVudCB0YWJsZSB1bnRpbCBhIGNsZWFyIGNvZGUgaXMgZm91bmRcblx0XHRcdFx0Ly8gKGRlZmVycmVkIGNsZWFyIGNvZGUgaW1wbGVtZW50YXRpb24gYXMgcGVyIEdJRiBzcGVjKVxuXHRcdFx0XHRpZihhdmFpbGFibGUgPCBNQVhfU1RBQ0tfU0laRSl7XG5cdFx0XHRcdFx0cHJlZml4W2F2YWlsYWJsZV0gPSBvbGRfY29kZTtcblx0XHRcdFx0XHRzdWZmaXhbYXZhaWxhYmxlXSA9IGZpcnN0O1xuXHRcdFx0XHRcdGF2YWlsYWJsZSsrO1xuXHRcdFx0XHRcdGlmICgoKGF2YWlsYWJsZSAmIGNvZGVfbWFzaykgPT09IDApICYmIChhdmFpbGFibGUgPCBNQVhfU1RBQ0tfU0laRSkpIHtcblx0XHRcdFx0XHRcdGNvZGVfc2l6ZSsrO1xuXHRcdFx0XHRcdFx0Y29kZV9tYXNrICs9IGF2YWlsYWJsZTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdFx0b2xkX2NvZGUgPSBpbl9jb2RlO1xuXHRcdFx0fVxuXHRcdFx0Ly8gUG9wIGEgcGl4ZWwgb2ZmIHRoZSBwaXhlbCBzdGFjay5cblx0XHRcdHRvcC0tO1xuXHRcdFx0ZHN0UGl4ZWxzW3BpKytdID0gcGl4ZWxTdGFja1t0b3BdO1xuXHRcdFx0aSsrO1xuXHRcdH1cblxuXHRcdGZvciAoaSA9IHBpOyBpIDwgbnBpeDsgaSsrKSB7XG5cdFx0XHRkc3RQaXhlbHNbaV0gPSAwOyAvLyBjbGVhciBtaXNzaW5nIHBpeGVsc1xuXHRcdH1cblxuXHRcdHJldHVybiBkc3RQaXhlbHM7XG5cdH1cblxuXHQvLyBkZWludGVybGFjZSBmdW5jdGlvbiBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9zaGFjaGFmL2pzZ2lmXG5cdGZ1bmN0aW9uIGRlaW50ZXJsYWNlKHBpeGVscywgd2lkdGgpIHtcblx0XHRcblx0XHR2YXIgbmV3UGl4ZWxzID0gbmV3IEFycmF5KHBpeGVscy5sZW5ndGgpO1xuXHRcdHZhciByb3dzID0gcGl4ZWxzLmxlbmd0aCAvIHdpZHRoO1xuXHRcdHZhciBjcFJvdyA9IGZ1bmN0aW9uKHRvUm93LCBmcm9tUm93KSB7XG5cdFx0XHR2YXIgZnJvbVBpeGVscyA9IHBpeGVscy5zbGljZShmcm9tUm93ICogd2lkdGgsIChmcm9tUm93ICsgMSkgKiB3aWR0aCk7XG5cdFx0XHRuZXdQaXhlbHMuc3BsaWNlLmFwcGx5KG5ld1BpeGVscywgW3RvUm93ICogd2lkdGgsIHdpZHRoXS5jb25jYXQoZnJvbVBpeGVscykpO1xuXHRcdH07XG5cblx0XHQvLyBTZWUgYXBwZW5kaXggRS5cblx0XHR2YXIgb2Zmc2V0cyA9IFswLDQsMiwxXTtcblx0XHR2YXIgc3RlcHMgICA9IFs4LDgsNCwyXTtcblxuXHRcdHZhciBmcm9tUm93ID0gMDtcblx0XHRmb3IgKHZhciBwYXNzID0gMDsgcGFzcyA8IDQ7IHBhc3MrKykge1xuXHRcdFx0Zm9yICh2YXIgdG9Sb3cgPSBvZmZzZXRzW3Bhc3NdOyB0b1JvdyA8IHJvd3M7IHRvUm93ICs9IHN0ZXBzW3Bhc3NdKSB7XG5cdFx0XHRcdGNwUm93KHRvUm93LCBmcm9tUm93KTtcblx0XHRcdFx0ZnJvbVJvdysrO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiBuZXdQaXhlbHM7XG5cdH1cblxuXHQvLyBjcmVhdGUgYSBjbGFtcGVkIGJ5dGUgYXJyYXkgcGF0Y2ggZm9yIHRoZSBmcmFtZSBpbWFnZSB0byBiZSB1c2VkIGRpcmVjdGx5IHdpdGggYSBjYW52YXNcblx0Ly8gVE9ETzogY291bGQgcG90ZW50aWFsbHkgc3F1ZWV6ZSBzb21lIHBlcmZvcm1hbmNlIGJ5IGRvaW5nIGEgZGlyZWN0IDMyYml0IHdyaXRlIHBlciBpdGVyYXRpb25cblx0ZnVuY3Rpb24gZ2VuZXJhdGVQYXRjaChpbWFnZSl7XG5cblx0XHR2YXIgdG90YWxQaXhlbHMgPSBpbWFnZS5waXhlbHMubGVuZ3RoO1xuXHRcdHZhciBwYXRjaERhdGEgPSBuZXcgVWludDhDbGFtcGVkQXJyYXkodG90YWxQaXhlbHMgKiA0KTtcblx0XHRmb3IodmFyIGk9MDsgaTx0b3RhbFBpeGVsczsgaSsrKXtcblx0XHRcdHZhciBwb3MgPSBpICogNDtcblx0XHRcdHZhciBjb2xvckluZGV4ID0gaW1hZ2UucGl4ZWxzW2ldO1xuXHRcdFx0dmFyIGNvbG9yID0gaW1hZ2UuY29sb3JUYWJsZVtjb2xvckluZGV4XTtcblx0XHRcdHBhdGNoRGF0YVtwb3NdID0gY29sb3JbMF07XG5cdFx0XHRwYXRjaERhdGFbcG9zICsgMV0gPSBjb2xvclsxXTtcblx0XHRcdHBhdGNoRGF0YVtwb3MgKyAyXSA9IGNvbG9yWzJdO1xuXHRcdFx0cGF0Y2hEYXRhW3BvcyArIDNdID0gY29sb3JJbmRleCAhPT0gaW1hZ2UudHJhbnNwYXJlbnRJbmRleCA/IDI1NSA6IDA7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHBhdGNoRGF0YTtcblx0fVxufTtcblxuLy8gcmV0dXJucyBhbGwgZnJhbWVzIGRlY29tcHJlc3NlZFxuR0lGLnByb3RvdHlwZS5kZWNvbXByZXNzRnJhbWVzID0gZnVuY3Rpb24oYnVpbGRQYXRjaCwgc3RhcnRGcmFtZSwgZW5kRnJhbWUpe1xuXHRpZiAoc3RhcnRGcmFtZSA9PT0gdW5kZWZpbmVkKSB7XG5cdFx0c3RhcnRGcmFtZSA9IDA7XG5cdH1cblx0aWYgKGVuZEZyYW1lID09PSB1bmRlZmluZWQpIHtcblx0XHRlbmRGcmFtZSA9IHRoaXMucmF3LmZyYW1lcy5sZW5ndGg7XG5cdH0gZWxzZSB7XG5cdFx0ZW5kRnJhbWUgPSBNYXRoLm1pbihlbmRGcmFtZSwgdGhpcy5yYXcuZnJhbWVzLmxlbmd0aCk7XG5cdH1cblx0dmFyIGZyYW1lcyA9IFtdO1xuXHRmb3IgKHZhciBpID0gc3RhcnRGcmFtZTsgaSA8IGVuZEZyYW1lOyBpKyspIHtcblx0XHR2YXIgZnJhbWUgPSB0aGlzLnJhdy5mcmFtZXNbaV07XG5cdFx0aWYgKGZyYW1lLmltYWdlKSB7XG5cdFx0XHRmcmFtZXMucHVzaCh0aGlzLmRlY29tcHJlc3NGcmFtZShpLCBidWlsZFBhdGNoKSk7XG5cdFx0fVxuXHR9XG5cdHJldHVybiBmcmFtZXM7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEdJRjsiLCJcbi8vIFNjaGVtYSBmb3IgdGhlIGpzIGZpbGUgcGFyc2VyIHRvIHVzZSB0byBwYXJzZSBnaWYgZmlsZXNcbi8vIEZvciBqcyBvYmplY3QgY29udmVuaWVuY2UgKHJlLXVzZSksIHRoZSBzY2hlbWEgb2JqZWN0cyBhcmUgYXBwcm94aW1hdGVseSByZXZlcnNlIG9yZGVyZWRcblxuLy8gY29tbW9uIHBhcnNlcnMgYXZhaWxhYmxlXG52YXIgUGFyc2VycyA9IHJlcXVpcmUoJy4uL2Jvd2VyX2NvbXBvbmVudHMvanMtYmluYXJ5LXNjaGVtYS1wYXJzZXIvc3JjL3BhcnNlcnMnKTtcblxuLy8gYSBzZXQgb2YgMHgwMCB0ZXJtaW5hdGVkIHN1YmJsb2Nrc1xudmFyIHN1YkJsb2NrcyA9IHtcblx0bGFiZWw6ICdibG9ja3MnLFxuXHRwYXJzZXI6IGZ1bmN0aW9uKHN0cmVhbSl7XG5cdFx0dmFyIHZpZXdzID0gW107XG5cdFx0dmFyIHRvdGFsID0gMDtcblx0XHR2YXIgdGVybWluYXRvciA9IDB4MDA7XHRcdFxuXHRcdGZvcih2YXIgc2l6ZT1zdHJlYW0ucmVhZEJ5dGUoKTsgc2l6ZSE9PXRlcm1pbmF0b3I7IHNpemU9c3RyZWFtLnJlYWRCeXRlKCkpe1xuXHRcdFx0dmlld3MucHVzaChzdHJlYW0ucmVhZEJ5dGVzKHNpemUpKTtcblx0XHRcdHRvdGFsICs9IHNpemU7XG5cdFx0fVxuXHRcdHZhciBvdXQgPSBuZXcgVWludDhBcnJheSh0b3RhbCk7XG5cdFx0dG90YWwgPSAwO1xuXHRcdGZvciAodmFyIGkgPSAwOyBpIDwgdmlld3MubGVuZ3RoOyBpKyspIHtcblx0XHRcdG91dC5zZXQodmlld3NbaV0sIHRvdGFsKTtcblx0XHRcdHRvdGFsICs9IHZpZXdzW2ldLmxlbmd0aDtcblx0XHR9XG5cdFx0cmV0dXJuIG91dDtcblx0fVxufTtcblxuLy8gZ2xvYmFsIGNvbnRyb2wgZXh0ZW5zaW9uXG52YXIgZ2NlID0ge1xuXHRsYWJlbDogJ2djZScsXG5cdHJlcXVpcmVzOiBmdW5jdGlvbihzdHJlYW0pe1xuXHRcdC8vIGp1c3QgcGVlayBhdCB0aGUgdG9wIHR3byBieXRlcywgYW5kIGlmIHRydWUgZG8gdGhpc1xuXHRcdHZhciBjb2RlcyA9IHN0cmVhbS5wZWVrQnl0ZXMoMik7XG5cdFx0cmV0dXJuIGNvZGVzWzBdID09PSAweDIxICYmIGNvZGVzWzFdID09PSAweEY5O1xuXHR9LFxuXHRwYXJ0czogW1xuXHRcdHsgbGFiZWw6ICdjb2RlcycsIHBhcnNlcjogUGFyc2Vycy5yZWFkQnl0ZXMoMiksIHNraXA6IHRydWUgfSxcblx0XHR7IGxhYmVsOiAnYnl0ZVNpemUnLCBwYXJzZXI6IFBhcnNlcnMucmVhZEJ5dGUoKSB9LFxuXHRcdHsgbGFiZWw6ICdleHRyYXMnLCBiaXRzOiB7XG5cdFx0XHRmdXR1cmU6IHsgaW5kZXg6IDAsIGxlbmd0aDogMyB9LFxuXHRcdFx0ZGlzcG9zYWw6IHsgaW5kZXg6IDMsIGxlbmd0aDogMyB9LFxuXHRcdFx0dXNlcklucHV0OiB7IGluZGV4OiA2IH0sXG5cdFx0XHR0cmFuc3BhcmVudENvbG9yR2l2ZW46IHsgaW5kZXg6IDcgfVxuXHRcdH19LFxuXHRcdHsgbGFiZWw6ICdkZWxheScsIHBhcnNlcjogUGFyc2Vycy5yZWFkVW5zaWduZWQodHJ1ZSkgfSxcblx0XHR7IGxhYmVsOiAndHJhbnNwYXJlbnRDb2xvckluZGV4JywgcGFyc2VyOiBQYXJzZXJzLnJlYWRCeXRlKCkgfSxcblx0XHR7IGxhYmVsOiAndGVybWluYXRvcicsIHBhcnNlcjogUGFyc2Vycy5yZWFkQnl0ZSgpLCBza2lwOiB0cnVlIH1cblx0XVxufTtcblxuLy8gaW1hZ2UgcGlwZWxpbmUgYmxvY2tcbnZhciBpbWFnZSA9IHtcblx0bGFiZWw6ICdpbWFnZScsXG5cdHJlcXVpcmVzOiBmdW5jdGlvbihzdHJlYW0pe1xuXHRcdC8vIHBlZWsgYXQgdGhlIG5leHQgYnl0ZVxuXHRcdHZhciBjb2RlID0gc3RyZWFtLnBlZWtCeXRlKCk7XG5cdFx0cmV0dXJuIGNvZGUgPT09IDB4MkM7XG5cdH0sXG5cdHBhcnRzOiBbXG5cdFx0eyBsYWJlbDogJ2NvZGUnLCBwYXJzZXI6IFBhcnNlcnMucmVhZEJ5dGUoKSwgc2tpcDogdHJ1ZSB9LFxuXHRcdHtcblx0XHRcdGxhYmVsOiAnZGVzY3JpcHRvcicsIC8vIGltYWdlIGRlc2NyaXB0b3Jcblx0XHRcdHBhcnRzOiBbXG5cdFx0XHRcdHsgbGFiZWw6ICdsZWZ0JywgcGFyc2VyOiBQYXJzZXJzLnJlYWRVbnNpZ25lZCh0cnVlKSB9LFxuXHRcdFx0XHR7IGxhYmVsOiAndG9wJywgcGFyc2VyOiBQYXJzZXJzLnJlYWRVbnNpZ25lZCh0cnVlKSB9LFxuXHRcdFx0XHR7IGxhYmVsOiAnd2lkdGgnLCBwYXJzZXI6IFBhcnNlcnMucmVhZFVuc2lnbmVkKHRydWUpIH0sXG5cdFx0XHRcdHsgbGFiZWw6ICdoZWlnaHQnLCBwYXJzZXI6IFBhcnNlcnMucmVhZFVuc2lnbmVkKHRydWUpIH0sXG5cdFx0XHRcdHsgbGFiZWw6ICdsY3QnLCBiaXRzOiB7XG5cdFx0XHRcdFx0ZXhpc3RzOiB7IGluZGV4OiAwIH0sXG5cdFx0XHRcdFx0aW50ZXJsYWNlZDogeyBpbmRleDogMSB9LFxuXHRcdFx0XHRcdHNvcnQ6IHsgaW5kZXg6IDIgfSxcblx0XHRcdFx0XHRmdXR1cmU6IHsgaW5kZXg6IDMsIGxlbmd0aDogMiB9LFxuXHRcdFx0XHRcdHNpemU6IHsgaW5kZXg6IDUsIGxlbmd0aDogMyB9XG5cdFx0XHRcdH19XG5cdFx0XHRdXG5cdFx0fSx7XG5cdFx0XHRsYWJlbDogJ2xjdCcsIC8vIG9wdGlvbmFsIGxvY2FsIGNvbG9yIHRhYmxlXG5cdFx0XHRyZXF1aXJlczogZnVuY3Rpb24oc3RyZWFtLCBvYmosIHBhcmVudCl7XG5cdFx0XHRcdHJldHVybiBwYXJlbnQuZGVzY3JpcHRvci5sY3QuZXhpc3RzO1xuXHRcdFx0fSxcblx0XHRcdHBhcnNlcjogUGFyc2Vycy5yZWFkQXJyYXkoMywgZnVuY3Rpb24oc3RyZWFtLCBvYmosIHBhcmVudCl7XG5cdFx0XHRcdHJldHVybiBNYXRoLnBvdygyLCBwYXJlbnQuZGVzY3JpcHRvci5sY3Quc2l6ZSArIDEpO1xuXHRcdFx0fSlcblx0XHR9LHtcblx0XHRcdGxhYmVsOiAnZGF0YScsIC8vIHRoZSBpbWFnZSBkYXRhIGJsb2Nrc1xuXHRcdFx0cGFydHM6IFtcblx0XHRcdFx0eyBsYWJlbDogJ21pbkNvZGVTaXplJywgcGFyc2VyOiBQYXJzZXJzLnJlYWRCeXRlKCkgfSxcblx0XHRcdFx0c3ViQmxvY2tzXG5cdFx0XHRdXG5cdFx0fVxuXHRdXG59O1xuXG4vLyBwbGFpbiB0ZXh0IGJsb2NrXG52YXIgdGV4dCA9IHtcblx0bGFiZWw6ICd0ZXh0Jyxcblx0cmVxdWlyZXM6IGZ1bmN0aW9uKHN0cmVhbSl7XG5cdFx0Ly8ganVzdCBwZWVrIGF0IHRoZSB0b3AgdHdvIGJ5dGVzLCBhbmQgaWYgdHJ1ZSBkbyB0aGlzXG5cdFx0dmFyIGNvZGVzID0gc3RyZWFtLnBlZWtCeXRlcygyKTtcblx0XHRyZXR1cm4gY29kZXNbMF0gPT09IDB4MjEgJiYgY29kZXNbMV0gPT09IDB4MDE7XG5cdH0sXG5cdHBhcnRzOiBbXG5cdFx0eyBsYWJlbDogJ2NvZGVzJywgcGFyc2VyOiBQYXJzZXJzLnJlYWRCeXRlcygyKSwgc2tpcDogdHJ1ZSB9LFxuXHRcdHsgbGFiZWw6ICdibG9ja1NpemUnLCBwYXJzZXI6IFBhcnNlcnMucmVhZEJ5dGUoKSB9LFxuXHRcdHsgXG5cdFx0XHRsYWJlbDogJ3ByZURhdGEnLCBcblx0XHRcdHBhcnNlcjogZnVuY3Rpb24oc3RyZWFtLCBvYmosIHBhcmVudCl7XG5cdFx0XHRcdHJldHVybiBzdHJlYW0ucmVhZEJ5dGVzKHBhcmVudC50ZXh0LmJsb2NrU2l6ZSk7XG5cdFx0XHR9XG5cdFx0fSxcblx0XHRzdWJCbG9ja3Ncblx0XVxufTtcblxuLy8gYXBwbGljYXRpb24gYmxvY2tcbnZhciBhcHBsaWNhdGlvbiA9IHtcblx0bGFiZWw6ICdhcHBsaWNhdGlvbicsXG5cdHJlcXVpcmVzOiBmdW5jdGlvbihzdHJlYW0sIG9iaiwgcGFyZW50KXtcblx0XHQvLyBtYWtlIHN1cmUgdGhpcyBmcmFtZSBkb2Vzbid0IGFscmVhZHkgaGF2ZSBhIGdjZSwgdGV4dCwgY29tbWVudCwgb3IgaW1hZ2Vcblx0XHQvLyBhcyB0aGF0IG1lYW5zIHRoaXMgYmxvY2sgc2hvdWxkIGJlIGF0dGFjaGVkIHRvIHRoZSBuZXh0IGZyYW1lXG5cdFx0Ly9pZihwYXJlbnQuZ2NlIHx8IHBhcmVudC50ZXh0IHx8IHBhcmVudC5pbWFnZSB8fCBwYXJlbnQuY29tbWVudCl7IHJldHVybiBmYWxzZTsgfVxuXG5cdFx0Ly8gcGVlayBhdCB0aGUgdG9wIHR3byBieXRlc1xuXHRcdHZhciBjb2RlcyA9IHN0cmVhbS5wZWVrQnl0ZXMoMik7XG5cdFx0cmV0dXJuIGNvZGVzWzBdID09PSAweDIxICYmIGNvZGVzWzFdID09PSAweEZGO1xuXHR9LFxuXHRwYXJ0czogW1xuXHRcdHsgbGFiZWw6ICdjb2RlcycsIHBhcnNlcjogUGFyc2Vycy5yZWFkQnl0ZXMoMiksIHNraXA6IHRydWUgfSxcblx0XHR7IGxhYmVsOiAnYmxvY2tTaXplJywgcGFyc2VyOiBQYXJzZXJzLnJlYWRCeXRlKCkgfSxcblx0XHR7IFxuXHRcdFx0bGFiZWw6ICdpZCcsIFxuXHRcdFx0cGFyc2VyOiBmdW5jdGlvbihzdHJlYW0sIG9iaiwgcGFyZW50KXtcblx0XHRcdFx0cmV0dXJuIHN0cmVhbS5yZWFkU3RyaW5nKHBhcmVudC5ibG9ja1NpemUpO1xuXHRcdFx0fVxuXHRcdH0sXG5cdFx0c3ViQmxvY2tzXG5cdF1cbn07XG5cbi8vIGNvbW1lbnQgYmxvY2tcbnZhciBjb21tZW50ID0ge1xuXHRsYWJlbDogJ2NvbW1lbnQnLFxuXHRyZXF1aXJlczogZnVuY3Rpb24oc3RyZWFtLCBvYmosIHBhcmVudCl7XG5cdFx0Ly8gbWFrZSBzdXJlIHRoaXMgZnJhbWUgZG9lc24ndCBhbHJlYWR5IGhhdmUgYSBnY2UsIHRleHQsIGNvbW1lbnQsIG9yIGltYWdlXG5cdFx0Ly8gYXMgdGhhdCBtZWFucyB0aGlzIGJsb2NrIHNob3VsZCBiZSBhdHRhY2hlZCB0byB0aGUgbmV4dCBmcmFtZVxuXHRcdC8vaWYocGFyZW50LmdjZSB8fCBwYXJlbnQudGV4dCB8fCBwYXJlbnQuaW1hZ2UgfHwgcGFyZW50LmNvbW1lbnQpeyByZXR1cm4gZmFsc2U7IH1cblxuXHRcdC8vIHBlZWsgYXQgdGhlIHRvcCB0d28gYnl0ZXNcblx0XHR2YXIgY29kZXMgPSBzdHJlYW0ucGVla0J5dGVzKDIpO1xuXHRcdHJldHVybiBjb2Rlc1swXSA9PT0gMHgyMSAmJiBjb2Rlc1sxXSA9PT0gMHhGRTtcblx0fSxcblx0cGFydHM6IFtcblx0XHR7IGxhYmVsOiAnY29kZXMnLCBwYXJzZXI6IFBhcnNlcnMucmVhZEJ5dGVzKDIpLCBza2lwOiB0cnVlIH0sXG5cdFx0c3ViQmxvY2tzXG5cdF1cbn07XG5cbi8vIGZyYW1lcyBvZiBleHQgYW5kIGltYWdlIGRhdGFcbnZhciBmcmFtZXMgPSB7XG5cdGxhYmVsOiAnZnJhbWVzJyxcblx0cGFydHM6IFtcblx0XHRnY2UsXG5cdFx0YXBwbGljYXRpb24sXG5cdFx0Y29tbWVudCxcblx0XHRpbWFnZSxcblx0XHR0ZXh0XG5cdF0sXG5cdGxvb3A6IGZ1bmN0aW9uKHN0cmVhbSl7XG5cdFx0dmFyIG5leHRDb2RlID0gc3RyZWFtLnBlZWtCeXRlKCk7XG5cdFx0Ly8gcmF0aGVyIHRoYW4gY2hlY2sgZm9yIGEgdGVybWluYXRvciwgd2Ugc2hvdWxkIGNoZWNrIGZvciB0aGUgZXhpc3RlbmNlXG5cdFx0Ly8gb2YgYW4gZXh0IG9yIGltYWdlIGJsb2NrIHRvIGF2b2lkIGluZmluaXRlIGxvb3BzXG5cdFx0Ly92YXIgdGVybWluYXRvciA9IDB4M0I7XG5cdFx0Ly9yZXR1cm4gbmV4dENvZGUgIT09IHRlcm1pbmF0b3I7XG5cdFx0cmV0dXJuIG5leHRDb2RlID09PSAweDIxIHx8IG5leHRDb2RlID09PSAweDJDO1xuXHR9XG59O1xuXG4vLyBtYWluIEdJRiBzY2hlbWFcbnZhciBzY2hlbWFHSUYgPSBbXG5cdHtcblx0XHRsYWJlbDogJ2hlYWRlcicsIC8vIGdpZiBoZWFkZXJcblx0XHRwYXJ0czogW1xuXHRcdFx0eyBsYWJlbDogJ3NpZ25hdHVyZScsIHBhcnNlcjogUGFyc2Vycy5yZWFkU3RyaW5nKDMpIH0sXG5cdFx0XHR7IGxhYmVsOiAndmVyc2lvbicsIHBhcnNlcjogUGFyc2Vycy5yZWFkU3RyaW5nKDMpIH1cblx0XHRdXG5cdH0se1xuXHRcdGxhYmVsOiAnbHNkJywgLy8gbG9jYWwgc2NyZWVuIGRlc2NyaXB0b3Jcblx0XHRwYXJ0czogW1xuXHRcdFx0eyBsYWJlbDogJ3dpZHRoJywgcGFyc2VyOiBQYXJzZXJzLnJlYWRVbnNpZ25lZCh0cnVlKSB9LFxuXHRcdFx0eyBsYWJlbDogJ2hlaWdodCcsIHBhcnNlcjogUGFyc2Vycy5yZWFkVW5zaWduZWQodHJ1ZSkgfSxcblx0XHRcdHsgbGFiZWw6ICdnY3QnLCBiaXRzOiB7XG5cdFx0XHRcdGV4aXN0czogeyBpbmRleDogMCB9LFxuXHRcdFx0XHRyZXNvbHV0aW9uOiB7IGluZGV4OiAxLCBsZW5ndGg6IDMgfSxcblx0XHRcdFx0c29ydDogeyBpbmRleDogNCB9LFxuXHRcdFx0XHRzaXplOiB7IGluZGV4OiA1LCBsZW5ndGg6IDMgfVxuXHRcdFx0fX0sXG5cdFx0XHR7IGxhYmVsOiAnYmFja2dyb3VuZENvbG9ySW5kZXgnLCBwYXJzZXI6IFBhcnNlcnMucmVhZEJ5dGUoKSB9LFxuXHRcdFx0eyBsYWJlbDogJ3BpeGVsQXNwZWN0UmF0aW8nLCBwYXJzZXI6IFBhcnNlcnMucmVhZEJ5dGUoKSB9XG5cdFx0XVxuXHR9LHtcblx0XHRsYWJlbDogJ2djdCcsIC8vIGdsb2JhbCBjb2xvciB0YWJsZVxuXHRcdHJlcXVpcmVzOiBmdW5jdGlvbihzdHJlYW0sIG9iail7XG5cdFx0XHRyZXR1cm4gb2JqLmxzZC5nY3QuZXhpc3RzO1xuXHRcdH0sXG5cdFx0cGFyc2VyOiBQYXJzZXJzLnJlYWRBcnJheSgzLCBmdW5jdGlvbihzdHJlYW0sIG9iail7XG5cdFx0XHRyZXR1cm4gTWF0aC5wb3coMiwgb2JqLmxzZC5nY3Quc2l6ZSArIDEpO1xuXHRcdH0pXG5cdH0sXG5cdGZyYW1lcyAvLyBjb250ZW50IGZyYW1lc1xuXTtcblxubW9kdWxlLmV4cG9ydHMgPSBzY2hlbWFHSUY7Il19
