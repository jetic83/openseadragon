/*
 * OpenSeadragon - ImageLoader
 *
 * Copyright (C) 2009 CodePlex Foundation
 * Copyright (C) 2010-2013 OpenSeadragon contributors

 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * - Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * - Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in the
 *   documentation and/or other materials provided with the distribution.
 *
 * - Neither the name of CodePlex Foundation nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

(function($){

/**
 * @private
 * @class ImageJob
 * @classdesc Handles downloading of a single image.
 * @param {Object} options - Options for this ImageJob.
 * @param {Object} [options.tiledImage] - The parent tiled image.
 * @param {String} [options.src] - URL of image to download.
 * @param {Boolean} [options.loadWithSignalR] - Whether to load this image with SignalR.
 * @param {String|Object} [options.signalRHub] - Hub (or name of a hub) to use when loading the image with SignalR.
 * @param {String} [options.loadWithAjax] - Whether to load this image with AJAX.
 * @param {String} [options.ajaxHeaders] - Headers to add to the image request if using AJAX.
 * @param {Boolean} [options.loadWithMultiServers] - Whether to load this image with multiple servers to balance the tile loading.
 * @param {Object} [options.multiServers] - Servers to load the image if using multiple Servers.
 * @param {String} [options.crossOriginPolicy] - CORS policy to use for downloads
 * @param {Function} [options.callback] - Called once image has been downloaded.
 * @param {Function} [options.abort] - Called when this image job is aborted.
 * @param {Number} [options.timeout] - The max number of milliseconds that this image job may take to complete.
 */
function ImageJob (options) {

    $.extend(true, this, {
        timeout: $.DEFAULT_SETTINGS.timeout,
        jobId: null
    }, options);

    /**
     * Image object which will contain downloaded image.
     * @member {Image} image
     * @memberof OpenSeadragon.ImageJob#
     */
    this.image = null;
}

