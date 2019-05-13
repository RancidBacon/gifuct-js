// user canvas
var c = document.getElementById('c');
var ctx = c.getContext('2d');
// gif patch canvas
var tempCanvas = document.createElement('canvas');
var tempCtx = tempCanvas.getContext('2d');
// full gif canvas
var gifCanvas = document.createElement('canvas');
var gifCtx = gifCanvas.getContext('2d');

var audioCtx = new (window.AudioContext || window.webkitAudioContext)();

var url = document.getElementById('url');
// default (audio!) gif
url.value = '/demo/audio-gif-sting.a.gif';

// load the default gif
loadGIF(url.value);
var gif;
var audio_pcm_data;


// load a gif from the supplied url value
function loadGIF(gifUrl){
        var oReq = new XMLHttpRequest();
        oReq.open("GET", gifUrl, true);
        oReq.responseType = "arraybuffer";

        oReq.onload = function (oEvent) {
            var arrayBuffer = oReq.response; // Note: not oReq.responseText
            if (arrayBuffer) {
                gif = new GIF(arrayBuffer);

                // TODO: Check AUDIOGIF header, version, type etc...
                audio_wav_data = new Uint8Array(gif.raw.frames[0].application.blocks.slice(1));
                audioCtx.decodeAudioData(audio_wav_data.buffer).then(function(decodedData){
                  console.log(decodedData);
                  audio_pcm_data = decodedData;
                });

                var frames = gif.decompressFrames(true);
                console.log(gif);
                // render the gif
                renderGIF(frames);
            }
        };

        oReq.send(null);
}

var playing = false;
var loadedFrames;
var frameIndex;

function playpause(){
        playing = !playing;
        if(playing){
                renderFrame();
        }
}

function renderGIF(frames){
        loadedFrames = frames;
        frameIndex = 0;

        c.width = frames[0].dims.width;
        c.height = frames[0].dims.height;

        gifCanvas.width = c.width;
        gifCanvas.height = c.height;

        if(!playing){
                playpause();
        }
}

var frameImageData;

function drawPatch(frame){
        var dims = frame.dims;

        if(!frameImageData || dims.width != frameImageData.width || dims.height != frameImageData.height){
                tempCanvas.width = dims.width;
                tempCanvas.height = dims.height;
                frameImageData = tempCtx.createImageData(dims.width, dims.height);
        }

        // set the patch data as an override
        frameImageData.data.set(frame.patch);

        // draw the patch back over the canvas
        tempCtx.putImageData(frameImageData, 0, 0);

        gifCtx.drawImage(tempCanvas, dims.left, dims.top);
}

function manipulate(){
        var imageData = gifCtx.getImageData(0, 0, gifCanvas.width, gifCanvas.height);

        ctx.putImageData(imageData, 0, 0);
}

function renderFrame(){
        // get the frame
        var frame = loadedFrames[frameIndex];

        var start = new Date().getTime();

        if (!(frame.hasOwnProperty("transparentIndex") && (frame.disposalType == 1))) {
            gifCtx.clearRect(0, 0, c.width, c.height);
        }

        // draw the patch
        drawPatch(frame);

        // perform manipulation
        manipulate();


        if ((frameIndex==0) && audio_pcm_data) {
            var source = audioCtx.createBufferSource();
            source.connect(audioCtx.destination);
            source.buffer = audio_pcm_data;
            source.start();
        }


        if (audio_pcm_data) {
            // update the frame index
            frameIndex++;
            if(frameIndex >= loadedFrames.length){
                frameIndex = 0;
            }
        }

        var end = new Date().getTime();
        var diff = end - start;

        if(playing){
                // delay the next gif frame
                setTimeout(function(){
                        requestAnimationFrame(renderFrame);
                        //renderFrame();
                }, Math.max(0, Math.floor(frame.delay - diff)));
        }
}