ImageJob.prototype = {
    errorMsg: null,

    /**
     * Starts the image job.
     * @method
     */
    start: function(){
        var self = this;
        var selfAbort = this.abort;

        this.image = new Image();

        // Custom even for tile loading for logging (author bhavana.mallineni@paige.ai)
        this.tiledImage.viewer.raiseEvent("tile-load-start", {
            src: this.src,
        });

        this.image.onload = function(){
            self.finish(true);
        };
        this.image.onabort = this.image.onerror = function() {
            self.errorMsg = "Image load aborted";
            self.finish(false);
        };

        this.jobId = window.setTimeout(function(){
            self.errorMsg = "Image load exceeded timeout (" + self.timeout + " ms)";
            self.finish(false);
        }, this.timeout);

        // Load the tile with an open SignalR connection (webSocket) if the loadWithSignalR option is
        // set. Otherwise, load the image either with an AJAX request or by setting the source proprety of the image object.
        if (this.loadWithSignalR && this.signalRHub) {

            var signalRDownloadImageDataFromServer = function () {
                // The following function getTile(string url) has to be defined on the Hub on the server.
                // Its return value must be a structure with
                //     a property 'Base64' (the base64 encoded image string) and
                //     a property 'Mime' (the image format string, e.g. 'image/png').
                self.signalRHub.server.getTile(self.src).done(function (data) {
                    if (data) {
                        //*
                        // Alternative 1:
                        // Set the source of the image to the base64 string recieved from the server.
                        self.image.src = "data:" + data.Mime + ";base64," + data.Base64;

                        /*/
                        // Alternative 2:
                        // Create a blob object out of the base64 string revieved from the server.
                        // b64toBlob is commented/defined on bottom of this file.
                        var blb = b64toBlob(data.Base64, data.Mime);

                        // If the blob is empty for some reason consider the image load a failure.
                        if (typeof blb === "undefined" || blb.size === 0) {
                            self.errorMsg = "Image load aborted - Could not create blob.";
                            self.finish(false);
                        }
                        // Create a URL for the blob data and make it the source of the image object.
                        // This will still trigger Image.onload to indicate a successful tile load.
                        var url = (window.URL || window.webkitURL).createObjectURL(blb);
                        self.image.src = url;
                        //*/
                    } else {
                        // No data have been returned by the server
                        self.errorMsg = "Image load aborted - Empty image response.";
                        self.finish(false);
                    }
                }).fail(function (error) {
                    self.errorMsg = "Image load aborted - SignalR error: " + error;
                    self.finish(false);
                });
            };

            // If the signalR connection has not started yet, start it and download then the image...
            if (this.signalRHub.connection.state !== window.$.signalR.connectionState.connected) {
                window.$.connection.hub.start()
                    .done(function () {
                        // Uncomment following line to see the connection ID (for debugging).
                        //$.console.info('SignalR now connected, connection ID=' + window.$.connection.hub.id);

                        // Download the image with SignalR
                        signalRDownloadImageDataFromServer();
                    })
                    .fail(function () {
                        $.console.error('SignalR could not Connect!');
                    });
                /// ... otherwise download the image with SignalR directly.
            } else {
                signalRDownloadImageDataFromServer();
            }
        }

        // Load the tile with an AJAX request if the loadWithAjax option is
        // set. Otherwise load the image by setting the source proprety of the image object.
        else if (this.loadWithAjax) {
            this.request = $.makeAjaxRequest({
                url: this.src,
                withCredentials: this.ajaxWithCredentials,
                headers: this.ajaxHeaders,
                responseType: "arraybuffer",
                success: function (request) {
                    var blb;
                    // Make the raw data into a blob.
                    // BlobBuilder fallback adapted from
                    // http://stackoverflow.com/questions/15293694/blob-constructor-browser-compatibility
                    try {
                        blb = new window.Blob([request.response]);
                    } catch (e) {
                        var BlobBuilder = (
                            window.BlobBuilder ||
                            window.WebKitBlobBuilder ||
                            window.MozBlobBuilder ||
                            window.MSBlobBuilder
                        );
                        if (e.name === 'TypeError' && BlobBuilder) {
                            var bb = new BlobBuilder();
                            bb.append(request.response);
                            blb = bb.getBlob();
                        }
                    }
                    // If the blob is empty for some reason consider the image load a failure.
                    if (blb.size === 0) {
                        self.errorMsg = "Empty image response.";
                        self.finish(false);
                    }
                    // Create a URL for the blob data and make it the source of the image object.
                    // This will still trigger Image.onload to indicate a successful tile load.
                    var url = (window.URL || window.webkitURL).createObjectURL(blb);
                    self.image.src = url;
                },
                error: function (request) {
                    self.errorMsg = "Image load aborted - XHR error";
                    self.finish(false);
                }
            });

            // Provide a function to properly abort the request.
            this.abort = function () {
                self.request.abort();

                // Call the existing abort function if available
                if (typeof selfAbort === "function") {
                    selfAbort();
                }
            };
        // Balance the image to one of the multiple servers if loadWithMultiServers is set.
        } else if (this.loadWithMultiServers) {
            if (this.crossOriginPolicy !== false) {
                this.image.crossOrigin = this.crossOriginPolicy;
            }

            // do now balance label files: they are only located on the original server
            if (this.src.indexOf("labels_") !== -1 || this.src.indexOf("predictions_") !== -1) {
                this.image.src = this.src;
            } else {
                // devide the loading load to three servers
                var coords = this.src.split('/').slice(-1)[0].split('\\.')[0].split('_');
                var col = parseInt(coords[0], 10);
                var row = parseInt(coords[1], 10);

                if (col % 2 === 0) {
                    if (row % 2 === 0) {
                        this.image.src = this.multiServers[0] + this.src;
                    } else {
                        this.image.src = this.multiServers[1] + this.src;
                    }
                } else {
                    if (row % 2 === 0) {
                        this.image.src = this.multiServers[2] + this.src;
                    } else {
                        this.image.src = this.multiServers[3] + this.src;
                    }
                }
            }

        } else {
            if (this.crossOriginPolicy !== false) {
                this.image.crossOrigin = this.crossOriginPolicy;
            }

            this.image.src = this.src;
        }
    },

    finish: function(successful) {
        this.image.onload = this.image.onerror = this.image.onabort = null;
        if (!successful) {
            this.image = null;
        }

        if (this.jobId) {
            window.clearTimeout(this.jobId);
        }

        this.callback(this);
    }

};

/**
 * @class ImageLoader
 * @memberof OpenSeadragon
 * @classdesc Handles downloading of a set of images using asynchronous queue pattern.
 * You generally won't have to interact with the ImageLoader directly.
 * @param {Object} options - Options for this ImageLoader.
 * @param {Number} [options.jobLimit] - The number of concurrent image requests. See imageLoaderLimit in {@link OpenSeadragon.Options} for details.
 * @param {Number} [options.timeout] - The max number of milliseconds that an image job may take to complete.
 */
$.ImageLoader = function(options) {

    $.extend(true, this, {
        jobLimit:       $.DEFAULT_SETTINGS.imageLoaderLimit,
        timeout:        $.DEFAULT_SETTINGS.timeout,
        jobQueue:       [],
        jobsInProgress: 0
    }, options);

};

/** @lends OpenSeadragon.ImageLoader.prototype */
$.ImageLoader.prototype = {

    /**
     * Add an unloaded image to the loader queue.
     * @method
     * @param {Object} options - Options for this job.
     * @param {Object} [options.tiledImage] - The parent tiled image.
     * @param {String} [options.src] - URL of image to download.
     * @param {Boolean} [options.loadWithSignalR] - Whether to load this image with SignalR.
     * @param {String|Object} [options.signalRHub] - Hub (or name of a hub) to use when loading the image with SignalR.
     * @param {String} [options.loadWithAjax] - Whether to load this image with AJAX.
     * @param {String} [options.ajaxHeaders] - Headers to add to the image request if using AJAX.
     * @param {Boolean} [options.loadWithMultiServers] - Whether to load this image balanced over multiple servers.
     * @param {String} [options.multiServers] - Servers to load to image from if using multiple servers.
     * @param {String|Boolean} [options.crossOriginPolicy] - CORS policy to use for downloads
     * @param {Boolean} [options.ajaxWithCredentials] - Whether to set withCredentials on AJAX
     * requests.
     * @param {Function} [options.callback] - Called once image has been downloaded.
     * @param {Function} [options.abort] - Called when this image job is aborted.
     */
    addJob: function(options) {
        var _this = this,
            complete = function(job) {
                completeJob(_this, job, options.callback);
            },
            jobOptions = {
                tiledImage: options.tiledImage,
                src: options.src,
                loadWithSignalR: options.loadWithSignalR,
                signalRHub: options.loadWithSignalR ? options.signalRHub : null,
                loadWithAjax: options.loadWithAjax,
                ajaxHeaders: options.loadWithAjax ? options.ajaxHeaders : null,
                loadWithMultiServers: options.loadWithMultiServers,
                multiServers: options.multiServers ? options.multiServers : null,
                crossOriginPolicy: options.crossOriginPolicy,
                ajaxWithCredentials: options.ajaxWithCredentials,
                callback: complete,
                abort: options.abort,
                timeout: this.timeout
            },
            newJob = new ImageJob(jobOptions);

        if ( !this.jobLimit || this.jobsInProgress < this.jobLimit ) {
            newJob.start();
            this.jobsInProgress++;
        }
        else {
            this.jobQueue.push( newJob );
        }
    },

    /**
     * Clear any unstarted image loading jobs from the queue.
     * @method
     */
    clear: function() {
        for( var i = 0; i < this.jobQueue.length; i++ ) {
            var job = this.jobQueue[i];
            if ( typeof job.abort === "function" ) {
                job.abort();
            }
        }

        this.jobQueue = [];
    }
};

/**
 * Cleans up ImageJob once completed.
 * @method
 * @private
 * @param loader - ImageLoader used to start job.
 * @param job - The ImageJob that has completed.
 * @param callback - Called once cleanup is finished.
 */
function completeJob(loader, job, callback) {
    var nextJob;

    loader.jobsInProgress--;

    if ((!loader.jobLimit || loader.jobsInProgress < loader.jobLimit) && loader.jobQueue.length > 0) {
        nextJob = loader.jobQueue.shift();
        nextJob.start();
        loader.jobsInProgress++;
    }

    callback(job.image, job.errorMsg, job.request);
}

/**
 * Converts a base64 string to a blob.
 * @method
 * @private
 * @param b64Data - The image data as base 64 string.
 * @param contentType - The content MIME type of the blob. E.g. "image/jpg" or "image/png".
 * @param sliceSize - Default 512.
 * @returns A blob of the base64 string. Will be undefined if b64Data is undefined.
 */
/*function b64toBlob(b64Data, contentType, sliceSize) {
    var blob;
    if (b64Data) {
        contentType = contentType || '';
        sliceSize = sliceSize || 512;

        var byteCharacters = atob(b64Data);
        var byteArrays = [];

        for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            var slice = byteCharacters.slice(offset, offset + sliceSize);

            var byteNumbers = new Array(slice.length);
            for (var i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }

            var byteArray = new window.Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }

        // Make the raw data into a blob.
        // BlobBuilder fallback adapted from
        // http://stackoverflow.com/questions/15293694/blob-constructor-browser-compatibility
        try {
            blob = new Blob(byteArrays, { type: contentType });
        }
        catch (e) {
            // TypeError old chrome and FF
            window.BlobBuilder = window.BlobBuilder ||
                window.WebKitBlobBuilder ||
                window.MozBlobBuilder ||
                window.MSBlobBuilder;
            if (e.name == 'TypeError' && window.BlobBuilder) {
                var bb = new window.BlobBuilder();
                bb.append(byteArrays.buffer);
                blob = bb.getBlob(contentType);
            }
            else if (e.name == "InvalidStateError") {
                // InvalidStateError (tested on FF13 WinXP)
                blob = new Blob([byteArrays.buffer], { type: contentType });
            }
            else {
               // We're screwed, blob constructor unsupported entirely
            }
        }
    }
    return blob;
}*/

}(OpenSeadragon));
